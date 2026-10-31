import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExposures, compareExposures, seriesStatus, overview, previousExposures, weightDrop, weightTrend } from '../../app/js/lib/plateau.js';

// Fixture builder. `spec` = { cycle, week, day, date, sets: [[w, r, rir?], ...], key?, flags?, drop? }
function fixture(specs) {
  const sessions = [];
  const sets = [];
  specs.forEach((sp, i) => {
    const id = `s${i}`;
    const key = sp.key || 'press';
    sessions.push({
      id,
      date: sp.date,
      cycle: sp.cycle,
      week: sp.week,
      day: sp.day || 1,
      status: sp.status || 'done',
      startedAt: i,
      items: [{ slotId: 'slot1', seriesKey: key, category: sp.category || 'base', flags: sp.flags || {} }],
    });
    sp.sets.forEach(([w, r, rir, extra], j) => {
      sets.push({
        id: `${id}-${j}`,
        sessionId: id,
        slotId: 'slot1',
        seriesKey: key,
        exercise: key,
        setNo: j + 1,
        weight: w,
        reps: r,
        rir: rir ?? null,
        ...(extra || {}),
      });
    });
  });
  return { sessions, sets };
}

const status = (specs, key = 'press') => {
  const { sessions, sets } = fixture(specs);
  const list = buildExposures(sessions, sets).get(key);
  return seriesStatus(list, { category: 'base' });
};

test('week 3 with fewer reps than week 2 is not a regression (different phases)', () => {
  const r = status([
    { cycle: 1, week: 2, date: '2026-10-23', sets: [[80, 10], [80, 9], [80, 9], [80, 8]] },
    { cycle: 1, week: 3, date: '2026-10-30', sets: [[85, 7], [85, 7], [85, 6], [85, 6]] },
  ]);
  assert.equal(r.status, 'insufficient');
  assert.equal(r.counted.length, 0);
});

test('same weight, more reps in the same phase is progress — uses all sets, not only the best', () => {
  const r = status([
    { cycle: 1, week: 2, date: '2026-10-23', sets: [[80, 10], [80, 9], [80, 8], [80, 8]] },
    { cycle: 2, week: 2, date: '2026-11-13', sets: [[80, 10], [80, 10], [80, 9], [80, 8]] },
  ]);
  assert.equal(r.status, 'progress');
  const cmp = r.counted[0].cmp;
  assert.equal(cmp.repsDelta, 2);
  assert.equal(cmp.pairs.length, 4);
});

test('one bad session is a dip, never a plateau', () => {
  const r = status([
    { cycle: 1, week: 2, date: '2026-10-23', sets: [[80, 10], [80, 10], [80, 9], [80, 9]] },
    { cycle: 2, week: 2, date: '2026-11-13', sets: [[80, 8], [80, 8], [80, 7], [80, 7]] },
  ]);
  assert.equal(r.status, 'dip');
});

test('two consecutive comparable declines are a regress', () => {
  const r = status([
    { cycle: 1, week: 2, date: '2026-10-23', sets: [[80, 10], [80, 10], [80, 9], [80, 9]] },
    { cycle: 1, week: 3, date: '2026-10-30', sets: [[85, 8], [85, 8], [85, 7], [85, 7]] },
    { cycle: 2, week: 2, date: '2026-11-13', sets: [[80, 8], [80, 8], [80, 7], [80, 7]] },
    { cycle: 2, week: 3, date: '2026-11-20', sets: [[85, 6], [85, 6], [85, 5], [85, 5]] },
  ]);
  assert.equal(r.status, 'regress');
});

test('flat results: 2 → possible plateau, 3 across two cycles → plateau', () => {
  const base = [
    { cycle: 1, week: 2, date: '2026-10-23', sets: [[80, 10], [80, 9], [80, 9], [80, 8]] },
    { cycle: 1, week: 3, date: '2026-10-30', sets: [[85, 8], [85, 7], [85, 7], [85, 6]] },
    { cycle: 2, week: 2, date: '2026-11-13', sets: [[80, 10], [80, 9], [80, 9], [80, 8]] },
    { cycle: 2, week: 3, date: '2026-11-20', sets: [[85, 8], [85, 7], [85, 7], [85, 6]] },
  ];
  assert.equal(status(base).status, 'maybePlateau');
  const more = [...base, { cycle: 3, week: 2, date: '2026-12-04', sets: [[80, 10], [80, 9], [80, 9], [80, 8]] }];
  const r = status(more);
  assert.equal(r.status, 'plateau');
  assert.match(r.reasons[0], /3 сопоставимых/);
});

