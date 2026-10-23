// Personal records: what was actually lifted, per exercise variant (strength series) and per
// number of reps. Pure functions over plain records — no storage, no DOM.
//
// Sources
//  * Workout sets. Every set the app records is a working set by construction (warm-ups are not
//    logged); a set does not count when it is a drop set, or marked with pain or worse
//    technique — on the set itself or on the exercise for that workout. No other flag is
//    trusted or invented.
//  * Manual records entered by the owner: any past date, no workout needed. A manual entry that
//    repeats a logged set (same variant, date, weight and reps) counts once.
//
// Rules
//  * Variants never mix: the key is the strength series (Hammer ≠ dumbbells, incline ≠ flat,
//    each pull-up grip separate).
//  * A record for N reps is the heaviest weight lifted for exactly N reps. A 1-rep record exists
//    only if a single was actually lifted; the estimated 1RM is a reference, never a record.
//  * Pull-ups compare the ADDED weight (0 = bodyweight only). Bodyweight is context; an estimate
//    uses the body weight of its own day (a manual record's own value, else the nearest weigh-in,
//    lib/bodyweight.js) and is left out when that is unknown — never assumed.
//  * New records never replace old ones: the history keeps every achievement with its date.

import { daysBetween, roundToStep } from './util.js';

const EPS = 1e-6;
export const MAX_REPS = 30;
export const RECENT_DAYS = 42; // "recent workouts" for the assessment
export const NEW_DAYS = 21; // a new record stays "new" this long

export const STATE = {
  new: { label: 'Новый рекорд', tone: 'good' },
  improvable: { label: 'Можно обновить', tone: 'accent' },
  steady: { label: 'Актуален', tone: 'neutral' },
  unknown: { label: 'Мало данных', tone: 'muted' },
};

const isPullup = (category) => category === 'pullup';

// ---------------------------------------------------------------- what counts

// Why a logged set is not a record candidate (null = it counts).
export function excludedReason(set, item) {
  if (set.drop) return 'дроп-сет';
  if (set.pain || item?.flags?.pain) return 'боль';
  if (set.technique || item?.flags?.technique) return 'техника хуже';
  return null;
}

function validLoad(weight, reps, category) {
  if (!Number.isFinite(weight) || weight < 0) return false;
  if (!Number.isInteger(reps) || reps < 1 || reps > MAX_REPS) return false;
  return isPullup(category) || weight > 0;
}

// Every record candidate of every series, plus what was left out and why.
export function performances({ sessions, sets, manual = [], categories = new Map() }) {
  const live = new Map();
  for (const s of sessions) if (!s.deleted) live.set(s.id, s);
  const list = [];
  const excluded = [];
  for (const st of sets) {
    if (st.deleted) continue;
    const s = live.get(st.sessionId);
    if (!s) continue;
    const item = (s.items || []).find((i) => i.slotId === st.slotId);
    const category = item?.category || categories.get(st.seriesKey) || null;
    const why = excludedReason(st, item);
    if (why) {
      excluded.push({ set: st, reason: why });
      continue;
    }
    if (!validLoad(st.weight, st.reps, category)) continue;
    list.push({
      key: st.seriesKey,
      name: st.exercise,
      category,
      date: st.date || s.date,
      week: s.week,
      weight: st.weight,
      reps: st.reps,
      rir: st.rir ?? null,
      source: 'workout',
      setId: st.id,
      sessionId: s.id,
      at: st.createdAt || 0,
    });
  }
  const duplicates = new Map(); // manual record id -> the workout set it repeats
  for (const r of manual) {
    if (r.deleted) continue;
    const category = r.category || categories.get(r.seriesKey) || null;
    if (!r.seriesKey || !r.date || !validLoad(r.weight, r.reps, category)) continue;
    const twin = list.find((p) => p.source === 'workout' && p.key === r.seriesKey && p.date === r.date && p.reps === r.reps && Math.abs(p.weight - r.weight) < EPS);
    if (twin) {
      duplicates.set(r.id, twin);
      continue;
    }
    list.push({
      key: r.seriesKey,
      name: r.exercise,
      category,
      date: r.date,
      week: null,
      weight: r.weight,
      reps: r.reps,
      rir: r.rir ?? null,
      bodyweight: r.bodyweight ?? null,
      note: r.note || '',
      source: 'manual',
      recordId: r.id,
      at: r.createdAt || 0,
    });
  }
  return { list, excluded, duplicates };
}

// ---------------------------------------------------------------- the record book

const byTime = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.at - b.at);
const dominates = (q, p) => q.weight >= p.weight - EPS && q.reps >= p.reps;

