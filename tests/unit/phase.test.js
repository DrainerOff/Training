// Bulk / cut / maintenance analytics (lib/phase.js). Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, addDays, phaseOn, rateOf, weeklyWeights, rateStatus, waistVsWeight, strengthOver, phaseReport } from '../../app/js/lib/phase.js';
import { createStore } from '../../app/js/data/store.js';
import { memoryAdapter } from '../../app/js/data/db.js';

// Daily weights from `start`, `n` days, +`perDay` kg a day, on the days `every` apart.
const series = (start, n, w0, perDay, every = 1) =>
  Array.from({ length: n }, (_, i) => i)
    .filter((i) => i % every === 0)
    .map((i) => ({ date: addDays(start, i), bodyweight: Math.round((w0 + perDay * i) * 100) / 100 }));

test('rate: a steady +0.2 kg a week at 80 kg is +0.25 % a week; too few days is no answer', () => {
  const days = series('2026-09-01', 28, 80, 0.2 / 7);
  const r = rateOf(days);
  assert.ok(Math.abs(r.perWeek - 0.2) < 0.01);
  assert.ok(Math.abs(r.pct - 0.25) < 0.01);
  assert.equal(r.days, 28);
  assert.equal(rateOf(days.slice(0, 5)), null); // 5 days with a weigh-in
  assert.equal(rateOf(series('2026-09-01', 10, 80, 0.03)), null); // 10 days only
  assert.notEqual(rateOf(series('2026-09-01', 15, 80, 0.03, 2)), null); // 8 days over 14
});

test('rate against the target', () => {
  assert.equal(rateStatus(0.3, 0.25), 'on');
  assert.equal(rateStatus(0.6, 0.25), 'fast');
  assert.equal(rateStatus(0.05, 0.25), 'slow');
  assert.equal(rateStatus(-0.4, 0.25), 'reverse');
  assert.equal(rateStatus(-0.45, -0.5), 'on');
  assert.equal(rateStatus(-1.1, -0.5), 'fast');
  assert.equal(rateStatus(0.3, -0.5), 'reverse');
  assert.equal(rateStatus(0.05, 0), 'on');
  assert.equal(rateStatus(0.3, 0), 'up');
  assert.equal(rateStatus(-0.3, 0), 'down');
  assert.deepEqual(Object.keys(MODES), ['bulk', 'cut', 'maintain']);
});

test('weeks run Monday to Sunday; a week with fewer than 3 weigh-in days has no average', () => {
  // 2026-10-05 is a Monday.
  const days = [
    ...series('2026-10-05', 7, 80, 0), // full week at 80
    { date: '2026-10-13', bodyweight: 81 }, // 2 days only
    { date: '2026-10-15', bodyweight: 81 },
    ...series('2026-10-19', 3, 80.5, 0),
  ];
  const w = weeklyWeights(days, { from: '2026-10-07', to: '2026-10-21' });
  assert.deepEqual(w.map((x) => [x.start, x.days, x.avg, x.change]), [
    ['2026-10-05', 5, 80, null], // the phase starts on Wednesday: its days only
    ['2026-10-12', 2, null, null],
    ['2026-10-19', 3, 80.5, 0.5], // against the last week that had an average
  ]);
});

test('waist against weight: first and last waist 14+ days apart, weight by 7-day averages', () => {
  const days = series('2026-09-01', 40, 80, 0.05);
  const w = (date, value) => ({ kind: 'waist', value, date, measuredAt: `${date}T08:00:00+03:00`, deleted: false });
  const body = [w('2026-09-07', 84), w('2026-09-20', 84.2), w('2026-10-07', 85)];
  const r = waistVsWeight(body, days, { from: '2026-09-01', to: '2026-10-10' });
  assert.equal(r.enough, true);
  assert.equal(r.waistChange, 1);
  assert.ok(Math.abs(r.weightChange - 1.5) < 0.01); // 30 days × 0.05
  assert.ok(Math.abs(r.cmPerKg - 0.667) < 0.01);
  assert.equal(waistVsWeight([w('2026-09-07', 84), w('2026-09-15', 85)], days, { from: '2026-09-01', to: '2026-10-10' }).enough, false);
  assert.equal(waistVsWeight([{ ...w('2026-09-07', 84), deleted: true }, w('2026-10-07', 85)], days, { from: '2026-09-01', to: '2026-10-10' }).count, 1);
});

