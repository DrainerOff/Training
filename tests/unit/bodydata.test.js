// Body measurements and sleep import. All data here is synthetic: real exports never enter the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv,
  parseValue,
  parseTime,
  sourceFamily,
  bodyId,
  sleepId,
  detectFormat,
  parseFile,
  planImport,
  weightSuspects,
  dailyWeights,
  sleepNights,
  sleepAverage,
  latestOf,
} from '../../app/js/lib/bodydata.js';

const MSK = { offset: () => 180 };
const toMap = (recs) => new Map(recs.map((r) => [r.id, r]));

const WEIGHT_CSV = '﻿local_datetime,weight_kg,source\r\n2026-10-01 07:10:05 +0300,80.10,Zepp Life\r\n2026-10-02 07:12:40 +0300,79.85,Zepp Life\r\n2026-10-02 07:12:40 +0300,79.85,Zepp Life\r\n2026-10-03 07:00:00 +0300,500,Zepp Life\r\nвчера,80,Zepp Life\r\n';
const FITDAYS_CSV = [
  'Время,Голова,Шея,Плечо,Грудь,Талия,Бедро,Л Рука,П Рука,L-бедро,R бедра,Л Голень,П Голень,Соотношение талии и бедер,Пульс',
  '19/10/2026 18:06,--,38.0 cm,--,101.5 cm,84.5 cm,--,--,--,--,--,--,--,0.85,70',
  '19/10/2026 18:06,--,--,--,--,84.5 cm,--,--,--,--,--,--,--,--,',
  '20/10/2026 08:00,--,--,--,--,--,--,--,--,--,--,--,--,--,',
].join('\n');
const SLEEP_CSV = [
  'wake_date,sleep_start_local,sleep_end_local,sleep_hours,core_hours,deep_hours,rem_hours,unspecified_hours,segments,method',
  '2026-10-18,2026-10-17 23:30:00 +0300,2026-10-18 07:00:00 +0300,7.2,4.5,1.2,1.5,0,3,stages',
  '2026-10-19,2026-10-18 23:50:00 +0300,2026-10-19 06:40:00 +0300,6.5,4,1,1.5,,2,stages',
  '2026-10-19,2026-10-18 23:50:00 +0300,2026-10-19 06:40:00 +0300,6.5,4,1,1.5,,2,stages',
  '2026-10-20,2026-10-20 07:00:00 +0300,2026-10-19 23:00:00 +0300,8,,,,,1,stages',
].join('\n');

