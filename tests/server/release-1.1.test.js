// Release v1.1.0 checks: the owner's sheet goes from the API 4 script installed on 19.10 to API 5
// with its rows untouched; the v1.0.2 app (still on the phone until Pages updates) keeps syncing
// workouts, check-ins, records and exercise settings with API 5, and the v1.1 app sees all of it.
// Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas } from '../helpers/fake-gas.js';
import { createStore } from '../../app/js/data/store.js';
import { memoryAdapter } from '../../app/js/data/db.js';
import { createSync } from '../../app/js/data/sync.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API4 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/apps-script/Code.api4.gs'), 'utf8');

let clock = 1_792_500_000_000;
const now = () => (clock += 17);
const post = (gas) => async (_u, p) => gas.post(JSON.parse(JSON.stringify(p)));

const table = (gas, name) => gas.sheet(name)?.rows() ?? null;

async function oldPhone(gas, token) {
  const old = await import('../fixtures/releases/bf41b45/js/data/store.js');
  const oldDb = await import('../fixtures/releases/bf41b45/js/data/db.js');
  const oldSync = await import('../fixtures/releases/bf41b45/js/data/sync.js');
  const store = old.createStore(oldDb.memoryAdapter(), { now });
  await store.load();
  await store.setKV({ sync: { url: 'https://example/exec', token } });
  return { store, sync: oldSync.createSync(store, { transport: post(gas), now }) };
}

async function newPhone(gas, token) {
  const store = createStore(memoryAdapter(), { now });
  await store.load();
  await store.setKV({ sync: { url: 'https://example/exec', token } });
  return { store, sync: createSync(store, { transport: post(gas), now }) };
}

test('API 4 → API 5 on the same sheet: every existing row stays as it was, App_Phases is added, the key and the Shortcuts key still work', async () => {
  const gas = createGas({ code: API4 });
  const token = gas.call('setup');
  const key = gas.call('showIngestKey');
  // What the sheet holds today: a workout and records from v1.0.2, measurements and sleep from «Команды».
  const phone = await oldPhone(gas, token);
  const s = await phone.store.startSession({ cycle: 1, week: 1, day: 1 });
  await phone.store.logSet(s.id, s.items[0].slotId, { weight: 100, reps: 5, rir: 2 });
  await phone.store.finishSession(s.id);
  await phone.store.saveMetric('2026-10-18', { bodyweight: 81, sleep: 8, recovery: 4 });
  await phone.sync.syncNow();
  gas.post({ action: 'ingest', key, type: 'weight', lines: '81.25|2026-10-19T21:36:08+03:00|2026-10-19T21:36:08+03:00|Zepp Life' });
  gas.post({ action: 'ingest', key, type: 'sleep', lines: 'Core|2026-10-19T00:00:00+03:00|2026-10-19T07:00:00+03:00|' });
  const names = ['App_Sessions', 'App_Sets', 'App_Metrics', 'App_Records', 'App_Exercises', 'App_Body', 'App_Sleep', 'App_HealthLog'];
  const before = Object.fromEntries(names.map((n) => [n, JSON.stringify(table(gas, n))]));
  assert.equal(table(gas, 'App_Phases'), null);

  gas.redeploy();
  assert.equal(gas.post({ action: 'ping', token }).api, 5);
  const v11 = await newPhone(gas, token);
  await v11.sync.syncNow();
  assert.equal(v11.sync.status.state, 'idle');
  for (const n of names.filter((x) => x !== 'App_HealthLog')) assert.equal(JSON.stringify(table(gas, n)), before[n], `${n} unchanged`);
  assert.deepEqual(table(gas, 'App_Phases')[0].slice(0, 4), ['start', 'end', 'mode', 'target_pct_week']);
  // The phone got everything: the workout, the check-in, the Shortcuts weigh-in and night.
  assert.equal(v11.store.state.sets.size, 1);
  assert.equal(v11.store.state.metrics.size, 1);
  assert.equal(v11.store.state.body.size, 1);
  assert.equal(v11.store.state.sleep.size, 1);
  // The same Shortcuts key keeps working after the update.
  assert.equal(gas.post({ action: 'ingest', key, type: 'waist', lines: '84.5|2026-10-19T18:06:05+03:00|2026-10-19T18:06:05+03:00|Fitdays+' }).added, 1);
});

test('v1.0.2 and v1.1 side by side on API 5: workouts, check-ins and records go both ways; v1.0.2 never receives what it does not know', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const old = await oldPhone(gas, token);
  const neu = await newPhone(gas, token);

  const s = await old.store.startSession({ cycle: 1, week: 2, day: 1 });
  await old.store.logSet(s.id, s.items[0].slotId, { weight: 102.5, reps: 5, rir: 1 });
  await old.store.finishSession(s.id);
  await old.store.saveRecord({ date: '2026-10-10', seriesKey: 'bench', exercise: 'Жим', weight: 110, reps: 1 });
  await old.sync.syncNow();
  assert.equal(old.sync.status.state, 'idle');

  await neu.store.savePhase({ mode: 'bulk', start: '2026-10-01', targetPct: 0.25 });
  await neu.store.addBody({ kind: 'waist', value: 84.5, measuredAt: '2026-10-19T18:06' });
  const s2 = await neu.store.startSession({ cycle: 1, week: 2, day: 2 });
  await neu.store.logSet(s2.id, s2.items[0].slotId, { weight: 60, reps: 10, rir: 2 });
  await neu.store.finishSession(s2.id);
  await neu.sync.syncNow();
  await old.sync.syncNow();

  assert.equal(neu.store.state.sets.size, 2);
  assert.equal(old.store.state.sets.size, 2);
  assert.equal(old.sync.status.error, null);
  assert.equal(old.store.state.phases, undefined);
  assert.equal(old.store.state.body, undefined);
  assert.equal(table(gas, 'App_Sets').length - 1, 2);
  assert.equal(table(gas, 'App_Phases').length - 1, 1);
  // The manual record from v1.0.2 reaches the sheet and the v1.1 phone.
  assert.equal(table(gas, 'App_Records').length - 1, 1);
  assert.equal([...neu.store.state.records.values()][0].weight, 110);
});
