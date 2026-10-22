// Bulk / cut / maintenance phases and the honest numbers for one: weekly average weight, the rate
// against the target, waist against weight, strength in the same week of the cycle, sleep. Every
// figure says what it is based on; with too little data the answer is «данных недостаточно», not
// a guess. Numbers describe what happened; they do not claim why (correlation is not causation).

import { setScore } from './plateau.js';
import { sum } from './util.js';

export const MODES = {
  bulk: { label: 'Набор', target: 0.25 },
  cut: { label: 'Сушка', target: -0.5 },
  maintain: { label: 'Поддержание', target: 0 },
};

// Least data for a rate: weigh-ins on 6 days spread over 14+ days.
export const RATE_MIN_DAYS = 6;
export const RATE_MIN_SPAN = 14;
// A week's average counts with weigh-ins on 3+ of its days.
export const WEEK_MIN_DAYS = 3;
// Strength: a change below 1 % is noise (as on the progress screen).
const STRENGTH_EPS = 0.01;

const dayNum = (iso) => Date.parse(iso + 'T00:00:00Z') / 86400000;
const fromDayNum = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
export const addDays = (iso, n) => fromDayNum(dayNum(iso) + n);

// The phase running on `date` (the latest started one if several overlap).
export function phaseOn(phases, date) {
  const live = [...phases].filter((p) => !p.deleted && p.start <= date && (!p.end || p.end >= date));
  return live.sort((a, b) => b.start.localeCompare(a.start))[0] || null;
}

export function sortedPhases(phases) {
  return [...phases].filter((p) => !p.deleted).sort((a, b) => b.start.localeCompare(a.start));
}

// Least-squares slope of the daily weights → kg per week and % of the mean weight per week.
export function rateOf(days) {
  if (days.length < RATE_MIN_DAYS) return null;
  const pts = days.map((d) => ({ t: dayNum(d.date), w: d.bodyweight }));
  if (pts[pts.length - 1].t - pts[0].t < RATE_MIN_SPAN) return null;
  const mt = sum(pts.map((p) => p.t)) / pts.length;
  const mw = sum(pts.map((p) => p.w)) / pts.length;
  const den = sum(pts.map((p) => (p.t - mt) ** 2));
  const perWeek = den ? (sum(pts.map((p) => (p.t - mt) * (p.w - mw))) / den) * 7 : 0;
  return { perWeek, pct: (perWeek / mw) * 100, days: pts.length, from: days[0].date, to: days[days.length - 1].date };
}

// Weeks from Monday: average of the days with a weigh-in; a week with fewer than WEEK_MIN_DAYS
// days has no average (shown, but not used).
export function weeklyWeights(days, { from, to }) {
  const mon = (iso) => {
    const n = dayNum(iso);
    return fromDayNum(n - ((new Date(n * 86400000).getUTCDay() + 6) % 7));
  };
  const weeks = new Map();
  for (let w = mon(from); w <= to; w = addDays(w, 7)) weeks.set(w, []);
  for (const d of days) if (d.date >= from && d.date <= to) weeks.get(mon(d.date))?.push(d.bodyweight);
  let prev = null;
  return [...weeks].map(([start, ws]) => {
    const avg = ws.length >= WEEK_MIN_DAYS ? sum(ws) / ws.length : null;
    const change = avg != null && prev != null ? avg - prev : null;
    if (avg != null) prev = avg;
    return { start, days: ws.length, avg, change };
  });
}

// The corridor around the target: ±40 % of the target, at least ±0.1 % a week.
export const targetBand = (target) => Math.max(0.1, Math.abs(target) * 0.4);

// Where the rate stands against the target.
export function rateStatus(pct, target) {
  const band = targetBand(target);
  if (Math.abs(pct - target) <= band) return 'on';
  if (target === 0) return pct > 0 ? 'up' : 'down';
  if (Math.sign(pct) !== Math.sign(target) && Math.abs(pct) > 0.1) return 'reverse';
  return Math.abs(pct) > Math.abs(target) ? 'fast' : 'slow';
}

export const STATUS_TEXT = {
  on: 'в пределах цели',
  fast: 'быстрее цели',
  slow: 'медленнее цели',
  reverse: 'вес идёт в обратную сторону',
  up: 'вес растёт',
  down: 'вес снижается',
};

