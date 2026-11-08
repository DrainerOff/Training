// The weight recommendation (lib/recommend.js): same week of the cycle only, every set and its RIR,
// pain / technique / baseline, a break, body weight, today's sets. Synthetic numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExposures } from '../../app/js/lib/plateau.js';
import { recommend, workingWeight } from '../../app/js/lib/recommend.js';
import { targetFor } from '../../app/js/lib/program.js';

// `specs`: { date, week, day?, key?, sets: [[w, r, rir?, extra?]], flags?, bw?, order? } in order;
// `order` — the exercise's place in that day's program (0 = first; other exercises fill the places before).
function history(specs, { key = 'press', category = 'base' } = {}) {
  const sessions = [];
  const sets = [];
  const bws = new Map();
  specs.forEach((sp, i) => {
    const id = `s${i}`;
    const k = sp.key || key;
    sessions.push({ id, date: sp.date, cycle: sp.cycle || 1, week: sp.week, day: sp.day || 1, status: 'done', startedAt: i + 1,
      items: [...Array.from({ length: sp.order || 0 }, (_, j) => ({ slotId: `other${j}`, seriesKey: `other${j}`, category: 'iso', flags: {} })),
        { slotId: 'slot1', seriesKey: k, category, flags: sp.flags || {} }] });
    sp.sets.forEach(([w, r, rir, extra], j) => sets.push({ id: `${id}-${j}`, sessionId: id, slotId: 'slot1', seriesKey: k, exercise: k, setNo: j + 1, weight: w, reps: r, rir: rir ?? null, ...(extra || {}) }));
    if (sp.bw) bws.set(sp.date, { value: sp.bw, date: sp.date });
  });
  return buildExposures(sessions, sets, { bodyweightAt: (d) => bws.get(d) || null });
}
const today = (week, date = '2026-11-20', extra = {}) => ({ id: 'today', date, week, cycle: 3, day: 1, startedAt: 1e12, ...extra });
const rec = (series, { key = 'press', week, category = 'base', date, ...opts }) =>
  recommend({ list: series.get(key) || [], session: today(week, date), target: targetFor({ category }, week), category, step: 2.5, ...opts });

test('every set at the top of the range with the planned RIR → one step up', () => {
  const s = history([{ date: '2026-11-06', week: 2, sets: [[90, 10, 2], [90, 10, 1], [90, 10, 1], [90, 10, 1]] }]);
  const r = rec(s, { week: 2 });
  assert.equal(r.kind, 'up');
  assert.equal(r.label, 'Можно повысить');
  assert.equal(r.weight, 92.5);
  assert.equal(r.conditional, false);
  assert.match(r.reasons[0], /^Прошлый раз на неделе 2, 6 ноября: 90×10 \(RIR 2\), 90×10 \(RIR 1\)/);
});

test('RIR counts: 9 reps at RIR 2 is 10 at RIR 1 (up); 10 reps at RIR 0 is not (hold)', () => {
  let s = history([{ date: '2026-11-06', week: 2, sets: [[90, 9, 2], [90, 10, 1], [90, 9, 2], [90, 10, 2]] }]);
  assert.equal(rec(s, { week: 2 }).kind, 'up');
  s = history([{ date: '2026-11-06', week: 2, sets: [[90, 10, 0], [90, 10, 1], [90, 10, 1], [90, 10, 1]] }]);
  const r = rec(s, { week: 2 });
  assert.deepEqual([r.kind, r.weight], ['hold', 90]);
  assert.match(r.reasons.join(' '), /90×10 \(RIR 0\) — с меньшим запасом, чем RIR по плану/);
  assert.match(r.reasons.join(' '), /Цель — 10 повторений при RIR 1–2 во всех подходах по 90 кг/);
});

test('without RIR the increase is conditional and says why', () => {
  const s = history([{ date: '2026-11-06', week: 3, sets: [[100, 8], [100, 8], [100, 8], [100, 9]] }]);
  const r = rec(s, { week: 3 });
  assert.deepEqual([r.kind, r.weight, r.conditional], ['up', 102.5, true]);
  assert.match(r.reasons.join(' '), /RIR в тот раз записан не везде, поэтому рекомендация условная.*RIR 0–1.*лучше закрепить 100 кг/);
});

test('never up or hold because of another week: week 2 history, today week 3 → only an approximate «Ориентир»', () => {
  const s = history([
    { date: '2026-10-30', week: 2, sets: [[90, 10, 3], [90, 10, 3], [90, 10, 3], [90, 10, 3]] },
    { date: '2026-11-06', week: 1, sets: [[70, 12, 5], [70, 12, 5], [70, 12, 5]] },
  ]);
  const r = rec(s, { week: 3 });
  assert.deepEqual([r.kind, r.label, r.approx, r.basis], ['estimate', 'Ориентир', true, 'heavy']);
  assert.equal(r.ref.date, '2026-10-30', 'the light week is never the source');
  assert.match(r.reasons[0], /На неделе 3 этот вариант ещё не выполнялся, поэтому взята неделя 2 \(30 октября\)/);
  assert.match(r.reasons.join(' '), /приблизительный расчёт по другой неделе/);
});

test('the latest same-week result is the reference, from any day of the program', () => {
  const s = history([
    { date: '2026-10-09', week: 2, day: 2, sets: [[40, 10, 2], [40, 10, 2], [40, 10, 2]] },
    { date: '2026-10-30', week: 2, day: 4, sets: [[42.5, 9, 1], [42.5, 9, 1], [42.5, 8, 1]] },
    { date: '2026-11-06', week: 3, day: 2, sets: [[45, 8, 0], [45, 8, 0], [45, 8, 0]] },
  ], { category: 'iso' });
  const r = rec(s, { week: 2, category: 'iso' });
  assert.deepEqual([r.kind, r.weight, r.ref.date], ['hold', 42.5, '2026-10-30']);
});

test('a split series: the history under another key is not seen; once joined it is', () => {
  const split = history([
    { date: '2026-10-18', week: 2, key: 'row-smith', sets: [[40, 10, 2], [40, 10, 2], [40, 10, 1]] },
    { date: '2026-10-22', week: 2, key: 'row-barbell', sets: [[40, 10, 2], [42.5, 10, 2], [42.5, 10, 1]] },
  ], { category: 'iso' });
  // The 22.10 sets under the barbell key: the Smith series knows only 18.10.
  assert.equal(rec(split, { key: 'row-smith', week: 2, category: 'iso' }).ref.date, '2026-10-18');
  const joined = history([
    { date: '2026-10-18', week: 2, key: 'row-smith', sets: [[40, 10, 2], [40, 10, 2], [40, 10, 1]] },
    { date: '2026-10-22', week: 2, key: 'row-smith', sets: [[40, 10, 2], [42.5, 10, 2], [42.5, 10, 1]] },
  ], { category: 'iso' });
  const r = rec(joined, { key: 'row-smith', week: 2, category: 'iso' });
  assert.deepEqual([r.ref.date, r.kind, r.weight], ['2026-10-22', 'up', 45]);
  assert.equal(rec(joined, { key: 'row-barbell', week: 2, category: 'iso' }).kind, 'none');
});

test('pain: in that workout, since then in another week, or today → no increase', () => {
  const good = [[90, 10, 2], [90, 10, 2], [90, 10, 2], [90, 10, 2]];
  let s = history([{ date: '2026-11-06', week: 2, sets: good, flags: { pain: true } }]);
  let r = rec(s, { week: 2 });
  assert.deepEqual([r.kind, r.weight], ['hold', 90]);
  assert.match(r.reasons.join(' '), /была отмечена боль/);
  s = history([{ date: '2026-11-06', week: 2, sets: [...good.slice(0, 3), [90, 10, 2, { pain: true }]] }]);
  assert.equal(rec(s, { week: 2 }).kind, 'hold', 'a set marked with pain');
  s = history([{ date: '2026-10-30', week: 2, sets: good }, { date: '2026-11-06', week: 3, sets: [[95, 6, 1]], flags: { pain: true } }]);
  r = rec(s, { week: 2 });
  assert.equal(r.kind, 'hold');
  assert.match(r.reasons.join(' '), /6 ноября \(неделя 3\) была отмечена боль/);
  s = history([{ date: '2026-11-06', week: 2, sets: good }]);
  assert.equal(rec(s, { week: 2, todayFlags: { pain: true } }).kind, 'hold');
  assert.equal(rec(s, { week: 2, todaySets: [{ weight: 90, reps: 8, pain: true }] }).kind, 'hold');
});

test('worse technique then or today → no increase', () => {
  const good = [[90, 10, 2], [90, 10, 2], [90, 10, 2], [90, 10, 2]];
  let s = history([{ date: '2026-11-06', week: 2, sets: good, flags: { technique: true } }]);
  assert.equal(rec(s, { week: 2 }).kind, 'hold');
  s = history([{ date: '2026-11-06', week: 2, sets: good }]);
  const r = rec(s, { week: 2, todayFlags: { technique: true } });
  assert.equal(r.kind, 'hold');
  assert.match(r.reasons.join(' '), /техника хуже/);
});

