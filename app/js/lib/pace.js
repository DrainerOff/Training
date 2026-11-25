// How much of today's workout is done and roughly how long the rest will take.
//
// Every set carries the moment it was logged (`createdAt`). The time between two sets in a row is
// one interval «set + rest». Intervals are learned from past workouts: per exercise variant
// (`seriesKey`) for sets of the same exercise in a row (`within`), and for the first set after a
// change of exercise (`switch`: moving, setting up the machine). Today's own intervals then tell
// whether the owner is faster or slower than usual, and the estimate follows that pace gradually.
//
// Robust to a set logged late (forgotten, then logged a few minutes later or two at once):
//  * intervals shorter than MIN_GAP or longer than MAX_GAP are not intervals of training at all
//    (back-filled sets, a break, a set added the next day) and are dropped;
//  * everything else is summarised by the median, so one long or one short interval among
//    several barely moves the estimate.
//
// Nothing here is stored: it is derived from sets and sessions already on the phone.

export const MIN_GAP = 15 * 1000;
export const MAX_GAP = 20 * 60 * 1000;
// A first set later than this after «Начать» is not a warm-up but a workout started ahead.
export const MAX_START = 30 * 60 * 1000;
// Without any history: a typical set with its rest and a typical change of exercise.
export const DEFAULT_WITHIN = 150 * 1000;
export const DEFAULT_SWITCH = 240 * 1000;
// Past workouts to learn from (the latest ones), samples per exercise kept.
const SESSIONS = 12;
const PER_KEY = 30;
// Samples needed before an exercise's own median replaces the common one.
const KEY_MIN = 3;
const ALL_MIN = 5;
// Today's pace counts as much as this many samples of history pull it back to the usual one.
const PACE_PRIOR = 4;
const PACE_MIN = 0.5;
const PACE_MAX = 2;

export function median(values) {
  const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const timed = (sets) =>
  sets.filter((s) => !s.deleted && Number.isFinite(s.createdAt) && s.createdAt > 0).sort((a, b) => a.createdAt - b.createdAt);

const usable = (dt) => dt >= MIN_GAP && dt <= MAX_GAP;

// Intervals of one workout: [{ kind: 'within' | 'switch' | 'start', key, ms }].
export function intervalsOf(session, sets) {
  const list = timed(sets);
  const out = [];
  if (list.length && Number.isFinite(session?.startedAt) && session.startedAt > 0) {
    const ms = list[0].createdAt - session.startedAt;
    if (ms >= MIN_GAP && ms <= MAX_START) out.push({ kind: 'start', key: list[0].seriesKey, ms });
  }
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    const ms = b.createdAt - a.createdAt;
    if (!usable(ms)) continue;
    out.push({ kind: a.slotId === b.slotId ? 'within' : 'switch', key: b.seriesKey, ms });
  }
  return out;
}

// A workout typed in from text (or entered afterwards in one go) has no real timing: its sets were
// logged within moments of each other. Such a workout teaches nothing about pace.
function hasTiming(sets) {
  const list = timed(sets);
  if (list.length < 3) return false;
  return list[list.length - 1].createdAt - list[0].createdAt >= MIN_GAP * (list.length - 1);
}

// The usual intervals, learned from finished workouts before `before` (ms; the current workout's start).
// `sessions` — all sessions; `setsOf(sessionId)` — that workout's sets.
export function paceModel(sessions, setsOf, { before = Infinity, exceptId = null } = {}) {
  const past = [...sessions]
    .filter((s) => !s.deleted && s.status === 'done' && s.id !== exceptId && (s.startedAt || 0) < before)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const within = new Map();
  const switches = new Map();
  const all = { within: [], switch: [], start: [] };
  let used = 0;
  for (const s of past) {
    if (used >= SESSIONS) break;
    const sets = setsOf(s.id);
    if (!hasTiming(sets)) continue;
    used++;
    for (const x of intervalsOf(s, sets)) {
      all[x.kind].push(x.ms);
      if (x.kind === 'start') continue;
      const map = x.kind === 'within' ? within : switches;
      const list = map.get(x.key) || [];
      if (list.length < PER_KEY) list.push(x.ms); // newest first: the latest samples are kept
      map.set(x.key, list);
    }
  }
  const common = {
    within: all.within.length >= ALL_MIN ? median(all.within) : null,
    switch: all.switch.length >= KEY_MIN ? median(all.switch) : null,
    start: all.start.length >= KEY_MIN ? median(all.start) : null,
  };
  return {
    sessions: used,
    within: (key) => {
      const own = within.get(key);
      return own && own.length >= KEY_MIN ? median(own) : common.within ?? DEFAULT_WITHIN;
    },
    switch: (key) => {
      const own = switches.get(key);
      return own && own.length >= KEY_MIN ? median(own) : common.switch ?? DEFAULT_SWITCH;
    },
    start: () => common.start ?? common.switch ?? DEFAULT_SWITCH,
    learned: used > 0 && (all.within.length + all.switch.length) >= ALL_MIN,
  };
}

