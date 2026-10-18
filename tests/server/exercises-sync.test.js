// Per-variant exercise settings (seat, handles, stops…): App_Exercises on the real Code.gs, two
// devices, offline, and the Apps Script the owner runs until the update (API 2, v1.0.0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas } from '../helpers/fake-gas.js';
import { createStore } from '../../app/js/data/store.js';
import { memoryAdapter } from '../../app/js/data/db.js';
import { createSync, SyncError } from '../../app/js/data/sync.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API2 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/apps-script/Code.api2.gs'), 'utf8');

let clock = 1_792_500_000_000;
const now = () => (clock += 17);

function network(gas) {
  const net = { online: true };
  net.transport = async (url, payload) => {
    if (!net.online) throw new SyncError('network', 'offline');
    return gas.post(JSON.parse(JSON.stringify(payload)));
  };
  return net;
}

async function device(token, net, adapter = memoryAdapter()) {
  const store = createStore(adapter, { now });
  await store.load();
  if (!store.state.kv.sync) await store.setKV({ sync: { url: 'https://example/exec', token } });
  return { adapter, store, sync: createSync(store, { transport: net.transport, now }) };
}

const PEC = ['obratnaya-babochka-dvumya-rukami', 'Обратная бабочка двумя руками'];
const ONE = ['obratnaya-babochka-odnoy-rukoy', 'Обратная бабочка одной рукой'];

function rows(gas) {
  const [head, ...data] = gas.sheet('App_Exercises').rows();
  return data.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

test('settings belong to one variant, reach App_Exercises once and the other device; last edit wins', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(token, net);
  const b = await device(token, net);
  await a.store.saveSetup(...PEC, 'сиденье 5, ручки 3');
  await a.store.saveSetup(...ONE, 'сиденье 4');
  assert.equal(a.store.setupOf(PEC[0]), 'сиденье 5, ручки 3');
  assert.equal(a.store.setupOf(ONE[0]), 'сиденье 4');
  assert.equal(a.store.setupOf('krossover-na-zadnyuyu-deltu'), '');
  await a.sync.syncNow();
  await a.sync.syncNow(); // a resend changes nothing
  assert.deepEqual(rows(gas).map((r) => [r.exercise, r.setup, r.series_key, r.id]), [
    ['Обратная бабочка двумя руками', 'сиденье 5, ручки 3', PEC[0], `x:${PEC[0]}`],
    ['Обратная бабочка одной рукой', 'сиденье 4', ONE[0], `x:${ONE[0]}`],
  ]);

  await b.sync.syncNow();
  assert.equal(b.store.setupOf(PEC[0]), 'сиденье 5, ручки 3');
  await b.store.saveSetup(...PEC, 'сиденье 6, ручки 3');
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.equal(a.store.setupOf(PEC[0]), 'сиденье 6, ручки 3');
  assert.equal(rows(gas).length, 2, 'one row per variant, never two');

  // Cleared text stays a row (with an empty value), so the clearing reaches every device too.
  await a.store.saveSetup(...ONE, '');
  await a.sync.syncNow();
  await b.sync.syncNow();
  assert.equal(b.store.setupOf(ONE[0]), '');
  assert.equal(rows(gas).length, 2);
});

test('offline edit survives a restart and syncs later; a backup carries the settings', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(token, net);
  net.online = false;
  await a.store.saveSetup(...PEC, 'упор на 2-м отверстии');
  await a.sync.syncNow();
  const again = await device(token, net, a.adapter);
  assert.equal(again.store.setupOf(PEC[0]), 'упор на 2-м отверстии');
  net.online = true;
  await again.sync.syncNow();
  assert.equal(rows(gas)[0].setup, 'упор на 2-м отверстии');

  const backup = JSON.parse(JSON.stringify(again.store.exportAll()));
  const c = await device(token, net);
  await c.store.importBackup(backup);
  assert.equal(c.store.setupOf(PEC[0]), 'упор на 2-м отверстии');
});

test('long text is cut to a short note; a row whose id does not match its variant is refused', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(token, net);
  const rec = await a.store.saveSetup(...PEC, 'x'.repeat(1000));
  assert.equal(rec.setup.length, 300);
  const res = gas.post({ action: 'sync', token, since: 0, push: { exercises: [{ id: 'x:other', seriesKey: PEC[0], exercise: PEC[1], setup: 'a', updatedAt: 5 }] } });
  assert.equal(res.ack.exercises, 0);
  assert.equal(res.rejected.length, 1);
});

test('Apps Script of v1.0.0 (API 2): settings wait on the phone, nothing else is held up; after the update they arrive', async () => {
  const gas = createGas({ code: API2 });
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(token, net);
  await a.store.saveSetup(...PEC, 'сиденье 5');
  const s = await a.store.startSession({ cycle: 1, week: 2, day: 1 });
  await a.sync.syncNow();
  const st = a.sync.status;
  assert.equal(st.state, 'idle');
  assert.equal(st.waiting, 1);
  assert.equal(st.waitingBy.exercises, 1);
  assert.equal(st.pending, 0, 'waiting for the script is not «в очереди»');
  assert.match(st.notice, /настройки упражнений — 1/);
  assert.equal(gas.sheet('App_Exercises'), null);
  assert.ok(gas.sheet('App_Sessions').rows().some((r) => r.includes(s.id)), 'workouts sync as usual');

  gas.redeploy(); // the owner pastes the new Code.gs and deploys a new version (same URL, same key)
  await a.sync.syncNow();
  assert.equal(a.sync.status.waiting, 0);
  assert.equal(a.sync.status.notice, null);
  assert.equal(rows(gas)[0].setup, 'сиденье 5');
});

test('a device that synced on v1.0.0 after settings were saved still gets them once it updates', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(token, net);
  await a.store.saveSetup(...PEC, 'сиденье 5');
  await a.sync.syncNow();

  // Phone B still runs v1.0.0 (the code of 3f386f8): it pulls, ignores App_Exercises, moves its cursor.
  const Old = {
    ...(await import('../fixtures/releases/3f386f8/js/data/store.js')),
    ...(await import('../fixtures/releases/3f386f8/js/data/sync.js')),
  };
  const adapter = memoryAdapter();
  const oldStore = Old.createStore(adapter, { now });
  await oldStore.load();
  await oldStore.setKV({ sync: { url: 'https://example/exec', token } });
  await Old.createSync(oldStore, { transport: net.transport, now }).syncNow();
  assert.ok(oldStore.state.kv.cursor > 0);
  assert.equal(oldStore.state.kv.recordsPulled, true);

  const b = await device(token, net, adapter);
  assert.equal(b.store.setupOf(PEC[0]), '');
  await b.sync.syncNow();
  assert.equal(b.store.setupOf(PEC[0]), 'сиденье 5');
  assert.equal(b.store.state.kv.exercisesPulled, true);
  await b.sync.syncNow();
  assert.equal(b.store.state.exercises.size, 1);
});
