// The abs machine before v1.4: on 20.10.2026 (cycle 1, week 2, day 3) it was recorded as «Скручивания
// в тренажере», a series of its own, while days 1 and 3 otherwise use «Пресс в тренажере» — the same
// machine. Ids, slots and series keys as recorded; weights, reps, RIR and times are synthetic.
import { programFromSnapshot } from './legacy-import.js';
import { FIX_2026_10_18, FIX_2026_10_22, programAfterFix } from '../../app/js/data/fixes.js';
import { itemsForDay } from '../../app/js/lib/planner.js';

export const SID_1020 = 'ssmvgz3a8z32faa37f54050404';
export const PRESS = { key: 'press-v-trenazhere', name: 'Пресс в тренажере' };
export const CRUNCH = { key: 'skruchivaniya-v-trenazhere', name: 'Скручивания в тренажере' };
export const PRAYER = { key: 'skruchivanie-na-bloke-molitva', name: 'Скручивание на блоке («молитва»)' };
export const SET_IDS_1020 = ['stmvh3hfdxb01ee9bcad06bd12', 'stmvh3l4mnaa50e967260ed2fd', 'stmvh3palpabfa791fcf2db56e'];

// The program as it is in the sheet now: the 18.10 and 22.10 corrections applied, day 3 slot 7 is
// the prayer crunch, the abs machine is the day 1 slot 7.
export function programNow() {
  const p = programAfterFix(programAfterFix(programFromSnapshot().program, FIX_2026_10_18), FIX_2026_10_22);
  return { ...p, updatedAt: Date.UTC(2026, 9, 22, 20, 0, 0) };
}

// A workout of `day` started from `program`: pull-ups and the abs slot; `absAs` = the variant the
// abs sets were recorded under when it is not the program's (picked through «Заменить»).
export function absWorkout(program, { id, date, day, cycle = 1, week = 2, abs = [], absIds = null, absAs = null, startedAt = null }) {
  const slotId = day === 1 ? 'D1-07' : 'D3-07';
  const pullSlot = day === 1 ? 'D1-01' : 'D3-01';
  const items = itemsForDay(program, day).map((it) => {
    if (it.slotId !== slotId || !absAs) return it;
    const options = it.options.some((o) => o.key === absAs.key) ? it.options : [...it.options, { ...absAs }];
    return { ...it, seriesKey: absAs.key, name: absAs.name, options };
  });
  const item = items.find((i) => i.slotId === slotId);
  const pull = items.find((i) => i.slotId === pullSlot);
  const start = startedAt ?? Date.parse(`${date}T12:00:00Z`);
  const base = { sessionId: id, date, cycle, week, day, drop: false, pain: false, technique: false, note: '', deleted: false };
  const sets = [
    ...[0, 1, 2].map((i) => ({ ...base, id: `${id}-p${i}`, slotId: pullSlot, seriesKey: pull.seriesKey, exercise: pull.name, setNo: i + 1, weight: 20, reps: 6, rir: 1, createdAt: start + i * 180000, updatedAt: start + i * 180000 })),
    ...abs.map(([weight, reps, rir], i) => ({ ...base, id: absIds ? absIds[i] : `${id}-a${i}`, slotId, seriesKey: item.seriesKey, exercise: item.name, setNo: i + 1, weight, reps, rir, createdAt: start + 3600000 + i * 150000, updatedAt: start + 3600000 + i * 150000 })),
  ];
  const finished = Math.max(...sets.map((x) => x.createdAt));
  const session = { id, date, cycle, week, day, status: 'done', note: '', startedAt: start, finishedAt: finished, items, updatedAt: finished + 1000, deleted: false };
  return { session, sets };
}

// 16.10 and 25.10 (day 1) and 29.10 (day 3, picked as «Пресс в тренажере») on the press; 20.10 on «Скручивания».
export function pressHistory(program = programNow()) {
  return [
    absWorkout(program, { id: 'ss-1016', date: '2026-10-16', day: 1, abs: [[30, 10, 4], [30, 10, 4], [30, 10, 4]] }),
    absWorkout(program, { id: SID_1020, date: '2026-10-20', day: 3, abs: [[30, 10, 4], [32.5, 10, 3], [32.5, 10, 2]], absIds: SET_IDS_1020, absAs: CRUNCH }),
    absWorkout(program, { id: 'ss-1025', date: '2026-10-25', day: 1, week: 3, abs: [[32.5, 8, 2], [35, 8, 2], [35, 8, 2]] }),
    absWorkout(program, { id: 'ss-1029', date: '2026-10-29', day: 3, week: 3, abs: [[35, 8, 2], [37.5, 8, 2], [37.5, 7, 1]], absAs: PRESS }),
  ];
}
