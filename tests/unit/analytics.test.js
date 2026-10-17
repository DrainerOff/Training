import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExposures, compareExposures, seriesStatus, overview, previousExposures, weightTrend } from '../../app/js/lib/analytics.js';

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
