// The owner's 18.10.2026 workout as read from the sheet before v1.0.1
// (tests/fixtures/real/2026-10-18-before-v1.0.1.json), turned into app records the way a pull
// from the sheet delivers them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const REAL = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/real/2026-10-18-before-v1.0.1.json'), 'utf8'));

const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
const bool = (v) => String(v).toUpperCase() === 'TRUE';

function table(rows) {
  const [head, ...data] = rows;
  return data.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

export function realSession() {
  const [r] = table(REAL.App_Sessions);
  return {
    id: r.id,
    date: r.date,
    cycle: num(r.cycle),
    week: num(r.week),
    day: num(r.day),
    status: r.status,
    note: r.note,
    startedAt: num(r.started_at),
    finishedAt: num(r.finished_at),
    items: JSON.parse(r.items_json),
    updatedAt: num(r.updated_at),
    deleted: bool(r.deleted),
  };
}

export function realSets() {
  return table(REAL.App_Sets).map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    slotId: r.slot_id,
    seriesKey: r.series_key,
    exercise: r.exercise,
    date: r.date,
    cycle: num(r.cycle),
    week: num(r.week),
    day: num(r.day),
    setNo: num(r.set_no),
    weight: num(r.weight_kg),
    reps: num(r.reps),
    rir: num(r.rir),
    drop: bool(r.drop_set),
    pain: bool(r.pain),
    technique: bool(r.technique_worse),
    note: r.note,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    deleted: bool(r.deleted),
  }));
}

// Day 2 of App_Program as the sheet has it: [{ slotId, keys, names }].
export function realProgramDay2() {
  return table(REAL.App_Program_day2).map((r) => ({
    slotId: r.slot_id,
    keys: r.keys.split(' / '),
    names: [r.exercise, ...(r.alternatives ? r.alternatives.split(' / ') : [])],
  }));
}