// Today's pace relative to the usual one: 1 — as usual, 1.2 — 20% slower. The median of
// today's interval / usual interval, pulled toward 1 while today has few intervals.
export function todayPace(model, session, sets) {
  const ratios = intervalsOf(session, sets)
    .filter((x) => x.kind !== 'start')
    .map((x) => x.ms / (x.kind === 'within' ? model.within(x.key) : model.switch(x.key)));
  const n = ratios.length;
  if (!n) return { pace: 1, samples: 0 };
  const r = Math.min(PACE_MAX, Math.max(PACE_MIN, median(ratios)));
  return { pace: 1 + ((r - 1) * n) / (n + PACE_PRIOR), samples: n };
}

// `rows` — today's exercises in order: { slotId, key, target: { sets, drop }, working, drops, skipped }.
// `sets` — today's sets; `now` — current time (ms).
// Returns { done, total, percent, remainingMs, endsAt, learned, samples } or null when the workout
// has no planned sets at all. remainingMs is null when there is nothing to estimate from yet.
export function workoutProgress({ session, rows, sets, model, now }) {
  let total = 0;
  let done = 0;
  const left = rows.map((r) => {
    if (r.skipped) return 0;
    const planned = (r.target?.sets || 0) + (r.target?.drop || 0);
    const rest = Math.max(0, (r.target?.sets || 0) - (r.working || 0)) + Math.max(0, (r.target?.drop || 0) - (r.drops || 0));
    total += planned;
    done += planned - Math.min(planned, rest);
    return rest;
  });
  if (!total) return null;
  const percent = Math.round((done / total) * 100);
  const list = timed(sets);
  const last = list[list.length - 1] || null;
  const samples = intervalsOf(session, sets).filter((x) => x.kind !== 'start').length;
  const base = { done, total, percent, learned: model.learned, samples };
  if (left.every((n) => !n)) return { ...base, percent: 100, remainingMs: 0, endsAt: now };

  const startedSlots = new Set(list.map((s) => s.slotId));
  // The exercise the next set most likely belongs to: the one in progress, else the next unfinished
  // one after it in order (as the workout screen opens it), else the first unfinished.
  const lastIdx = last ? rows.findIndex((r) => r.slotId === last.slotId) : -1;
  let nextIdx = -1;
  if (lastIdx >= 0 && left[lastIdx]) nextIdx = lastIdx;
  else {
    const order = lastIdx >= 0 ? [...rows.keys()].slice(lastIdx + 1).concat([...rows.keys()].slice(0, lastIdx + 1)) : [...rows.keys()];
    nextIdx = order.find((i) => left[i] > 0);
  }

  let usual = 0;
  let nextCost = 0;
  rows.forEach((r, i) => {
    const n = left[i];
    if (!n) return;
    const within = model.within(r.key);
    let first;
    if (startedSlots.has(r.slotId)) first = within;
    else if (!last && i === nextIdx) first = model.start();
    else first = model.switch(r.key);
    usual += first + (n - 1) * within;
    if (i === nextIdx) nextCost = first;
  });

  // Not enough to go on: no history and fewer than two intervals today.
  if (!model.learned && samples < 2) return { ...base, remainingMs: null, endsAt: null };

  const { pace } = todayPace(model, session, sets);
  // The next interval has been running since the latest set (or since «Начать»): that part is spent.
  const since = Math.max(0, now - (last ? last.createdAt : session.startedAt || now));
  const spent = Math.min(since, nextCost * pace);
  const remainingMs = Math.max(0, usual * pace - spent);
  return { ...base, remainingMs, endsAt: now + remainingMs };
}

// «≈25 мин»: whole minutes up to 10, then steps of 5 — the estimate is not more exact than that.
export function roundMinutes(ms) {
  const m = ms / 60000;
  if (m < 1) return m > 0 ? 1 : 0;
  if (m < 10) return Math.round(m);
  return Math.round(m / 5) * 5;
}

export function fmtLeft(ms) {
  const m = roundMinutes(ms);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `≈${h} ч ${rest} мин` : `≈${h} ч`;
  }
  return `≈${m} мин`;
}

// Clock time of the end, rounded to 5 minutes like the estimate: «22:40».
export function fmtEndsAt(ms) {
  const step = 5 * 60000;
  const d = new Date(Math.round(ms / step) * step);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