test('a new baseline: marked today → not enough data; the reference must come after it', () => {
  const good = [[90, 10, 2], [90, 10, 2], [90, 10, 2], [90, 10, 2]];
  let s = history([{ date: '2026-11-06', week: 2, sets: good }]);
  assert.equal(rec(s, { week: 2, todayFlags: { baseline: true } }).kind, 'none');
  s = history([
    { date: '2026-10-30', week: 2, sets: good },
    { date: '2026-11-06', week: 3, sets: [[80, 8, 1]], flags: { baseline: true } },
  ]);
  const r = rec(s, { week: 2 });
  assert.equal(r.kind, 'none');
  assert.match(r.reasons[0], /после новой точки отсчёта \(6 ноября\)/);
});

test('below the range, too few sets at the top weight → hold with a goal', () => {
  let s = history([{ date: '2026-11-06', week: 2, sets: [[90, 10, 2], [90, 9, 1], [90, 8, 1], [90, 8, 1]] }]);
  let r = rec(s, { week: 2 });
  assert.deepEqual([r.kind, r.weight], ['hold', 90]);
  assert.match(r.reasons.join(' '), /До верха диапазона 8–10 не дошли: 90×9 \(RIR 1\), 90×8 \(RIR 1\), 90×8 \(RIR 1\)/);
  // A heavier top set alone does not move the weight.
  s = history([{ date: '2026-11-06', week: 2, sets: [[95, 10, 2], [90, 10, 2], [90, 10, 2], [90, 10, 2]] }]);
  r = rec(s, { week: 2 });
  assert.deepEqual([r.kind, r.weight], ['hold', 95]);
  assert.match(r.reasons.join(' '), /По 95 кг — 1 подход из 4/);
  // All but one of the planned sets at the top weight is enough.
  s = history([{ date: '2026-11-06', week: 2, sets: [[90, 10, 2], [90, 10, 2], [90, 10, 2], [85, 12, 2]] }]);
  assert.deepEqual([rec(s, { week: 2 }).kind, rec(s, { week: 2 }).weight], ['up', 92.5]);
});

test('a clear surplus with RIR in every set → two steps, when that is still a small jump', () => {
  let s = history([{ date: '2026-11-06', week: 2, sets: [[90, 10, 4], [90, 10, 4], [90, 10, 4], [90, 10, 4]] }]);
  assert.equal(rec(s, { week: 2 }).weight, 95);
  // 25 kg isolation: +5 kg is 20% — one step.
  s = history([{ date: '2026-11-06', week: 2, sets: [[25, 10, 4], [25, 10, 4], [25, 10, 4]] }], { category: 'iso' });
  assert.equal(rec(s, { week: 2, category: 'iso' }).weight, 27.5);
});

test('week 1 uses the target of the category: base 10–12, isolation 12–15', () => {
  let s = history([{ date: '2026-11-06', week: 1, sets: [[70, 12, 2], [70, 12, 2], [70, 12, 2]] }]);
  assert.deepEqual([rec(s, { week: 1 }).kind, rec(s, { week: 1 }).weight], ['up', 72.5]);
  s = history([{ date: '2026-11-06', week: 1, sets: [[70, 11, 2], [70, 12, 2], [70, 12, 2]] }]);
  let r = rec(s, { week: 1 });
  assert.equal(r.kind, 'hold');
  assert.match(r.reasons.join(' '), /Цель — 12 повторений при RIR 2–3 во всех подходах по 70 кг/);
  // Isolation: 12 reps is the bottom of 12–15, not the top — hold; 15 in every set — up.
  s = history([{ date: '2026-11-06', week: 1, sets: [[30, 12, 2], [30, 12, 2], [30, 12, 2]] }], { category: 'iso' });
  r = rec(s, { week: 1, category: 'iso' });
  assert.deepEqual([r.kind, r.weight], ['hold', 30]);
  assert.match(r.reasons.join(' '), /До верха диапазона 12–15 не дошли/);
  assert.match(r.reasons.join(' '), /Цель — 15 повторений при RIR 2–3 во всех подходах по 30 кг/);
  s = history([{ date: '2026-11-06', week: 1, sets: [[30, 15, 2], [30, 15, 3], [30, 14, 3]] }], { category: 'iso' });
  r = rec(s, { week: 1, category: 'iso' });
  assert.deepEqual([r.kind, r.weight], ['up', 32.5]);
  // No target → no range, nothing invented.
  r = recommend({ list: s.get('press'), session: today(1), target: null, category: 'iso', step: 2.5 });
  assert.deepEqual([r.kind, r.weight], ['none', null]);
});

test('a break of more than 8 weeks → the old weight first', () => {
  const s = history([{ date: '2026-08-01', week: 2, sets: [[90, 10, 2], [90, 10, 2], [90, 10, 2], [90, 10, 2]] }]);
  const r = rec(s, { week: 2 });
  assert.deepEqual([r.kind, r.weight], ['hold', 90]);
  assert.match(r.reasons.join(' '), /15 недель назад/);
});

test('no history, no range → not enough data, no weight', () => {
  const r = rec(new Map(), { week: 2 });
  assert.deepEqual([r.kind, r.weight], ['none', null]);
  assert.match(r.reasons[0], /первое выполнение/);
});

test('pull-ups: added weight, body weight on each date; a gain worth a step is already an increase', () => {
  const sets = [[20, 6, 1], [20, 6, 1], [20, 6, 2]];
  let s = history([{ date: '2026-11-06', week: 2, sets, bw: 80 }], { key: 'pullup', category: 'pullup' });
  const base = { key: 'pullup', week: 2, category: 'pullup', share: 1 };
  let r = rec(s, { ...base, bodyweightToday: { value: 80.2 } });
  assert.deepEqual([r.kind, r.weight], ['up', 22.5]);
  r = rec(s, { ...base, bodyweightToday: { value: 83 } });
  assert.deepEqual([r.kind, r.weight], ['hold', 20]);
  assert.match(r.reasons.join(' '), /Масса тела больше на 3 кг, чем 6 ноября/);
  assert.match(r.reasons.join(' '), /нагрузка уже больше на ≈3 кг/);
  // Unknown body weight on a date: said, not invented.
  s = history([{ date: '2026-11-06', week: 2, sets }], { key: 'pullup', category: 'pullup' });
  r = rec(s, { ...base, bodyweightToday: null });
  assert.equal(r.kind, 'up');
  assert.match(r.reasons.join(' '), /Масса тела на одну из дат неизвестна/);
  // Bodyweight only (0 added) → the first added step.
  s = history([{ date: '2026-11-06', week: 2, sets: [[0, 6, 2], [0, 6, 2], [0, 6, 2]], bw: 80 }], { key: 'pullup', category: 'pullup' });
  r = rec(s, { ...base, bodyweightToday: { value: 80 } });
  assert.deepEqual([r.kind, r.weight], ['up', 2.5]);
});

test("today's sets: one at the new weight below the range → back to hold; in range → still up", () => {
  const s = history([{ date: '2026-11-06', week: 2, sets: [[90, 10, 2], [90, 10, 2], [90, 10, 2], [90, 10, 2]] }]);
  let r = rec(s, { week: 2, todaySets: [{ weight: 92.5, reps: 7, rir: 0 }] });
  assert.deepEqual([r.kind, r.weight], ['hold', 90]);
  assert.match(r.reasons.join(' '), /Сегодня 92,5×7 \(RIR 0\) — ниже диапазона 8–10: лучше вернуться к 90 кг/);
  r = rec(s, { week: 2, todaySets: [{ weight: 92.5, reps: 9, rir: 1 }] });
  assert.deepEqual([r.kind, r.weight], ['up', 92.5]);
  assert.match(r.reasons.join(' '), /Сегодня по 92,5 кг: 92,5×9 \(RIR 1\)/);
});

test('drop sets and deleted sets are not part of the decision', () => {
  const s = history([{ date: '2026-11-06', week: 2, sets: [[90, 10, 2], [90, 10, 2], [90, 10, 2], [90, 10, 2], [60, 4, 0, { drop: true }], [90, 3, 0, { deleted: true }]] }]);
  assert.equal(rec(s, { week: 2 }).kind, 'up');
});

// ---------------------------------------------------------------- v1.4: «закрепить», «Ориентир»

const calves = (specs) => history(specs, { key: 'calves', category: 'calves' });
const calfTarget = (week) => targetFor({ category: 'calves', overrides: { 1: { sets: 3, reps: [10, 12] }, 2: { sets: 3, reps: [10, 12] }, 3: { sets: 3, reps: [10, 12] } } }, week);