// Waist against weight over the phase: the first and the last waist of the phase, 14+ days apart,
// and the change of the 7-day average weight between the same dates.
export function waistVsWeight(body, days, { from, to }) {
  const waist = [...body]
    .filter((r) => r.kind === 'waist' && !r.deleted && r.excluded !== true && r.date >= from && r.date <= to)
    .sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : 1));
  if (waist.length < 2) return { enough: false, count: waist.length };
  const a = waist[0];
  const b = waist[waist.length - 1];
  if (dayNum(b.date) - dayNum(a.date) < 14) return { enough: false, count: waist.length };
  const avg7 = (date) => {
    const w = days.filter((d) => d.date <= date && dayNum(d.date) > dayNum(date) - 7);
    return w.length >= 2 ? sum(w.map((d) => d.bodyweight)) / w.length : null;
  };
  const wa = avg7(a.date);
  const wb = avg7(b.date);
  const waistChange = b.value - a.value;
  const weightChange = wa != null && wb != null ? wb - wa : null;
  return {
    enough: true,
    count: waist.length,
    from: a.date,
    to: b.date,
    waistChange,
    weightChange,
    cmPerKg: weightChange != null && Math.abs(weightChange) >= 0.5 ? waistChange / weightChange : null,
  };
}

// Strength over the phase, the way the progress screen compares: the same week of the cycle at the
// start and at the end of the phase, best set (Epley on reps; pull-ups with body weight on top).
export function strengthOver(series, { from, to, bodyweight = null }) {
  const out = { up: 0, flat: 0, down: 0, items: [] };
  for (const [key, list] of series) {
    const inPhase = list.filter((e) => !e.active && e.date >= from && e.date <= to && e.sets.length);
    const byWeek = new Map();
    for (const e of inPhase) {
      if (!byWeek.has(e.week)) byWeek.set(e.week, []);
      byWeek.get(e.week).push(e);
    }
    // The week of the cycle with the longest stretch between its first and last workout.
    let best = null;
    for (const es of byWeek.values()) {
      if (es.length < 2) continue;
      const span = dayNum(es[es.length - 1].date) - dayNum(es[0].date);
      if (!best || span > best.span) best = { first: es[0], last: es[es.length - 1], span };
    }
    if (!best || best.span < 14) continue;
    const bw = best.first.category === 'pullup' ? bodyweight || 75 : 0;
    const top = (e) => Math.max(...e.sets.map((s) => setScore(s, { bwAdj: bw })));
    const change = top(best.last) / top(best.first) - 1;
    const verdict = change > STRENGTH_EPS ? 'up' : change < -STRENGTH_EPS ? 'down' : 'flat';
    out[verdict]++;
    out.items.push({ key, name: best.last.name, week: best.last.week, from: best.first.date, to: best.last.date, change, verdict });
  }
  out.items.sort((a, b) => b.change - a.change);
  out.compared = out.items.length;
  return out;
}

// Everything the phase card shows. `days`: dailyWeights(...).days; `nights`: sleepNights(...).nights.
export function phaseReport(phase, { days, body = [], nights = [], series = new Map(), today }) {
  const from = phase.start;
  const to = phase.end && phase.end < today ? phase.end : today;
  const inPhase = days.filter((d) => d.date >= from && d.date <= to);
  const rate = rateOf(inPhase);
  // The last 3 weeks, when the phase is long enough for it to differ from the whole.
  const recentFrom = addDays(to, -20);
  const recent = recentFrom > from ? rateOf(inPhase.filter((d) => d.date >= recentFrom)) : null;
  const target = Number(phase.targetPct) || 0;
  const sleep = nights.filter((n) => n.date >= from && n.date <= to);
  const lastWeight = inPhase.length ? inPhase[inPhase.length - 1].bodyweight : null;
  return {
    from,
    to,
    weeks: (dayNum(to) - dayNum(from) + 1) / 7,
    weighDays: inPhase.length,
    rate,
    recent,
    target,
    status: rate ? rateStatus(rate.pct, target) : null,
    targetKg: lastWeight != null ? (lastWeight * target) / 100 : null,
    weekly: weeklyWeights(inPhase, { from, to }),
    waist: waistVsWeight(body, days, { from, to }),
    strength: strengthOver(series, { from, to, bodyweight: lastWeight }),
    sleep: { nights: sleep.length, avg: sleep.length ? sum(sleep.map((n) => n.hours)) / sleep.length : null },
  };
}
