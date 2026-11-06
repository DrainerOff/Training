// What to train next, what to suggest in the set composer.

import { targetFor } from './program.js';
import { roundToStep } from './util.js';

export function positionValue(s) {
  return (s.cycle || 0) * 10000 + (s.week || 0) * 100 + (s.day || 0);
}

// Next workout is the successor of the furthest completed position (cycle, week, day),
// so a back-dated entry of a missed day does not reset the sequence.
// `days` is the list of program day numbers (they need not be 1..N after edits).
export function nextWorkout(sessions, days = [1, 2, 3, 4]) {
  const list = [...new Set(days)].sort((a, b) => a - b);
  if (!list.length) list.push(1);
  let last = null;
  for (const s of sessions) {
    if (s.deleted || s.status !== 'done') continue;
    if (!last || positionValue(s) > positionValue(last)) last = s;
  }
  if (!last) return { cycle: 1, week: 1, day: list[0] };
  const { cycle, week, day } = last;
  const nextDay = list.find((d) => d > day);
  if (nextDay != null) return { cycle, week, day: nextDay };
  if (week < 3) return { cycle, week: week + 1, day: list[0] };
  return { cycle: cycle + 1, week: 1, day: list[0] };
}

export function findSameSlotSession(sessions, { cycle, week, day }, exceptId = null) {
  return (
    [...sessions].find(
      (s) => !s.deleted && s.id !== exceptId && s.cycle === cycle && s.week === week && s.day === day,
    ) || null
  );
}

export function activeSession(sessions) {
  let best = null;
  for (const s of sessions) {
    if (s.deleted || s.status !== 'active') continue;
    if (!best || (s.startedAt || 0) > (best.startedAt || 0)) best = s;
  }
  return best;
}

// Snapshot of the program day for a session. Later program edits do not rewrite history.
export function itemsForDay(program, day) {
  const d = program?.days?.find((x) => x.day === day);
  if (!d) return [];
  return d.slots.map((s) => ({
    slotId: s.id,
    category: s.category,
    step: s.step,
    options: s.options.map((o) => ({ key: o.key, name: o.name })),
    overrides: s.overrides || {},
    seriesKey: s.options[0].key,
    name: s.options[0].name,
    note: '',
    flags: { pain: false, technique: false, baseline: false },
  }));
}

export function itemTarget(item, week) {
  return targetFor(item, week);
}

// Values pre-filled in the composer. They are only a suggestion: nothing is recorded
// until the owner taps "Записать".
//  1. same as the previous set today (weight carries over — no re-typing four times);
//  2. otherwise the first set of the previous result of this series;
//  3. otherwise empty weight, reps from the target.
export function suggestNext({ todaySets, prev, target, step = 2.5, drop = false }) {
  const working = todaySets.filter((s) => !s.deleted && !s.drop);
  const lastToday = working[working.length - 1];
  if (drop) {
    const base = lastToday || prev?.sets?.[prev.sets.length - 1];
    if (!base) return { weight: null, reps: null, source: 'none' };
    return { weight: roundToStep((base.weight || 0) * 0.7, step), reps: base.reps, source: 'drop' };
  }
  if (lastToday) return { weight: lastToday.weight, reps: lastToday.reps, source: 'today' };
  const ref = prev?.sets?.[0];
  if (ref) return { weight: ref.weight, reps: ref.reps, source: 'prev' };
  const reps = target?.reps ? target.reps[1] : null;
  return { weight: null, reps, source: 'none' };
}
