// Manual personal records: App_Records on the real Code.gs, the client store + sync engine,
// and compatibility with the Apps Script that is deployed today (API 1, no records).
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
const API1 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/apps-script/Code.api1.gs'), 'utf8');

let clock = 1_760_100_000_000;
const now = () => (clock += 11);

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

const HAMMER = { seriesKey: 'naklonnyy-zhim-hammer-naklon', exercise: 'Наклонный жим: Hammer - наклон', category: 'hammer' };
const record = (extra = {}) => ({ ...HAMMER, date: '2025-06-01', weight: 100, reps: 6, rir: 1, note: 'до перерыва', ...extra });

test('App_Records: readable rows, idempotent resend, last writer wins, deletion is a flag', () => {
  const gas = createGas();
  const token = gas.call('setup');
  assert.ok(gas.sheet('App_Records'), 'setup creates App_Records');
  const rec = { ...record(), id: 'pr-1', createdAt: 1000, updatedAt: 1000, deleted: false };
  const req = { action: 'sync', token, since: 0, push: { records: [rec] } };
  const r1 = gas.post(req);
  assert.ok(r1.api >= 2);
  assert.equal(r1.ack.records, 1);
  gas.post(req);
  const sh = gas.sheet('App_Records');
  assert.equal(sh.getLastRow(), 2, 'header + one row after a resend');
  assert.deepEqual(sh.rows()[0].slice(0, 4), ['date', 'exercise', 'weight_kg', 'reps']);
  assert.deepEqual(sh.rows()[1].slice(1, 4), ['Наклонный жим: Hammer - наклон', 100, 6]);

  gas.post({ action: 'sync', token, push: { records: [{ ...rec, weight: 95, updatedAt: 900 }] } });
  gas.post({ action: 'sync', token, push: { records: [{ ...rec, deleted: true, updatedAt: 2000 }] } });
  const pulled = gas.post({ action: 'sync', token, since: 0 }).pull.records;
  assert.equal(pulled.length, 1);
  assert.equal(pulled[0].weight, 100, 'an older version does not overwrite');
  assert.equal(pulled[0].deleted, true);
  assert.equal(pulled[0].date, '2025-06-01');
  assert.equal(pulled[0].rir, 1);
});

test('a record without reps, weight, date or exercise is refused and stays queued', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const res = gas.post({ action: 'sync', token, push: { records: [{ id: 'bad', seriesKey: 'x', date: '2026-01-01', weight: 50, updatedAt: 5 }] } });
  assert.deepEqual(res.rejected, [{ entity: 'records', id: 'bad' }]);
  assert.equal(gas.sheet('App_Records').getLastRow(), 1);
});

test('offline: a manual record is kept, survives a restart, syncs once online and reaches another device', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(token, net);
  net.online = false;
  const saved = await a.store.saveRecord(record());
  assert.equal((await a.sync.syncNow()).state, 'offline');

  const again = await device(token, net, a.adapter); // the app was closed and reopened
  assert.deepEqual(again.store.state.records.get(saved.id), saved);
  assert.equal(again.store.state.outbox.size, 1);
  net.online = true;
  const st = await again.sync.syncNow();
  assert.equal(st.state, 'idle');
  assert.equal(st.pending, 0);
  assert.equal(gas.sheet('App_Records').getLastRow(), 2);

  const b = await device(token, net);
  await b.sync.syncNow();
  assert.equal(b.store.state.records.get(saved.id).weight, 100);
  // An edit and a deletion travel the same way, the id never changes.
  await b.store.saveRecord({ ...b.store.state.records.get(saved.id), weight: 102.5 });
  await b.sync.syncNow();
  await again.sync.syncNow();
  assert.equal(again.store.state.records.get(saved.id).weight, 102.5);
  await again.store.deleteRecord(saved.id);
  await again.sync.syncNow();
  await b.sync.syncNow();
  assert.equal(b.store.state.records.get(saved.id).deleted, true);
  assert.equal(gas.sheet('App_Records').getLastRow(), 2, 'still one row: edits and deletion update it in place');
});

test('old Apps Script (API 1): records are never treated as saved; they reach the sheet after the update', async () => {
  const gas = createGas({ code: API1 });
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(token, net);
  const s = await a.store.startSession({ cycle: 1, week: 2, day: 1 });
  await a.store.saveRecord(record());
  const st = await a.sync.syncNow();
  assert.equal(st.state, 'idle', 'not an error: everything else synced');
  assert.equal(a.store.state.outbox.size, 1, 'the record is still queued');
  assert.deepEqual([st.pending, st.waiting], [0, 1], 'waiting for the script, not pending: no retries every minute');
  assert.match(st.notice, /Сохранены на телефоне .*: рекорды, добавленные вручную — 1\./);
  assert.equal(gas.sheet('App_Records'), null, 'the old script does not know records');
  assert.equal(gas.sheet('App_Sessions').getLastRow(), 2, 'the workout itself synced');
  assert.ok(a.store.state.sessions.get(s.id));

  // Repeated syncs keep it queued — never acknowledged by mistake.
  await a.sync.syncNow();
  assert.equal(a.store.state.outbox.size, 1);

  // The owner pastes the new Code.gs and deploys a new version (same URL and key).
  gas.redeploy();
  const st2 = await a.sync.syncNow();
  assert.deepEqual([st2.pending, st2.waiting, a.store.state.outbox.size], [0, 0, 0]);
  assert.equal(st2.notice, null);
  assert.equal(gas.sheet('App_Records').getLastRow(), 2);
});

test('backup includes manual records and restores them without duplicates', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(token, net);
  await a.store.saveRecord(record());
  const backup = JSON.parse(JSON.stringify(a.store.exportAll()));
  assert.equal(backup.records.length, 1);
  const b = await device(token, net);
  await b.store.importBackup(backup);
  await b.store.importBackup(backup);
  assert.equal(b.store.state.records.size, 1);
});

test('a device that synced on a release without records still gets every record after updating', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(token, net);
  await a.store.saveRecord(record());
  await a.sync.syncNow();

  // Phone B still runs build 7705635 (no records): it pulls, ignores the record, moves its cursor.
  const Old = {
    ...(await import('../fixtures/releases/7705635/js/data/store.js')),
    ...(await import('../fixtures/releases/7705635/js/data/sync.js')),
  };
  const adapter = memoryAdapter(); // the IndexedDB of the update keeps the data and gains the store
  const oldStore = Old.createStore(adapter, { now });
  await oldStore.load();
  await oldStore.setKV({ sync: { url: 'https://example/exec', token } });
  await Old.createSync(oldStore, { transport: net.transport, now }).syncNow();
  assert.ok(oldStore.state.kv.cursor > 0, 'the old client moved past the record');

  // B updates: same storage, new code — the record arrives anyway, exactly once.
  const b = await device(token, net, adapter);
  assert.equal(b.store.state.records.size, 0);
  await b.sync.syncNow();
  assert.equal(b.store.state.records.size, 1);
  assert.equal(b.store.state.kv.recordsPulled, true);
  await b.sync.syncNow();
  assert.equal(b.store.state.records.size, 1);
});
