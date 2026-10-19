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
  assert.deepEqual(log[0], ['received_at', 'type', 'lines', 'added', 'updated', 'same', 'kept', 'rejected', 'sources', 'errors']);
  assert.deepEqual(log.slice(1).map((r) => r.slice(1)), [
    ['weight', 2, 2, 0, 0, 0, 0, 'Zepp Life', ''],
    ['sleep', 7, 2, 0, 0, 0, 0, '', ''],
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

test('keys are shown in the sheet dialog only, never written to the execution log', () => {
  const gas = createGas();
  const token = gas.call('setup');
  const key = gas.call('showIngestKey');
  const next = gas.call('rotateIngestKey');
  const app = gas.call('rotateToken');
  gas.call('showToken');
  const log = gas.logs.join('\n');
  for (const secret of [token, key, next, app]) assert.ok(!log.includes(secret));
  assert.match(log, /не записывается в журнал/);
});

// 19.10.2026 on the real iPhone: refused waist and sleep lines left only `rejected` in the log.
// Each refusal now says why, in the answer (for the Shortcut's notification) and in the log.
test('a refused line says why: in the answer, in its message and in the log, never with its values', () => {
  const { gas, key } = boot();
  const local = '84.5|19 окт. 2026 г., 18:06|19 окт. 2026 г., 18:06|Fitdays+'; // date tokens left in the default format
  const shifted = '2026-03-01T07:10:05+03:00|2026-03-01T07:10:05+03:00|Fitdays+'; // the value token is missing
  const ok = '84.5|2026-03-01T18:06:05+03:00|2026-03-01T18:06:05+03:00|Fitdays+';
  const res = send(gas, key, 'waist', [local, shifted, ok]);
  assert.deepEqual([res.ok, res.added, res.rejected], [true, 1, 2]);
  assert.match(res.errors[0].reason, /ISO 8601/);
  assert.match(res.errors[1].reason, /значение\|начало\|окончание\|источник/);
  assert.match(res.message, /^Не принято строк: 2 из 3\. Строка 1: дата/);
  const clean = send(gas, key, 'waist', [ok]);
  assert.deepEqual([clean.same, clean.rejected, clean.message], [1, 0, undefined]);

  const log = rows(gas, 'App_HealthLog');
  assert.match(log[0].errors, /ISO 8601.* ×1; нужно 4 поля.* ×1$/);
  assert.equal(log[1].errors, '');
  assert.ok(!JSON.stringify(log).includes('84'), 'no values in the log');
});

test('a request refused as a whole (too big, too many lines, unknown type) is logged too', () => {
  const { gas, key } = boot();
  // The 19.10 mistake: heart tokens put the whole list into every line, 319 × 319 samples.
  const all = Array.from({ length: 319 }, (_, i) => `Core 2026-03-01T0${i % 10}:00:00+03:00 2026-03-01T0${i % 10}:30:00+03:00`).join(' ');
  const big = send(gas, key, 'sleep', Array.from({ length: 319 }, () => all));
  assert.deepEqual([big.ok, big.error, big.rejected], [false, 'bad_request', 319]);
  assert.match(big.message, /Объект повтора/);
  assert.equal(send(gas, key, 'steps', [W1]).error, 'bad_request');
  assert.equal(send(gas, key, 'weight', Array.from({ length: 3001 }, () => W1)).error, 'bad_request');
  const log = rows(gas, 'App_HealthLog');
  assert.deepEqual(log.map((r) => [r.type, r.lines, r.rejected]), [['sleep', 319, 319], ['steps', 1, 1], ['weight', 3001, 3001]]);
  assert.match(log[0].errors, /больше 1 МБ/);
  // A wrong key is not logged: the log cannot be flooded from outside.
  send(gas, 'x'.repeat(64), 'sleep', Array.from({ length: 319 }, () => all));
  assert.equal(rows(gas, 'App_HealthLog').length, 3);
  // The same sleep sent right afterwards is accepted.
  assert.equal(send(gas, key, 'sleep', NIGHTS).added, 2);
});

test('a log created by the first API 4 script gets the errors column', () => {
  const { gas, key } = boot();
  send(gas, key, 'weight', [W1]);
  const log = gas.sheet('App_HealthLog');
  log.getRange(1, 10, 1, 1).setValues([['']]); // the header as the earlier version wrote it: nine columns
  assert.equal(log.rows()[0].filter(Boolean).length, 9);
  assert.equal(send(gas, key, 'weight', ['80|x|x|Zepp Life']).rejected, 1);
  const r = log.rows();
  assert.equal(r[0][9], 'errors');
  assert.match(r[r.length - 1][9], /ISO 8601/);
});

// The spreadsheet is set to America/Los_Angeles while the phone is at +03:00. Dates come from the
// offset each sample carries, so the same samples give the same days whatever the sheet's zone.
test('the spreadsheet time zone does not move measurement dates or wake dates', () => {
  const run = (timeZone) => {
    const gas = createGas({ timeZone });
    gas.call('setup');
    const key = gas.call('showIngestKey');
    send(gas, key, 'weight', ['81.25|2026-10-19T01:36:08+03:00|2026-10-19T01:36:08+03:00|Zepp Life']);
    send(gas, key, 'sleep', [
      'Core|2026-10-18T22:30:00+03:00|2026-10-19T00:30:00+03:00|',
      'REM|2026-10-19T00:30:00+03:00|2026-10-19T02:10:00+03:00|',
      'Core|2026-10-19T13:00:00+03:00|2026-10-19T16:00:00+03:00|',
    ]);
    return {
      body: rows(gas, 'App_Body').map((r) => [r.date, r.measured_at, r.id]),
      sleep: rows(gas, 'App_Sleep').map((r) => [r.wake_date, r.sleep_h, r.total_h, r.episodes, r.start, r.end]),
    };
  };
  const msk = run('Europe/Moscow');
  assert.deepEqual(run('America/Los_Angeles'), msk);
  assert.deepEqual(msk.body, [['2026-10-19', '2026-10-19T01:36:08+03:00', 'b:weight:zepp:20261018T223608:8125']]);
  // A split day like 19.10: main sleep is the longer part, total is both parts.
  assert.deepEqual(msk.sleep, [['2026-10-19', 3.67, 6.67, 2, '2026-10-18T22:30:00+03:00', '2026-10-19T02:10:00+03:00']]);
});

// History loaded from a CSV on a phone that had not synced yet must not replace a night that came
// from «Команды» (it has all sleep of the day; the CSV only the main sleep).
test('a CSV night does not overwrite a Shortcuts night in the sheet; the phone gets the Shortcuts night back', async () => {
  const { gas, token, key } = boot();
  send(gas, key, 'sleep', NIGHTS);
  const fromShortcut = rows(gas, 'App_Sleep').find((r) => r.wake_date === '2026-03-03');
  assert.equal(fromShortcut.episodes, 2);

  const store = createStore(memoryAdapter(), { now: () => 1_792_500_000_000 });
  await store.load();
  await store.setKV({ sync: { url: 'https://example/exec', token } });
  const csv = parseFile([
    'wake_date,sleep_start_local,sleep_end_local,sleep_hours,core_hours,deep_hours,rem_hours,unspecified_hours,segments,method',
    '2026-03-03,2026-03-03 07:00:00 +0300,2026-03-03 10:00:00 +0300,3,3,0,0,0,1,stages',
    '2026-02-20,2026-02-19 23:00:00 +0300,2026-02-20 07:00:00 +0300,8,5,1,2,0,9,stages',
  ].join('\n'));
  const plan = planImport(csv, { body: store.state.body, sleep: store.state.sleep });
  assert.equal(plan.add.length, 2); // the phone does not know the Shortcuts nights yet
  await store.importBody(plan, { batch: 'i1', file: 'sleep.csv' });
  const sync = createSync(store, { transport: async (_u, payload) => gas.post(payload) });
  await sync.syncNow();
  await sync.syncNow();

  const sheet = rows(gas, 'App_Sleep');
  const kept = sheet.find((r) => r.wake_date === '2026-03-03');
  assert.deepEqual([kept.via, kept.total_h, kept.episodes], ['shortcut', fromShortcut.total_h, 2]);
  assert.equal(sheet.find((r) => r.wake_date === '2026-02-20').via, 'csv'); // history the sheet lacked is added
  const onPhone = store.state.sleep.get('s:2026-03-03');
  assert.deepEqual([onPhone.via, onPhone.total, onPhone.episodes], ['shortcut', fromShortcut.total_h, 2]);
});
