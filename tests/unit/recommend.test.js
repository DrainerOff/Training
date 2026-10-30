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
  assert.deepEqual([r.weight, r.range], [75, [70, 80]]);
  assert.match(r.reasons[0], /Лёгкой недели в истории этого варианта ещё нет, поэтому вес пересчитан с недели 3/);
  assert.match(r.reasons.join(' '), /формулы дают от 70 кг до 80 кг, ошибка около ±10%/);
  assert.match(r.reasons.join(' '), /Если первый подход тяжелее RIR 4 — снизьте вес/);
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
