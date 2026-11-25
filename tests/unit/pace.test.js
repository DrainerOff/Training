import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  median, intervalsOf, paceModel, todayPace, workoutProgress, roundMinutes, fmtLeft, fmtEndsAt,
  DEFAULT_WITHIN, DEFAULT_SWITCH,
} from '../../app/js/lib/pace.js';

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 1, 18, 0); // synthetic

// A synthetic workout: `plan` = [[key, [gap before each set in minutes…]], …], gaps counted from
// the previous set (the very first one from «Начать»).
function workout(id, startedAt, plan, extra = {}) {
  const session = { id, status: 'done', startedAt, deleted: false, ...extra };
  const sets = [];
  let t = startedAt;
  plan.forEach(([key, gaps], i) => {
    gaps.forEach((g, n) => {
      t += g * MIN;
      sets.push({ id: `${id}-${key}-${n}`, sessionId: id, slotId: `slot-${i}`, seriesKey: key, setNo: n + 1, createdAt: t, deleted: false });
    });
  });
  return { session, sets };
}

function history(list) {
  const by = new Map(list.map((w) => [w.session.id, w.sets]));
  return { sessions: list.map((w) => w.session), setsOf: (id) => by.get(id) || [] };
}

const row = (slotId, key, sets, { working = 0, drops = 0, drop = 0, skipped = false } = {}) =>
  ({ slotId, key, target: { sets, drop }, working, drops, skipped });

test('median of odd and even lists, ignores non-numbers', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([NaN, 5]), 5);
});

test('intervals: same exercise in a row is «within», a change is «switch», the first set is «start»', () => {
  const w = workout('a', T0, [['squat', [5, 3, 3]], ['row', [4, 2]]]);
  const kinds = intervalsOf(w.session, w.sets).map((x) => `${x.kind}:${x.key}:${x.ms / MIN}`);
  assert.deepEqual(kinds, ['start:squat:5', 'within:squat:3', 'within:squat:3', 'switch:row:4', 'within:row:2']);
});

test('intervals: a back-filled set (seconds after the previous) and a forgotten one (half an hour) are dropped', () => {
  const w = workout('a', T0, [['squat', [5, 3, 0.1, 40, 3]]]);
  const ms = intervalsOf(w.session, w.sets).filter((x) => x.kind === 'within').map((x) => x.ms / MIN);
  assert.deepEqual(ms, [3, 3]);
});

test('model: per-exercise median once there are 3 samples, common median otherwise, defaults without history', () => {
  const empty = paceModel([], () => []);
  assert.equal(empty.within('squat'), DEFAULT_WITHIN);
  assert.equal(empty.switch('squat'), DEFAULT_SWITCH);
  assert.equal(empty.learned, false);

  const h = history([
    workout('a', T0, [['squat', [5, 4, 4, 4]], ['curl', [3, 2, 2]]]),
    workout('b', T0 + 86400000, [['squat', [5, 4, 4, 4]], ['curl', [3, 2, 2]]]),
  ]);
  const m = paceModel(h.sessions, h.setsOf);
  assert.equal(m.learned, true);
  assert.equal(m.within('squat'), 4 * MIN);
  assert.equal(m.within('curl'), 2 * MIN);
  // Unknown exercise: median of every within-interval (4,4,4,2,2 ×2 → 4).
  assert.equal(m.within('press'), 4 * MIN);
  // Two starts are not enough yet (and two switches neither): the default.
  assert.equal(m.start(), DEFAULT_SWITCH);
});

test('model: one forgotten set among usual ones does not move the median', () => {
  const h = history([workout('a', T0, [['squat', [5, 3, 3, 12, 3, 3]]])]);
  assert.equal(paceModel(h.sessions, h.setsOf).within('squat'), 3 * MIN);
});

