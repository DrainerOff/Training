// Body measurements and sleep (App_Body, App_Sleep) on the real Code.gs: import, re-import, undo,
// edits, two devices, offline, the v1.0.2 Apps Script (API 3) and the old tabs. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas } from '../helpers/fake-gas.js';
import { createStore } from '../../app/js/data/store.js';
import { memoryAdapter } from '../../app/js/data/db.js';
import { createSync, SyncError } from '../../app/js/data/sync.js';
import { parseFile, planImport, dailyWeights } from '../../app/js/lib/bodydata.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API3 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/apps-script/Code.api3.gs'), 'utf8');
const MSK = { offset: () => 180 };

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

function rows(gas, name) {
  const sh = gas.sheet(name);
  if (!sh) return [];
  const [head, ...data] = sh.rows();
  return data.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const WEIGHT = 'local_datetime,weight_kg,source\n2026-10-01 07:10:05 +0300,80.10,Zepp Life\n2026-10-02 07:12:40 +0300,79.85,Zepp Life\n2026-10-03 07:05:00 +0300,80.30,Zepp Life\n';
const FITDAYS = 'Время,Шея,Талия,Л Рука\n19/10/2026 18:06,38.0 cm,84.5 cm,--\n19/10/2026 18:06,--,84.5 cm,35.5 cm\n';
const SLEEP = 'wake_date,sleep_start_local,sleep_end_local,sleep_hours,core_hours,deep_hours,rem_hours,unspecified_hours,segments,method\n2026-10-18,2026-10-17 23:30:00 +0300,2026-10-18 07:00:00 +0300,7.2,4.5,1.2,1.5,0,3,stages\n';

async function importText(store, text, batch) {
  const plan = planImport(parseFile(text, MSK), { body: store.state.body, sleep: store.state.sleep }, { batch, now: now() });
  if (plan.add.length) await store.importBody(plan, { batch, file: 'test.csv' });
  return plan;
}

test('an import reaches App_Body / App_Sleep once and the other device; re-import on either adds nothing', async () => {
  const gas = createGas({ legacy: { 'Журнал': [['Дата', 'Вес']], 'Замеры': [['Дата', 'Талия']] } });
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(token, net);
  const b = await device(token, net);
  const p1 = await importText(a.store, WEIGHT, 'w1');
  const p2 = await importText(a.store, FITDAYS, 'f1');
  const p3 = await importText(a.store, SLEEP, 's1');
  assert.deepEqual([p1.add.length, p2.add.length, p3.add.length], [3, 4, 1]);
  await a.sync.syncNow();
  await a.sync.syncNow();
  assert.equal(a.sync.status.state, 'idle');
  const body = rows(gas, 'App_Body');
  assert.equal(body.length, 7);
  assert.deepEqual(
    body.filter((r) => r.kind === 'waist').map((r) => [r.measured_at, r.value, r.id]),
    [
      ['2026-10-19T18:06+03:00', 84.5, 'b:waist:fitdays:20261019T1506:8450'],
      ['2026-10-19T18:06+03:00', 84.5, 'b:waist:fitdays:20261019T1506:8450:2'],
    ],
  );
  assert.equal(body[0].excluded, '', 'no decision yet = empty cell');
  assert.deepEqual(rows(gas, 'App_Sleep').map((r) => [r.wake_date, r.sleep_h, r.deep_h, r.id]), [['2026-10-18', 7.2, 1.2, 's:2026-10-18']]);

  await b.sync.syncNow();
  assert.equal(b.store.state.body.size, 7);
  assert.equal(b.store.state.sleep.get('s:2026-10-18').hours, 7.2);
  assert.equal((await importText(b.store, WEIGHT, 'w2')).add.length, 0);
  assert.equal((await importText(b.store, FITDAYS, 'f2')).add.length, 0);
  assert.equal((await importText(b.store, SLEEP, 's2')).add.length, 0);
  await b.sync.syncNow();
  assert.equal(rows(gas, 'App_Body').length, 7);

  // The old tabs are never touched.
  assert.deepEqual(gas.sheet('Журнал').rows(), [['Дата', 'Вес']]);
  assert.deepEqual(gas.sheet('Замеры').rows(), [['Дата', 'Талия']]);
});

test('a correction and a deletion survive a re-import and reach the other device', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(token, net);
  const b = await device(token, net);
  const plan = await importText(a.store, WEIGHT, 'w1');
  const [first, second] = plan.add;
  await a.store.editBody(second.id, { value: 79.5, note: 'в одежде, поправил' });
  await a.store.deleteBody(first.id);
  await a.sync.syncNow();
  await b.sync.syncNow();
  const re = await importText(b.store, WEIGHT, 'w2');
  assert.equal(re.add.length, 0);
  assert.equal(re.kept, 1);
  assert.equal(re.deleted, 1);
  const r = b.store.state.body.get(second.id);
  assert.deepEqual([r.value, r.origValue, r.edited], [79.5, 79.85, true]);
  assert.equal(b.store.state.body.get(first.id).deleted, true);
  const row = rows(gas, 'App_Body').find((x) => x.id === second.id);
  assert.deepEqual([row.value, row.orig_value, row.edited], [79.5, 79.85, true]);
});