test('alternative exercises are separate series and never compared', () => {
  const { sessions, sets } = fixture([
    { key: 'hammer', cycle: 1, week: 2, date: '2026-10-23', sets: [[60, 10], [60, 10], [60, 9]] },
    { key: 'db-press', cycle: 2, week: 2, date: '2026-11-13', sets: [[30, 10], [30, 9], [30, 8]] },
  ]);
  const map = buildExposures(sessions, sets);
  assert.equal(map.get('hammer').length, 1);
  assert.equal(map.get('db-press').length, 1);
  assert.equal(seriesStatus(map.get('db-press')).status, 'insufficient');
});

test('pain-marked session is not counted and is not used as a reference', () => {
  const r = status([
    { cycle: 1, week: 2, date: '2026-10-23', sets: [[80, 10], [80, 9], [80, 9], [80, 8]] },
    { cycle: 2, week: 2, date: '2026-11-13', sets: [[70, 8], [70, 8], [70, 7], [70, 7]], flags: { pain: true } },
    { cycle: 3, week: 2, date: '2026-12-04', sets: [[80, 10], [80, 10], [80, 9], [80, 9]] },
  ]);
  const last = r.comparisons[2];
  assert.equal(last.cmp.prev.date, '2026-10-23', 'compared against the last pain-free session');
  assert.equal(r.comparisons[1].counted, false);
  assert.equal(r.status, 'progress');
});

test('gain with degraded technique is not counted as progress', () => {
  const r = status([
    { cycle: 1, week: 2, date: '2026-10-23', sets: [[80, 10], [80, 9], [80, 9], [80, 8]] },
    { cycle: 2, week: 2, date: '2026-11-13', sets: [[85, 10], [85, 9], [85, 9], [85, 8]], flags: { technique: true } },
  ]);
  assert.equal(r.counted[0].cmp.verdict, 'up');
  assert.equal(r.counted[0].effective, 'flat');
  assert.notEqual(r.status, 'progress');
});

test('stricter technique (new baseline) does not read as regress', () => {
  const r = status([
    { cycle: 1, week: 2, date: '2026-10-23', sets: [[80, 10], [80, 10], [80, 9], [80, 9]] },
    { cycle: 1, week: 3, date: '2026-10-30', sets: [[85, 8], [85, 8], [85, 7], [85, 7]] },
    { cycle: 2, week: 2, date: '2026-11-13', sets: [[70, 10], [70, 9], [70, 9], [70, 8]], flags: { baseline: true } },
    { cycle: 2, week: 3, date: '2026-11-20', sets: [[75, 8], [75, 7], [75, 7], [75, 6]] },
  ]);
  assert.equal(r.status, 'insufficient');
  assert.ok(r.comparisons.every((c) => !c.cmp || c.cmp.verdict !== 'down'));
});

test('reported RIR is used when both sides have it: same reps but easier = progress', () => {
  const r = status([
    { cycle: 1, week: 2, date: '2026-10-23', sets: [[80, 10, 0], [80, 9, 0], [80, 9, 0], [80, 8, 0]] },
    { cycle: 2, week: 2, date: '2026-11-13', sets: [[80, 10, 2], [80, 9, 2], [80, 9, 1], [80, 8, 1]] },
  ]);
  assert.equal(r.status, 'progress');
});

test('light week is shown but never drives the status', () => {
  const r = status([
    { cycle: 1, week: 1, date: '2026-10-16', sets: [[70, 10], [70, 10], [70, 10]] },
    { cycle: 2, week: 1, date: '2026-11-06', sets: [[60, 8], [60, 8], [60, 8]] },
  ]);
  assert.equal(r.status, 'insufficient');
  assert.equal(r.comparisons[1].cmp.verdict, 'down');
  assert.equal(r.comparisons[1].counted, false);
});