test('model: active, deleted, later and imported-from-text workouts are not learned from', () => {
  const real = workout('real', T0, [['squat', [5, 3, 3, 3]]]);
  const active = workout('act', T0 + 1, [['squat', [1, 9, 9, 9]]], { status: 'active' });
  const deleted = workout('del', T0 + 2, [['squat', [1, 9, 9, 9]]], { deleted: true });
  const later = workout('later', T0 + 10 * 86400000, [['squat', [1, 9, 9, 9]]]);
  // Imported: every set within a millisecond of the previous one.
  const imported = { session: { id: 'imp', status: 'done', startedAt: T0 + 3 }, sets: [0, 1, 2, 3].map((i) => ({ id: `imp${i}`, sessionId: 'imp', slotId: 's', seriesKey: 'squat', createdAt: T0 + 3 + i })) };
  const h = history([real, active, deleted, later, imported]);
  const m = paceModel(h.sessions, h.setsOf, { before: T0 + 5 * 86400000 });
  assert.equal(m.sessions, 1);
  assert.equal(m.within('squat'), 3 * MIN);
});

test('today pace: as usual → 1; consistently slower → above 1 but pulled toward 1 while samples are few', () => {
  const h = history([workout('a', T0, [['squat', [5, 3, 3, 3, 3, 3]]])]);
  const m = paceModel(h.sessions, h.setsOf);
  const same = workout('t', T0 + 86400000, [['squat', [5, 3, 3]]], { status: 'active' });
  assert.equal(todayPace(m, same.session, same.sets).pace, 1);
  const slow = workout('t', T0 + 86400000, [['squat', [5, 6, 6]]], { status: 'active' });
  const p = todayPace(m, slow.session, slow.sets);
  assert.equal(p.samples, 2);
  assert.ok(p.pace > 1 && p.pace < 2, String(p.pace)); // 1 + (2-1)·2/6
  assert.ok(Math.abs(p.pace - (1 + 2 / 6)) < 1e-9);
});

test('progress: percent by planned sets, skipped exercises and extra sets do not break it', () => {
  const model = paceModel([], () => []);
  const rows = [row('a', 'squat', 4, { working: 4 }), row('b', 'row', 3, { working: 1 }), row('c', 'curl', 3, { skipped: true }), row('d', 'press', 3, { working: 5 })];
  const p = workoutProgress({ session: { startedAt: T0 }, rows, sets: [], model, now: T0 });
  assert.equal(p.total, 10);
  assert.equal(p.done, 8);
  assert.equal(p.percent, 80);
});

test('progress: a planned drop set counts until it is done', () => {
  const model = paceModel([], () => []);
  const p = workoutProgress({ session: { startedAt: T0 }, rows: [row('a', 'squat', 3, { working: 3, drop: 1 })], sets: [], model, now: T0 });
  assert.equal(p.percent, 75);
  assert.ok(p.remainingMs === null); // nothing to estimate from yet
});

test('progress: all done → 100% and nothing left', () => {
  const model = paceModel([], () => []);
  const p = workoutProgress({ session: { startedAt: T0 }, rows: [row('a', 'squat', 3, { working: 3 })], sets: [], model, now: T0 });
  assert.equal(p.percent, 100);
  assert.equal(p.remainingMs, 0);
});

test('progress: no planned sets → null', () => {
  assert.equal(workoutProgress({ session: {}, rows: [], sets: [], model: paceModel([], () => []), now: T0 }), null);
});

// Usual: squat 4 min per set, row 3 min, switch 5 min.
const usual = history([1, 2, 3].map((d) => workout(`h${d}`, T0 + d * 86400000, [['squat', [5, 4, 4, 4]], ['row', [5, 3, 3, 3]]])));
const START = T0 + 10 * 86400000;
const model = paceModel(usual.sessions, usual.setsOf, { before: START });

test('remaining before the first set: start + the rest of the day from history', () => {
  const rows = [row('slot-0', 'squat', 4), row('slot-1', 'row', 4)];
  const p = workoutProgress({ session: { startedAt: START }, rows, sets: [], model, now: START });
  // start 5 + 3×4 (squat) + switch 5 + 3×3 (row) = 31
  assert.equal(p.remainingMs, 31 * MIN);
  assert.equal(p.percent, 0);
});