// Achievements of each day, measured against everything lifted on earlier days.
function achievements(perfs) {
  const events = [];
  const prior = [];
  const bestByReps = new Map();
  const days = new Map();
  for (const p of perfs) {
    if (!days.has(p.date)) days.set(p.date, []);
    days.get(p.date).push(p);
  }
  for (const [date, todays] of days) {
    const found = [];
    for (const p of todays) {
      if (prior.some((q) => dominates(q, p))) continue; // matched or beaten before: not new
      const same = bestByReps.get(p.reps) || null;
      let beat = null;
      if (!same) {
        // Outdoing an earlier result (more weight and/or more reps) also is a record; name the
        // strongest such result, not merely the heaviest.
        const strength = (q) => q.weight * (1 + q.reps / 30) + q.reps * 1e-3;
        for (const q of prior) {
          if (q.weight <= p.weight + EPS && q.reps <= p.reps && (!beat || strength(q) > strength(beat))) beat = q;
        }
      }
      found.push({ date, reps: p.reps, perf: p, kind: same || beat ? 'record' : 'first', prev: same, beat: same ? null : beat });
    }
    // Within a day keep only the best: 90×9 makes 90×8 of the same day no achievement.
    // Identical sets: the first one (by time, then by order) stands.
    found.forEach((e, i) => {
      const better = found.some(
        (o, j) => o !== e && dominates(o.perf, e.perf) && (o.perf.weight > e.perf.weight + EPS || o.perf.reps > e.perf.reps || o.perf.at < e.perf.at || (o.perf.at === e.perf.at && j < i)),
      );
      if (!better) events.push(e);
    });
    for (const p of todays) {
      prior.push(p);
      const b = bestByReps.get(p.reps);
      if (!b || p.weight > b.weight + EPS) bestByReps.set(p.reps, p);
    }
  }
  return events;
}

// Current records by rep count. A row is "covered" when at least as much was lifted later or
// earlier for more reps — it stays in the history, but it is not the real limit any more.
function table(perfs) {
  const best = new Map();
  for (const p of perfs) {
    const b = best.get(p.reps);
    if (!b || p.weight > b.weight + EPS || (Math.abs(p.weight - b.weight) < EPS && byTime(p, b) < 0)) best.set(p.reps, p);
  }
  return [...best.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([reps, p]) => {
      let coveredBy = null;
      for (const q of perfs) {
        if (q.reps > reps && q.weight >= p.weight - EPS && (!coveredBy || q.weight > coveredBy.weight + EPS || (Math.abs(q.weight - coveredBy.weight) < EPS && q.reps > coveredBy.reps))) coveredBy = q;
      }
      return { reps, best: p, coveredBy };
    });
}

// Series key -> record book.
export function buildRecordBook(list) {
  const groups = new Map();
  for (const p of list) {
    if (!groups.has(p.key)) groups.set(p.key, []);
    groups.get(p.key).push(p);
  }
  const books = new Map();
  for (const [key, perfs] of groups) {
    perfs.sort(byTime);
    const last = perfs[perfs.length - 1];
    let heaviest = perfs[0];
    for (const p of perfs) if (p.weight > heaviest.weight + EPS || (Math.abs(p.weight - heaviest.weight) < EPS && p.reps > heaviest.reps)) heaviest = p;
    const workouts = perfs.filter((p) => p.source === 'workout');
    books.set(key, {
      key,
      name: last.name,
      category: perfs.find((p) => p.category)?.category || null,
      perfs,
      events: achievements(perfs),
      table: table(perfs),
      heaviest,
      lastWorkoutDate: workouts.length ? workouts[workouts.length - 1].date : null,
    });
  }
  return books;
}

// ---------------------------------------------------------------- estimates (reference only)

// `bodyweightAt(date)` → { value } | null (lib/bodyweight.js bodyweightLookup); the value or null.
const bwValue = (bodyweightAt, date) => (bodyweightAt ? bodyweightAt(date)?.value ?? null : null);

// Estimated 1RM (Epley, with reps in reserve when reported and small). A reference for
// comparing different rep counts — never a record. Null when the set says too little:
// far from failure (RIR > 3), too many reps, or a pull-up without a known body weight.
// `share` — the lifted part of the body weight (pull-ups 1; lib/bodyweight.js loadShare).
export function estimate1rm(p, { bodyweight = null, share = null } = {}) {
  if (p.rir != null && p.rir > 3) return null;
  const reps = p.reps + (p.rir ?? 0);
  if (reps > 12) return null;
  const bw = p.bodyweight ?? bodyweight;
  const k = share ?? (isPullup(p.category) ? 1 : 0);
  const load = k ? (bw > 0 ? k * bw + p.weight : null) : p.weight;
  if (!(load > 0)) return null;
  return reps === 1 ? load : load * (1 + reps / 30);
}

// ---------------------------------------------------------------- how current is the record

