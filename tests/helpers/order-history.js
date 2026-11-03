// Day 1 reordered between cycles, for v1.6.1 tests and screenshots: in cycle 1 Hammer (D1-02) was 2nd
// and the barbell press (D1-04) 4th; now the press is 2nd and Hammer 4th. Synthetic weights: Hammer
// 100×7, 100×7, 100×7 at RIR 1, 1, 0 on week 3 of cycle 1.
import { programNow } from './workout-2026-10-20.js';
import { itemsForDay } from '../../app/js/lib/planner.js';

export const HAMMER = 'D1-02';
export const PRESS = 'D1-04';

// The day 1 slots with the press and Hammer swapped (the same slot ids, so the same series).
export function reordered(program) {
  const days = program.days.map((d) => {
    if (d.day !== 1) return d;
    const slots = [...d.slots];
    const a = slots.findIndex((s) => s.id === HAMMER);
    const b = slots.findIndex((s) => s.id === PRESS);
    [slots[a], slots[b]] = [slots[b], slots[a]];
    return { ...d, slots };
  });
  return { ...program, days, updatedAt: Date.UTC(2026, 10, 1, 12, 0, 0) };
}

export function history() {
  const before = programNow();
  const items = itemsForDay(before, 1);
  const item = items.find((i) => i.slotId === HAMMER);
  const id = 'c1w3d1';
  const date = '2026-10-25';
  const start = Date.parse(`${date}T12:00:00Z`);
  const sets = [[100, 7, 1], [100, 7, 1], [100, 7, 0]].map(([weight, reps, rir], i) => ({
    id: `${id}-${i}`, sessionId: id, date, cycle: 1, week: 3, day: 1, slotId: HAMMER, seriesKey: item.seriesKey, exercise: item.name,
    setNo: i + 1, weight, reps, rir, drop: false, pain: false, technique: false, note: '', deleted: false,
    createdAt: start + i * 180000, updatedAt: start + i * 180000,
  }));
  const end = start + sets.length * 180000;
  const session = { id, date, cycle: 1, week: 3, day: 1, status: 'done', note: '', startedAt: start, finishedAt: end, items, updatedAt: end, deleted: false };
  return { program: reordered(before), sessions: [session], sets };
}
