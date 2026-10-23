// Body weight on a date and the load of exercises where the body is lifted (lib/bodyweight.js),
// and how comparisons use it: each workout its own day's weight, nothing assumed. Synthetic data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyweightIndex, bodyweightAt, bodyweightLookup, loadShare, totalLoad, MAX_DAYS } from '../../app/js/lib/bodyweight.js';
import { dailyWeights } from '../../app/js/lib/bodydata.js';
import { buildExposures, compareExposures, seriesStatus } from '../../app/js/lib/plateau.js';
import { strengthOver } from '../../app/js/lib/phase.js';

const weigh = (date, value, extra = {}) => ({ id: `b:${date}:${value}:${extra.n || 1}`, kind: 'weight', date, value, deleted: false, ...extra });
const at = (body, date, metrics = []) => bodyweightAt(bodyweightIndex(dailyWeights(body, metrics).days), date);

test('the weigh-in of the day is measured; otherwise the nearest one, before or after, says which', () => {
  const body = [weigh('2026-10-10', 80.2), weigh('2026-10-16', 81.0)];
  assert.deepEqual(at(body, '2026-10-10'), { value: 80.2, date: '2026-10-10', distance: 0, side: 'same', measured: true, fresh: true, from: 'body' });
  const before = at(body, '2026-10-12');
  assert.deepEqual([before.value, before.side, before.distance, before.measured, before.fresh], [80.2, 'before', 2, false, true]);
  const after = at(body, '2026-10-15');
  assert.deepEqual([after.value, after.side, after.distance], [81.0, 'after', 1]);
  // A tie: the earlier weigh-in.
  assert.equal(at(body, '2026-10-13').value, 80.2);
  assert.equal(at(body, '2026-10-13').side, 'before');
});

test('nothing is assumed: no weigh-ins, or none within the limit, is unknown — never 75 kg', () => {
  assert.equal(at([], '2026-10-10'), null);
  const body = [weigh('2026-09-01', 80)];
  assert.ok(at(body, addDays('2026-09-01', MAX_DAYS)));
  assert.equal(at(body, addDays('2026-09-01', MAX_DAYS + 1)), null);
  assert.equal(at(body, addDays('2026-09-01', -(MAX_DAYS + 1))), null);
  assert.equal(at(body, '2026-09-10').fresh, false, 'nine days away: an approximation, flagged');
});

test('«не учитывать», flagged outliers and deleted rows are never the body weight; the check-in fills only a day without weigh-ins', () => {
  const body = [
    weigh('2026-10-01', 80.0),
    weigh('2026-10-02', 80.1),
    weigh('2026-10-03', 95.0), // outlier → suspect
    weigh('2026-10-04', 80.2),
    weigh('2026-10-05', 70.0, { excluded: true }),
    weigh('2026-10-06', 99.0, { deleted: true }),
  ];
  assert.equal(at(body, '2026-10-03').value === 95, false);
  assert.equal(at(body, '2026-10-05').value, 80.2);
  assert.equal(at(body, '2026-10-06').value, 80.2);
  const metrics = [{ id: 'm1', date: '2026-10-04', bodyweight: 81.5 }, { id: 'm2', date: '2026-10-08', bodyweight: 80.6 }];
  assert.equal(at(body, '2026-10-04', metrics).value, 80.2, 'the weigh-in wins its day');
  assert.equal(at(body, '2026-10-08', metrics).value, 80.6);
  assert.equal(at(body, '2026-10-08', metrics).from, 'metrics');
});

test('load share: pull-ups the whole body; anything else only when the owner set it', () => {
  assert.equal(loadShare('pullup'), 1);
  assert.equal(loadShare('base'), 0);
  assert.equal(loadShare('iso', { bwShare: 0.65 }), 0.65);
  assert.equal(loadShare('pullup', { bwShare: null }), 1);
  assert.equal(loadShare('pullup', { bwShare: 0 }), 0, 'the owner may say the body is not part of it');
  assert.equal(totalLoad(28, { share: 1, bodyweight: 80 }), 108);
  assert.equal(totalLoad(28, { share: 1, bodyweight: null }), null);
  assert.equal(totalLoad(60, {}), 60);
});

// --- comparisons ------------------------------------------------------------------------------