test('regression: one heavy set below the range, the rest lighter → hold the lighter working weight', () => {
  const s = calves([{ date: '2026-11-06', week: 2, sets: [[150, 8, 1], [140, 11, 0], [140, 10, 0]] }]);
  const r = recommend({ list: s.get('calves'), session: today(2), target: calfTarget(2), category: 'calves', step: 2.5 });
  assert.deepEqual([r.kind, r.weight, r.basis], ['hold', 140, 'same']);
  assert.match(r.reasons.join(' '), /По 150 кг — 150×8 \(RIR 1\): ниже диапазона 10–12, поэтому рабочий вес — 140 кг \(2 подхода в диапазоне\)/);
  assert.match(r.reasons.join(' '), /во всех подходах по 140 кг/);
});

test('regression: the heavy set below the range and no lighter weight done twice → the heaviest done in range', () => {
  let s = calves([{ date: '2026-11-06', week: 2, sets: [[150, 8, 1], [145, 11, 0], [140, 10, 0]] }]);
  let r = recommend({ list: s.get('calves'), session: today(2), target: calfTarget(2), category: 'calves', step: 2.5 });
  assert.deepEqual([r.kind, r.weight], ['hold', 145]);
  // Nothing reached the range: the lightest weight done.
  s = calves([{ date: '2026-11-06', week: 2, sets: [[150, 8, 1], [145, 9, 0], [140, 9, 0]] }]);
  r = recommend({ list: s.get('calves'), session: today(2), target: calfTarget(2), category: 'calves', step: 2.5 });
  assert.deepEqual([r.kind, r.weight], ['hold', 140]);
  // A heavy set in range is still the weight to hold (unchanged).
  s = history([{ date: '2026-11-06', week: 2, sets: [[95, 9, 2], [90, 10, 2], [90, 10, 2], [90, 10, 2]] }]);
  assert.deepEqual([rec(s, { week: 2 }).kind, rec(s, { week: 2 }).weight], ['hold', 95]);
});

test('a same-week result: other weeks in the history change nothing', () => {
  const same = { date: '2026-11-06', week: 2, sets: [[90, 10, 2], [90, 9, 1], [90, 8, 1], [90, 8, 1]] };
  const other = [
    { date: '2026-10-23', week: 3, sets: [[100, 8, 1], [100, 8, 1], [100, 7, 0], [100, 7, 0]] },
    { date: '2026-10-28', week: 1, sets: [[70, 12, 5], [70, 12, 5], [70, 12, 5]] },
  ];
  for (const week of [2]) {
    // Session ids of the synthetic history differ by position; everything else must match.
    const strip = (r) => ({ ...r, ref: { ...r.ref, sessionId: null } });
    assert.deepEqual(strip(rec(history([...other, same]), { week })), strip(rec(history([same]), { week })));
  }
});

test('«Ориентир» on a heavy week: on the grid, at least half a rep above the bottom of the window', () => {
  const s = history([{ date: '2026-11-06', week: 2, sets: [[95, 10, 2], [95, 10, 1], [95, 10, 2]] }], { category: 'iso' });
  const r = rec(s, { week: 3, category: 'iso' });
  assert.equal(r.kind, 'estimate');
  assert.equal((r.weight - 95) % 2.5, 0);
  // Epley median: 95 × (1 + 12/30) = 133; at the weight → reps to failure ≥ 6 + 0 + 0.5.
  const rtf = 30 * (133 / r.weight - 1);
  assert.ok(rtf >= 6.5, `≈${rtf} reps to failure`);
  assert.equal(r.weight, 107.5);
  assert.equal(r.range, null);
  assert.match(r.reasons.join(' '), /при 107,5 кг выходит около 7 повторений до отказа/);
});

test('«Ориентир» needs RIR, two sets, no pain or worse technique, not too old; the light week is no source', () => {
  const base = [[95, 10, 2], [95, 10, 1], [95, 10, 2]];
  let r = rec(history([{ date: '2026-11-06', week: 2, sets: [[95, 10], [95, 10, 1], [95, 10]] }]), { week: 3 });
  assert.deepEqual([r.kind, r.weight], ['none', null]);
  assert.match(r.reasons.join(' '), /RIR записан не во всех подходах: без него ориентир по другой неделе не считается/);
  r = rec(history([{ date: '2026-11-06', week: 2, sets: [[95, 10, 2]] }]), { week: 3 });
  assert.match(r.reasons.join(' '), /по одному подходу ориентир не считается/);
  r = rec(history([{ date: '2026-11-06', week: 2, sets: base, flags: { pain: true } }]), { week: 3 });
  assert.equal(r.kind, 'none');
  r = rec(history([{ date: '2026-11-06', week: 2, sets: base }]), { week: 3, todayFlags: { technique: true } });
  assert.equal(r.kind, 'none');
  r = rec(history([{ date: '2026-09-01', week: 2, sets: base }]), { week: 3 });
  assert.equal(r.kind, 'none');
  r = rec(history([{ date: '2026-11-06', week: 1, sets: [[70, 12, 5], [70, 12, 5], [70, 12, 5]] }]), { week: 3 });
  assert.equal(r.kind, 'none');
  // Before the baseline is not a source.
  r = rec(history([
    { date: '2026-10-30', week: 2, sets: base },
    { date: '2026-11-06', week: 1, sets: [[60, 12, 5], [60, 12, 5]], flags: { baseline: true } },
  ]), { week: 3 });
  assert.equal(r.kind, 'none');
});

test('light week from a heavy one: «≈ weight (from–to)», marked as an approximate estimate', () => {
  const s = history([{ date: '2026-11-06', week: 3, sets: [[95, 7, 1], [95, 7, 1], [95, 7, 0]] }], { category: 'hammer' });
  const r = rec(s, { week: 1, category: 'hammer' });
  assert.deepEqual([r.kind, r.basis, r.approx], ['estimate', 'light', true]);
  // Hammer: the first set at the top of the window (12 at RIR 3) — the light week loses reps set to set.
  assert.deepEqual([r.weight, r.range], [75, [72.5, 80]]);
  assert.match(r.reasons[0], /Лёгкой недели в истории этого варианта ещё нет, поэтому вес пересчитан с недели 3/);
  assert.match(r.reasons.join(' '), /Цель лёгкой недели — 10–12 при RIR 2–3\. Вес взят под верх цели — 12 при RIR 3: на лёгкой неделе от подхода к подходу повторений до отказа становится меньше, и третий подход тоже должен остаться в цели\. .*формулы дают от 72,5 кг до 80 кг, ошибка около ±10%/);
  assert.match(r.reasons.join(' '), /Если первый подход тяжелее RIR 2 — снизьте вес/);
  assert.doesNotMatch(r.reasons.join(' '), /RIR 4/);
});

// Synthetic cycle: week 2 and week 3 from the same strength, then the light week at RIR 2–3 with the reps
// of the category (base 10–12, isolation 12–15). Its window of reps to failure (12–15 or 14–18) lies
// above week 2's (9–12), so the hint is lighter than week 2.
const cycle = (w2, w3, step, category = 'iso') => {
  const s = history([
    { date: '2026-11-03', week: 2, sets: w2 },
    { date: '2026-11-10', week: 3, sets: w3 },
  ], { category });
  return recommend({ list: s.get('press'), session: today(1, '2026-11-15'), target: targetFor({ category }, 1), category, step });
};

test('light week at RIR 2–3: heavier than at RIR 4–5, still below the week 2 weight', () => {
  // Machine, step 2.5: week 2 100×9–10, week 3 105×6–7 → light ≈ 85 (from 82,5 to 90; a base lift aims a
  // little above the middle of the window, at 87,5 before v1.6.4); at RIR 4–5 it was ≈ 82,5.
  let r = cycle([[100, 10, 2], [100, 10, 1], [100, 9, 1], [100, 9, 1]], [[105, 7, 1], [105, 7, 1], [105, 6, 1], [105, 6, 0]], 2.5, 'base');
  assert.deepEqual([r.basis, r.weight, r.range], ['light', 85, [82.5, 90]]);
  assert.match(r.reasons.join(' '), /Вес взят чуть выше середины цели: на лёгкой неделе/);
  assert.ok(r.weight < 100 && r.range[1] < 100);
  // Isolation 40 kg, 12–15 since v1.6.0: ≈ 30 (from 27,5 to 32,5; the top of the window since v1.6.4),
  // below 40 (at 10–12 it was ≈ 35).
  r = cycle([[40, 10, 2], [40, 10, 1], [40, 9, 1]], [[42.5, 8, 1], [42.5, 7, 1], [42.5, 7, 0]], 2.5);
  assert.deepEqual([r.weight, r.range], [30, [27.5, 32.5]]);
  assert.match(r.reasons.join(' '), /Цель лёгкой недели — 12–15 при RIR 2–3\./);
  // The same numbers on a base lift (10–12): heavier than isolation, still below week 2.
  r = cycle([[40, 10, 2], [40, 10, 1], [40, 9, 1]], [[42.5, 8, 1], [42.5, 7, 1], [42.5, 7, 0]], 2.5, 'base');
  assert.deepEqual([r.weight, r.range], [35, [32.5, 37.5]]);
  assert.match(r.reasons.join(' '), /Цель лёгкой недели — 10–12 при RIR 2–3\./);
});

