// Shortcuts → Apps Script (`ingest`): its own append-only key, limits, the same record ids as the
// app's CSV import, sleep computed like the app does, and nothing personal in the log.
// Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas } from '../helpers/fake-gas.js';
import { createStore } from '../../app/js/data/store.js';
import { memoryAdapter } from '../../app/js/data/db.js';
import { createSync } from '../../app/js/data/sync.js';
import { bodyId, parseTime, sleepFromSamples, parseFile, planImport } from '../../app/js/lib/bodydata.js';

function boot() {
  const gas = createGas();
  const token = gas.call('setup');
  const key = gas.call('showIngestKey');
  return { gas, token, key };
}

const rows = (gas, name) => {
  const sh = gas.sheet(name);
  if (!sh) return [];
  const [head, ...data] = sh.rows();
  return data.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
};

const send = (gas, key, type, lines) => gas.post({ action: 'ingest', key, type, lines: lines.join('\n') });

const W1 = '80.14999847412109|2026-03-01T07:10:05+03:00|2026-03-01T07:10:05+03:00|Zepp Life';
const W2 = '80.3|2026-03-02T07:05:41+03:00|2026-03-02T07:05:41+03:00|Zepp Life';

test('the Shortcuts key only ingests; the app key cannot ingest and the Shortcuts key cannot sync', () => {
  const { gas, token, key } = boot();
  assert.equal(key.length, 64);
  assert.notEqual(key, token);
  assert.equal(send(gas, token, 'weight', [W1]).error, 'unauthorized');
  assert.equal(send(gas, 'x'.repeat(64), 'weight', [W1]).error, 'unauthorized');
  assert.equal(gas.post({ action: 'sync', token: key, since: 0, push: {} }).error, 'unauthorized');
  assert.equal(gas.post({ action: 'ping', key }).error, 'unauthorized');
  // Before the owner opens «Ключ для «Команд»» there is no Shortcuts key at all.
  const fresh = createGas();
  fresh.call('setup');
  assert.equal(fresh.post({ action: 'ingest', key: '', type: 'weight', lines: W1 }).error, 'unauthorized');
  // A new key replaces the old one at once.
  const next = gas.call('rotateIngestKey');
  assert.equal(send(gas, key, 'weight', [W1]).error, 'unauthorized');
  assert.equal(send(gas, next, 'weight', [W1]).added, 1);
});

test('weigh-ins: float noise rounded, same id as the app computes, a resend adds nothing', () => {
  const { gas, key } = boot();
  const res = send(gas, key, 'weight', [W1, W2, W1]);
  assert.deepEqual([res.ok, res.received, res.added, res.same, res.rejected], [true, 3, 2, 1, 0]);
  const t = parseTime('2026-03-01T07:10:05+03:00');
  const id = bodyId({ kind: 'weight', family: 'zepp', utc: t.utc, precision: t.precision, value: 80.15 });
  const r = rows(gas, 'App_Body');
  assert.deepEqual(r.map((x) => [x.id, x.value, x.measured_at, x.date, x.via]), [
    [id, 80.15, '2026-03-01T07:10:05+03:00', '2026-03-01', 'shortcut'],
    ['b:weight:zepp:20260302T040541:8030', 80.3, '2026-03-02T07:05:41+03:00', '2026-03-02', 'shortcut'],
  ]);
  const again = send(gas, key, 'weight', [W1, W2]);
  assert.deepEqual([again.added, again.same], [0, 2]);
  assert.equal(rows(gas, 'App_Body').length, 2);
});

