import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextWorkout, suggestNext, itemsForDay, findSameSlotSession } from '../../app/js/lib/planner.js';
import { starterProgram } from '../../app/js/lib/program.js';

const done = (cycle, week, day, date = '2026-10-16') => ({ id: `${cycle}${week}${day}`, cycle, week, day, date, status: 'done' });

test('first workout is cycle 1, week 1, day 1', () => {
  assert.deepEqual(nextWorkout([]), { cycle: 1, week: 1, day: 1 });
});

test('advances day → week → cycle', () => {
  assert.deepEqual(nextWorkout([done(1, 1, 1)]), { cycle: 1, week: 1, day: 2 });
  assert.deepEqual(nextWorkout([done(1, 1, 4)]), { cycle: 1, week: 2, day: 1 });
  assert.deepEqual(nextWorkout([done(1, 3, 4)]), { cycle: 2, week: 1, day: 1 });
});

test('back-dated entry of a missed day does not reset the sequence', () => {
  const s = [done(1, 2, 3, '2026-11-01'), done(1, 2, 2, '2026-11-02')];
  assert.deepEqual(nextWorkout(s), { cycle: 1, week: 2, day: 4 });
});

test('active and deleted sessions do not move the sequence', () => {
  const s = [done(1, 1, 1), { ...done(1, 1, 2), status: 'active' }, { ...done(1, 1, 3), deleted: true }];
  assert.deepEqual(nextWorkout(s), { cycle: 1, week: 1, day: 2 });
});

test('program days need not be numbered 1..N (a middle day was deleted)', () => {
  const days = [1, 3, 4];
  assert.deepEqual(nextWorkout([], days), { cycle: 1, week: 1, day: 1 });
  assert.deepEqual(nextWorkout([done(1, 1, 1)], days), { cycle: 1, week: 1, day: 3 });
  assert.deepEqual(nextWorkout([done(1, 1, 4)], days), { cycle: 1, week: 2, day: 1 });
});

test('duplicate slot detection', () => {
  const s = [done(1, 1, 1)];
  assert.ok(findSameSlotSession(s, { cycle: 1, week: 1, day: 1 }));
  assert.equal(findSameSlotSession(s, { cycle: 1, week: 1, day: 2 }), null);
});

test('composer: weight carries over from the previous set today', () => {
  const todaySets = [{ weight: 80, reps: 10 }];
  assert.deepEqual(suggestNext({ todaySets, prev: null, target: null }), { weight: 80, reps: 10, source: 'today' });
});

test('composer: first set suggests the previous result, labelled as such', () => {
  const prev = { sets: [{ weight: 77.5, reps: 9 }, { weight: 77.5, reps: 8 }] };
  assert.deepEqual(suggestNext({ todaySets: [], prev, target: null }), { weight: 77.5, reps: 9, source: 'prev' });
});

test('composer: nothing known → empty weight, target reps', () => {
  assert.deepEqual(suggestNext({ todaySets: [], prev: null, target: { reps: [8, 10] } }), { weight: null, reps: 10, source: 'none' });
});

test('composer: drop set suggests ~70% rounded to the step', () => {
  const s = suggestNext({ todaySets: [{ weight: 100, reps: 12 }], prev: null, target: null, step: 5, drop: true });
  assert.equal(s.weight, 70);
  assert.equal(s.source, 'drop');
});

test('session items snapshot the program day', () => {
  const p = starterProgram();
  const items = itemsForDay(p, 4);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Подтягивания нейтральным хватом');
  assert.equal(items[0].seriesKey, p.days[3].slots[0].options[0].key);
});