test('light week never heavier than week 2 at the same strength; equal only where one step is over ~10% of the weight', () => {
  const grid = (w, s) => Math.round(w / s) * s;
  let n = 0;
  for (const category of ['iso', 'base']) {
    for (const step of [1, 2, 2.5, 5]) {
      for (let w2 = step * 3; w2 <= 200; w2 += step) {
        for (const [r2, i2, r3, i3] of [[10, 2, 7, 1], [9, 1, 8, 0], [8, 2, 6, 1], [10, 1, 7, 0]]) {
          const cap = w2 * (1 + (r2 + i2) / 30); // the same strength on week 3
          const w3 = grid(cap / (1 + (r3 + i3) / 30), step);
          const r = cycle([[w2, r2, i2], [w2, r2, i2], [w2, r2, i2]], [[w3, r3, i3], [w3, r3, i3], [w3, r3, i3]], step, category);
          if (r.weight == null) continue;
          n++;
          assert.ok(r.weight <= w2, `${category}, step ${step}: week 2 ${w2}, light ${r.weight}`);
          if (step / w2 < 0.1) assert.ok(r.weight < w2, `${category}, step ${step}: week 2 ${w2}, light ${r.weight}`);
        }
      }
    }
  }
  assert.ok(n > 2000);
  // Light dumbbells, step 2: week 2 14×10, week 3 16×7. Isolation at 12–15 → 12 (range 10–12); a base
  // lift at 10–12 → the nearest dumbbell is 14 again (one step is 14% of the weight).
  let r = cycle([[14, 10, 2], [14, 10, 1], [14, 9, 1]], [[16, 7, 1], [16, 7, 1], [16, 6, 0]], 2);
  assert.deepEqual([r.weight, r.range], [12, [10, 12]]);
  r = cycle([[14, 10, 2], [14, 10, 1], [14, 9, 1]], [[16, 7, 1], [16, 7, 1], [16, 6, 0]], 2, 'base');
  assert.equal(r.weight, 14);
});

test('pull-ups: whole load; a body-weight difference below a step is not recounted, a bigger one is', () => {
  const s = history([{ date: '2026-11-06', week: 2, sets: [[28, 6, 1], [28, 6, 1], [28, 8, 0]], bw: 81.25 }], { key: 'pullup', category: 'pullup' });
  const base = { key: 'pullup', week: 3, category: 'pullup', share: 1 };
  let r = rec(s, { ...base, bodyweightToday: { value: 79.35 } });
  assert.deepEqual([r.kind, r.weight], ['estimate', 28]);
  assert.match(r.reasons.join(' '), /меньше чем на шаг \(1,9 кг\): не пересчитываю/);
  // 4,3 kg lighter: the same whole load needs more added weight.
  r = rec(s, { ...base, bodyweightToday: { value: 77 } });
  assert.equal(r.weight, 33);
  assert.match(r.reasons.join(' '), /Масса тела меньше на 4,3 кг, чем 6 ноября: учтено/);
  r = rec(history([{ date: '2026-11-06', week: 2, sets: [[28, 6, 1], [28, 6, 1], [28, 8, 0]] }], { key: 'pullup', category: 'pullup' }), { ...base, bodyweightToday: null });
  assert.equal(r.kind, 'none');
  // No added weight: «без доп. веса выходит», not «при без доп. веса» (v1.6.3).
  const bw = history([{ date: '2026-11-06', week: 3, sets: [[0, 7, 1], [0, 7, 1], [0, 7, 1]], bw: 80 }], { key: 'pullup', category: 'pullup' });
  r = rec(bw, { ...base, week: 2, bodyweightToday: { value: 80 } });
  assert.deepEqual([r.kind, r.weight], ['estimate', 0]);
  assert.match(r.reasons.join(' '), /По этим подходам без доп\. веса выходит около/);
  assert.doesNotMatch(r.reasons.join(' '), /при без доп/);
});

test("«Ориентир»: today's first set corrects it by one step", () => {
  const s = history([{ date: '2026-11-06', week: 2, sets: [[95, 10, 2], [95, 10, 1], [95, 10, 2]] }], { category: 'iso' });
  const at = (set) => rec(s, { week: 3, category: 'iso', todaySets: [set] });
  let r = at({ weight: 107.5, reps: 5, rir: 0 });
  assert.equal(r.weight, 105);
  assert.match(r.reasons.join(' '), /Сегодня первый подход 107,5×5 \(RIR 0\) — ниже цели: следующий 105 кг/);
  r = at({ weight: 107.5, reps: 10, rir: 1 });
  assert.equal(r.weight, 110);
  assert.match(r.reasons.join(' '), /заметно легче цели: следующий 110 кг/);
  r = at({ weight: 107.5, reps: 9, rir: 1 });
  assert.equal(r.weight, 107.5, 'one rep above the window is still in it');
  r = at({ weight: 107.5, reps: 7, rir: 1 });
  assert.equal(r.weight, 107.5);
  // A first set without RIR is not a reason to move it.
  assert.equal(at({ weight: 107.5, reps: 5 }).weight, 107.5);
});

test('every answer says how it was made', () => {
  const s = history([{ date: '2026-11-06', week: 2, sets: [[90, 10, 2], [90, 10, 1], [90, 10, 1], [90, 10, 1]] }]);
  assert.deepEqual([rec(s, { week: 2 }).basis, rec(s, { week: 2 }).approx], ['same', false]);
  assert.equal(rec(s, { week: 3 }).basis, 'heavy');
  assert.equal(rec(s, { week: 1 }).basis, 'light');
  assert.equal(rec(new Map(), { week: 2 }).basis, null);
});

// ---------------------------------------------------------------- v1.4.3: a step large for the weight

test('regression: light dumbbells, step 2,5 — «Ориентир» goes up a step instead of staying a whole window too light', () => {
  // Week 2: 10×11 at RIR 3 (14 reps to failure). Week 3 (6–8 at RIR 0–1, 6–9 to failure): 10 kg would
  // be ≈14 again (a whole window above), 12,5 kg ≈5 — one step up is nearer to the target.
  const s = history([{ date: '2026-11-06', week: 2, sets: [[10, 11, 3], [10, 11, 3], [10, 11, 3]] }], { category: 'iso' });
  const r = rec(s, { week: 3, category: 'iso' });
  assert.deepEqual([r.kind, r.basis, r.weight], ['estimate', 'heavy', 12.5]);
  const why = r.reasons.join(' ');
  assert.match(why, /Шаг 2,5 кг для этого веса крупный: при 10 кг выходит около 14 повторений до отказа — легче цели, при 12,5 кг — около 5\. Взят 12,5 кг: он ближе к цели\./);
  assert.match(why, /Если первый подход пойдёт тяжелее плана — следующий 10 кг/);
  // Today's first set still corrects it by a step down; a step up follows the same large-step rule
  // (v1.6.2): 12,5×8 at RIR 3 is 11 to failure, 15 kg would be ≈4 — further under the window than 12,5
  // is over it, so 12,5 stays; 12,5×10 at RIR 3 (13) — 15 kg ≈6, in the window.
  assert.equal(rec(s, { week: 3, category: 'iso', todaySets: [{ weight: 12.5, reps: 4, rir: 0 }] }).weight, 10);
  assert.equal(rec(s, { week: 3, category: 'iso', todaySets: [{ weight: 12.5, reps: 8, rir: 3 }] }).weight, 12.5);
  assert.equal(rec(s, { week: 3, category: 'iso', todaySets: [{ weight: 12.5, reps: 10, rir: 3 }] }).weight, 15);
});

test('a step large for the weight: the lighter weight stays when the next step is far too heavy or only a rep is at stake', () => {
  const at = (sets, step) => {
    const s = history([{ date: '2026-11-06', week: 2, sets }], { category: 'iso' });
    return recommend({ list: s.get('press'), session: today(3), target: targetFor({ category: 'iso' }, 3), category: 'iso', step });
  };
  // 10×10 at RIR 2 (12 to failure): 10 kg ≈12, 12,5 kg ≈4 — two reps under the window: stays 10, and says why.
  let r = at([[10, 10, 2], [10, 10, 2], [10, 10, 2]], 2.5);
  assert.equal(r.weight, 10);
  assert.match(r.reasons.join(' '), /Шаг 2,5 кг для этого веса крупный: при 12,5 кг выходит около 4 повторений до отказа — тяжелее цели, поэтому 10 кг\./);
  // 45×8 at RIR 2, step 5: 45 kg ≈10 (a rep above 6–9), 50 kg ≈6 — ordinary rounding, light side, no note.
  r = at([[45, 8, 2], [45, 8, 2], [45, 8, 2]], 5);
  assert.equal(r.weight, 45);
  assert.doesNotMatch(r.reasons.join(' '), /крупный/);
});