const fmt = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
// "12 апреля", with the year when it is not `thisYear` ("12 апреля 2025").
export const day = (iso, thisYear = null) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${thisYear && y !== thisYear ? ` ${y}` : ''}`;
};
export function fmtLoad(weight, category) {
  if (isPullup(category)) return weight > 0 ? `+${fmt(weight)} кг` : 'СВ';
  return `${fmt(weight)} кг`;
}
const setText = (p) => (isPullup(p.category) ? `${p.weight > 0 ? `+${fmt(p.weight)}` : 'СВ'}×${p.reps}` : `${fmt(p.weight)}×${p.reps}`);
const plural = (n, a, b, c) => (n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);
const repsText = (n) => `${n} ${plural(n, 'повторение', 'повторения', 'повторений')}`;

export function describeEvent(e, { thisYear = null } = {}) {
  const p = e.perf;
  if (e.kind === 'first') return `${setText(p)} — первый результат на ${repsText(p.reps)}`;
  if (e.prev) return `${setText(p)} — рекорд на ${repsText(p.reps)} (было ${fmtLoad(e.prev.weight, p.category)}, ${day(e.prev.date, thisYear)})`;
  const how = p.weight > e.beat.weight + EPS ? 'больше веса и повторений' : 'больше повторений с тем же весом';
  return `${setText(p)} — ${how}, чем ${setText(e.beat)} (${day(e.beat.date, thisYear)})`;
}

// Recent training days of this series (two workouts on one day are still one day), each with
// its best usable capacity estimate. `bwOf(date)` — the body weight a pull-up estimate of that day uses.
function dayLevels(book, { today, bwOf, share }) {
  const byDay = new Map();
  for (const p of book.perfs) {
    if (p.source !== 'workout' || daysBetween(p.date, today) > RECENT_DAYS || daysBetween(p.date, today) < 0) continue;
    if (!byDay.has(p.date)) byDay.set(p.date, { date: p.date, sets: [], level: null, from: null });
    const s = byDay.get(p.date);
    s.sets.push(p);
    // A light-week set without reported RIR is submaximal by design: it says nothing about the limit.
    if (p.week === 1 && p.rir == null) continue;
    const e = estimate1rm(p, { bodyweight: bwOf(p.date), share });
    if (e != null && (s.level == null || e > s.level)) {
      s.level = e;
      s.from = p;
    }
  }
  return [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// { state, reasons[] } — see STATE. Conservative: never a forecast from a single workout;
// "можно обновить" is a hint, not a verdict, and lower recent results are never called a regress.
export function assess(book, { today, bodyweightAt = null, step = 2.5, share = null }) {
  const thisYear = Number(today.slice(0, 4));
  const at = (iso) => day(iso, thisYear);
  if (!book || !book.perfs.length) return { state: 'unknown', reasons: ['Недостаточно данных для оценки: результатов пока нет.'] };

  const records = book.events.filter((e) => e.kind === 'record');
  const latest = records[records.length - 1];
  if (latest && daysBetween(latest.date, today) <= NEW_DAYS) {
    const sameDay = records.filter((e) => e.date === latest.date);
    return {
      state: 'new',
      event: latest,
      reasons: sameDay.map((e) => `${at(e.date)}: ${describeEvent(e, { thisYear })}${e.perf.source === 'manual' ? ' — добавлено вручную' : ''}.`),
    };
  }

  // Pull-ups: every estimate — records and recent sets — is made with the body weight of its own
  // day, and the weight to try is what that capacity leaves on top of today's body weight: a
  // heavier body alone never reads as more added weight to lift (nor a lighter one as less).
  const k = share ?? (isPullup(book.category) ? 1 : 0);
  const bwOf = (date) => (k ? bwValue(bodyweightAt, date) : null);
  const recent = book.perfs.filter((p) => p.source === 'workout' && daysBetween(p.date, today) <= RECENT_DAYS && daysBetween(p.date, today) >= 0);
  const bwNow = k && recent.length ? bwOf(recent[recent.length - 1].date) : null;
  const sessions = dayLevels(book, { today, bwOf, share: k });
  if (sessions.length < 2) {
    return {
      state: 'unknown',
      reasons: [
        `Недостаточно данных для оценки: ${sessions.length ? 'за последние 6 недель одна тренировка' : 'за последние 6 недель не было тренировок'} с этим упражнением, нужно хотя бы две.`,
      ],
    };
  }

  const reasons = [];
  // 1. Fact: a recent set beat a record row outright (more weight for more reps).
  for (const row of book.table) {
    const c = row.coveredBy;
    if (c && c.source === 'workout' && c.date > row.best.date && daysBetween(c.date, today) <= RECENT_DAYS) {
      const how = c.weight > row.best.weight + EPS ? 'больше веса на большее число повторений' : 'тот же вес на большее число повторений';
      reasons.push(`Рекорд на ${repsText(row.reps)} — ${fmtLoad(row.best.weight, book.category)} (${at(row.best.date)}), а ${at(c.date)} было ${setText(c)}: ${how}.`);
    }
  }
  // 2. Capacity: at least two recent workouts above the level of the current records.
  const usable = sessions.filter((s) => s.level != null);
  // A record is what was lifted — its reps in reserve are not part of it (they are exactly the
  // spare capacity recent workouts may show).
  const recordLevels = book.table
    .filter((r) => !r.coveredBy)
    .map((r) => ({ row: r, e: estimate1rm({ ...r.best, rir: null }, { bodyweight: bwOf(r.best.date), share: k }) }))
    .filter((x) => x.e != null);
  const top = recordLevels.sort((a, b) => b.e - a.e)[0] || null;
  let level = null;
  if (usable.length >= 2) {
    const lastThree = usable.slice(-3).map((s) => s.level).sort((a, b) => b - a);
    level = lastThree[1]; // the second best: one strong day is not enough
  }
  if (top && level != null && level >= top.e * 1.03) {
    // Only with a concrete weight above the current record — less than one step is no news.
    const r = usable[usable.length - 1].from.reps;
    const target = k && bwNow == null ? -Infinity : Math.floor((level / (1 + r / 30) - k * (bwNow || 0)) / step + EPS) * step;
    const row = book.table.find((x) => x.reps === r);
    if (target > (row ? row.best.weight : 0) + EPS) {
      reasons.push(
        `По последним тренировкам расчётный 1ПМ ≈ ${fmt(level)} кг — выше, чем дают текущие рекорды (≈ ${fmt(top.e)} кг). Это ориентир, а не рекорд.`,
        `Можно попробовать ${fmtLoad(roundToStep(target, step), book.category)} на ${repsText(r)} в тяжёлую неделю${row ? ` (рекорд — ${fmtLoad(row.best.weight, book.category)})` : ''}.`,
      );
    }
  }
  if (reasons.length) return { state: 'improvable', reasons, level, recordLevel: top?.e ?? null };

  const n = sessions.length;
  const steady = [];
  if (top && level != null) {
    steady.push(`Последние ${n} ${plural(n, 'тренировка', 'тренировки', 'тренировок')}: расчётный 1ПМ ≈ ${fmt(level)} кг, по рекордам ≈ ${fmt(top.e)} кг — рекорды соответствуют известным результатам.`);
    if (level < top.e * 0.9) steady.push('Сейчас результаты ниже рекордных — так бывает в лёгкие недели, после перерыва или при смене техники.');
  } else {
    steady.push(`Последние ${n} ${plural(n, 'тренировка', 'тренировки', 'тренировок')} не превышают рекордов по весу и повторениям.`);
  }
  if (top && daysBetween(top.row.best.date, today) > 180) {
    steady.push(`Самому сильному результату (${setText(top.row.best)}) больше полугода.`);
  }
  return { state: 'steady', reasons: steady, level, recordLevel: top?.e ?? null };
}

// ---------------------------------------------------------------- charts

// Record weight for exactly `reps` over time — a step line: it only ever goes up.
export function repProgress(book, reps) {
  return book.events.filter((e) => e.reps === reps).map((e) => ({ date: e.date, weight: e.perf.weight, source: e.perf.source, kind: e.kind }));
}

// Rep counts worth a chart, most history first.
export function chartReps(book) {
  const counts = new Map();
  for (const e of book.events) counts.set(e.reps, (counts.get(e.reps) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([r]) => r);
}

// Best estimated 1RM per day (explicitly a computed reference, across rep counts).
export function estimateProgress(book, { bodyweightAt = null, share = null } = {}) {
  const byDay = new Map();
  for (const p of book.perfs) {
    if (p.source === 'workout' && p.week === 1 && p.rir == null) continue;
    const e = estimate1rm(p, { bodyweight: bwValue(bodyweightAt, p.date), share });
    if (e == null) continue;
    const cur = byDay.get(p.date);
    if (!cur || e > cur.value) byDay.set(p.date, { date: p.date, value: e, from: p });
  }
  return [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Latest achievements across all series (newest first).
export function recentAchievements(books, { today, days = 60, limit = 8 } = {}) {
  const out = [];
  for (const b of books.values()) for (const e of b.events) if (e.kind === 'record' && daysBetween(e.date, today) <= days) out.push({ book: b, event: e });
  return out.sort((a, b) => (a.event.date < b.event.date ? 1 : a.event.date > b.event.date ? -1 : b.event.perf.at - a.event.perf.at)).slice(0, limit);
}