test('a measurement already imported from a Fitdays+ CSV (to the minute) is not added again', async () => {
  const { gas, token, key } = boot();
  const store = createStore(memoryAdapter(), { now: () => 1_792_500_000_000 });
  await store.load();
  await store.setKV({ sync: { url: 'https://example/exec', token } });
  const sync = createSync(store, { transport: async (u, p) => gas.post(JSON.parse(JSON.stringify(p))) });
  const plan = planImport(parseFile('Время,Талия\n19/10/2026 18:06,84.5 cm\n', { offset: () => 180 }), store.state);
  await store.importBody(plan, { batch: 'csv1' });
  await sync.syncNow();
  const res = send(gas, key, 'waist', ['84.5|2026-10-19T18:06:05+03:00|2026-10-19T18:06:05+03:00|Fitdays+']);
  assert.deepEqual([res.added, res.same], [0, 1]);
  // A different reading in the same minute is a different measurement.
  assert.equal(send(gas, key, 'waist', ['85|2026-10-19T18:06:40+03:00|2026-10-19T18:06:40+03:00|Fitdays+']).added, 1);
  await sync.syncNow();
  assert.equal([...store.state.body.values()].filter((r) => r.kind === 'waist').length, 2);
});

test('a weigh-in the owner deleted is not brought back by the next automatic run', async () => {
  const { gas, token, key } = boot();
  send(gas, key, 'weight', [W1]);
  const store = createStore(memoryAdapter(), { now: () => 1_892_500_000_000 });
  await store.load();
  await store.setKV({ sync: { url: 'https://example/exec', token } });
  const sync = createSync(store, { transport: async (u, p) => gas.post(JSON.parse(JSON.stringify(p))) });
  await sync.syncNow();
  const [rec] = store.state.body.values();
  await store.deleteBody(rec.id);
  await sync.syncNow();
  assert.equal(send(gas, key, 'weight', [W1]).added, 0);
  assert.equal(rows(gas, 'App_Body')[0].deleted, true);
});

test('limits: unknown type, too many lines, bad values and dates are refused by line', () => {
  const { gas, key } = boot();
  assert.equal(send(gas, key, 'steps', [W1]).error, 'bad_request');
  assert.equal(send(gas, key, 'weight', Array.from({ length: 3001 }, () => W1)).error, 'bad_request');
  assert.equal(gas.post({ action: 'ingest', key, type: 'weight', lines: 'x'.repeat(1024 * 1024 + 10) }).error, 'bad_request');
  const res = send(gas, key, 'weight', [
    '900|2026-03-01T07:10:05+03:00||Zepp Life',
    'abc|2026-03-01T07:10:05+03:00||Zepp Life',
    '80|1 марта||Zepp Life',
    '80|2014-12-31T10:00:00+03:00||Zepp Life',
    '80|2099-01-01T10:00:00+03:00||Zepp Life',
    '80|2026-03-01T07:10:05||Zepp Life', // no offset: the instant is unknown
    W2,
  ]);
  assert.deepEqual([res.added, res.rejected], [1, 6]);
  assert.deepEqual(res.errors.map((e) => e.line), [1, 2, 3, 4, 5]);
  assert.equal(rows(gas, 'App_Body').length, 1);
});

const S = (stage, a, b, src = '') => `${stage}|2026-03-0${a}|2026-03-0${b}|${src}`;
const NIGHTS = [
  S('Core', '1T23:00:00+03:00', '2T02:00:00+03:00'),
  S('Awake', '2T02:00:00+03:00', '2T02:02:00+03:00'),
  S('Deep', '2T02:02:00+03:00', '2T03:02:00+03:00'),
  S('REM', '2T03:02:00+03:00', '2T06:02:00+03:00'),
  S('Core', '3T07:00:00+03:00', '3T10:00:00+03:00'),
  S('Core', '3T12:00:00+03:00', '3T13:30:00+03:00'),
  S('REM', '3T13:30:00+03:00', '3T14:30:00+03:00'),
];