test('a step large for the weight, week 3 → week 2: never half the weight because the same one sits on the window edge', () => {
  // Week 3: 3×7 at RIR 2 (9 to failure) = the bottom of week 2's window (9–12); 2 kg would be ≈28.
  const s = history([{ date: '2026-11-06', week: 3, sets: [[3, 7, 2], [3, 7, 2], [3, 7, 2]] }], { category: 'iso' });
  const r = recommend({ list: s.get('press'), session: today(2), target: targetFor({ category: 'iso' }, 2), category: 'iso', step: 1 });
  assert.equal(r.weight, 3);
});

test('a fine step (machines at working weights): the large-step rule never fires', () => {
  for (const step of [1, 2, 2.5, 5]) {
    for (let w = Math.max(step * 13, 30); w <= 200; w += step) {
      for (const [week, other, sets] of [[3, 2, [[w, 10, 2], [w, 10, 1], [w, 9, 3]]], [2, 3, [[w, 7, 1], [w, 6, 0], [w, 8, 2]]]]) {
        const s = history([{ date: '2026-11-06', week: other, sets }], { category: 'iso' });
        const r = recommend({ list: s.get('press'), session: today(week), target: targetFor({ category: 'iso' }, week), category: 'iso', step });
        assert.doesNotMatch(r.reasons.join(' '), /для этого веса крупный/, `step ${step}, ${w} kg, week ${other} → ${week}`);
      }
    }
  }
});

test('regression v1.6.3: a step large for the weight going down — the hint keeps the weight, not a step that halves it', () => {
  // A cable stack in 2,5 kg plates, light week (isolation 12–15 at RIR 2–3: 14–18 to failure); week 3:
  // 7,5×8 at RIR 1. The first hint is 5 kg; 5×13 at RIR 2 (15) is in the window, then 5×12 at RIR 1
  // (13) a rep below it. Before: «следующий 2,5 кг» — half the weight, ≈44 reps to failure.
  const s = history([{ date: '2026-11-06', week: 3, sets: [[7.5, 8, 1], [7.5, 8, 1], [7.5, 8, 1]] }], { category: 'iso' });
  const at = (step, ...todaySets) => rec(s, { week: 1, category: 'iso', step, todaySets });
  const done = [{ weight: 5, reps: 13, rir: 2 }, { weight: 5, reps: 12, rir: 1 }];
  assert.equal(at(2.5).weight, 5);
  assert.equal(at(2.5, done[0]).weight, 5);
  let r = at(2.5, ...done);
  assert.deepEqual([r.kind, r.weight], ['estimate', 5]);
  let why = r.reasons.join(' ');
  assert.match(why, /Сегодня второй подход 5×12 \(RIR 1\) — ниже цели, но шаг 2,5 кг для этого веса крупный: при 2,5 кг выходит около 54 повторений до отказа — легче цели\. Этот вес и дальше, останавливайтесь на RIR 2–3, даже если повторений меньше\./);
  // The weight between the two, for the middle of the window with the next set a rep weaker.
  assert.match(why, /Точнее — около 4,5 кг, если есть чем добрать вес \(маленький блин, гантель\)\. Шаг веса упражнения меняется в программе\./);
  // Step 0,5 (add-on weights): that weight itself, no note.
  r = at(0.5, ...done);
  assert.equal(r.weight, 4.5);
  assert.match(r.reasons.join(' '), /Сегодня второй подход 5×12 \(RIR 1\) — ниже цели: следующий 4,5 кг\./);
  assert.doesNotMatch(r.reasons.join(' '), /крупный|Точнее/);
  // Step 1: 4 kg is ≈22 to failure — further above the window than 5 kg falls below it: 5 stays.
  assert.equal(at(1, ...done).weight, 5);
  // A set further below the window: one step down is nearer even when large.
  r = at(2.5, { weight: 7.5, reps: 7, rir: 1 });
  assert.equal(r.weight, 5);
  assert.doesNotMatch(r.reasons.join(' '), /крупный/);
  // At one step from zero: never «0 кг» for a weight that is part of the stack.
  r = at(2.5, { weight: 2.5, reps: 12, rir: 1 });
  assert.equal(r.weight, 2.5);
  assert.match(r.reasons.join(' '), /шаг 2,5 кг для этого веса крупный: на шаг легче — уже без веса\. Этот вес и дальше/);
  why = r.reasons.join(' ');
  assert.doesNotMatch(why, /NaN|Infinity|бесконечн/);
});

test('verifier on v1.6.3: the weight stays only a rep below the window, never against a lighter set done today', () => {
  const s = history([{ date: '2026-11-06', week: 3, sets: [[7.5, 8, 1], [7.5, 8, 1], [7.5, 8, 1]] }], { category: 'iso' });
  const at = (...todaySets) => rec(s, { week: 1, category: 'iso', todaySets });
  // Two or more reps below the window: a step down even when large (it errs light), the ⓘ names the
  // weight between. 5×3 at RIR 0 is not «этот вес и дальше, останавливайтесь на RIR 2–3».
  for (const [reps, rir] of [[11, 1], [5, 1], [3, 0]]) {
    const r = at({ weight: 5, reps, rir });
    assert.equal(r.weight, 2.5, `5×${reps} RIR ${rir}`);
    assert.doesNotMatch(r.reasons.join(' '), /Этот вес и дальше/, `5×${reps} RIR ${rir}`);
  }
  assert.match(at({ weight: 5, reps: 11, rir: 1 }).reasons.join(' '), /ниже цели: следующий 2,5 кг\. Точнее — около 4,5 кг/);
  // A set at the lighter weight today in the window (or below it): what was done beats the formula.
  let r = at({ weight: 5, reps: 13, rir: 2 }, { weight: 7.5, reps: 10, rir: 1 });
  assert.equal(r.weight, 5);
  assert.match(r.reasons.join(' '), /Сегодня второй подход 7,5×10 \(RIR 1\) — ниже цели: следующий 5 кг\./);
  // A lighter set clearly lighter than the target does not count against keeping the weight.
  r = at({ weight: 5, reps: 18, rir: 4 }, { weight: 7.5, reps: 12, rir: 1 });
  assert.equal(r.weight, 7.5);
});

test('verifier on v1.6.3: the advice for the first set goes once a set is logged — the ⓘ never contradicts itself', () => {
  const s = history([{ date: '2026-11-06', week: 3, sets: [[7.5, 8, 1], [7.5, 8, 1], [7.5, 8, 1]] }], { category: 'iso' });
  assert.match(rec(s, { week: 1, category: 'iso' }).reasons.join(' '), /Это приблизительная оценка по другой неделе\. Если первый подход тяжелее RIR 2 — снизьте вес\./);
  let r = rec(s, { week: 1, category: 'iso', todaySets: [{ weight: 5, reps: 12, rir: 1 }] });
  assert.equal(r.weight, 5);
  assert.match(r.reasons.join(' '), /Это приблизительная оценка по другой неделе\./);
  assert.doesNotMatch(r.reasons.join(' '), /Если первый подход/);
  // Heavy week: «следующий 2,5 кг» is not promised next to «Этот вес и дальше».
  const h = history([{ date: '2026-11-06', week: 2, sets: [[5, 11, 2], [5, 11, 2], [5, 11, 2]] }], { category: 'iso' });
  assert.match(rec(h, { week: 3, category: 'iso' }).reasons.join(' '), /Если первый подход пойдёт тяжелее плана — следующий/);
  r = rec(h, { week: 3, category: 'iso', todaySets: [{ weight: 5, reps: 5, rir: 0 }] });
  assert.doesNotMatch(r.reasons.join(' '), /Если первый подход/);
  // A set without RIR corrects nothing, and the advice stays.
  assert.match(rec(s, { week: 1, category: 'iso', todaySets: [{ weight: 5, reps: 12 }] }).reasons.join(' '), /Если первый подход тяжелее RIR 2/);
});