test('back to previous level after a dip is "recovering", not progress', () => {
  const r = status([
    { cycle: 1, week: 2, date: '2026-10-23', sets: [[90, 10], [90, 10], [90, 9], [90, 9]] },
    { cycle: 2, week: 2, date: '2026-11-13', sets: [[80, 8], [80, 8], [80, 8], [80, 7]] },
    { cycle: 3, week: 2, date: '2026-12-04', sets: [[85, 9], [85, 9], [85, 8], [85, 8]] },
  ]);
  assert.equal(r.status, 'recovering');
});

test('after a new baseline, beating the new segment is progress (old heavier results ignored)', () => {
  const r = status([
    { cycle: 1, week: 2, date: '2026-10-23', sets: [[100, 10], [100, 10], [100, 9], [100, 9]] },
    { cycle: 2, week: 2, date: '2026-11-13', sets: [[70, 10], [70, 10], [70, 9], [70, 9]], flags: { baseline: true } },
    { cycle: 3, week: 2, date: '2026-12-04', sets: [[75, 10], [75, 10], [75, 9], [75, 9]] },
  ]);
  assert.equal(r.status, 'progress');
});

test('drop sets are excluded from working-set comparisons', () => {
  const { sessions, sets } = fixture([
    { cycle: 1, week: 3, date: '2026-10-30', category: 'calves', key: 'calves', sets: [[100, 12], [100, 12], [100, 11], [70, 10, null, { drop: true }]] },
  ]);
  const e = buildExposures(sessions, sets).get('calves')[0];
  assert.equal(e.sets.length, 3);
  assert.equal(e.drops.length, 1);
});

test('compareExposures pairs sets by order and copes with fewer sets', () => {
  const cur = { sets: [{ weight: 80, reps: 10 }, { weight: 80, reps: 9 }] };
  const prev = { sets: [{ weight: 80, reps: 10 }, { weight: 80, reps: 9 }, { weight: 80, reps: 8 }] };
  const c = compareExposures(cur, prev);
  assert.equal(c.pairs.length, 2);
  assert.equal(c.setsDelta, -1);
  assert.equal(c.verdict, 'flat');
});

test('pull-ups: added weight at the same reps reads as a gain', () => {
  const cur = { category: 'pullup', sets: [{ weight: 5, reps: 6 }, { weight: 5, reps: 6 }, { weight: 5, reps: 6 }] };
  const prev = { category: 'pullup', sets: [{ weight: 0, reps: 6 }, { weight: 0, reps: 6 }, { weight: 0, reps: 6 }] };
  assert.equal(compareExposures(cur, prev).verdict, 'up');
});

test('previous-result hint prefers the same week of the cycle', () => {
  const { sessions, sets } = fixture([
    { cycle: 1, week: 2, date: '2026-10-23', sets: [[80, 10]] },
    { cycle: 1, week: 3, date: '2026-10-30', sets: [[85, 7]] },
  ]);
  const list = buildExposures(sessions, sets).get('press');
  const p = previousExposures(list, { week: 2, sessionId: 'new', date: '2026-11-13' });
  assert.equal(p.samePhase.date, '2026-10-23');
  assert.equal(p.latest.date, '2026-10-30');
});

// ---- «новая точка отсчёта»: everything is counted from the mark (v1.5.0)

const markedRow = [
  { cycle: 1, week: 2, date: '2026-10-20', sets: [[100, 8, 2], [100, 8, 2], [100, 8, 1], [100, 8, 1]] },
  { cycle: 1, week: 3, date: '2026-10-29', sets: [[110, 6, 1], [110, 6, 1], [110, 6, 1], [110, 7, 0]] },
  { cycle: 2, week: 1, date: '2026-11-03', sets: [[75, 12, 3], [75, 12, 3], [75, 12, 3]], flags: { baseline: true } },
  { cycle: 2, week: 2, date: '2026-11-10', sets: [[90, 8, 2], [90, 8, 2], [90, 8, 1], [90, 8, 1]] },
  { cycle: 2, week: 3, date: '2026-11-17', sets: [[95, 6, 1], [95, 6, 1], [95, 6, 1], [95, 6, 0]] },
];

test('a deliberate drop without the mark reads as a dip, then a regress', () => {
  const r = status(markedRow.map((x) => ({ ...x, flags: {} })));
  assert.equal(r.status, 'regress');
});