test('undo of an import removes it everywhere; importing the file again brings it back', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(token, net);
  const b = await device(token, net);
  const plan = await importText(a.store, WEIGHT, 'w1');
  await a.store.editBody(plan.add[0].id, { note: 'утром' }); // a note is not a correction of the value
  await a.store.editBody(plan.add[2].id, { value: 80.0 });
  await a.sync.syncNow();
  const n = await a.store.undoImport('w1');
  assert.equal(n, 2, 'the corrected row stays');
  assert.equal(a.store.state.kv.bodyImports[0].undone, true);
  await a.sync.syncNow();
  await b.sync.syncNow();
  assert.equal([...b.store.state.body.values()].filter((r) => !r.deleted).length, 1);
  const back = await importText(b.store, WEIGHT, 'w2');
  assert.equal(back.add.length, 2);
  assert.deepEqual(back.add.map((r) => r.id), [plan.add[0].id, plan.add[1].id]);
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.equal([...a.store.state.body.values()].filter((r) => !r.deleted).length, 3);
  assert.equal(rows(gas, 'App_Body').length, 3);
});

test('offline import survives a restart and syncs later; a manual weigh-in keeps v1.0 weights from counting twice', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(token, net);
  await a.store.saveMetric('2026-10-02', { bodyweight: 82 }); // v1.0 check-in, same day as an import
  await a.store.saveMetric('2026-09-30', { bodyweight: 81 });
  net.online = false;
  await importText(a.store, WEIGHT, 'w1');
  const manual = await a.store.addBody({ kind: 'waist', value: 85, measuredAt: '2026-10-03T08:00+03:00' });
  assert.match(manual.id, /^b:waist:manual:20261003T0500:8500$/);
  await a.sync.syncNow();
  assert.equal(a.sync.status.state, 'offline');
  const restarted = await device(token, net, a.adapter);
  assert.equal(restarted.store.state.body.size, 4);
  net.online = true;
  await restarted.sync.syncNow();
  assert.equal(rows(gas, 'App_Body').length, 4);
  const { days, shadowed } = dailyWeights(restarted.store.state.body.values(), restarted.store.state.metrics.values());
  assert.deepEqual(days.map((d) => [d.date, d.bodyweight, d.from]), [
    ['2026-09-30', 81, 'metrics'],
    ['2026-10-01', 80.1, 'body'],
    ['2026-10-02', 79.85, 'body'],
    ['2026-10-03', 80.3, 'body'],
  ]);
  assert.deepEqual([...shadowed], ['m2026-10-02']);
  assert.equal(rows(gas, 'App_Metrics').length, 2, 'App_Metrics is left as it was');
});