test('remaining mid-workout at the usual pace, and time since the last set is already spent', () => {
  const today = workout('t', START, [['squat', [5, 4]]], { status: 'active' });
  const rows = [row('slot-0', 'squat', 4, { working: 2 }), row('slot-1', 'row', 4)];
  const lastAt = today.sets[1].createdAt;
  const p = workoutProgress({ session: today.session, rows, sets: today.sets, model, now: lastAt });
  // 2×4 squat + 5 switch + 3×3 row = 22
  assert.equal(p.remainingMs, 22 * MIN);
  assert.equal(p.endsAt, lastAt + 22 * MIN);
  const later = workoutProgress({ session: today.session, rows, sets: today.sets, model, now: lastAt + 3 * MIN });
  assert.equal(later.remainingMs, 19 * MIN);
  // Resting longer than a whole interval: what is left after the next set, plus a minute for that set.
  const idle = workoutProgress({ session: today.session, rows, sets: today.sets, model, now: lastAt + 15 * MIN });
  assert.equal(idle.remainingMs, 19 * MIN);
});

test('remaining: the next exercise after a finished one starts with a switch', () => {
  const today = workout('t', START, [['squat', [5, 4, 4, 4]]], { status: 'active' });
  const rows = [row('slot-0', 'squat', 4, { working: 4 }), row('slot-1', 'row', 4)];
  const lastAt = today.sets[3].createdAt;
  const p = workoutProgress({ session: today.session, rows, sets: today.sets, model, now: lastAt + 2 * MIN });
  // switch 5 + 3×3 = 14, 2 minutes of the switch spent
  assert.equal(p.remainingMs, 12 * MIN);
  assert.equal(p.percent, 50);
});

test('remaining follows a slower day, and one forgotten set barely changes it', () => {
  const rows = [row('slot-0', 'squat', 6, { working: 4 }), row('slot-1', 'row', 4)];
  const slow = workout('t', START, [['squat', [5, 6, 6, 6]]], { status: 'active' });
  const at = slow.sets[3].createdAt;
  const pSlow = workoutProgress({ session: slow.session, rows, sets: slow.sets, model, now: at });
  // Usual 2×4 + 5 + 3×3 = 22; pace 1 + 0.5·3/7
  assert.ok(Math.abs(pSlow.remainingMs - 22 * MIN * (1 + 1.5 / 7)) < 1);

  const usualDay = workout('t', START, [['squat', [5, 4, 4, 4]]], { status: 'active' });
  const forgot = workout('t', START, [['squat', [5, 4, 14, 0.1]]], { status: 'active' }); // forgot, then logged two at once
  const a = workoutProgress({ session: usualDay.session, rows, sets: usualDay.sets, model, now: usualDay.sets[3].createdAt });
  const b = workoutProgress({ session: forgot.session, rows, sets: forgot.sets, model, now: forgot.sets[3].createdAt });
  assert.equal(a.remainingMs, 22 * MIN);
  // One interval of 14 among 2 samples (the 0.1 one is dropped): median of ratios 1 and 3.5 → 2.25 → capped 2,
  // pulled to 1 + 1·2/6. Still far from doubling.
  assert.ok(b.remainingMs < a.remainingMs * 1.4, `${b.remainingMs / MIN}`);
});

test('without history, the estimate waits for two intervals of today', () => {
  const empty = paceModel([], () => []);
  const rows = [row('slot-0', 'squat', 4, { working: 2 }), row('slot-1', 'row', 4)];
  const one = workout('t', START, [['squat', [5, 2]]], { status: 'active' });
  assert.equal(workoutProgress({ session: one.session, rows, sets: one.sets, model: empty, now: one.sets[1].createdAt }).remainingMs, null);
  const two = workout('t', START, [['squat', [5, 2, 2]]], { status: 'active' });
  const rows3 = [row('slot-0', 'squat', 4, { working: 3 }), row('slot-1', 'row', 4)];
  const p = workoutProgress({ session: two.session, rows: rows3, sets: two.sets, model: empty, now: two.sets[2].createdAt });
  assert.ok(p.remainingMs > 0);
});