test('with the mark the drop is no regress: nothing to compare with until the week repeats after it', () => {
  const r = status(markedRow);
  assert.equal(r.status, 'insufficient');
  assert.equal(r.baseline, '2026-11-03');
  assert.match(r.reasons[0], /^После новой точки отсчёта \(3 ноября\) сравнивать пока не с чем/);
  const later = status([...markedRow, { cycle: 3, week: 2, date: '2026-12-01', sets: [[92.5, 8, 2], [92.5, 8, 2], [92.5, 8, 1], [92.5, 8, 1]] }]);
  assert.equal(later.status, 'progress');
});

test('the status counts only the current segment: an old regress or a flat run does not carry over the mark', () => {
  const old = [
    { cycle: 1, week: 2, date: '2026-09-01', sets: [[100, 10], [100, 10], [100, 9], [100, 9]] },
    { cycle: 2, week: 2, date: '2026-09-22', sets: [[95, 9], [95, 9], [95, 8], [95, 8]] },
    { cycle: 3, week: 2, date: '2026-10-13', sets: [[90, 9], [90, 8], [90, 8], [90, 8]] },
  ];
  assert.equal(status(old).status, 'regress');
  const marked = status([...old, { cycle: 4, week: 2, date: '2026-11-03', sets: [[80, 10], [80, 10], [80, 9], [80, 9]], flags: { baseline: true } }]);
  assert.equal(marked.status, 'insufficient');
  assert.equal(marked.counted.length, 0);

  const flat = [
    { cycle: 1, week: 2, date: '2026-09-01', sets: [[80, 10], [80, 10]] },
    { cycle: 2, week: 2, date: '2026-09-22', sets: [[80, 10], [80, 10]] },
    { cycle: 3, week: 2, date: '2026-10-13', sets: [[80, 10], [80, 10]] },
    { cycle: 4, week: 2, date: '2026-11-03', sets: [[80, 10], [80, 10]] },
  ];
  assert.equal(status(flat).status, 'plateau');
  const afterMark = status([
    ...flat.slice(0, 3),
    { cycle: 4, week: 2, date: '2026-11-03', sets: [[70, 10], [70, 10]], flags: { baseline: true } },
    { cycle: 5, week: 2, date: '2026-11-24', sets: [[70, 10], [70, 10]] },
  ]);
  assert.equal(afterMark.counted.length, 1);
  assert.equal(afterMark.status, 'stable');
});

const prevOf = (specs, args) => {
  const { sessions, sets } = fixture(specs);
  return previousExposures(buildExposures(sessions, sets).get('press'), { sessionId: 'new', ...args });
};

test('last time after a mark: only results since it; what was before comes back as «old», the same week first', () => {
  // Week 2 after a mark on the light week: no week 2 since the mark.
  let p = prevOf(markedRow.slice(0, 3), { week: 2, date: '2026-11-10' });
  assert.equal(p.samePhase, null);
  assert.equal(p.latest.date, '2026-11-03'); // the light week, new technique
  assert.equal(p.old.date, '2026-10-20'); // week 2 before the mark
  assert.equal(p.mark, '2026-11-03');
  // Week 3: week 2 since the mark is the latest; week 3 before it is «old».
  p = prevOf(markedRow.slice(0, 4), { week: 3, date: '2026-11-17' });
  assert.equal(p.samePhase, null);
  assert.equal(p.latest.date, '2026-11-10');
  assert.equal(p.old.date, '2026-10-29');
  // Once the week repeats after the mark, it is «Прошлый раз» again, and nothing is cut.
  p = prevOf(markedRow, { week: 2, date: '2026-12-01' });
  assert.equal(p.samePhase.date, '2026-11-10');
  assert.equal(p.old, null);
  assert.equal(p.mark, null);
  // The marked workout itself is the reference of its week.
  p = prevOf(markedRow.slice(0, 3), { week: 1, date: '2026-11-24' });
  assert.equal(p.samePhase.date, '2026-11-03');
});