let n = 0;
function pullups(date, week, sets) {
  const id = `s${++n}`;
  return {
    session: { id, date, week, cycle: Math.ceil(n / 3), day: 1, status: 'done', startedAt: Date.parse(date), items: [{ slotId: 'p', seriesKey: 'pull', category: 'pullup', flags: {} }] },
    sets: sets.map(([weight, reps], i) => ({ id: `${id}-${i}`, sessionId: id, slotId: 'p', seriesKey: 'pull', exercise: 'Подтягивания', date, setNo: i + 1, weight, reps, rir: null, deleted: false, createdAt: i })),
  };
}
function series(ws, body) {
  const lookup = bodyweightLookup({ body });
  return buildExposures(ws.map((w) => w.session), ws.flatMap((w) => w.sets), { bodyweightAt: lookup }).get('pull');
}

test('pull-ups: the same added weight and reps with a heavier body is more strength; with a lighter one, less', () => {
  const ws = [pullups('2026-09-02', 2, [[20, 6], [20, 6], [20, 6]]), pullups('2026-09-23', 2, [[20, 6], [20, 6], [20, 6]])];
  const heavier = series(ws, [weigh('2026-09-02', 78), weigh('2026-09-23', 81)]);
  const c = compareExposures(heavier[1], heavier[0]);
  assert.equal(c.verdict, 'up');
  assert.deepEqual([c.bodyweight.prev, c.bodyweight.cur, c.bodyweight.missing], [78, 81, null]);
  const lighter = series(ws, [weigh('2026-09-02', 81), weigh('2026-09-23', 78)]);
  assert.equal(compareExposures(lighter[1], lighter[0]).median < 0, true);
});

test('pull-ups: one side without a body weight — the known one stands for both, and the result says so', () => {
  const ws = [pullups('2026-09-02', 2, [[20, 6], [20, 6]]), pullups('2026-10-20', 2, [[22.5, 6], [22.5, 6]])];
  const list = series(ws, [weigh('2026-10-20', 80)]); // nothing near 2.09
  const c = compareExposures(list[1], list[0]);
  assert.equal(c.bodyweight.missing, 'prev');
  assert.deepEqual([c.bodyweight.prev, c.bodyweight.cur], [80, 80]);
  assert.equal(c.verdict, 'up');
});

test('pull-ups: no body weight at all — compared by added weight and reps, never with an invented weight', () => {
  const ws = [pullups('2026-09-02', 2, [[0, 8], [0, 8]]), pullups('2026-09-23', 2, [[5, 6], [5, 6]])];
  const list = series(ws, []);
  const c = compareExposures(list[1], list[0]);
  assert.equal(c.bodyweight.missing, 'both');
  assert.equal(c.verdict, 'flat', 'heavier but fewer reps: cannot be told without the body weight');
  const same = series([pullups('2026-09-02', 2, [[10, 6]]), pullups('2026-09-23', 2, [[10, 7]])], []);
  assert.equal(compareExposures(same[1], same[0]).verdict, 'up', 'same added weight, one more rep');
  const heavier = series([pullups('2026-09-02', 2, [[10, 6]]), pullups('2026-09-23', 2, [[12.5, 6]])], []);
  assert.equal(compareExposures(heavier[1], heavier[0]).verdict, 'up');
});

test('a weigh-in added later for an earlier date changes the comparisons around it', () => {
  const ws = [pullups('2026-09-02', 2, [[20, 6], [20, 6]]), pullups('2026-09-23', 2, [[20, 6], [20, 6]])];
  const before = series(ws, [weigh('2026-09-23', 80)]);
  assert.equal(compareExposures(before[1], before[0]).verdict, 'flat'); // one known weight for both
  const after = series(ws, [weigh('2026-09-23', 80), weigh('2026-09-01', 77)]); // imported later
  const c = compareExposures(after[1], after[0]);
  assert.equal(c.bodyweight.missing, null);
  assert.equal(c.bodyweight.prev, 77);
  assert.equal(c.verdict, 'up');
  assert.equal(seriesStatus(after).comparisons[1].cmp.verdict, 'up');
});

test('phase strength uses each workout\'s own body weight too', () => {
  const ws = [pullups('2026-09-02', 2, [[20, 6]]), pullups('2026-09-30', 2, [[20, 6]])];
  const s = new Map([['pull', series(ws, [weigh('2026-09-02', 78), weigh('2026-09-30', 80)])]]);
  const r = strengthOver(s, { from: '2026-09-01', to: '2026-10-01' });
  assert.equal(r.items[0].verdict, 'up');
  assert.equal(Math.round(r.items[0].change * 1000), Math.round((100 / 98 - 1) * 1000));
  const unknown = new Map([['pull', series(ws, [])]]);
  assert.equal(strengthOver(unknown, { from: '2026-09-01', to: '2026-10-01' }).items[0].verdict, 'flat');
});

function addDays(iso, d) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10);
}