test('rounding and formatting', () => {
  assert.equal(roundMinutes(0), 0);
  assert.equal(roundMinutes(20 * 1000), 1);
  assert.equal(roundMinutes(7.4 * MIN), 7);
  assert.equal(roundMinutes(23 * MIN), 25);
  assert.equal(roundMinutes(22 * MIN), 20);
  assert.equal(fmtLeft(23 * MIN), '≈25 мин');
  assert.equal(fmtLeft(72 * MIN), '≈1 ч 10 мин');
  assert.equal(fmtLeft(61 * MIN), '≈1 ч');
  const d = new Date(2026, 10, 25, 22, 38);
  assert.equal(fmtEndsAt(d.getTime()), '22:40');
  assert.equal(fmtEndsAt(new Date(2026, 10, 25, 9, 1).getTime()), '9:00');
});

// Found by the independent check of v1.7.0.
test('the last set of the plan, rest longer than usual: not «done», a little time is still left', () => {
  const rows = [row('slot-0', 'squat', 4, { working: 4 }), row('slot-1', 'row', 4, { working: 3 })];
  const today = workout('t', START, [['squat', [5, 4, 4, 4]], ['row', [5, 3, 3]]], { status: 'active' });
  const lastAt = today.sets[today.sets.length - 1].createdAt;
  for (const rest of [1, 3, 5, 12]) {
    const p = workoutProgress({ session: today.session, rows, sets: today.sets, model, now: lastAt + rest * MIN });
    assert.equal(p.finished, false);
    assert.ok(p.remainingMs >= MIN, `rest ${rest}: ${p.remainingMs / MIN}`);
  }
  // Two sets left and a long rest: both still count, not only one.
  const two = [row('slot-0', 'squat', 4, { working: 4 }), row('slot-1', 'row', 4, { working: 2 })];
  const t2 = workout('t', START, [['squat', [5, 4, 4, 4]], ['row', [5, 3]]], { status: 'active' });
  const p2 = workoutProgress({ session: t2.session, rows: two, sets: t2.sets, model, now: t2.sets[t2.sets.length - 1].createdAt + 10 * MIN });
  assert.ok(p2.remainingMs >= 3 * MIN + MIN, `${p2.remainingMs / MIN}`);
  const all = workoutProgress({ session: t2.session, rows: [row('slot-0', 'squat', 4, { working: 4 })], sets: t2.sets, model, now: T0 });
  assert.equal(all.finished, true);
});

test('a superset (two exercises in turn) is estimated by its own pace, not by the usual rest of one exercise', () => {
  // Past: squat 3 min per set, then A and B in turn every 1.5 min (4 sets each).
  const pair = (id, start) => {
    const session = { id, status: 'done', startedAt: start, deleted: false };
    const sets = [];
    let t = start;
    for (let n = 0; n < 4; n++) { t += (n ? 3 : 5) * MIN; sets.push({ id: `${id}-s${n}`, slotId: 'slot-0', seriesKey: 'squat', createdAt: t }); }
    t += 5 * MIN;
    for (let n = 0; n < 8; n++) {
      if (n) t += 1.5 * MIN;
      const ab = n % 2 ? 'B' : 'A';
      sets.push({ id: `${id}-${ab}${n}`, slotId: `slot-${ab}`, seriesKey: ab, createdAt: t });
    }
    return { session, sets };
  };
  const h = history([1, 2, 3, 4].map((d) => pair(`p${d}`, T0 + d * 86400000)));
  const m = paceModel(h.sessions, h.setsOf, { before: START });
  // Today: squat done, A and B two sets each — four sets of the superset left, 1.5 min apart.
  const today = pair('t', START);
  today.session.status = 'active';
  const sets = today.sets.slice(0, 8);
  const rows = [row('slot-0', 'squat', 4, { working: 4 }), row('slot-A', 'A', 4, { working: 2 }), row('slot-B', 'B', 4, { working: 2 })];
  const p = workoutProgress({ session: today.session, rows, sets, model: m, now: sets[7].createdAt });
  assert.ok(Math.abs(p.remainingMs - 6 * MIN) <= 0.5 * MIN, `${p.remainingMs / MIN}`);
});
