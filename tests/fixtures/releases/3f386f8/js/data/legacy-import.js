// One-time migration of the owner's existing Google Sheet into the app (program + the
// 16.10.2026 workout). Source data: gsheets-snapshot.js (read-only copy of the cells).
//
// Guarantees:
//  * nothing is invented: every value comes from a cell; anything the converter does not
//    understand aborts the import instead of being guessed (see `problems`);
//  * no duplicates: records have fixed ids and a fixed timestamp, so importing twice, on two
//    phones, or after the data already came back from the sheet is a no-op;
//  * the owner's own data wins: an existing session for the same date/cycle/week/day, an
//    existing body-metric entry for the date, or a program the owner already set up are kept.

import { SNAPSHOT } from './gsheets-snapshot.js';
import { targetFor, makeOption, normalizeProgram } from '../lib/program.js';
import { itemsForDay } from '../lib/planner.js';
import { parseNum } from '../lib/util.js';

export const IMPORT_ID = 'gsheets-2026-10-17';
// Same on every device; any later real edit has a newer timestamp and wins.
export const IMPORTED_AT = Date.UTC(2026, 9, 17, 6, 0, 0);

const DIARY = {
  session: 0, cycle: 1, week: 2, day: 3, date: 4, slot: 5, exercise: 6, variant: 7, sets: 8,
  weights: [11, 13, 15, 17], reps: [12, 14, 16, 18], rirFact: 19, technique: 20, notes: 21, setCount: 22,
  dropWeight: 28, dropReps: 29,
};

export function serialToISO(serial) {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
}

