// The weekly report (lib/report.js): the last full calendar week and 4 weeks up to it; training against
// the same week of the cycle, weight and its pace, nutrition of the phase days only, sleep; «недостаточно
// данных» where it applies; calorie advice only with 2+ full weeks; no causes. Synthetic numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyReport, reportText, lastFullWeek } from '../../app/js/lib/report.js';
import { buildExposures } from '../../app/js/lib/plateau.js';
import { addDays } from '../../app/js/lib/phase.js';

const TODAY = '2026-10-29'; // Thursday → the report covers 19–25 October
const BULK = { id: 'p1', mode: 'bulk', start: '2026-09-01', end: null, targetPct: 0.25 };
const GOALS = [{ id: 'g:p1:2026-09-01', phaseId: 'p1', from: '2026-09-01', kcalMin: 3200, kcalMax: 3500, proteinMin: 150, proteinMax: 170, fatMin: 80, fatMax: 100, carbsMode: 'rest' }];

const range = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
const day = (date, v = {}) => ({ id: `n:${date}`, date, kcal: 3300, protein: 160, fat: 90, carbs: 400, status: 'final', source: 'manual', approx: false, ranges: null, deleted: false, updatedAt: 1, ...v });
// Daily weights from 28.09: `perWeek` kg a week, from 80 kg.
const weights = (perWeek, from = '2026-09-28', to = '2026-10-25') => range(from, to).map((date, i) => ({ date, bodyweight: Math.round((80 + (perWeek / 7) * i) * 100) / 100, from: 'body' }));
const report = (input) => weeklyReport({ today: TODAY, phases: [BULK], goals: GOALS, ...input });
const all = (r) => [...r.training.lines, ...r.body.lines, ...r.nutrition.lines, ...r.sleep.lines].join('\n');