test('v1.6.3: with a fine step a set below the window is one step down on the heavy weeks', () => {
  // A step at most 5% of the weight: the large-step rule going down never fires.
  let cases = 0;
  for (const step of [0.5, 1, 1.25, 2, 2.5, 5]) {
    for (let w = step * 20; w <= 200; w += step) {
      for (const [week, src, category, todaySets] of [
        [2, [[w, 7, 1], [w, 7, 1], [w, 7, 0]], 'base', [{ weight: w, reps: 9, rir: 0 }]],
        [3, [[w, 10, 2], [w, 10, 1], [w, 9, 3]], 'iso', [{ weight: w, reps: 4, rir: 1 }]],
      ]) {
        const s = history([{ date: '2026-11-06', week: week === 3 ? 2 : 3, sets: src }], { category });
        const r = recommend({ list: s.get('press'), session: today(week), target: targetFor({ category }, week), category, step, todaySets });
        assert.equal(r.weight, Math.round((w - step) * 100) / 100, `step ${step}, ${w} kg, week ${week}, ${category}`);
        assert.doesNotMatch(r.reasons.join(' '), /крупный|Точнее|а не на шаг/, `step ${step}, ${w} kg, week ${week}, ${category}`);
        cases++;
      }
    }
  }
  assert.ok(cases > 400);
});

test('v1.6.4: light week, a fine step — after a set below the window as many steps down as that set says', () => {
  // The next set is taken a rep weaker; the weight is the heaviest one step or more lighter where that
  // set lands at least half a rep into the window — never heavier, never a step more than that.
  let cases = 0;
  let more = 0;
  for (const step of [0.5, 1, 1.25, 2, 2.5, 5]) {
    for (let w = step * 20; w <= 200; w += step) {
      for (const [category, set] of [['iso', { reps: 12, rir: 1 }], ['iso', { reps: 9, rir: 2 }], ['iso', { reps: 6, rir: 1 }], ['base', { reps: 12, rir: 0 }], ['base', { reps: 8, rir: 2 }]]) {
        const s = history([{ date: '2026-11-06', week: 3, sets: [[w, 7, 1], [w, 7, 1], [w, 7, 1]] }], { category });
        const target = targetFor({ category }, 1);
        const r = recommend({ list: s.get('press'), session: today(1), target, category, step, todaySets: [{ weight: w, ...set }] });
        const lo = target.reps[0] + target.rir[0];
        const capNext = w * (1 + (set.reps + set.rir - 1) / 30);
        const at = (x) => 30 * (capNext / x - 1);
        const tag = `step ${step}, ${w} kg, ${category}, ${set.reps}@${set.rir}`;
        assert.ok(r.weight <= w - step + 1e-9, tag);
        assert.ok(at(r.weight) >= lo + 0.5 - 1e-6, `${tag}: ${r.weight} lands below the window`);
        assert.ok(at(r.weight + step) < lo + 0.5 + 1e-6 || r.weight === Math.round((w - step) * 100) / 100, `${tag}: ${r.weight} is a step lighter than needed`);
        assert.doesNotMatch(r.reasons.join(' '), /крупный/, tag);
        if (r.weight < w - step - 1e-9) {
          more++;
          assert.match(r.reasons.join(' '), /поэтому легче на [\d,]+ кг, а не на шаг\./, tag);
        }
        cases++;
      }
    }
  }
  assert.ok(cases > 2000 && more > 1000);
});

test('v1.6.4: light week, a set far below the window → the next weight several steps lighter, not one', () => {
  // Isolation 12–15 at RIR 2–3 (14–18 to failure); week 3 85×8–9 at RIR 1, step 2,5.
  const s = history([{ date: '2026-11-06', week: 3, sets: [[85, 9, 1], [85, 9, 1], [85, 8, 1]] }], { category: 'iso' });
  const at = (...todaySets) => rec(s, { week: 1, category: 'iso', todaySets });
  // The first set at the top of the window: ≈65 (from 60 to 70).
  let r = at();
  assert.deepEqual([r.weight, r.range], [65, [60, 70]]);
  assert.match(r.reasons.join(' '), /Вес взят под верх цели — 15 при RIR 3/);
  // 70×12 at RIR 2 is in the window; then 70×7 at RIR 1 (8 to failure): 67,5 would be ≈8 again → 57,5.
  r = at({ weight: 70, reps: 12, rir: 2 });
  assert.equal(r.weight, 70);
  r = at({ weight: 70, reps: 12, rir: 2 }, { weight: 70, reps: 7, rir: 1 });
  assert.equal(r.weight, 57.5);
  assert.match(r.reasons.join(' '), /Сегодня второй подход 70×7 \(RIR 1\) — ниже цели: следующий 57,5 кг\. При 67,5 кг выходит около 8 повторений до отказа — тоже ниже цели, поэтому легче на 12,5 кг, а не на шаг\./);
  // Never below a lighter weight that was in the window today: 62,5×14 at RIR 2 (16 to failure), then
  // 70×7 at RIR 1 → 62,5, not 57,5.
  r = at({ weight: 62.5, reps: 14, rir: 2 }, { weight: 70, reps: 7, rir: 1 });
  assert.equal(r.weight, 62.5);
  assert.match(r.reasons.join(' '), /следующий 62,5 кг\. .*поэтому легче на 7,5 кг, а не на шаг\./);
  // A lighter set below the window today is no floor.
  assert.equal(at({ weight: 62.5, reps: 11, rir: 1 }, { weight: 70, reps: 7, rir: 1 }).weight, 57.5);
  // A rep below the window (65×12 at RIR 1, 13 to failure): a step lighter is ≈13,6 for the next set, a
  // rep weaker — said as «около 14», so «впритык к нижней границе», not «тоже ниже цели» (14 is in it).
  r = at({ weight: 65, reps: 12, rir: 1 });
  assert.equal(r.weight, 60);
  assert.match(r.reasons.join(' '), /При 62,5 кг выходит около 14 повторений до отказа — впритык к нижней границе, поэтому легче на 5 кг, а не на шаг\./);
  // The heavy weeks keep one step: their reps to failure hardly fall from set to set.
  r = rec(s, { week: 2, category: 'iso', todaySets: [{ weight: 85, reps: 5, rir: 1 }] });
  assert.equal(r.weight, 82.5);
  assert.doesNotMatch(r.reasons.join(' '), /а не на шаг/);
});

// ---------------------------------------------------------------- v1.6.1: every set, the order of the day

test("«Ориентир»: today's latest set corrects it, not only the first", () => {
  // Light week, Hammer: 75×12 at RIR 2 is in the window, then 75×10 at RIR 1 is not.
  const s = history([{ date: '2026-11-06', week: 3, sets: [[95, 7, 1], [95, 7, 1], [95, 7, 0]] }], { category: 'hammer' });
  const at = (...todaySets) => rec(s, { week: 1, category: 'hammer', todaySets });
  let r = at({ weight: 75, reps: 12, rir: 2 });
  assert.equal(r.weight, 75);
  assert.match(r.reasons.join(' '), /Сегодня первый подход 75×12 \(RIR 2\) — в цели: этот вес и дальше\./);
  // 11 to failure at 10–12, RIR 2–3 (12–15): the next set, a rep weaker, ≈11 at 72,5 — still below, so 70
  // (light week since v1.6.4: as many steps as the set says).
  r = at({ weight: 75, reps: 12, rir: 2 }, { weight: 75, reps: 10, rir: 1 });
  assert.equal(r.weight, 70);
  assert.match(r.reasons.join(' '), /Сегодня второй подход 75×10 \(RIR 1\) — ниже цели: следующий 70 кг\. При 72,5 кг выходит около 11 повторений до отказа — тоже ниже цели, поэтому легче на 5 кг, а не на шаг\./);
  assert.doesNotMatch(r.reasons.join(' '), /этот вес и дальше/, 'the first set no longer speaks once another followed');
  r = at({ weight: 75, reps: 12, rir: 2 }, { weight: 75, reps: 10, rir: 1 }, { weight: 70, reps: 11, rir: 2 });
  assert.equal(r.weight, 70);
  assert.match(r.reasons.join(' '), /Сегодня третий подход 70×11 \(RIR 2\) — в цели: этот вес и дальше/);
  // Two reps over the window → a step up from that set's weight.
  assert.equal(at({ weight: 75, reps: 12, rir: 2 }, { weight: 72.5, reps: 14, rir: 3 }).weight, 75);
  // The latest set WITH RIR decides; drop sets and deleted sets are not working sets.
  r = at({ weight: 75, reps: 10, rir: 1 }, { weight: 72.5, reps: 12 }, { weight: 50, reps: 15, rir: 0, drop: true }, { weight: 90, reps: 3, rir: 0, deleted: true });
  assert.equal(r.weight, 70);
  assert.match(r.reasons.join(' '), /Сегодня первый подход 75×10/);
  assert.equal(r.range, null, 'after a set the range is gone: the set decided');
});

