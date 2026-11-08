// Body weight on a date and the load of exercises where the body is lifted (pull-ups and the like).
// Pure functions — no storage, no DOM.
//
// Three things are kept apart:
//  * the recorded weight of a set — what was added (a belt, a dumbbell); stored as is, «+28 кг»;
//  * the body weight on the date of the workout — from the weigh-ins (App_Body; a check-in weight
//    in App_Metrics only fills a day without one), the nearest reliable day before or after;
//  * the estimated total load = added weight + share × body weight, used only for comparisons and
//    estimates, never stored.
// Nothing is assumed: with no weigh-in within MAX_DAYS the body weight is unknown.

import { dailyWeights } from './bodydata.js';

export const MAX_DAYS = 14; // farther from any weigh-in than this: unknown
export const FRESH_DAYS = 3; // within this the weight of the day is taken as measured for that day

const dayNum = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000;

// Counted weigh-in days, sorted: [{ date, value, from }] — `days` as dailyWeights(...).days gives
// them (flagged rows and «не учитывать» are already out; one value per day).
export function bodyweightIndex(days) {
  return [...days]
    .filter((d) => d.bodyweight > 0)
    .map((d) => ({ date: d.date, value: d.bodyweight, from: d.from, t: dayNum(d.date) }))
    .sort((a, b) => a.t - b.t);
}

// Body weight for `date`: { value, date (of the weigh-in), distance (days), side ('same' | 'before'
// | 'after'), measured (that very day), fresh } or null. The nearest weigh-in wins; on a tie the
// earlier one. A weigh-in after the date is only a closer approximation, and says so in `side`.
export function bodyweightAt(index, date, { maxDays = MAX_DAYS } = {}) {
  if (!index?.length || !date) return null;
  const t = dayNum(date);
  // First weigh-in on or after the date.
  let lo = 0;
  let hi = index.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (index[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const after = index[lo] || null;
  const before = lo > 0 ? index[lo - 1] : null;
  let pick = null;
  if (after && after.t === t) pick = after;
  else if (before && after) pick = t - before.t <= after.t - t ? before : after;
  else pick = before || after;
  if (!pick) return null;
  const distance = Math.abs(pick.t - t);
  if (distance > maxDays) return null;
  return {
    value: pick.value,
    date: pick.date,
    distance,
    side: distance === 0 ? 'same' : pick.t < t ? 'before' : 'after',
    measured: distance === 0,
    fresh: distance <= FRESH_DAYS,
    from: pick.from,
  };
}

// date → bodyweightAt(...) for the store's records; App_Body and App_Metrics as they are.
export function bodyweightLookup({ body = [], metrics = [] } = {}, opts = {}) {
  const index = bodyweightIndex(dailyWeights(body, metrics).days);
  const memo = new Map();
  return (date) => {
    if (!memo.has(date)) memo.set(date, bodyweightAt(index, date, opts));
    return memo.get(date);
  };
}

// The part of the body weight that is lifted: 1 for pull-ups (the whole body), for any other
// exercise only what the owner set for the variant (e.g. dips ≈ 1; push-ups are not 1) — else 0,
// the recorded weight is the whole load.
export function loadShare(category, setup = null) {
  const s = Number(setup?.bwShare);
  if (setup && setup.bwShare != null && s >= 0 && s <= 1.5) return s;
  return category === 'pullup' ? 1 : 0;
}

// Estimated total load of a set, or null when it depends on an unknown body weight.
export function totalLoad(weight, { share = 0, bodyweight = null } = {}) {
  if (!share) return weight || 0;
  if (!(bodyweight > 0)) return null;
  return (weight || 0) + share * bodyweight;
}

// "80,4 кг (взвешивание 12 октября)" style facts for explanations.
export function describeBodyweight(bw, { fmtDay, fmtNum }) {
  if (!bw) return 'масса тела на эту дату неизвестна';
  const kg = `${fmtNum(bw.value, 1)} кг`;
  if (bw.measured) return `масса тела ${kg} (взвешивание в этот день)`;
  return `масса тела ≈ ${kg} (ближайшее взвешивание — ${fmtDay(bw.date)}${bw.side === 'after' ? ', после тренировки' : ''})`;
}
