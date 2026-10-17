// Training analytics. Pure functions over plain records — no storage, no DOM.
//
// Principles (from the brief):
//  * compare like with like: a strength series (one exercise variant) in the same phase
//    of the cycle — week 2 vs week 2, week 3 vs week 3; never week 3 vs week 2;
//  * use every working set, not just the best one: sets are paired by order and
//    compared one by one, the median of those ratios is the headline number;
//  * reps + reported RIR are used when both sides have RIR, so "same weight, same reps,
//    but easier" counts as progress;
//  * a single bad result is a "dip", never a plateau; plateau needs a run of
//    non-improving comparable sessions spanning at least two cycles;
//  * sessions marked with pain are not counted; a gain made with degraded technique
//    is not counted as progress; a "new baseline" mark (stricter technique, new machine
//    settings) starts a fresh comparison segment;
//  * the light week (RIR 4–5) is shown but never used to diagnose plateau/regress.

import { median, sum } from './util.js';

export const EPS = 0.01; // 1% — below this a change is noise
const HEAVY = new Set([2, 3]);

export const STATUS = {
  regress: { label: 'Регресс', rank: 0, tone: 'bad', glyph: '▼' },
  plateau: { label: 'Плато', rank: 1, tone: 'warn', glyph: '●' },
  maybePlateau: { label: 'Возможное плато', rank: 2, tone: 'warn', glyph: '◆' },
  dip: { label: 'Разовая просадка', rank: 3, tone: 'muted', glyph: '▽' },
  stable: { label: 'Держится', rank: 4, tone: 'muted', glyph: '■' },
  recovering: { label: 'Возвращается', rank: 5, tone: 'muted', glyph: '△' },
  progress: { label: 'Прогресс', rank: 6, tone: 'good', glyph: '▲' },
  insufficient: { label: 'Мало данных', rank: 7, tone: 'muted', glyph: '○' },
};

function bySetOrder(a, b) {
  return (a.setNo || 0) - (b.setNo || 0) || (a.createdAt || 0) - (b.createdAt || 0);
}

export function bySessionOrder(a, b) {
  return (
    String(a.date).localeCompare(String(b.date)) ||
    (a.startedAt || 0) - (b.startedAt || 0) ||
    String(a.id || a.sessionId).localeCompare(String(b.id || b.sessionId))
  );
}

// Groups sets into exposures: one exposure = one series in one session.
// Returns Map<seriesKey, exposure[]> sorted chronologically.
export function buildExposures(sessions, sets, { metricsByDate = null, includeActive = true } = {}) {
  const sById = new Map();
  for (const s of sessions) if (!s.deleted && (includeActive || s.status === 'done')) sById.set(s.id, s);
  const byKey = new Map();
  for (const st of sets) {
    if (st.deleted) continue;
    const s = sById.get(st.sessionId);
    if (!s) continue;
    const k = `${st.sessionId}|${st.seriesKey}`;
    let e = byKey.get(k);
    if (!e) {
      const item = (s.items || []).find((i) => i.slotId === st.slotId);
      const m = metricsByDate?.get(s.date);
      e = {
        key: st.seriesKey,
        name: st.exercise,
        category: item?.category || null,
        sessionId: s.id,
        date: s.date,
        cycle: s.cycle,
        week: s.week,
        day: s.day,
        startedAt: s.startedAt || 0,
        active: s.status !== 'done',
        sets: [],
        drops: [],
        flags: {
          pain: !!item?.flags?.pain,
          technique: !!item?.flags?.technique,
          baseline: !!item?.flags?.baseline,
        },
        note: item?.note || '',
        recovery: m?.recovery ?? null,
        sleep: m?.sleep ?? null,
      };
      byKey.set(k, e);
    }
    (st.drop ? e.drops : e.sets).push(st);
    if (st.pain) e.flags.pain = true;
    if (st.technique) e.flags.technique = true;
  }
  const series = new Map();
  for (const e of byKey.values()) {
    e.sets.sort(bySetOrder);
    e.drops.sort(bySetOrder);
    if (!series.has(e.key)) series.set(e.key, []);
    series.get(e.key).push(e);
  }
  for (const list of series.values()) list.sort(bySessionOrder);
  return series;
}

// Strength score of one set. Epley on (reps + RIR) when RIR is comparable.
// For pull-ups the added weight sits on top of a nominal bodyweight so that
// "+2.5 kg at the same reps" and "+1 rep at the same weight" both read as gains.
export function setScore(set, { useRir = false, bwAdj = 0 } = {}) {
  const eff = (set.reps || 0) + (useRir && set.rir != null ? set.rir : 0);
  const load = (set.weight || 0) + bwAdj;
  if (load <= 0) return eff;
  return load * (1 + eff / 30);
}