// "8-10" → [8, 10]; "6" → [6, 6]; "10-12*" → [10, 12]; "не задано" → null
function parseRange(text) {
  const s = String(text ?? '').trim();
  const m = s.match(/^(\d+)\s*[-–]\s*(\d+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  const one = s.match(/^(\d+)/);
  return one ? [Number(one[1]), Number(one[1])] : null;
}

// The owner's own taxonomy: base lifts get 4 heavy sets; Hammer, pull-ups and isolation 3;
// calves carry the week-3 drop set. The sheet's set counts are cross-checked below.
function categoryOf(exercise, heavySets) {
  if (/^подтягивания/i.test(exercise)) return 'pullup';
  if (/икры/i.test(exercise)) return 'calves';
  if (/hammer/i.test(exercise)) return 'hammer';
  return Number(heavySets) === 4 ? 'base' : 'iso';
}

const sameRange = (a, b) => (a == null && b == null) || (a && b && a[0] === b[0] && a[1] === b[1]);

export function programFromSnapshot(snap = SNAPSHOT) {
  const problems = [];
  const titles = {};
  for (const line of snap.split) {
    const m = line.match(/^День\s+(\d+)\s*-\s*([^:]+):/);
    if (m) titles[Number(m[1])] = m[2].trim().replace(/^./, (c) => c.toUpperCase());
  }
  const days = new Map();
  for (const row of snap.program.rows) {
    const [dayLabel, slotId, exercise, variant, alt, light, heavy, reps1, reps23, control, note = ''] = row;
    const day = Number(String(dayLabel).replace(/\D+/g, ''));
    const category = categoryOf(exercise, heavy);
    const hasAlt = alt && alt !== '-';
    const base = exercise.split(':')[0].replace(/\s*\([^)]*\)\s*$/, '').trim();
    const names = hasAlt ? [`${base}: ${variant}`, `${base}: ${alt}`] : [exercise];
    const [r2, r3] = String(reps23).split('/').map((s) => parseRange(s));
    const sheet = {
      1: { sets: Number(light), reps: parseRange(reps1) },
      2: { sets: Number(heavy), reps: r2 },
      3: { sets: Number(heavy), reps: r3 },
    };
    const notes = [];
    if (!hasAlt) notes.push(`Вариант: ${variant}.`);
    if (note) notes.push(note);
    if (control === 'Доп. вес' && !/отягощение/.test(note)) notes.push('Вес — дополнительное отягощение.');
    if (/\*/.test(reps1)) notes.push(`В таблице повторы нед. 1 указаны как «${reps1}».`);
    const slot = {
      id: slotId,
      category,
      step: 2.5,
      options: names.map((n) => makeOption(n)),
      overrides: {},
      note: notes.join(' '),
    };
    // Category rules give the defaults; whatever the sheet states differently becomes an override.
    for (const w of [1, 2, 3]) {
      const def = targetFor({ category }, w);
      if (def.sets !== sheet[w].sets || !sameRange(def.reps, sheet[w].reps)) {
        slot.overrides[w] = { sets: sheet[w].sets, reps: sheet[w].reps };
      }
      const got = targetFor(slot, w);
      if (got.sets !== sheet[w].sets || !sameRange(got.reps, sheet[w].reps)) {
        problems.push(`${slotId}: неделя ${w} не совпадает с таблицей`);
      }
    }
    if (!days.has(day)) days.set(day, { day, title: titles[day] || '', slots: [] });
    days.get(day).slots.push(slot);
  }
  const program = normalizeProgram({ id: 'main', draft: false, updatedAt: IMPORTED_AT, days: [...days.values()] });
  return { program, problems };
}

export function workoutsFromSnapshot(program, snap = SNAPSHOT) {
  const problems = [];
  const sessions = [];
  const sets = [];
  const metrics = [];
  const sessionInfo = new Map(snap.sessions.rows.map((r) => [r.values[0], r]));
  const bySession = new Map();
  for (const row of snap.diary.rows) {
    const n = row[DIARY.session];
    if (!bySession.has(n)) bySession.set(n, []);
    bySession.get(n).push(row);
  }
  const programRows = new Map(snap.program.rows.map((r) => [r[1], r]));

  for (const [n, rows] of bySession) {
    const first = rows[0];
    const info = sessionInfo.get(n);
    const date = serialToISO(first[DIARY.date]);
    if (info && info.values[5] !== first[DIARY.date]) problems.push(`Сессия ${n}: дата в «Сессии» и «Дневник» различается`);
    const day = first[DIARY.day];
    const id = `gs-s${n}`;
    const items = itemsForDay(program, day);
    rows.forEach((row) => {
      const slotId = row[DIARY.slot];
      const item = items.find((i) => i.slotId === slotId);
      const prow = programRows.get(slotId);
      if (!item || !prow) {
        problems.push(`${slotId}: нет в программе`);
        return;
      }
      const variant = row[DIARY.variant];
      const optIndex = variant === prow[3] ? 0 : variant === prow[4] ? 1 : -1;
      if (optIndex < 0 || !item.options[optIndex]) {
        problems.push(`${slotId}: неизвестный вариант «${variant}»`);
        return;
      }
      const opt = item.options[optIndex];
      item.seriesKey = opt.key;
      item.name = opt.name;
      const notes = [];
      if (row[DIARY.rirFact] != null && row[DIARY.rirFact] !== '') notes.push(`RIR факт (одно значение на упражнение): ${row[DIARY.rirFact]}`);
      const tech = String(row[DIARY.technique] ?? '').trim();
      if (/хуже/i.test(tech)) item.flags.technique = true;
      if (/боль/i.test(tech)) item.flags.pain = true;
      if (row[DIARY.notes]) notes.push(String(row[DIARY.notes]));
      item.note = notes.join('. ');

      const pairs = [];
      DIARY.weights.forEach((wc, i) => {
        const w = row[wc];
        const r = row[DIARY.reps[i]];
        if (w == null && r == null) return;
        if (typeof w !== 'number' || typeof r !== 'number') problems.push(`${slotId}: подход ${i + 1} заполнен не полностью`);
        else pairs.push({ weight: w, reps: r, drop: false });
      });
      if (typeof row[DIARY.dropWeight] === 'number' && typeof row[DIARY.dropReps] === 'number') {
        pairs.push({ weight: row[DIARY.dropWeight], reps: row[DIARY.dropReps], drop: true });
      }
      const working = pairs.filter((p) => !p.drop).length;
      if (row[DIARY.setCount] != null && row[DIARY.setCount] !== working) {
        problems.push(`${slotId}: подходов ${working}, а в столбце «Сетов» ${row[DIARY.setCount]}`);
      }
      pairs.forEach((p, i) => {
        sets.push({
          id: `${id}-${slotId}-${i + 1}`,
          sessionId: id,
          slotId,
          seriesKey: opt.key,
          exercise: opt.name,
          date,
          cycle: first[DIARY.cycle],
          week: first[DIARY.week],
          day,
          setNo: i + 1,
          weight: p.weight,
          reps: p.reps,
          rir: null,
          drop: p.drop,
          pain: !!item.flags.pain,
          technique: !!item.flags.technique,
          note: '',
          createdAt: IMPORTED_AT + sets.length,
          updatedAt: IMPORTED_AT,
          deleted: false,
        });
      });
    });
    const sessionNote = info?.values[9] ? String(info.values[9]) : '';
    sessions.push({
      id,
      date,
      cycle: first[DIARY.cycle],
      week: first[DIARY.week],
      day,
      status: 'done',
      startedAt: null,
      finishedAt: null,
      note: ['Перенесено из Google Таблицы («Дневник», сессия ' + n + ')', sessionNote].filter(Boolean).join('. '),
      items,
      updatedAt: IMPORTED_AT,
      deleted: false,
    });

    if (info) {
      const [, , , , , , weight, sleepValue, wellbeing] = info.values;
      // A sleep cell typed "8.4" in a ru_RU sheet is stored as a date; the displayed text is what was typed.
      const sleep = typeof sleepValue === 'number' && sleepValue <= 24 ? sleepValue : parseNum(info.displayed[7]);
      const noteParts = [];
      if (wellbeing) noteParts.push(`Самочувствие: ${wellbeing}`);
      if (typeof weight === 'number' || sleep != null || noteParts.length) {
        metrics.push({
          id: `m${date}`,
          date,
          bodyweight: typeof weight === 'number' ? weight : null,
          sleep: sleep != null && sleep >= 0 && sleep <= 24 ? sleep : null,
          recovery: null, // «Отлично» is kept as text: there is no agreed mapping to the 1–5 scale
          note: noteParts.join('. '),
          updatedAt: IMPORTED_AT,
          deleted: false,
        });
      }
    }
  }
  return { sessions, sets, metrics, problems };
}

export function convertSnapshot(snap = SNAPSHOT) {
  const p = programFromSnapshot(snap);
  const w = workoutsFromSnapshot(p.program, snap);
  return { program: p.program, sessions: w.sessions, sets: w.sets, metrics: w.metrics, problems: [...p.problems, ...w.problems] };
}

export async function applyLegacyImport(store, { snapshot = SNAPSHOT, now = Date.now } = {}) {
  const st = store.state;
  const imports = st.kv.imports || {};
  if (imports[IMPORT_ID]) return null; // already handled on this device
  const data = convertSnapshot(snapshot);
  const report = { id: IMPORT_ID, at: now(), program: false, sessions: 0, sets: 0, metrics: 0, skipped: [], problems: data.problems, seen: false };
  if (data.problems.length) {
    // Nothing is written and the import is not marked done, so a corrected app version retries it.
    if (!st.kv.importNotice?.problems?.length) await store.setKV({ importNotice: report });
    return report;
  }
  const payload = { sessions: [], sets: [], metrics: [] };
  const starter = !st.program || st.program.draft || !st.program.updatedAt;
  if (starter) {
    payload.program = data.program;
    report.program = true;
  } else {
    report.skipped.push('Программа: в приложении уже настроена своя, она не заменена.');
  }
  const live = store.liveSessions();
  for (const s of data.sessions) {
    const twin = live.find((x) => x.date === s.date && x.cycle === s.cycle && x.week === s.week && x.day === s.day);
    if (st.sessions.has(s.id) || twin) {
      report.skipped.push(`Тренировка ${s.date}: уже есть в приложении, не продублирована.`);
      continue;
    }
    payload.sessions.push(s);
    payload.sets.push(...data.sets.filter((x) => x.sessionId === s.id && !st.sets.has(x.id)));
  }
  for (const m of data.metrics) {
    if (st.metrics.has(m.id)) report.skipped.push(`Вес и сон за ${m.date}: запись уже есть, не изменена.`);
    else payload.metrics.push(m);
  }
  await store.applyRemote(payload, { queue: true });
  report.sessions = payload.sessions.length;
  report.sets = payload.sets.length;
  report.metrics = payload.metrics.length;
  await store.setKV({ imports: { ...imports, [IMPORT_ID]: report }, importNotice: report });
  return report;
}