test('the sheet refuses broken body and sleep rows', () => {
  const gas = createGas();
  const token = gas.call('setup');
  const ok = { id: 'b:weight:manual:20261001T0400:8000', kind: 'weight', value: 80, measuredAt: '2026-10-01T07:00+03:00', date: '2026-10-01', updatedAt: 5 };
  const bad = [
    { ...ok, value: 900 },
    { ...ok, kind: 'mood' },
    { ...ok, id: 'b:waist:manual:x' },
    { ...ok, measuredAt: '1 октября' },
    { ...ok, date: '2026-10-02' },
  ];
  const sleepOk = { id: 's:2026-10-18', wakeDate: '2026-10-18', hours: 7, updatedAt: 5 };
  const res = gas.post({ action: 'sync', token, since: 0, push: { body: [ok, ...bad], sleep: [sleepOk, { ...sleepOk, id: 's:2026-10-19' }, { ...sleepOk, hours: 30 }] } });
  assert.equal(res.api, 5);
  assert.deepEqual(res.ack, { sessions: 0, sets: 0, metrics: 0, records: 0, exercises: 0, body: 1, sleep: 1, phases: 0 });
  assert.equal(res.rejected.length, 7);
  const owner = rows(gas, 'App_Body')[0];
  assert.equal(owner.value, 80);
  // The owner's decision on a weigh-in is three-state and round-trips: empty, TRUE, FALSE.
  gas.post({ action: 'sync', token, since: 0, push: { body: [{ ...ok, excluded: false, updatedAt: 6 }] } });
  const pulled = gas.post({ action: 'sync', token, since: 0, push: {} }).pull.body[0];
  assert.equal(pulled.excluded, false);
  gas.post({ action: 'sync', token, since: 0, push: { body: [{ ...ok, excluded: null, updatedAt: 7 }] } });
  assert.equal(gas.post({ action: 'sync', token, since: 0, push: {} }).pull.body[0].excluded, null);
});

test('a hand edit of App_Body reaches the phone', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(token, net);
  const rec = await a.store.addBody({ kind: 'weight', value: 80, measuredAt: '2026-10-01T07:00+03:00' });
  await a.sync.syncNow();
  const sh = gas.sheet('App_Body');
  const head = sh.rows()[0];
  gas.edit('App_Body', 2, head.indexOf('excluded') + 1, true);
  await a.sync.syncNow();
  assert.equal(a.store.state.body.get(rec.id).excluded, true);
});

test('Apps Script of v1.0.2 (API 3): measurements wait on the phone, workouts sync; after the update they arrive', async () => {
  const gas = createGas({ code: API3 });
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(token, net);
  await importText(a.store, FITDAYS, 'f1');
  await importText(a.store, SLEEP, 's1');
  const s = await a.store.startSession({ cycle: 1, week: 1, day: 1 });
  await a.sync.syncNow();
  const st = a.sync.status;
  assert.equal(st.state, 'idle');
  assert.deepEqual(st.waitingBy, { body: 4, sleep: 1 });
  assert.match(st.notice, /замеры тела — 4; сон — 1/);
  assert.equal(gas.sheet('App_Body'), null);
  assert.ok(gas.sheet('App_Sessions').rows().some((r) => r.includes(s.id)));

  gas.redeploy();
  await a.sync.syncNow();
  assert.equal(a.sync.status.waiting, 0);
  assert.equal(rows(gas, 'App_Body').length, 4);
  assert.equal(rows(gas, 'App_Sleep').length, 1);
});

test('a device that synced on v1.0.2 after another one sent measurements still gets them once it updates', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(token, net);
  const b = await device(token, net);
  await importText(a.store, WEIGHT, 'w1');
  await a.sync.syncNow();
  await a.store.saveMetric('2026-10-05', { recovery: 4 });
  await a.sync.syncNow();
  // b ran v1.0.2: its cursor passed the App_Body rows without keeping them.
  await b.store.setKV({ cursor: 9e15 });
  await b.sync.syncNow();
  assert.equal(b.store.state.body.size, 3);
  assert.equal(b.store.state.kv.bodyPulled, true);
});

test('backup of the spreadsheet: a full copy, every tab included, nothing changed', () => {
  const gas = createGas({ legacy: { 'Журнал': [['Дата', 'Вес']] } });
  gas.call('setup');
  const id = gas.call('backupSpreadsheet');
  const copy = gas.spreadsheet.copies[0];
  assert.equal(copy.id, id);
  assert.match(copy.name, /резервная копия/);
  assert.ok(copy.sheets.some((s) => s.name === 'Журнал'));
  assert.ok(copy.sheets.some((s) => s.name === 'App_Body'));
  assert.deepEqual(gas.sheet('Журнал').rows(), [['Дата', 'Вес']]);
});

test('a backup file of the app carries measurements and sleep', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(token, net);
  await importText(a.store, FITDAYS, 'f1');
  await importText(a.store, SLEEP, 's1');
  const backup = JSON.parse(JSON.stringify(a.store.exportAll()));
  const c = await device(token, net);
  await c.store.importBackup(backup);
  assert.equal(c.store.state.body.size, 4);
  assert.equal(c.store.state.sleep.size, 1);
});