test('order: later in the day than the source workout → said, the «Ориентир» weight itself unchanged', () => {
  const src = (order) => history([{ date: '2026-11-06', week: 3, order, sets: [[95, 7, 1], [95, 7, 1], [95, 7, 0]] }], { category: 'hammer' });
  const plain = rec(src(1), { week: 1, category: 'hammer' });
  assert.equal(plain.moved, undefined, 'no place today → nothing said');
  const r = rec(src(1), { week: 1, category: 'hammer', order: 3 });
  assert.deepEqual(r.moved, { then: 2, now: 4 });
  assert.equal(r.weight, plain.weight);
  assert.match(r.reasons.join(' '), /В тот раз \(6 ноября\) упражнение было 2-м по порядку, сегодня оно 4-е: перед ним больше работы, поэтому ориентир может быть завышен — проверьте первым подходом\./);
  // One place later, the same place or earlier → nothing.
  assert.equal(rec(src(1), { week: 1, category: 'hammer', order: 2 }).moved, undefined);
  assert.equal(rec(src(3), { week: 1, category: 'hammer', order: 1 }).moved, undefined);
  // A heavy week from the other heavy week too.
  const h = history([{ date: '2026-11-06', week: 2, order: 0, sets: [[90, 10, 2], [90, 10, 2], [90, 9, 1]] }], { category: 'hammer' });
  assert.deepEqual(rec(h, { week: 3, category: 'hammer', order: 4 }).moved, { then: 1, now: 5 });
  // Today's set has answered it: no line under the advice, the ⓘ still says it.
  const after = rec(src(1), { week: 1, category: 'hammer', order: 3, todaySets: [{ weight: plain.weight, reps: 12, rir: 2 }] });
  assert.equal(after.moved, undefined);
  assert.match(after.reasons.join(' '), /сегодня оно 4-е/);
});

test('order: «Можно повысить» waits when the exercise moved two places later; a hold says why it may be heavy', () => {
  const up = (order, sets = [[90, 10, 2], [90, 10, 2], [90, 10, 2]]) =>
    history([{ date: '2026-11-06', week: 2, order, sets }], { category: 'hammer' });
  let r = rec(up(1), { week: 2, category: 'hammer', order: 1 });
  assert.deepEqual([r.kind, r.weight, r.moved], ['up', 92.5, undefined]);
  r = rec(up(1), { week: 2, category: 'hammer', order: 3 });
  assert.deepEqual([r.kind, r.weight, r.moved], ['hold', 90, { then: 2, now: 4 }]);
  assert.match(r.reasons.join(' '), /Во всех подходах по 90 кг — верх диапазона 8–10/);
  assert.match(r.reasons.join(' '), /В тот раз \(6 ноября\) упражнение было 2-м по порядку, сегодня оно 4-е: перед ним больше работы, поэтому вес пока не повышаем: сначала 90 кг на новом месте\./);
  // Earlier today than then → the increase stands.
  assert.equal(rec(up(3), { week: 2, category: 'hammer', order: 1 }).kind, 'up');
  // After today's first set: still «закрепить», the line under it gone.
  r = rec(up(1), { week: 2, category: 'hammer', order: 3, todaySets: [{ weight: 90, reps: 9, rir: 1 }] });
  assert.deepEqual([r.kind, r.weight, r.moved], ['hold', 90, undefined]);
  assert.match(r.reasons.join(' '), /поэтому вес пока не повышаем/);
  // Already a hold (below the top of the range): the same weight, with the warning.
  r = rec(up(1, [[90, 9, 2], [90, 9, 2], [90, 8, 1]]), { week: 2, category: 'hammer', order: 3 });
  assert.deepEqual([r.kind, r.weight, r.moved], ['hold', 90, { then: 2, now: 4 }]);
  assert.match(r.reasons.at(-1), /сегодня оно 4-е: перед ним больше работы, вес может быть завышен — проверьте первым подходом\./);
});

test('order: the place of each exposure in its day comes from the workout, null when the slot is not in it', () => {
  const s = history([{ date: '2026-11-06', week: 2, order: 2, sets: [[90, 10, 2]] }]);
  assert.equal(s.get('press')[0].order, 2);
  const lost = buildExposures([{ id: 'x', date: '2026-11-06', week: 2, cycle: 1, day: 1, status: 'done', items: [] }],
    [{ id: 'x-0', sessionId: 'x', slotId: 'gone', seriesKey: 'press', exercise: 'press', setNo: 1, weight: 90, reps: 10, rir: 2 }]);
  assert.equal(lost.get('press')[0].order, null);
});

// ---------------------------------------------------------------- v1.6.2: independent review of v1.4.2–v1.6.1

// One workout where the same variant stands in two slots of the day (`places`, 0-based); the sets go to
// the slots in turn.
function twice(specs, { key = 'press', category = 'base' } = {}) {
  const sessions = [];
  const sets = [];
  specs.forEach((sp, i) => {
    const id = `s${i}`;
    const n = Math.max(...sp.places) + 1;
    const items = Array.from({ length: n }, (_, j) => (sp.places.includes(j)
      ? { slotId: `slot${j}`, seriesKey: key, category, flags: {} }
      : { slotId: `other${j}`, seriesKey: `other${j}`, category: 'iso', flags: {} }));
    sessions.push({ id, date: sp.date, cycle: 1, week: sp.week, day: sp.day || 1, status: 'done', startedAt: i + 1, items });
    sp.sets.forEach(([w, r, rir], j) => sets.push({ id: `${id}-${j}`, sessionId: id, slotId: `slot${sp.places[j % sp.places.length]}`, seriesKey: key, exercise: key, setNo: j + 1, weight: w, reps: r, rir }));
  });
  return buildExposures(sessions, sets);
}

test('review 1: an exercise in two days at different places — never held for the place of the other day', () => {
  // «Разгибание рук из-за головы на блоке»: day 1 — 6th, day 3 — 3rd. The same-week reference of day 1
  // is always day 3 of the cycle before; the place is compared with day 1 only.
  const top = [[20, 10, 1], [20, 10, 1], [20, 10, 1]];
  const s = history([
    { date: '2026-10-26', week: 2, day: 1, order: 5, sets: top },
    { date: '2026-10-30', week: 2, day: 3, order: 2, sets: top },
  ], { category: 'iso' });
  const at = (day, order, week = 2) => recommend({ list: s.get('press'), session: today(week, '2026-11-16', { day }), target: targetFor({ category: 'iso' }, week), category: 'iso', step: 2.5, order });
  let r = at(1, 5);
  assert.deepEqual([r.kind, r.weight, r.moved, r.ref.date], ['up', 22.5, undefined, '2026-10-30']);
  assert.doesNotMatch(r.reasons.join(' '), /по порядку/);
  // Moved later within day 1 itself (a program change): held, and the day-1 workout is named.
  r = at(1, 8);
  assert.deepEqual([r.kind, r.weight, r.moved], ['hold', 20, { then: 6, now: 9 }]);
  assert.match(r.reasons.join(' '), /26 октября \(день 1\) упражнение было 6-м по порядку, сегодня оно 9-е: перед ним больше работы, поэтому вес пока не повышаем/);
  // A day with no earlier workout of its own: nothing to compare the place with.
  r = at(2, 7);
  assert.deepEqual([r.kind, r.moved], ['up', undefined]);
  // The «Ориентир» of the light week the same way: source day 3, today day 1 at its usual place.
  const h = history([
    { date: '2026-11-02', week: 3, day: 1, order: 5, sets: [[22.5, 8, 1], [22.5, 8, 1], [22.5, 7, 1]] },
    { date: '2026-11-06', week: 3, day: 3, order: 2, sets: [[22.5, 8, 1], [22.5, 8, 1], [22.5, 7, 1]] },
  ], { category: 'iso' });
  const e = recommend({ list: h.get('press'), session: today(1, '2026-11-16', { day: 1 }), target: targetFor({ category: 'iso' }, 1), category: 'iso', step: 2.5, order: 5 });
  assert.deepEqual([e.kind, e.moved, e.ref.date], ['estimate', undefined, '2026-11-06']);
});

test('review 9: the same exercise twice in one day — the second slot is not «moved later» against the first', () => {
  const s = twice([{ date: '2026-11-06', week: 2, places: [1, 4], sets: [[90, 10, 2], [90, 10, 2], [90, 10, 2], [90, 10, 2]] }], { category: 'hammer' });
  const [e] = s.get('press');
  assert.deepEqual([e.order, e.places], [1, [1, 4]]);
  const at = (order) => recommend({ list: s.get('press'), session: today(2), target: targetFor({ category: 'hammer' }, 2), category: 'hammer', step: 2.5, order });
  assert.deepEqual([at(4).kind, at(4).moved], ['up', undefined]);
  assert.deepEqual([at(1).kind, at(1).moved], ['up', undefined]);
  // Further than either place → still said.
  assert.deepEqual(at(6).moved, { then: 5, now: 7 });
});

test('review 8: the order line under the «Ориентир» goes after any working set, with or without RIR', () => {
  const s = history([{ date: '2026-11-06', week: 3, order: 1, sets: [[95, 7, 1], [95, 7, 1], [95, 7, 0]] }], { category: 'hammer' });
  const r = rec(s, { week: 1, category: 'hammer', order: 3, todaySets: [{ weight: 75, reps: 12 }] });
  assert.equal(r.moved, undefined);
  assert.match(r.reasons.join(' '), /сегодня оно 4-е/, 'the ⓘ still says it');
});