export function compareExposures(cur, prev, { category = null, bodyweight = null } = {}) {
  const n = Math.min(cur.sets.length, prev.sets.length);
  if (!n) return null;
  const cat = category || cur.category || prev.category;
  const bwAdj = cat === 'pullup' ? bodyweight || 75 : 0;
  const pairs = [];
  for (let i = 0; i < n; i++) {
    const a = cur.sets[i];
    const b = prev.sets[i];
    const useRir = a.rir != null && b.rir != null;
    const sa = setScore(a, { useRir, bwAdj });
    const sb = setScore(b, { useRir, bwAdj });
    pairs.push({ cur: a, prev: b, ratio: sb > 0 ? sa / sb - 1 : 0 });
  }
  const ratios = pairs.map((p) => p.ratio);
  const med = median(ratios);
  const worst = Math.min(...ratios);
  const ton = (list) => sum(list.slice(0, n).map((s) => ((s.weight || 0) + bwAdj) * (s.reps || 0)));
  const tonPrev = ton(prev.sets);
  const tonnage = tonPrev > 0 ? ton(cur.sets) / tonPrev - 1 : 0;
  const repsDelta = sum(cur.sets.slice(0, n).map((s) => s.reps || 0)) - sum(prev.sets.slice(0, n).map((s) => s.reps || 0));
  const sameWeights = pairs.every((p) => (p.cur.weight || 0) === (p.prev.weight || 0));
  let verdict = 'flat';
  // Up: most sets better, or no set meaningfully worse while total work on the same sets grew.
  if (med > EPS || (med >= 0 && tonnage > 0.02 && worst > -0.02)) verdict = 'up';
  // Down needs two signals: median set worse AND less work on the paired sets.
  else if (med < -EPS && tonnage < 0) verdict = 'down';
  return {
    verdict,
    median: med,
    tonnage,
    repsDelta,
    sameWeights,
    setsDelta: cur.sets.length - prev.sets.length,
    pairs,
    prev,
  };
}

// Builds comparisons for a series: each exposure vs the previous exposure of the same
// week-in-cycle inside the same baseline segment (skipping pain-marked references).
export function seriesComparisons(exposures, opts = {}) {
  const out = [];
  let segment = 0;
  const segOf = new Map();
  for (const e of exposures) {
    if (e.flags.baseline) segment++;
    segOf.set(e, segment);
  }
  exposures.forEach((e, idx) => {
    const entry = { exposure: e, segment: segOf.get(e), cmp: null, counted: false, effective: null, notes: [] };
    if (!e.sets.length) {
      entry.notes.push('нет рабочих подходов');
      out.push(entry);
      return;
    }
    if (e.flags.baseline) entry.notes.push('новая точка отсчёта');
    let ref = null;
    for (let j = idx - 1; j >= 0; j--) {
      const p = exposures[j];
      if (segOf.get(p) !== segOf.get(e)) break;
      if (p.week === e.week && p.sets.length && !p.flags.pain) {
        ref = p;
        break;
      }
    }
    if (ref && !e.flags.baseline) {
      entry.cmp = compareExposures(e, ref, opts);
      entry.effective = entry.cmp.verdict;
      entry.counted = HEAVY.has(e.week) && !e.active;
      if (e.flags.pain) {
        entry.counted = false;
        entry.notes.push('отмечена боль — не учитывается');
      }
      if (entry.effective === 'up' && e.flags.technique) {
        entry.effective = 'flat';
        entry.notes.push('техника хуже — прирост не засчитан');
      }
      if (e.week === 1) entry.notes.push('лёгкая неделя — не влияет на оценку');
      if (entry.cmp.setsDelta < 0) entry.notes.push(`подходов меньше на ${-entry.cmp.setsDelta}`);
    }
    out.push(entry);
  });
  return out;
}

function bestBefore(comparisons, entry, opts) {
  // Best result of the same week inside the same baseline segment before `entry`,
  // to tell "back to the previous level" from real progress.
  let best = null;
  for (const c of comparisons) {
    if (c === entry) break;
    const e = c.exposure;
    if (c.segment !== entry.segment || e.week !== entry.exposure.week || !e.sets.length || e.flags.pain) continue;
    if (!best || compareExposures(e, best, opts).median > 0) best = e;
  }
  return best;
}