test('sleep: computed exactly as the app computes it; resend is a no-op; a cut window never shrinks a night', () => {
  const { gas, key } = boot();
  const res = send(gas, key, 'sleep', NIGHTS);
  assert.deepEqual([res.added, res.rejected], [2, 0]);
  const app = sleepFromSamples(NIGHTS.map((l) => {
    const [value, start, end, source] = l.split('|');
    return { value, start, end, source };
  }));
  const sheet = rows(gas, 'App_Sleep');
  assert.deepEqual(
    sheet.map((r) => [r.id, r.wake_date, r.sleep_h, r.total_h, r.episodes, r.core_h, r.deep_h, r.rem_h, r.start, r.end]),
    app.map((n) => [`s:${n.wakeDate}`, n.wakeDate, n.hours, n.total, n.episodes, n.core, n.deep, n.rem, n.start, n.end]),
  );
  assert.deepEqual([sheet[1].sleep_h, sheet[1].total_h], [3, 5.5]);
  assert.equal(send(gas, key, 'sleep', NIGHTS).same, 2);
  // A later run whose window starts mid-night sees only part of 3 March: kept as it was.
  const cut = send(gas, key, 'sleep', NIGHTS.slice(5));
  assert.deepEqual([cut.updated, cut.same], [0, 1]);
  assert.equal(rows(gas, 'App_Sleep')[1].total_h, 5.5);
  // More samples for a day (the watch synced late) update it.
  const more = send(gas, key, 'sleep', [...NIGHTS, S('Core', '3T14:30:00+03:00', '3T15:30:00+03:00')]);
  assert.equal(more.updated, 1);
  assert.equal(rows(gas, 'App_Sleep')[1].total_h, 6.5);
});

test('sleep the owner edited or deleted is kept', () => {
  const { gas, token, key } = boot();
  send(gas, key, 'sleep', NIGHTS);
  const [first] = gas.post({ action: 'sync', token, since: 0, push: {} }).pull.sleep;
  gas.post({ action: 'sync', token, since: 0, push: { sleep: [{ ...first, hours: 6.5, total: 6.5, edited: true, updatedAt: first.updatedAt + 1 }] } });
  const res = send(gas, key, 'sleep', [...NIGHTS, S('Core', '2T06:02:00+03:00', '2T07:00:00+03:00')]);
  assert.equal(res.kept, 1);
  assert.equal(rows(gas, 'App_Sleep')[0].sleep_h, 6.5);
});

test('the log says when and how much arrived, never what', () => {
  const { gas, key } = boot();
  send(gas, key, 'weight', [W1, W2]);
  send(gas, key, 'sleep', NIGHTS);
  const log = gas.sheet('App_HealthLog').rows();
  assert.deepEqual(log[0], ['received_at', 'type', 'lines', 'added', 'updated', 'same', 'kept', 'rejected', 'sources']);
  assert.deepEqual(log.slice(1).map((r) => r.slice(1)), [
    ['weight', 2, 2, 0, 0, 0, 0, 'Zepp Life'],
    ['sleep', 7, 2, 0, 0, 0, 0, ''],
  ]);
  assert.ok(!JSON.stringify(log).includes('80.'), 'no values in the log');
});

test('the app on the phone today (v1.0.2) keeps syncing workouts with an API 4 script that holds measurements', async () => {
  const { gas, token, key } = boot();
  send(gas, key, 'weight', [W1, W2]);
  send(gas, key, 'sleep', NIGHTS);
  const old = await import('../fixtures/releases/bf41b45/js/data/store.js');
  const oldDb = await import('../fixtures/releases/bf41b45/js/data/db.js');
  const oldSync = await import('../fixtures/releases/bf41b45/js/data/sync.js');
  const store = old.createStore(oldDb.memoryAdapter(), { now: () => 1_792_500_000_000 });
  await store.load();
  await store.setKV({ sync: { url: 'https://example/exec', token } });
  const sync = oldSync.createSync(store, { transport: async (u, p) => gas.post(JSON.parse(JSON.stringify(p))) });
  await store.saveMetric('2026-03-01', { recovery: 4 });
  await sync.syncNow();
  assert.equal(sync.status.state, 'idle');
  assert.equal(sync.status.error, null);
  assert.equal(rows(gas, 'App_Metrics').length, 1);
  assert.equal(store.state.body, undefined, 'v1.0.2 ignores what it does not know');
});