test('review 2: a step larger than the window — the hint never swings back to a weight already below the target today', () => {
  // Lateral raises, light week (12–15 at RIR 2–3: 14–18 to failure), dumbbells 10 / 12,5;
  // source week 3: 12,5×8 at RIR 1. The owner does what each hint says.
  const s = history([{ date: '2026-11-06', week: 3, sets: [[12.5, 8, 1], [12.5, 8, 1], [12.5, 8, 1]] }], { category: 'iso' });
  const done = [];
  const after = (set) => {
    done.push(set);
    return rec(s, { week: 1, category: 'iso', todaySets: [...done] });
  };
  let r = after({ weight: 10, reps: 15, rir: 5 });
  assert.equal(r.weight, 10, '12,5 would be ≈10 to failure — further under the window than 10 is over it');
  assert.match(r.reasons.join(' '), /Сегодня первый подход 10×15 \(RIR 5\) — заметно легче цели, но шаг 2,5 кг для этого веса крупный: при 12,5 кг выходит около 10 повторений до отказа — тяжелее цели\. Этот вес и дальше\./);
  r = after({ weight: 12.5, reps: 11, rir: 1 });
  assert.equal(r.weight, 10);
  r = after({ weight: 10, reps: 15, rir: 5 });
  assert.equal(r.weight, 10);
  r = after({ weight: 12.5, reps: 10, rir: 1 });
  assert.equal(r.weight, 10);
  // A weight that was below the target today is not offered again even when the formula would allow it.
  const m = history([{ date: '2026-11-06', week: 3, sets: [[60, 8, 1], [60, 8, 1], [60, 8, 1]] }], { category: 'iso' });
  r = rec(m, { week: 1, category: 'iso', todaySets: [{ weight: 52.5, reps: 11, rir: 1 }, { weight: 50, reps: 17, rir: 3 }] });
  assert.equal(r.weight, 50);
  assert.match(r.reasons.join(' '), /заметно легче цели, но 52,5×11 \(RIR 1\) сегодня уже был ниже цели: этот вес и дальше\./);
  // A fine step still goes up.
  r = rec(m, { week: 1, category: 'iso', todaySets: [{ weight: 50, reps: 17, rir: 3 }] });
  assert.equal(r.weight, 52.5);
});

test('review 5: a set harder than the planned RIR at the bottom of the window is not «в цели»', () => {
  const s = history([{ date: '2026-11-06', week: 3, sets: [[100, 7, 1], [100, 7, 1], [100, 7, 0], [100, 6, 0]] }]);
  const at = (set) => rec(s, { week: 1, todaySets: [set] });
  // Base, light week: 10–12 at RIR 2–3. To failure at 12 — 10 at RIR 2, and the next set falls short.
  // A step lighter the next set (a rep weaker) is ≈12 to failure — just at the bottom: since v1.6.4 one
  // more step on the light week.
  let r = at({ weight: 87.5, reps: 12, rir: 0 });
  assert.equal(r.weight, 82.5);
  assert.match(r.reasons.join(' '), /Сегодня первый подход 87,5×12 \(RIR 0\) — тяжелее плана \(RIR 2–3\): следующий 82,5 кг\. При 85 кг выходит около 12 повторений до отказа — впритык к нижней границе, поэтому легче на 5 кг, а не на шаг\./);
  assert.doesNotMatch(r.reasons.join(' '), /— (вес )?в цели/);
  r = at({ weight: 87.5, reps: 11, rir: 1 });
  assert.equal(r.weight, 82.5);
  // Reps to spare at the planned RIR: the weight is right, the set should stop earlier — said so.
  r = at({ weight: 87.5, reps: 14, rir: 0 });
  assert.equal(r.weight, 87.5);
  assert.match(r.reasons.join(' '), /87,5×14 \(RIR 0\) — вес в цели, но подход тяжелее плана: этот вес и дальше, останавливайтесь на RIR 2–3\./);
  // At the planned RIR the bottom of the window is still in it (unchanged).
  assert.equal(at({ weight: 87.5, reps: 10, rir: 2 }).weight, 87.5);
  // Heavy week 2 (RIR 1–2) from week 3: to failure at the bottom → a step lighter, as the ⓘ promises.
  const h = history([{ date: '2026-11-06', week: 3, sets: [[100, 8, 1], [100, 8, 1], [100, 7, 1], [100, 7, 1]] }]);
  r = rec(h, { week: 2, todaySets: [{ weight: 95, reps: 9, rir: 0 }] });
  assert.equal(r.weight, 92.5);
});

test('review 6: the large-step rule does not depend on rounding — the same strength gives the same answer', () => {
  // 20×9 (RIR 2), 20×9 (RIR 2), 20×8 (RIR 1), 20×8 (RIR 1) is the same strength as 4×20×8 at RIR 2.
  const at = (sets, step = 2.5) => {
    const s = history([{ date: '2026-11-06', week: 2, sets }], { category: 'iso' });
    return recommend({ list: s.get('press'), session: today(3), target: targetFor({ category: 'iso' }, 3), category: 'iso', step });
  };
  const at2 = (week, other, w, step, sets) => {
    const s = history([{ date: '2026-11-06', week: other, sets: sets.map(([r, rir]) => [w, r, rir]) }], { category: 'iso' });
    return recommend({ list: s.get('press'), session: today(week), target: targetFor({ category: 'iso' }, week), category: 'iso', step });
  };
  const mixed = at([[20, 9, 2], [20, 9, 2], [20, 8, 1], [20, 8, 1]]);
  const even = at([[20, 8, 2], [20, 8, 2], [20, 8, 2], [20, 8, 2]]);
  assert.equal(mixed.weight, even.weight);
  assert.doesNotMatch(mixed.reasons.join(' '), /крупный/);
  assert.doesNotMatch(even.reasons.join(' '), /крупный/);
  // Any weight, step and reps on the heavy weeks (Epley is linear in reps to failure): sets at n±1 to
  // failure answer exactly as sets at n.
  let cases = 0;
  for (const step of [1, 1.25, 2, 2.5]) {
    for (let w = 4; w <= 40; w += step) {
      for (let n = 7; n <= 14; n++) {
        for (const [week, other] of [[3, 2], [2, 3]]) {
          const a = at2(week, other, w, step, [[n - 2, 2], [n - 2, 2], [n - 2, 2], [n - 2, 2]]);
          const b = at2(week, other, w, step, [[n - 1, 2], [n - 1, 2], [n - 2, 1], [n - 2, 1]]);
          assert.equal(a.weight, b.weight, `step ${step}, ${w} kg, ${n} to failure, week ${other} → ${week}`);
          assert.equal(/крупный/.test(a.reasons.join(' ')), /крупный/.test(b.reasons.join(' ')), `note: step ${step}, ${w} kg, ${n}, ${other} → ${week}`);
          cases++;
        }
      }
    }
  }
  assert.ok(cases > 1000);
});

test('verifier on v1.6.2: every «Лучше закрепить» names the working weight — after pain, worse technique or a break too', () => {
  // Week 3: 100×5 at RIR 0 (below 6–8), then 90×7 three times: the working weight is 90, and the drop
  // question measures from it (lib/plateau.js weightDrop), so the advice must not say 100.
  const sets = [[100, 5, 0], [90, 7, 1], [90, 7, 1], [90, 7, 1]];
  const at = (spec, opts = {}) => rec(history([{ date: '2026-11-06', week: 3, sets, ...spec }]), { week: 3, ...opts });
  const T = targetFor({ category: 'base' }, 3);
  const cases = {
    plain: at({}),
    technique: at({ flags: { technique: true } }),
    pain: at({ flags: { pain: true } }),
    painToday: at({}, { todayFlags: { pain: true } }),
    techniqueToday: at({}, { todaySets: [{ weight: 90, reps: 7, rir: 1, technique: true }] }),
    break: at({ date: '2026-09-01' }),
  };
  for (const [name, r] of Object.entries(cases)) assert.deepEqual([r.kind, r.weight], ['hold', 90], name);
  assert.match(cases.technique.reasons.join(' '), /В тот раз техника была хуже/);
  assert.match(cases.break.reasons.join(' '), /после перерыва сначала прежний вес/);
  const ref = history([{ date: '2026-11-06', week: 3, sets, flags: { technique: true } }]).get('press')[0];
  assert.equal(workingWeight(ref.sets, T).weight, cases.technique.weight, 'the advice and the drop question agree');
  // The top weight in enough sets is still the one held.
  const most = rec(history([{ date: '2026-11-06', week: 3, sets: [[100, 5, 0], [100, 5, 0], [100, 5, 0], [90, 7, 1]], flags: { technique: true } }]), { week: 3 });
  assert.deepEqual([most.kind, most.weight], ['hold', 100]);
});