test('last time when today is marked: everything before is «old»; without history nothing is cut', () => {
  const p = prevOf(markedRow.slice(0, 2), { week: 1, date: '2026-11-03', baseline: true });
  assert.equal(p.samePhase, null);
  assert.equal(p.latest, null);
  assert.equal(p.old.date, '2026-10-29'); // no week 1 before: the latest
  assert.equal(p.mark, '2026-11-03');
  const none = prevOf([], { week: 1, date: '2026-11-03', baseline: true });
  assert.deepEqual([none.samePhase, none.latest, none.old, none.mark], [null, null, null, null]);
});

test('weight drop: asked at 10% below the same week last time, not for less, pain, worse technique, a mark or pull-ups', () => {
  const ref = { date: '2026-10-29', sets: [{ weight: 110, reps: 6 }, { weight: 110, reps: 7 }] };
  const d = weightDrop({ ref, todaySets: [{ weight: 95, reps: 7 }] });
  assert.deepEqual(d, { was: 110, now: 95, pct: 14, date: '2026-10-29' });
  assert.ok(weightDrop({ ref, todaySets: [{ weight: 99, reps: 7 }] })); // exactly 10%
  assert.equal(weightDrop({ ref, todaySets: [{ weight: 100, reps: 7 }] }), null); // 9%
  assert.equal(weightDrop({ ref, todaySets: [{ weight: 95, reps: 7 }, { weight: 105, reps: 6 }] }), null); // the heaviest set counts
  assert.equal(weightDrop({ ref, todaySets: [] }), null);
  assert.equal(weightDrop({ ref, todaySets: [{ weight: 50, reps: 8, drop: true }] }), null);
  assert.equal(weightDrop({ ref, todaySets: [{ weight: 95, reps: 7, pain: true }] }), null);
  assert.equal(weightDrop({ ref, todaySets: [{ weight: 95, reps: 7 }], flags: { technique: true } }), null);
  assert.equal(weightDrop({ ref, todaySets: [{ weight: 95, reps: 7 }], flags: { baseline: true } }), null);
  assert.equal(weightDrop({ ref: null, todaySets: [{ weight: 95, reps: 7 }] }), null);
  assert.equal(weightDrop({ ref: { date: 'x', sets: [{ weight: 10, reps: 6 }] }, todaySets: [{ weight: 0, reps: 6 }], category: 'pullup' }), null);
});

test('overview puts problems first', () => {
  const a = fixture([
    { key: 'a', cycle: 1, week: 2, date: '2026-10-23', sets: [[80, 10], [80, 10]] },
    { key: 'a', cycle: 2, week: 2, date: '2026-11-13', sets: [[85, 10], [85, 10]] },
  ]);
  const b = fixture([
    { key: 'b', cycle: 1, week: 2, date: '2026-10-23', sets: [[80, 10], [80, 10]] },
    { key: 'b', cycle: 1, week: 3, date: '2026-10-30', sets: [[85, 8], [85, 8]] },
    { key: 'b', cycle: 2, week: 2, date: '2026-11-13', sets: [[80, 7], [80, 7]] },
    { key: 'b', cycle: 2, week: 3, date: '2026-11-20', sets: [[85, 5], [85, 5]] },
  ]);
  b.sessions.forEach((s) => (s.id = 'b' + s.id));
  b.sets.forEach((s) => (s.sessionId = 'b' + s.sessionId));
  const map = buildExposures([...a.sessions, ...b.sessions], [...a.sets, ...b.sets]);
  const rows = overview(map);
  assert.deepEqual(rows.map((r) => [r.key, r.status]), [['b', 'regress'], ['a', 'progress']]);
});

test('weight trend: slope in kg/week from daily weigh-ins', () => {
  const metrics = [];
  for (let i = 0; i < 21; i++) {
    const d = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
    metrics.push({ date: d, bodyweight: 80 + i * (0.4 / 7) });
  }
  const t = weightTrend(metrics);
  assert.ok(Math.abs(t.perWeek - 0.4) < 0.01, `perWeek=${t.perWeek}`);
  assert.ok(t.perWeekPct > 0.45 && t.perWeekPct < 0.52);
});

test('weight trend needs enough data before claiming a rate', () => {
  const t = weightTrend([{ date: '2026-10-16', bodyweight: 80 }, { date: '2026-10-17', bodyweight: 80.4 }]);
  assert.equal(t.perWeek, null);
});
