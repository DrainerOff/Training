// The weight recommendation (lib/recommend.js): same week of the cycle only, every set and its RIR,
// pain / technique / baseline, a break, body weight, today's sets. Synthetic numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExposures } from '../../app/js/lib/plateau.js';
import { recommend, LIGHT_REPS } from '../../app/js/lib/recommend.js';
import { targetFor } from '../../app/js/lib/program.js';

// `specs`: { date, week, day?, key?, sets: [[w, r, rir?, extra?]], flags?, bw? } in order.
function history(specs, { key = 'press', category = 'base' } = {}) {
  const sessions = [];
  const sets = [];
  const bws = new Map();
  specs.forEach((sp, i) => {
    const id = `s${i}`;
    const k = sp.key || key;
    sessions.push({ id, date: sp.date, cycle: sp.cycle || 1, week: sp.week, day: sp.day || 1, status: 'done', startedAt: i + 1,
      items: [{ slotId: 'slot1', seriesKey: k, category, flags: sp.flags || {} }] });
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

test('never up because of another week: week 2 history, today week 3 → not enough data', () => {
  const s = history([
    { date: '2026-10-30', week: 2, sets: [[90, 10, 3], [90, 10, 3], [90, 10, 3], [90, 10, 3]] },
    { date: '2026-11-06', week: 1, sets: [[70, 12, 5], [70, 12, 5], [70, 12, 5]] },
  ]);
  const r = rec(s, { week: 3 });
  assert.deepEqual([r.kind, r.weight, r.label], ['none', null, 'Недостаточно данных']);
  assert.match(r.reasons.join(' '), /На неделе 3 этот вариант ещё не выполнялся. Результат другой недели цикла для повышения не используется/);
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

test('week 1 uses 10–12 reps inside the recommendation; the program target is unchanged', () => {
  assert.deepEqual(LIGHT_REPS, [10, 12]);
  assert.equal(targetFor({ category: 'base' }, 1).reps, null);
  let s = history([{ date: '2026-11-06', week: 1, sets: [[70, 12, 4], [70, 12, 4], [70, 12, 4]] }]);
  assert.deepEqual([rec(s, { week: 1 }).kind, rec(s, { week: 1 }).weight], ['up', 72.5]);
  s = history([{ date: '2026-11-06', week: 1, sets: [[70, 11, 4], [70, 12, 4], [70, 12, 4]] }]);
  assert.equal(rec(s, { week: 1 }).kind, 'hold');
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
