// The 22.10.2026 workout (cycle 1, week 2, day 4) as the sheet stored it before v1.3: the upright
// row in Smith recorded under the barbell series «Тяга штанги к подбородку», while the 18.10 sets
// of the same exercise are in «Тяга штанги к подбородку в Смите». Ids, slot and series keys as
// recorded; weights, reps, RIR and times are synthetic.
import { programFromSnapshot } from './legacy-import.js';
import { session1018, sets1018 } from './workout-2026-10-18.js';
import { FIX_2026_10_18, programAfterFix } from '../../app/js/data/fixes.js';
import { itemsForDay } from '../../app/js/lib/planner.js';

export const SID_1022 = 'ssmvjx9qrh499fc25a49abfac2';
export const SMITH = { key: 'tyaga-shtangi-k-podborodku-v-smite', name: 'Тяга штанги к подбородку в Смите' };
export const BARBELL = { key: 'tyaga-shtangi-k-podborodku', name: 'Тяга штанги к подбородку' };
export const SET_IDS_1022 = ['stmvk0gkgi5f5c80cdaec08f9c', 'stmvk0lkvia46d777e1737a414', 'stmvk0s5mq0433835a579add8b'];
const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);

// The program after the v1.0.1 correction: day 2 has the Smith variant, day 4 still the barbell.
export function programBefore1022() {
  const p = programAfterFix(programFromSnapshot().program, FIX_2026_10_18);
  return { ...p, updatedAt: Date.UTC(2026, 9, 18, 20, 0, 0) };
}

// The 18.10 workout as it is in the sheet now: its sets already in the series of what was done.
export function workout1018Fixed() {
  const moved = new Map(FIX_2026_10_18.moves.flatMap((m) => m.setIds.map((id) => [id, m.to])));
  const s = session1018();
  const items = s.items.map((it) => {
    const m = FIX_2026_10_18.moves.find((x) => x.slotId === it.slotId);
    return m ? { ...it, seriesKey: m.to.key, name: m.to.name, options: [...it.options, { key: m.to.key, name: m.to.name }] } : it;
  });
  const sets = sets1018().map((x) => (moved.has(x.id) ? { ...x, seriesKey: moved.get(x.id).key, exercise: moved.get(x.id).name, updatedAt: x.updatedAt + 1000 } : x));
  return { session: { ...s, items, updatedAt: s.updatedAt + 1000 }, sets };
}

// A day 4 workout started from `program`: the pull-ups and the upright row, with given sets.
export function day4Workout(program, { id, date, cycle = 1, week = 2, row = [], rowIds = null, startedAt = null }) {
  const items = itemsForDay(program, 4);
  const start = startedAt ?? Date.parse(`${date}T12:00:00Z`);
  const item = items.find((i) => i.slotId === 'D4-05');
  const pull = items.find((i) => i.slotId === 'D4-01');
  const base = { sessionId: id, date, cycle, week, day: 4, drop: false, pain: false, technique: false, note: '', deleted: false };
  const sets = [
    ...[0, 1, 2].map((i) => ({ ...base, id: `${id}-p${i}`, slotId: 'D4-01', seriesKey: pull.seriesKey, exercise: pull.name, setNo: i + 1, weight: 20, reps: 6, rir: 1, createdAt: start + i * 180000, updatedAt: start + i * 180000 })),
    ...row.map(([weight, reps, rir], i) => ({ ...base, id: rowIds ? rowIds[i] : `${id}-r${i}`, slotId: 'D4-05', seriesKey: item.seriesKey, exercise: item.name, setNo: i + 1, weight, reps, rir, createdAt: start + 3600000 + i * 150000, updatedAt: start + 3600000 + i * 150000 })),
  ];
  const finished = sets.length ? Math.max(...sets.map((x) => x.createdAt)) : start;
  const session = { id, date, cycle, week, day: 4, status: 'done', note: '', startedAt: start, finishedAt: finished, items, updatedAt: finished + 1000, deleted: false };
  return { session, sets };
}

export function workout1022(program = programBefore1022()) {
  return day4Workout(program, { id: SID_1022, date: '2026-10-22', row: [[40, 10, 3], [45, 10, 2], [45, 9, 1]], rowIds: SET_IDS_1022, startedAt: T0 });
}
