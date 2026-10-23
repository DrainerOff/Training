// The converter of the old sheet layout (tests/helpers/legacy-import.js, no longer in the app) that
// tests use to set up a phone like the owner's: it must reproduce the snapshot exactly — every
// target, every variant, every set. The snapshot is synthetic (tests/fixtures/synthetic).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SNAPSHOT } from '../fixtures/synthetic/gsheets-snapshot.js';
import { convertSnapshot, serialToISO } from '../helpers/legacy-import.js';
import { targetFor } from '../../app/js/lib/program.js';
import { nextWorkout } from '../../app/js/lib/planner.js';

const data = convertSnapshot();
const range = (raw) => {
  const s = String(raw).trim();
  const m = String(s).match(/(\d+)\s*-\s*(\d+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  const n = String(s).match(/^(\d+)/);
  return n ? [Number(n[1]), Number(n[1])] : null;
};

test('conversion reports no problems', () => {
  assert.deepEqual(data.problems, []);
});

test('program: 4 days with the sheet split titles, 29 slots in sheet order', () => {
  assert.deepEqual(data.program.days.map((d) => [d.day, d.title, d.slots.length]), [
    [1, 'Верх / руки', 7],
    [2, 'Ноги / дельты', 7],
    [3, 'Верх / руки', 7],
    [4, 'Ноги / дельты', 8],
  ]);
  const ids = data.program.days.flatMap((d) => d.slots.map((s) => s.id));
  assert.deepEqual(ids, SNAPSHOT.program.rows.map((r) => r[1]));
  assert.equal(data.program.draft, false);
});

test('program: sets and reps of every slot equal the sheet for all three weeks', () => {
  const slots = new Map(data.program.days.flatMap((d) => d.slots.map((s) => [s.id, s])));
  for (const r of SNAPSHOT.program.rows) {
    const slot = slots.get(r[1]);
    const [r2, r3] = String(r[8]).split('/').map(range);
    const want = { 1: [Number(r[5]), range(r[7])], 2: [Number(r[6]), r2], 3: [Number(r[6]), r3] };
    for (const w of [1, 2, 3]) {
      const t = targetFor(slot, w);
      assert.deepEqual([t.sets, t.reps], want[w], `${r[1]} week ${w}`);
    }
  }
});

test('program: RIR per week follows the cycle (4–5, 1–2, 0–1), including pull-ups', () => {
  const pull = data.program.days[0].slots[0];
  assert.deepEqual([1, 2, 3].map((w) => targetFor(pull, w).rir), [[4, 5], [1, 2], [0, 1]]);
});

test('program: calves get the single drop set on week 3 only', () => {
  const calves = data.program.days[1].slots.find((s) => s.id === 'D2-07');
  assert.deepEqual([1, 2, 3].map((w) => targetFor(calves, w).drop), [0, 0, 1]);
});

test('program: alternatives are separate series; the same exercise on two days is one series', () => {
  const s = new Map(data.program.days.flatMap((d) => d.slots.map((x) => [x.id, x])));
  const hammer = s.get('D1-02').options;
  assert.deepEqual(hammer.map((o) => o.name), ['Наклонный жим: Hammer - наклон', 'Наклонный жим: Гантели - наклон']);
  assert.notEqual(hammer[0].key, hammer[1].key);
  const press = s.get('D1-04').options;
  assert.deepEqual(press.map((o) => o.name), ['Жим штанги лежа: Штанга - наклон', 'Жим штанги лежа: Штанга - горизонт']);
  assert.equal(s.get('D1-01').options[0].key, s.get('D3-01').options[0].key);
  assert.equal(s.get('D1-06').options[0].key, s.get('D3-03').options[0].key);
  assert.notEqual(s.get('D2-03').options[0].key, s.get('D4-04').options[0].key, 'two different hyperextensions');
});

test('workout 16.10.2026: cycle 1, week 2, day 1, done, with the sheet session note', () => {
  assert.equal(data.sessions.length, 1);
  const s = data.sessions[0];
  assert.deepEqual([s.id, s.date, s.cycle, s.week, s.day, s.status], ['gs-s5', '2026-10-16', 1, 2, 1, 'done']);
  assert.equal(serialToISO(46311), '2026-10-16');
});

test('workout 16.10.2026: every set equals the diary cells; nothing added', () => {
  const rows = SNAPSHOT.diary.rows;
  const expected = [];
  for (const r of rows) {
    for (let i = 0; i < 4; i++) {
      if (r[11 + 2 * i] != null) expected.push([r[5], i + 1, r[11 + 2 * i], r[12 + 2 * i]]);
    }
  }
  assert.deepEqual(data.sets.map((x) => [x.slotId, x.setNo, x.weight, x.reps]), expected);
  assert.equal(data.sets.length, 23);
  assert.ok(data.sets.every((x) => x.rir === null && !x.drop && !x.pain && !x.technique && x.note === ''), 'empty RIR/technique cells stay empty');
});

test('workout 16.10.2026: the chosen variants are kept (Hammer, horizontal barbell press)', () => {
  const items = new Map(data.sessions[0].items.map((i) => [i.slotId, i]));
  assert.equal(items.get('D1-02').name, 'Наклонный жим: Hammer - наклон');
  assert.equal(items.get('D1-04').name, 'Жим штанги лежа: Штанга - горизонт');
  const press = data.sets.filter((x) => x.slotId === 'D1-04');
  assert.ok(press.every((x) => x.seriesKey === items.get('D1-04').seriesKey));
});

test("cross-check with the sheet's own formulas: set count and strongest-set index", () => {
  for (const r of SNAPSHOT.diary.rows) {
    const sets = data.sets.filter((x) => x.slotId === r[5]);
    assert.equal(sets.length, r[22], `${r[5]} «Сетов»`);
    // «Индекс»: weight × (1 + reps/30) of the strongest set; for pull-ups the added weight.
    const index = r[5].endsWith('-01') ? Math.max(...sets.map((x) => x.weight)) : Math.max(...sets.map((x) => x.weight * (1 + x.reps / 30)));
    assert.ok(Math.abs(index - r[23]) < 1e-9, `${r[5]} index ${index} vs ${r[23]}`);
  }
});

test('body metrics of 16.10: weight, sleep as typed (a date cell shown as 7.5), well-being kept as text', () => {
  assert.deepEqual(data.metrics, [
    { id: 'm2026-10-16', date: '2026-10-16', bodyweight: 81.2, sleep: 7.5, recovery: null, note: 'Самочувствие: Хорошо', updatedAt: data.metrics[0].updatedAt, deleted: false },
  ]);
});

test('after the import the next workout is cycle 1, week 2, day 2 — as in the sheet (session 6)', () => {
  assert.deepEqual(nextWorkout(data.sessions, [1, 2, 3, 4]), { cycle: 1, week: 2, day: 2 });
});

test('anything unexpected aborts instead of guessing', () => {
  const broken = structuredClone(SNAPSHOT);
  broken.diary.rows[3][7] = 'Штанга - под углом 30';
  broken.diary.rows[0][15] = null; // a set with reps but no weight
  const d = convertSnapshot(broken);
  const text = d.problems.join(' | ');
  assert.match(text, /D1-04: неизвестный вариант/);
  assert.match(text, /D1-01: подход 3 заполнен не полностью/);
  assert.match(text, /D1-01: подходов 2, а в столбце «Сетов» 3/);
});