test('strength: the same week of the cycle at the start and the end; other weeks are not compared', () => {
  const ex = (key, date, week, weight, reps, extra = {}) => ({ key, name: key, date, week, active: false, category: null, sets: [{ weight, reps }], ...extra });
  const s = new Map([
    ['bench', [ex('bench', '2026-09-02', 1, 100, 5), ex('bench', '2026-09-09', 2, 90, 10), ex('bench', '2026-09-23', 1, 105, 5)]],
    ['row', [ex('row', '2026-09-02', 1, 80, 8), ex('row', '2026-09-30', 1, 80, 8)]],
    ['curl', [ex('curl', '2026-09-02', 1, 20, 10), ex('curl', '2026-09-09', 2, 22, 10)]], // weeks 1 and 2 only once each
    ['old', [ex('old', '2026-08-01', 1, 50, 5), ex('old', '2026-09-30', 1, 40, 5)]], // started before the phase
  ]);
  const r = strengthOver(s, { from: '2026-09-01', to: '2026-10-01' });
  assert.deepEqual([r.up, r.flat, r.down, r.compared], [1, 1, 0, 2]);
  assert.deepEqual(r.items.map((i) => [i.key, i.week, i.verdict]), [['bench', 1, 'up'], ['row', 1, 'flat']]);
});

test('report: a phase with weigh-ins, waist, workouts and sleep; the end date caps the window', () => {
  const days = series('2026-09-01', 60, 80, 0.2 / 7);
  const phase = { id: 'p', mode: 'bulk', start: '2026-09-01', end: '2026-09-28', targetPct: 0.25 };
  const r = phaseReport(phase, { days, nights: [{ date: '2026-09-10', hours: 7 }, { date: '2026-10-10', hours: 5 }], today: '2026-10-20' });
  assert.equal(r.to, '2026-09-28');
  assert.equal(r.weighDays, 28);
  assert.equal(r.status, 'on');
  assert.ok(Math.abs(r.targetKg - 0.2) < 0.01);
  assert.deepEqual(r.sleep, { nights: 1, avg: 7 });
  assert.equal(r.waist.enough, false);
  assert.equal(r.strength.compared, 0);
  // Too early to say: honest "not enough".
  const fresh = phaseReport({ ...phase, start: '2026-10-15', end: null }, { days: series('2026-10-15', 5, 80, 0), today: '2026-10-20' });
  assert.equal(fresh.rate, null);
  assert.equal(fresh.status, null);
});

test('one phase at a time: a new phase ends the running one the day before; bad input is refused', async () => {
  const store = createStore(memoryAdapter(), { now: () => 1_792_500_000_000 });
  await store.load();
  const cut = await store.savePhase({ mode: 'cut', start: '2026-07-01', targetPct: -0.5 });
  const bulk = await store.savePhase({ mode: 'bulk', start: '2026-10-01', targetPct: 0.25, note: 'после сушки' });
  assert.equal(store.state.phases.get(cut.id).end, '2026-09-30');
  assert.equal(phaseOn(store.state.phases.values(), '2026-09-15').id, cut.id);
  assert.equal(phaseOn(store.state.phases.values(), '2026-10-19').id, bulk.id);
  assert.equal(store.state.outbox.size, 2);
  await assert.rejects(store.savePhase({ mode: 'bulk', start: '2026-10-01', targetPct: 3 }), /Темп/);
  await assert.rejects(store.savePhase({ mode: 'x', start: '2026-10-01', targetPct: 0 }), /режим/);
  await assert.rejects(store.savePhase({ mode: 'bulk', start: '2026-10-05', end: '2026-10-01', targetPct: 0 }), /Конец/);
  await store.deletePhase(bulk.id);
  assert.equal(phaseOn(store.state.phases.values(), '2026-10-19'), null);
});
