// A deliberate weight drop on the day 3 machine row, for v1.5 «новая точка отсчёта» tests and
// screenshots. Synthetic weights: 80 → 90 kg in cycle 1 (weeks 2 and 3), then the light week of
// cycle 2 at 60 kg with the mark (`mark`), 70 kg on week 2, 75 kg on week 3. `upTo` — the last
// workout included (c1w2, c1w3, c2w1, c2w2, c2w3).
import { programNow } from './workout-2026-10-20.js';
import { itemsForDay } from '../../app/js/lib/planner.js';

export const ROW = 'D3-04';

export function workout(program, { id, date, cycle, week, sets, baseline = false }) {
  const items = itemsForDay(program, 3).map((it) => (it.slotId === ROW ? { ...it, flags: { pain: false, technique: false, baseline } } : it));
  const item = items.find((i) => i.slotId === ROW);
  const start = Date.parse(`${date}T12:00:00Z`);
  const rows = sets.map(([weight, reps, rir], i) => ({
    id: `${id}-${i}`, sessionId: id, date, cycle, week, day: 3, slotId: ROW, seriesKey: item.seriesKey, exercise: item.name,
    setNo: i + 1, weight, reps, rir, drop: false, pain: false, technique: false, note: '', deleted: false,
    createdAt: start + i * 180000, updatedAt: start + i * 180000,
  }));
  const end = start + sets.length * 180000;
  return { session: { id, date, cycle, week, day: 3, status: 'done', note: '', startedAt: start, finishedAt: end, items, updatedAt: end, deleted: false }, sets: rows };
}

const four = (w, reps, rir) => [0, 1, 2, 3].map((i) => [w, reps, rir[i]]);
export function history({ mark = true, upTo = 'c2w2' } = {}) {
  const p = programNow();
  const all = [
    workout(p, { id: 'c1w2', date: '2026-10-20', cycle: 1, week: 2, sets: four(80, 8, [2, 2, 1, 1]) }),
    workout(p, { id: 'c1w3', date: '2026-10-29', cycle: 1, week: 3, sets: four(90, 6, [1, 1, 1, 0]) }),
    workout(p, { id: 'c2w1', date: '2026-11-03', cycle: 2, week: 1, sets: [[60, 12, 3], [60, 12, 3], [60, 12, 3]], baseline: mark }),
    workout(p, { id: 'c2w2', date: '2026-11-10', cycle: 2, week: 2, sets: four(70, 8, [2, 2, 1, 1]) }),
    workout(p, { id: 'c2w3', date: '2026-11-17', cycle: 2, week: 3, sets: four(75, 6, [1, 1, 1, 0]) }),
  ];
  const ws = all.slice(0, all.findIndex((w) => w.session.id === upTo) + 1);
  return { program: p, sessions: ws.map((w) => w.session), sets: ws.flatMap((w) => w.sets) };
}