export function seriesStatus(exposures, opts = {}) {
  const comps = seriesComparisons(exposures, opts);
  const counted = comps.filter((c) => c.counted);
  const last = counted[counted.length - 1];
  const result = { comparisons: comps, counted, status: 'insufficient', reasons: [] };
  if (!last) {
    const heavy = exposures.some((e) => HEAVY.has(e.week));
    result.reasons.push(
      heavy
        ? 'Сравнение появится, когда вы повторите эту неделю цикла в следующем цикле.'
        : 'Пока есть только лёгкие недели — по ним плато не оценивается.',
    );
    return result;
  }
  const v = counted.map((c) => c.effective).reverse(); // most recent first
  let k = 0;
  while (k < v.length && v[k] !== 'up') k++;
  const runCycles = new Set(counted.slice(counted.length - k).map((c) => c.exposure.cycle));

  if (v[0] === 'up') {
    const best = bestBefore(comps, last, opts);
    if (best && best !== last.cmp.prev && compareExposures(last.exposure, best, opts).median < -EPS) {
      result.status = 'recovering';
      result.reasons.push('Лучше прошлого раза, но ещё ниже лучшего результата на этой неделе цикла.');
    } else {
      result.status = 'progress';
    }
  } else if (v[0] === 'down' && v[1] === 'down') {
    result.status = 'regress';
    result.reasons.push('Два сопоставимых результата подряд хуже предыдущих.');
  } else if (k >= 4 || (k >= 3 && runCycles.size >= 2)) {
    result.status = 'plateau';
    result.reasons.push(`Нет прироста в ${k} сопоставимых тренировках подряд (циклов: ${runCycles.size}).`);
  } else if (v[0] === 'down') {
    result.status = 'dip';
    result.reasons.push('Один результат хуже — это ещё не плато. Смотрим следующую тренировку.');
  } else if (k >= 2) {
    result.status = 'maybePlateau';
    result.reasons.push(`Без прироста ${k} сопоставимые тренировки подряд. Если так будет и дальше — плато.`);
  } else {
    result.status = 'stable';
  }
  // Context that may explain a dip or regress.
  if (v[0] === 'down') {
    const e = last.exposure;
    if (e.flags.technique) result.reasons.push('В этой тренировке отмечено ухудшение техники.');
    if (e.recovery != null && e.recovery <= 2) result.reasons.push(`Восстановление в этот день: ${e.recovery} из 5.`);
    if (e.sleep != null && e.sleep < 6) result.reasons.push(`Сон: ${e.sleep} ч.`);
  }
  return result;
}

// Overview across all series, sorted by what needs attention first.
export function overview(seriesMap, { nameOf = (k, list) => list[list.length - 1].name, categoryOf = () => null, bodyweight = null } = {}) {
  const rows = [];
  for (const [key, list] of seriesMap) {
    const done = list.filter((e) => !e.active);
    if (!done.length) continue;
    const category = categoryOf(key) || done[done.length - 1].category;
    const st = seriesStatus(done, { category, bodyweight });
    rows.push({
      key,
      name: nameOf(key, done),
      category,
      status: st.status,
      result: st,
      last: done[done.length - 1],
      sessions: done.length,
    });
  }
  rows.sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank || String(b.last.date).localeCompare(String(a.last.date)));
  return rows;
}

// Previous result hints for a series: same week of the cycle first, otherwise the latest of any week.
export function previousExposures(list, { week, sessionId, date, startedAt = Infinity }) {
  let samePhase = null;
  let latest = null;
  for (let i = (list?.length || 0) - 1; i >= 0; i--) {
    const e = list[i];
    if (e.sessionId === sessionId) continue;
    if (e.date > date || (e.date === date && e.startedAt >= startedAt)) continue;
    if (!e.sets.length) continue;
    if (!latest) latest = e;
    if (!samePhase && e.week === week) samePhase = e;
    if (latest && samePhase) break;
  }
  return { samePhase, latest };
}

// --- body metrics -------------------------------------------------------------------

// Least-squares slope of bodyweight over the last `days` days → kg/week.
export function weightTrend(metrics, { days = 28, today = null } = {}) {
  const pts = metrics
    .filter((m) => !m.deleted && m.bodyweight != null && m.bodyweight > 0)
    .map((m) => ({ date: m.date, t: Date.parse(m.date + 'T00:00:00Z') / 86400000, w: m.bodyweight }))
    .sort((a, b) => a.t - b.t);
  if (!pts.length) return null;
  const endT = today ? Date.parse(today + 'T00:00:00Z') / 86400000 : pts[pts.length - 1].t;
  const win = pts.filter((p) => p.t > endT - days && p.t <= endT);
  const avg7 = (() => {
    const w = pts.filter((p) => p.t > endT - 7 && p.t <= endT);
    return w.length ? sum(w.map((p) => p.w)) / w.length : null;
  })();
  let perWeek = null;
  if (win.length >= 4 && win[win.length - 1].t - win[0].t >= 10) {
    const mt = sum(win.map((p) => p.t)) / win.length;
    const mw = sum(win.map((p) => p.w)) / win.length;
    const num = sum(win.map((p) => (p.t - mt) * (p.w - mw)));
    const den = sum(win.map((p) => (p.t - mt) ** 2));
    perWeek = den ? (num / den) * 7 : 0;
  }
  const ref = avg7 ?? pts[pts.length - 1].w;
  return {
    points: pts,
    avg7,
    perWeek,
    perWeekPct: perWeek != null && ref ? (perWeek / ref) * 100 : null,
    latest: pts[pts.length - 1],
  };
}

// Trailing 7-day average for each point (for the chart line).
export function rollingAverage(points, days = 7) {
  return points.map((p) => {
    const w = points.filter((q) => q.t > p.t - days && q.t <= p.t);
    return { ...p, avg: sum(w.map((q) => q.w)) / w.length };
  });
}