test('csv: BOM, quotes, CRLF, semicolon from a Russian Excel', () => {
  assert.deepEqual(parseCsv('﻿a;b\r\n"1;2";"say ""hi"""\r\n\r\n'), [
    ['a', 'b'],
    ['1;2', 'say "hi"'],
  ]);
  assert.deepEqual(parseCsv('a\tb\n1\t2'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('values: units, comma decimals, empty marks, garbage', () => {
  assert.equal(parseValue('84.5 cm'), 84.5);
  assert.equal(parseValue('84,5'), 84.5);
  assert.equal(parseValue(' 79.85 '), 79.85);
  assert.equal(parseValue('--'), null);
  assert.equal(parseValue(''), null);
  assert.ok(Number.isNaN(parseValue('abc')));
});

test('time: zoned seconds, ISO, Fitdays day-first without a zone, impossible dates', () => {
  const a = parseTime('2021-07-25 16:38:10 +0300');
  assert.equal(a.utc, Date.UTC(2021, 6, 25, 13, 38, 10));
  assert.equal(a.precision, 's');
  assert.equal(a.local, '2021-07-25T16:38:10+03:00');
  assert.equal(parseTime('2023-11-26T08:18:00Z').utc, Date.UTC(2023, 10, 26, 8, 18));
  const f = parseTime('19/10/2026 18:06', MSK);
  assert.equal(f.utc, Date.UTC(2026, 9, 19, 15, 6));
  assert.equal(f.precision, 'm');
  assert.equal(f.zoned, false);
  assert.equal(f.date, '2026-10-19');
  assert.equal(parseTime('31/02/2026 10:00', MSK), null);
  assert.equal(parseTime('2026-13-01 10:00'), null);
  assert.equal(parseTime('вчера'), null);
});

test('source families: one family per device app, whatever the export calls it', () => {
  assert.equal(sourceFamily('Zepp Life'), 'zepp');
  assert.equal(sourceFamily('Mi Fit'), 'zepp');
  assert.equal(sourceFamily('Fitdays+'), 'fitdays');
  assert.equal(sourceFamily('Apple Watch — Влад'), 'watch');
  assert.equal(sourceFamily('вручную'), 'manual');
  assert.equal(sourceFamily(''), 'unknown');
});

test('ids: stable, valid for the sheet, a source UUID wins', () => {
  const t = parseTime('19/10/2026 18:06', MSK);
  const id = bodyId({ kind: 'waist', family: 'fitdays', utc: t.utc, precision: t.precision, value: 84.5 });
  assert.equal(id, 'b:waist:fitdays:20261019T1506:8450');
  assert.equal(bodyId({ kind: 'waist', family: 'fitdays', utc: t.utc, precision: 'm', value: 84.5 }, 2), id + ':2');
  assert.equal(bodyId({ kind: 'weight', srcId: '6F1A2B3C-0000-4D4D-8E8E-123456789ABC' }), 'b:weight:u:6F1A2B3C-0000-4D4D-8E8E-123456789ABC');
  assert.match(id, /^[A-Za-z0-9_:\-]{1,80}$/); // Apps Script ID_RE
  assert.equal(sleepId('2026-10-19'), 's:2026-10-19');
});

test('formats are recognised by their headers', () => {
  assert.equal(detectFormat(['local_datetime', 'weight_kg', 'source']), 'weight');
  assert.equal(detectFormat(['wake_date', 'sleep_hours']), 'sleep');
  assert.equal(detectFormat(['Время', 'Талия']), 'fitdays');
  assert.equal(detectFormat(['date', 'value']), null);
  assert.equal(parseFile('date,value\n1,2').format, null);
  assert.equal(parseFile('').errors[0].reason, 'Файл пустой');
});

test('weight file: rows become measurements, bad rows are reported by line', () => {
  const p = parseFile(WEIGHT_CSV, MSK);
  assert.equal(p.format, 'weight');
  assert.equal(p.items.length, 3);
  assert.equal(p.items[0].family, 'zepp');
  assert.deepEqual(
    p.errors.map((e) => e.line),
    [5, 6],
  );
});

test('fitdays file: one record per filled column, derived and unknown columns are not stored', () => {
  const p = parseFile(FITDAYS_CSV, MSK);
  assert.equal(p.format, 'fitdays');
  assert.deepEqual(
    p.items.map((i) => [i.kind, i.value]),
    [
      ['neck', 38],
      ['chest', 101.5],
      ['waist', 84.5],
      ['waist', 84.5],
    ],
  );
  assert.deepEqual(p.ignored, ['Пульс']);
  assert.deepEqual(p.errors, [{ line: 4, reason: 'в строке нет ни одного замера' }]);
});

test('import plan: identical minute rows are two measurements, identical second rows are one', () => {
  const fit = planImport(parseFile(FITDAYS_CSV, MSK), {}, { batch: 'b1', now: 1 });
  const waists = fit.add.filter((r) => r.kind === 'waist').map((r) => r.id);
  assert.deepEqual(waists, ['b:waist:fitdays:20261019T1506:8450', 'b:waist:fitdays:20261019T1506:8450:2']);
  assert.deepEqual(fit.kinds, { neck: 1, chest: 1, waist: 2 });

  const w = planImport(parseFile(WEIGHT_CSV, MSK), {}, { batch: 'b2', now: 1 });
  assert.equal(w.add.length, 2);
  assert.equal(w.repeated, 1);
  const r = w.add[0];
  assert.equal(r.measuredAt, '2026-10-01T07:10:05+03:00');
  assert.equal(r.date, '2026-10-01');
  assert.equal(r.origValue, 80.1);
  assert.equal(r.batch, 'b2');
  assert.equal(r.excluded, null);
});

test('re-import of the same file adds nothing and keeps the ids', () => {
  const first = planImport(parseFile(FITDAYS_CSV, MSK), {}, { now: 1 });
  const body = toMap(first.add);
  const again = planImport(parseFile(FITDAYS_CSV, MSK), { body }, { now: 2 });
  assert.equal(again.add.length, 0);
  assert.equal(again.same, 4);
});

test('re-import never undoes a deletion or overwrites a manual correction', () => {
  const first = planImport(parseFile(WEIGHT_CSV, MSK), {}, { now: 1 });
  const [a, b] = first.add;
  const body = toMap([
    { ...a, deleted: true, updatedAt: 5 },
    { ...b, value: 79.5, edited: true, updatedAt: 5 },
  ]);
  const again = planImport(parseFile(WEIGHT_CSV, MSK), { body }, { now: 6 });
  assert.equal(again.add.length, 0);
  assert.equal(again.deleted, 1);
  assert.equal(again.kept, 1);
  assert.equal(again.repeated, 1);
});

test('the same measurement via Health (to the second, with a UUID) and via CSV (to the minute) is one record', () => {
  const fromHealth = {
    id: 'b:waist:u:AAAA-1111',
    kind: 'waist',
    value: 84.5,
    origValue: 84.5,
    measuredAt: '2026-10-19T18:06:23+03:00',
    date: '2026-10-19',
    source: 'Fitdays+',
    family: 'fitdays',
    deleted: false,
  };
  const csv = 'Время,Талия\n19/10/2026 18:06,84.5 cm\n';
  const plan = planImport(parseFile(csv, MSK), { body: toMap([fromHealth]) });
  assert.equal(plan.add.length, 0);
  assert.equal(plan.same, 1);
});

test('another source a minute apart with a close value is held for review, not added', () => {
  const manual = {
    id: 'b:weight:manual:20261001T0411:8000',
    kind: 'weight',
    value: 80.0,
    measuredAt: '2026-10-01T07:11+03:00',
    date: '2026-10-01',
    source: 'вручную',
    family: 'manual',
    deleted: false,
  };
  const plan = planImport(parseFile(WEIGHT_CSV, MSK), { body: toMap([manual]) });
  assert.equal(plan.near.length, 1);
  assert.equal(plan.near[0].existing.id, manual.id);
  assert.equal(plan.add.length, 1);
});

test('different values in the same minute are different measurements', () => {
  const csv = 'Время,Талия\n19/10/2026 18:06,84.5 cm\n19/10/2026 18:06,85.5 cm\n';
  const plan = planImport(parseFile(csv, MSK), {});
  assert.equal(plan.add.length, 2);
  assert.notEqual(plan.add[0].id, plan.add[1].id);
});

test('sleep file: one main sleep per wake date, duplicates and impossible rows reported', () => {
  const p = parseFile(SLEEP_CSV, MSK);
  assert.equal(p.items.length, 3);
  assert.equal(p.items[1].unspec, null);
  assert.deepEqual(
    p.errors.map((e) => e.line),
    [5],
  );
  const plan = planImport(p, {}, { now: 1 });
  assert.equal(plan.sleepAdded, 2);
  assert.equal(plan.repeated, 1);
  assert.deepEqual(
    plan.add.map((r) => r.id),
    ['s:2026-10-18', 's:2026-10-19'],
  );
  const sleep = toMap([{ ...plan.add[0], deleted: true }, plan.add[1]]);
  const again = planImport(parseFile(SLEEP_CSV, MSK), { sleep });
  assert.equal(again.add.length, 0);
  assert.equal(again.deleted, 1);
  assert.equal(again.same, 1);
});

const w = (id, date, value, extra = {}) => ({ id, kind: 'weight', date, value, measuredAt: date + 'T07:00+03:00', deleted: false, ...extra });

test('suspect weigh-ins are flagged with the reason, and the owner decides', () => {
  const list = [w('a', '2026-10-01', 80), w('b', '2026-10-02', 80.2), w('c', '2026-10-03', 79.9), w('d', '2026-10-04', 80.1), w('x', '2026-10-03', 95)];
  const s = weightSuspects(list);
  assert.deepEqual([...s.keys()], ['x']);
  assert.ok(s.get('x').diff > 14);
  assert.equal(dailyWeights(list, []).days.find((d) => d.date === '2026-10-03').bodyweight, 79.9);
  const kept = list.map((r) => (r.id === 'x' ? { ...r, excluded: false } : r));
  assert.equal(dailyWeights(kept, []).days.find((d) => d.date === '2026-10-03').n, 2);
  assert.equal(dailyWeights(list.map((r) => (r.id === 'a' ? { ...r, excluded: true } : r)), []).days[0].date, '2026-10-02');
});

test('a v1.0 weight in App_Metrics only fills days without App_Body weigh-ins', () => {
  const body = [w('a', '2026-10-01', 80), w('b', '2026-10-01', 81), w('gone', '2026-10-02', 70, { deleted: true })];
  const metrics = [
    { id: 'm2026-10-01', date: '2026-10-01', bodyweight: 85 },
    { id: 'm2026-10-02', date: '2026-10-02', bodyweight: 79 },
    { id: 'm2026-10-03', date: '2026-10-03', bodyweight: 0, sleep: 7 },
  ];
  const { days, shadowed } = dailyWeights(body, metrics);
  assert.deepEqual(
    days.map((d) => [d.date, d.bodyweight, d.from]),
    [
      ['2026-10-01', 80.5, 'body'],
      ['2026-10-02', 79, 'metrics'],
    ],
  );
  assert.deepEqual([...shadowed], ['m2026-10-01']);
});

test('sleep: App_Sleep wins over a manual "сон, ч"; averages count only nights with data', () => {
  const sleep = [
    { id: 's:2026-10-18', wakeDate: '2026-10-18', hours: 7 },
    { id: 's:2026-10-19', wakeDate: '2026-10-19', hours: 6, deleted: true },
  ];
  const metrics = [
    { id: 'm2026-10-18', date: '2026-10-18', sleep: 9 },
    { id: 'm2026-10-19', date: '2026-10-19', sleep: 8 },
    { id: 'm2026-10-01', date: '2026-10-01', sleep: 5 },
  ];
  const { nights, shadowed } = sleepNights(sleep, metrics);
  assert.deepEqual(
    nights.map((n) => [n.date, n.hours, n.from]),
    [
      ['2026-10-01', 5, 'metrics'],
      ['2026-10-18', 7, 'sleep'],
      ['2026-10-19', 8, 'metrics'],
    ],
  );
  assert.deepEqual([...shadowed], ['m2026-10-18']);
  assert.deepEqual(sleepAverage(nights, '2026-10-19', 7), { avg: 7.5, nights: 2, days: 7 });
  assert.deepEqual(sleepAverage(nights, '2026-10-19', 30), { avg: 20 / 3, nights: 3, days: 30 });
  assert.equal(sleepAverage([], '2026-10-19', 7).avg, null);
});

test('latest girth and its change over four weeks', () => {
  const g = (id, date, value, extra = {}) => ({ id, kind: 'waist', date, value, measuredAt: date + 'T08:00+03:00', deleted: false, ...extra });
  const body = [g('a', '2026-09-01', 86), g('b', '2026-09-20', 85), g('c', '2026-10-19', 84.5), g('d', '2026-10-18', 70, { excluded: true })];
  const r = latestOf(body, 'waist');
  assert.equal(r.last.id, 'c');
  assert.equal(r.ref.id, 'b');
  assert.equal(r.change, -0.5);
  assert.equal(r.count, 3);
  assert.equal(latestOf(body, 'neck'), null);
});
