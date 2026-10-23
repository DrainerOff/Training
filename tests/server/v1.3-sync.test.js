// v1.3 on the real Code.gs (API 6) and on the API 5 script the owner runs until the update: the
// share of body weight per variant, a field an older app does not send keeps its cell, the restore
// check (read-only), and when «Команды» last delivered Health data. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas } from '../helpers/fake-gas.js';
import { createStore } from '../../app/js/data/store.js';
import { memoryAdapter } from '../../app/js/data/db.js';
import { createSync, restoreReport, SYNCED } from '../../app/js/data/sync.js';
import { healthDelivery } from '../../app/js/lib/health.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API5 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/apps-script/Code.api5.gs'), 'utf8');

let clock = 1_792_900_000_000;
const now = () => (clock += 17);
const post = (gas) => async (_u, p) => gas.post(JSON.parse(JSON.stringify(p)));

async function phone(gas, token, adapter = memoryAdapter()) {
  const store = createStore(adapter, { now });
  await store.load();
  if (!store.state.kv.sync) await store.setKV({ sync: { url: 'https://example/exec', token } });
  return { store, sync: createSync(store, { transport: post(gas), now }) };
}
async function olderPhone(gas, token) {
  const old = await import('../fixtures/releases/bf41b45/js/data/store.js');
  const oldDb = await import('../fixtures/releases/bf41b45/js/data/db.js');
  const oldSync = await import('../fixtures/releases/bf41b45/js/data/sync.js');
  const store = old.createStore(oldDb.memoryAdapter(), { now });
  await store.load();
  await store.setKV({ sync: { url: 'https://example/exec', token } });
  return { store, sync: oldSync.createSync(store, { transport: post(gas), now }) };
}
function rows(gas, name) {
  const [head, ...data] = gas.sheet(name).rows();
  return data.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

test('body-weight share per variant: kept in App_Exercises, reaches the other phone; an older app editing the setup text keeps it', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const a = await phone(gas, token);
  await a.store.saveSetup('otzhimaniya-na-brusyah', 'Отжимания на брусьях', 'упор узкий', { bwShare: 0.95 });
  await a.sync.syncNow();
  assert.equal(rows(gas, 'App_Exercises')[0].bw_share, 0.95);
  const b = await phone(gas, token);
  await b.sync.syncNow();
  assert.equal(b.store.setupRecord('otzhimaniya-na-brusyah').bwShare, 0.95);
  // Text only: the share stays; share only: the text stays; empty share = by category again.
  await b.store.saveSetup('otzhimaniya-na-brusyah', 'Отжимания на брусьях', 'упор широкий');
  assert.equal(b.store.setupRecord('otzhimaniya-na-brusyah').bwShare, 0.95);
  await b.store.saveSetup('otzhimaniya-na-brusyah', 'Отжимания на брусьях', null, { bwShare: null });
  assert.deepEqual([b.store.setupOf('otzhimaniya-na-brusyah'), b.store.setupRecord('otzhimaniya-na-brusyah').bwShare], ['упор широкий', null]);
  await b.store.saveSetup('otzhimaniya-na-brusyah', 'Отжимания на брусьях', null, { bwShare: 0.9 });
  await b.sync.syncNow();

  // An older app (v1.0.2) on another device knows nothing of bw_share: its edit of the text must not wipe the cell.
  const old = await olderPhone(gas, token);
  await old.sync.syncNow();
  await old.store.saveSetup('otzhimaniya-na-brusyah', 'Отжимания на брусьях', 'упор широкий, наклон');
  await old.sync.syncNow();
  const row = rows(gas, 'App_Exercises')[0];
  assert.deepEqual([row.setup, row.bw_share], ['упор широкий, наклон', 0.9]);
  await a.sync.syncNow();
  assert.equal(a.store.setupOf('otzhimaniya-na-brusyah'), 'упор широкий, наклон');
  assert.equal(a.store.setupRecord('otzhimaniya-na-brusyah').bwShare, 0.9);
});

test('with the API 5 script still installed the share stays on the phone, everything else syncs', async () => {
  const gas = createGas({ code: API5 });
  const token = gas.call('setup');
  const a = await phone(gas, token);
  await a.store.saveSetup('otzhimaniya-na-brusyah', 'Отжимания на брусьях', 'упор узкий', { bwShare: 1 });
  await a.sync.syncNow();
  assert.equal(a.sync.status.state, 'idle');
  assert.equal(rows(gas, 'App_Exercises')[0].setup, 'упор узкий');
  assert.equal(a.store.setupRecord('otzhimaniya-na-brusyah').bwShare, 1, 'kept on this phone');
});