test('the last full calendar week: Monday to Sunday before the current week', () => {
  assert.deepEqual(lastFullWeek('2026-10-29'), { from: '2026-10-19', to: '2026-10-25' });
  assert.deepEqual(lastFullWeek('2026-10-26'), { from: '2026-10-19', to: '2026-10-25' }); // Monday
  assert.deepEqual(lastFullWeek('2026-10-25'), { from: '2026-10-12', to: '2026-10-18' }); // Sunday: that week is not over
  const r = report({});
  assert.deepEqual(r.four.map((w) => w.from), ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
});

test('nothing recorded: each part says so, «недостаточно данных», no advice', () => {
  const r = report({});
  assert.deepEqual(r.training.lines, ['За неделю тренировок не записано.']);
  assert.match(r.body.lines[0], /^Средний вес за неделю: недостаточно данных \(взвешиваний — 0, нужно 3\)\.$/);
  assert.match(r.body.lines.join(' '), /Темп за 4 недели: недостаточно данных/);
  assert.match(r.body.lines.join(' '), /Талия: за неделю замеров нет\./);
  assert.match(r.nutrition.lines.join(' '), /Питание: итогов дней нет — недостаточно данных\./);
  assert.equal(r.nutrition.advice, null);
  assert.deepEqual(r.sleep.lines, ['Сон: за неделю данных нет — недостаточно данных.']);
});

test('training: compared with the same week of the cycle; first times, pain and technique named', () => {
  const sessions = [
    { id: 's1', date: '2026-10-07', cycle: 1, week: 2, day: 1, status: 'done', startedAt: 1, items: [
      { slotId: 'a', seriesKey: 'bench', category: 'base', flags: {} },
      { slotId: 'b', seriesKey: 'squat', category: 'base', flags: {} }] },
    { id: 's2', date: '2026-10-21', cycle: 2, week: 2, day: 1, status: 'done', startedAt: 2, items: [
      { slotId: 'a', seriesKey: 'bench', category: 'base', flags: {} },
      { slotId: 'b', seriesKey: 'squat', category: 'base', flags: { pain: true } },
      { slotId: 'c', seriesKey: 'row', category: 'base', flags: { technique: true } }] },
    { id: 's3', date: '2026-10-23', cycle: 2, week: 2, day: 2, status: 'done', startedAt: 3, items: [] },
  ];
  const sets = [];
  const add = (sessionId, slotId, key, w, r, n) => {
    for (let i = 0; i < n; i++) sets.push({ id: `${sessionId}-${key}-${i}`, sessionId, slotId, seriesKey: key, exercise: key, setNo: i + 1, weight: w, reps: r, rir: 1 });
  };
  add('s1', 'a', 'bench', 90, 10, 4);
  add('s1', 'b', 'squat', 120, 8, 3);
  add('s2', 'a', 'bench', 92.5, 10, 4);
  add('s2', 'b', 'squat', 110, 6, 3);
  add('s2', 'c', 'row', 60, 10, 3);
  const series = buildExposures(sessions, sets);
  const names = { bench: 'Жим лёжа', squat: 'Присед', row: 'Тяга' };
  const r = report({ sessions, series, program: { days: [{ day: 1 }, { day: 2 }, { day: 3 }, { day: 4 }] }, nameOf: (k) => names[k] });
  assert.equal(r.training.lines[0], 'За неделю выполнено 2 тренировки из 4 по плану.');
  assert.equal(r.training.lines[1], 'С той же неделей цикла сравнено 1 упражнение: лучше — 1, на месте — 0, ниже — 0.');
  assert.equal(r.training.lines[2], 'Лучше: Жим лёжа.');
  // The squat with pain is not counted as «ниже»; it is named under pain.
  assert.ok(!all(r).includes('Ниже:'));
  assert.match(all(r), /Без сравнения \(первый раз на этой неделе цикла\): 1\./);
  assert.match(all(r), /Боль отмечена: Присед, 21 октября\./);
  assert.match(all(r), /Техника хуже: Тяга, 21 октября\./);
});

test('body: the week average with its days, the change, the 4-week pace against the phase target, waist', () => {
  const body = [
    { id: 'w1', kind: 'waist', value: 84, date: '2026-09-29', measuredAt: '2026-09-29T08:00:00Z' },
    { id: 'w2', kind: 'waist', value: 84.6, date: '2026-10-24', measuredAt: '2026-10-24T08:00:00Z' },
  ];
  const r = report({ days: weights(0.2), body });
  assert.match(r.body.lines[0], /^Средний вес 80,\d кг по 7 дням со взвешиванием, за неделю \+0,2\d? кг \(\+0,2\d? %\)\.$/);
  assert.match(r.body.lines[1], /^Темп за 4 недели \+0,2\d % массы в неделю при цели \+0,25 % \(набор\) — в пределах цели\.$/);
  assert.equal(r.body.lines[2], 'Талия 84,6 см, за 3+ недели +0,6 см.');
  // Three weigh-ins in the week are enough for an average; two are not.
  const few = weights(0.2).filter((d) => d.date < '2026-10-19' || ['2026-10-20', '2026-10-23'].includes(d.date));
  assert.match(report({ days: few }).body.lines[0], /недостаточно данных \(взвешиваний — 2, нужно 3\)/);
});

test('nutrition: averages over final days only, drafts and approximate days said, goals checked', () => {
  const nutrition = [
    ...range('2026-10-19', '2026-10-23').map((d) => day(d)),
    day('2026-10-24', { protein: 130, kcal: 2900 }),
    day('2026-10-25', { status: 'draft', kcal: 1200 }),
    day('2026-10-22', { approx: true }),
  ].reduce((m, r) => m.set(r.id, r), new Map());
  const r = report({ nutrition: [...nutrition.values()] });
  const text = r.nutrition.lines.join('\n');
  assert.match(text, /Средняя калорийность по 6 из 7 дней — ≈3233 ккал\./);
  assert.match(text, /Черновиков — 1: в средние не входят\./);
  assert.match(text, /Приблизительные значения или диапазоны — в 1 дне\./);
  assert.match(text, /Белок ниже цели в 1 дне из 6\./);
  assert.match(text, /Калории в цели — 5 из 6, ниже — 1\./);
  // One week of data: no advice on calories, and it says why.
  assert.equal(r.nutrition.advice, null);
  assert.match(text, /Советы по калорийности — только по 2\+ неделям.*таких недель 0 — недостаточно данных\./);
});

test('analytics only over the phase: a phase that started mid-week counts its own days', () => {
  const cut = { id: 'p2', mode: 'cut', start: '2026-10-22', end: null, targetPct: -0.5 };
  const nutrition = range('2026-10-19', '2026-10-25').map((d) => day(d, { kcal: d < '2026-10-22' ? 3400 : 2400 }));
  const r = weeklyReport({ today: TODAY, phases: [{ ...BULK, end: '2026-10-21' }, cut], goals: GOALS, nutrition });
  assert.equal(r.phase.id, 'p2');
  assert.match(r.nutrition.lines[0], /Неделя считается с начала режима: 4 дня\./);
  assert.match(r.nutrition.lines.join(' '), /Средняя калорийность по 4 из 4 дней — 2400 ккал\./);
  // No goals for the cut yet: said, not guessed from the bulk.
  assert.match(r.nutrition.lines.join(' '), /Цели по калориям для этого режима не заданы\./);
});

test('calorie advice: only with 2+ full weeks and a weight pace; faster than the target → a 100–300 kcal step', () => {
  const nutrition = range('2026-09-28', '2026-10-25').map((d) => day(d));
  const fast = report({ nutrition, days: weights(0.6) });
  assert.match(fast.nutrition.advice, /^За 4 недели при ≈3300 ккал в день темп \+0,7\d % в неделю — быстрее цели \(цель \+0,25 %\)\. Если цель прежняя, можно попробовать уменьшить калории примерно на 300 ккал в день/);
  assert.match(fast.nutrition.advice, /Оценка грубая/);
  assert.match(fast.nutrition.lines.join(' '), /Калории и вес по неделям: 28 сентября — 3300 ккал \(7 дн\.\), 80,\d кг; 5 октября/);

  const on = report({ nutrition, days: weights(0.2) });
  assert.match(on.nutrition.advice, /темп веса в пределах цели — менять калорийность повода нет\./);

  // Only one week with 5+ final days: no advice whatever the pace.
  const thin = nutrition.filter((r) => r.date >= '2026-10-19' || r.date.endsWith('0'));
  const one = report({ nutrition: thin, days: weights(0.6) });
  assert.equal(one.nutrition.advice, null);
  assert.match(one.nutrition.lines.join(' '), /таких недель 1 — недостаточно данных/);

  // No phase: no target, no advice.
  assert.equal(weeklyReport({ today: TODAY, nutrition, days: weights(0.6) }).nutrition.advice, null);
});

test('sleep: the week average against the week before; short nights before workouts are a coincidence, not a cause', () => {
  const nights = [
    ...range('2026-10-12', '2026-10-18').map((date) => ({ date, hours: 7.5 })),
    ...range('2026-10-19', '2026-10-23').map((date) => ({ date, hours: date === '2026-10-21' ? 5.2 : 7 })),
  ];
  const sessions = [
    { id: 'a', date: '2026-10-21', status: 'done', week: 2, day: 1 },
    { id: 'b', date: '2026-10-23', status: 'done', week: 2, day: 2 },
    { id: 'c', date: '2026-10-25', status: 'done', week: 2, day: 3 },
  ];
  const r = report({ nights, sessions });
  assert.equal(r.sleep.lines[0], 'Сон в среднем 6,6 ч по 5 из 7 ночей, неделей раньше — 7,5 ч (7 из 7).');
  assert.equal(r.sleep.lines[1], '1 из 2 тренировок — в день после сна короче 6 ч. Это совпадение во времени, не вывод о причине.');
  assert.ok(!/из-за|потому что|приводит|вызывает/.test(all(r)));
});

test('the text for ChatGPT: the period, the phase, four parts; totals only, no single records or comments', () => {
  const nutrition = range('2026-10-19', '2026-10-25').map((d) => day(d, { comment: 'ужин у мамы' }));
  const text = reportText(report({ nutrition, days: weights(0.2) }));
  const lines = text.split('\n');
  assert.equal(lines[0], 'Отчёт за неделю 19 октября — 25 октября, режим: Набор с 1 сентября, цель +0,25 % массы в неделю.');
  for (const h of ['Тренировки:', 'Тело:', 'Питание:', 'Сон:']) assert.ok(lines.includes(h), h);
  assert.ok(lines.filter((l) => l.startsWith('- ')).length >= 6);
  assert.ok(!text.includes('ужин у мамы'));
  assert.ok(!text.includes('n:2026'));
  assert.match(lines[lines.length - 1], /«недостаточно данных» — значит, выводов по этому пункту нет\./);
});
