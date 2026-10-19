// Derived data shared across screens, memoised on the store version.

import { app } from './core.js';
import { buildExposures } from '../lib/plateau.js';
import { allOptions } from '../lib/program.js';
import { performances, buildRecordBook } from '../lib/records.js';

let cache = { v: -1 };

export function derived() {
  const st = app.store.state;
  if (cache.v === st.version) return cache;
  const metricsByDate = new Map();
  for (const m of st.metrics.values()) if (!m.deleted) metricsByDate.set(m.date, m);
  const sessions = app.store.liveSessions();
  const series = buildExposures(sessions, st.sets.values(), { metricsByDate });
  const categories = new Map();
  for (const o of allOptions(st.program)) categories.set(o.key, o.slot.category);
  cache = { v: st.version, series, metricsByDate, sessions, categories };
  return cache;
}

export function latestBodyweight() {
  let best = null;
  for (const m of app.store.state.metrics.values()) {
    if (m.deleted || !m.bodyweight) continue;
    if (!best || m.date > best.date) best = m;
  }
  return best?.bodyweight ?? null;
}

// Personal records: workout sets + manual entries → one book per exercise variant.
let recordsCache = { v: -1 };
export function recordsDerived() {
  const st = app.store.state;
  if (recordsCache.v === st.version) return recordsCache;
  const { sessions, categories } = derived();
  const perf = performances({ sessions, sets: st.sets.values(), manual: [...st.records.values()], categories });
  const metrics = [...st.metrics.values()].filter((m) => !m.deleted);
  const steps = new Map();
  for (const o of allOptions(st.program)) steps.set(o.key, o.slot.step || 2.5);
  recordsCache = { v: st.version, books: buildRecordBook(perf.list), excluded: perf.excluded, duplicates: perf.duplicates, metrics, steps };
  return recordsCache;
}
