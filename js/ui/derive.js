// Derived data shared across screens, memoised on the store version.

import { app } from './core.js';
import { buildExposures } from '../lib/plateau.js';
import { allOptions } from '../lib/program.js';
import { performances, buildRecordBook } from '../lib/records.js';
import { dailyWeights } from '../lib/bodydata.js';
import { bodyweightLookup, loadShare } from '../lib/bodyweight.js';

let cache = { v: -1 };

export function derived() {
  const st = app.store.state;
  if (cache.v === st.version) return cache;
  const metricsByDate = new Map();
  for (const m of st.metrics.values()) if (!m.deleted) metricsByDate.set(m.date, m);
  const sessions = app.store.liveSessions();
  // Body weight on each workout's day: recomputed with every change, so a weigh-in added for an
  // earlier date updates every comparison and estimate around it.
  const bodyweightAt = bodyweightLookup({ body: st.body.values(), metrics: st.metrics.values() });
  const series = buildExposures(sessions, st.sets.values(), { metricsByDate, bodyweightAt });
  const categories = new Map();
  for (const o of allOptions(st.program)) categories.set(o.key, o.slot.category);
  const setups = new Map();
  for (const x of st.exercises.values()) if (!x.deleted) setups.set(x.seriesKey, x);
  // The lifted part of the body weight per variant: pull-ups 1, others as set in the editor.
  const shareOf = (key, category = categories.get(key)) => loadShare(category, setups.get(key));
  cache = { v: st.version, series, metricsByDate, sessions, categories, bodyweightAt, shareOf };
  return cache;
}

// Latest day's weight: weigh-ins of that day (median) or, for a day without any, the check-in.
let weightCache = { v: -1 };
export function latestBodyweight() {
  const st = app.store.state;
  if (weightCache.v !== st.version) {
    const { days } = dailyWeights(st.body.values(), st.metrics.values());
    weightCache = { v: st.version, w: days.length ? days[days.length - 1].bodyweight : null };
  }
  return weightCache.w;
}

// Personal records: workout sets + manual entries → one book per exercise variant.
let recordsCache = { v: -1 };
export function recordsDerived() {
  const st = app.store.state;
  if (recordsCache.v === st.version) return recordsCache;
  const { sessions, categories, bodyweightAt, shareOf } = derived();
  const perf = performances({ sessions, sets: st.sets.values(), manual: [...st.records.values()], categories });
  const steps = new Map();
  for (const o of allOptions(st.program)) steps.set(o.key, o.slot.step || 2.5);
  recordsCache = { v: st.version, books: buildRecordBook(perf.list), excluded: perf.excluded, duplicates: perf.duplicates, bodyweightAt, shareOf, steps };
  return recordsCache;
}