test('restore check: read-only, names what a new phone would miss; all good once synced', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const a = await phone(gas, token);
  const s = await a.store.startSession({ cycle: 1, week: 2, day: 1 });
  await a.store.logSet(s.id, s.items[0].slotId, { weight: 20, reps: 6, rir: 1 });
  await a.store.addBody({ kind: 'weight', value: 80.4, measuredAt: '2026-10-21T07:10' });
  await a.store.savePhase({ mode: 'bulk', start: '2026-08-01', targetPct: 0.25 });
  // Not synced yet: what waits is «ждут отправки», not a problem.
  let r = await a.sync.verify();
  assert.equal(r.ok, true);
  assert.equal(r.rows.find((x) => x.entity === 'sets').pending, 1);
  assert.equal(rows(gas, 'App_Sets').length, 0, 'the check sends nothing');
  assert.ok(a.store.state.outbox.size > 0, 'and leaves the queue as it was');
  await a.sync.syncNow();
  r = await a.sync.verify();
  assert.equal(r.ok, true);
  for (const e of ['sessions', 'sets', 'body', 'phases']) {
    const row = r.rows.find((x) => x.entity === e);
    assert.equal(row.same, row.here, e);
    assert.equal(row.there, row.here, e);
  }
  // A record the sheet lost (a deleted row) while the phone thinks it is saved: a problem, named.
  const sh = gas.sheet('App_Sets');
  sh.data.splice(1, 1);
  r = await a.sync.verify();
  assert.equal(r.ok, false);
  assert.equal(r.rows.find((x) => x.entity === 'sets').missing, 1);
  // Nothing received was applied.
  assert.equal([...a.store.state.sets.values()].filter((x) => !x.deleted).length, 1);
});

test('restore check against the API 5 script: entities it does not store are named, nothing is lost', async () => {
  const gas = createGas({ code: API5 });
  const token = gas.call('setup');
  const a = await phone(gas, token);
  await a.store.addBody({ kind: 'weight', value: 80.4, measuredAt: '2026-10-21T07:10' });
  await a.sync.syncNow();
  const res = gas.post({ action: 'sync', token, api: 6, since: 0, entitySince: Object.fromEntries(SYNCED.map((e) => [e, 0])), programSince: 0, push: {} });
  const r = restoreReport(a.store.state, res, [...SYNCED, 'imaginary']);
  assert.equal(r.rows.find((x) => x.entity === 'body').same, 1);
  assert.equal(r.rows.find((x) => x.entity === 'imaginary').unsupported, true);
  assert.equal(r.ok, true, 'nothing of it on the phone, so nothing missing');
});

test('«Команды» freshness: the sync answer says when each type last arrived — times and counts, never values', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const key = gas.call('showIngestKey');
  const a = await phone(gas, token);
  await a.sync.syncNow();
  assert.deepEqual(a.store.state.kv.ingest, { lastAt: null, byType: {} });
  gas.post({ action: 'ingest', key, type: 'weight', lines: '80.35|2026-10-21T07:10:00+03:00|2026-10-21T07:10:00+03:00|Zepp Life' });
  gas.post({ action: 'ingest', key, type: 'sleep', lines: 'Core|2026-10-21T00:00:00+03:00|2026-10-21T07:00:00+03:00|' });
  gas.post({ action: 'ingest', key, type: 'weight', lines: '' }); // ran, nothing new
  await a.sync.syncNow();
  const ing = a.store.state.kv.ingest;
  assert.deepEqual(Object.keys(ing.byType).sort(), ['sleep', 'weight']);
  assert.equal(ing.byType.weight.lines, 0, 'the latest run of that type');
  assert.ok(ing.lastAt >= ing.byType.sleep.at);
  assert.equal(JSON.stringify(ing).includes('80.35'), false);
  const d = healthDelivery({ ingest: ing, body: a.store.state.body.values(), sleep: a.store.state.sleep.values(), now: ing.lastAt + 3600000 });
  assert.deepEqual([d.used, d.quiet, d.fromLog], [true, false, true]);
  assert.equal(healthDelivery({ ingest: ing, now: ing.lastAt + 49 * 3600000 }).quiet, true);
});
