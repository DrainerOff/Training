// v1.4: the abs machine had two series — «Пресс в тренажере» (16.10, 25.10 on day 1, 29.10 on day 3)
// and «Скручивания в тренажере» (20.10, day 3). The owner confirms it is one machine; the correction
// moves exactly the 20.10 sets into the press series, keeps every fact of every set, makes the press
// the day 3 main variant (the prayer crunch stays an alternative), and from then on history,
// «Прошлый раз», records, the recommendation and search see one exercise on any day. Nothing changes
// before «Исправить»; «Отменить» puts it all back. Ids and keys as recorded, values synthetic.
// Also: the dumbbell weight steps (a program-only correction) — 1 kg and 2 kg, nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas } from '../helpers/fake-gas.js';
import { createStore } from '../../app/js/data/store.js';
import { memoryAdapter } from '../../app/js/data/db.js';
import { createSync, SyncError } from '../../app/js/data/sync.js';
import { FIX_2026_10_20 as FIX, FIX_2026_10_30_STEPS as STEPS, SAME_EXERCISE, pendingFix, pendingFixes, applyFix, revertFix } from '../../app/js/data/fixes.js';
import { buildExposures, previousExposures } from '../../app/js/lib/plateau.js';
import { performances, buildRecordBook } from '../../app/js/lib/records.js';
import { allOptions, targetFor } from '../../app/js/lib/program.js';
import { itemsForDay } from '../../app/js/lib/planner.js';
import { recommend } from '../../app/js/lib/recommend.js';
import { exerciseIndex, searchExercises, findExact } from '../../app/js/lib/exercises.js';
import { programNow, pressHistory, SID_1020, PRESS, CRUNCH, PRAYER, SET_IDS_1020 } from '../helpers/workout-2026-10-20.js';

let clock = 1_793_400_000_000; // after 30.10
const now = () => (clock += 13);

function network(gas) {
  const net = { online: true };
  net.transport = async (url, payload) => {
    if (!net.online) throw new SyncError('network', 'offline');
    return gas.post(JSON.parse(JSON.stringify(payload)));
  };
  return net;
}

async function device(token, net, adapter = memoryAdapter()) {
  const store = createStore(adapter, { now });
  await store.load();
  if (!store.state.kv.sync) await store.setKV({ sync: { url: 'https://example/exec', token } });
  return { adapter, store, sync: createSync(store, { transport: net.transport, now }) };
}

// The iPhone today: the program and the four abs workouts, all in the sheet.
async function today(program = programNow()) {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const phone = await device(token, net);
  const ws = pressHistory(program);
  await phone.store.applyRemote({ program, sessions: ws.map((w) => w.session), sets: ws.flatMap((w) => w.sets) }, { queue: true });
  await phone.sync.syncNow();
  assert.equal(phone.store.state.outbox.size, 0);
  return { gas, token, net, phone };
}

const FACTS = (x) => ({ id: x.id, date: x.date, cycle: x.cycle, week: x.week, day: x.day, setNo: x.setNo, weight: x.weight, reps: x.reps, rir: x.rir, drop: x.drop, pain: x.pain, technique: x.technique, note: x.note, createdAt: x.createdAt, sessionId: x.sessionId, slotId: x.slotId });
const live = (store) => [...store.state.sets.values()].filter((x) => !x.deleted);
const liveSessions = (st) => [...st.sessions.values()].filter((s) => !s.deleted);
const seriesOf = (st) => buildExposures(liveSessions(st), st.sets.values());
const indexOf = (st) => exerciseIndex({ program: st.program, series: seriesOf(st), sessions: liveSessions(st), aliases: SAME_EXERCISE });
const day = (st, n) => st.program.days.find((d) => d.day === n);
const slotOf = (st, id) => st.program.days.flatMap((d) => d.slots).find((s) => s.id === id);
function sheetRows(gas, name) {
  const [head, ...rows] = gas.sheet(name).rows();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

test('as recorded: one machine in two series; the card names exactly the 20.10 sets; search does not merge anything by itself', async () => {
  const { phone } = await today();
  const st = phone.store.state;
  const series = seriesOf(st);
  assert.deepEqual(series.get(PRESS.key).map((e) => [e.date, e.day]), [['2026-10-16', 1], ['2026-10-25', 1], ['2026-10-29', 3]]);
  assert.deepEqual(series.get(CRUNCH.key).map((e) => e.date), ['2026-10-20']);
  const plan = pendingFix(st, FIX);
  assert.deepEqual(plan.moves.map((m) => [m.sessionId, m.slotId, m.item.name, m.sets.map((x) => `${x.id}:${x.weight}×${x.reps}@${x.rir}`).join(' ')]), [
    [SID_1020, 'D3-07', CRUNCH.name, `${SET_IDS_1020[0]}:30×10@4 ${SET_IDS_1020[1]}:32.5×10@3 ${SET_IDS_1020[2]}:32.5×10@2`],
  ]);
  assert.equal(plan.skipped.length, 0);
  assert.ok(plan.program);
  assert.deepEqual(pendingFixes(st).map((x) => x.fix.id), [FIX.id, STEPS.id]);
  // Until the owner confirms, «Скручивания в тренажере» is its own exercise in search.
  const index = indexOf(st);
  assert.equal(findExact(index, 'Скручивания в тренажере').key, CRUNCH.key);
  const found = searchExercises(index, 'скручивания');
  assert.deepEqual(found.slice(0, 2).map((e) => e.key).sort(), [CRUNCH.key, PRAYER.key].sort());
  // The press is only suggested lower, as a synonym (abs), never joined with them.
  assert.ok(found.findIndex((e) => e.key === PRESS.key) >= 2);
});

test('apply: the three sets join the press series; every fact, id and the other sets stay; day 3 gets the press as main, the prayer crunch as alternative', async () => {
  const { phone } = await today();
  const before = new Map(live(phone.store).map((x) => [x.id, x]));
  const programBefore = structuredClone(phone.store.state.program);
  const res = await applyFix(phone.store, FIX);
  assert.deepEqual([res.sets, res.program], [3, true]);
  const after = live(phone.store);
  assert.equal(after.length, before.size, 'nothing added or removed');
  for (const x of after) {
    const b = before.get(x.id);
    assert.deepEqual(FACTS(x), FACTS(b));
    if (SET_IDS_1020.includes(x.id)) {
      assert.deepEqual([x.seriesKey, x.exercise], [PRESS.key, PRESS.name]);
      assert.ok(x.updatedAt > b.updatedAt);
    } else assert.deepEqual(x, b);
  }
  const s = phone.store.state.sessions.get(SID_1020);
  const item = s.items.find((i) => i.slotId === 'D3-07');
  assert.deepEqual([item.seriesKey, item.name], [PRESS.key, PRESS.name]);
  assert.equal(s.status, 'done');
  const st = phone.store.state;
  assert.deepEqual(slotOf(st, 'D3-07').options, [PRESS, PRAYER]);
  // Only that slot changed.
  assert.deepEqual(st.program.days.filter((d) => d.day !== 3), programBefore.days.filter((d) => d.day !== 3));
  assert.deepEqual(day(st, 3).slots.filter((x) => x.id !== 'D3-07'), programBefore.days[2].slots.filter((x) => x.id !== 'D3-07'));
  const was = programBefore.days[2].slots.find((x) => x.id === 'D3-07');
  assert.deepEqual([slotOf(st, 'D3-07').category, slotOf(st, 'D3-07').step, slotOf(st, 'D3-07').note], [was.category, was.step, was.note]);
  // A backup of exactly what changed, and the program as it was.
  const backup = st.kv.corrections.at(-1);
  assert.deepEqual([backup.reason, backup.from.key, backup.to.key, backup.sets.map((x) => x.id)], [FIX.id, CRUNCH.key, PRESS.key, SET_IDS_1020]);
  assert.deepEqual(st.kv.fixes[FIX.id].programBefore.days, programBefore.days);
  assert.equal(pendingFix(st, FIX), null);
  assert.equal(await applyFix(phone.store, FIX), null, 'applying again changes nothing');
});

test('after the fix: one press history on day 1 and day 3 — «Прошлый раз», the same-week recommendation, records and search', async () => {
  const { phone } = await today();
  await applyFix(phone.store, FIX);
  const st = phone.store.state;
  const series = seriesOf(st);
  assert.equal(series.get(CRUNCH.key), undefined);
  const list = series.get(PRESS.key);
  assert.deepEqual(list.map((e) => [e.date, e.day, e.week]), [['2026-10-16', 1, 2], ['2026-10-20', 3, 2], ['2026-10-25', 1, 3], ['2026-10-29', 3, 3]]);
  // New workouts on either day open the press with the whole history.
  for (const d of [1, 3]) {
    const item = itemsForDay(st.program, d).find((i) => i.slotId === `D${d}-07`);
    assert.equal(item.seriesKey, PRESS.key, `day ${d}`);
    const p = previousExposures(list, { week: 2, sessionId: 'next', date: '2026-11-15' });
    assert.deepEqual([p.latest.date, p.samePhase.date], ['2026-10-29', '2026-10-20']);
  }
  // Week 2 of the next cycle: the same-week reference is 20.10 (it was 16.10 while split).
  const session = { id: 'next', date: '2026-11-15', week: 2, startedAt: Date.parse('2026-11-15T12:00:00Z') };
  const rec = recommend({ list, session, target: targetFor({ category: 'iso' }, 2), category: 'iso', step: 2.5 });
  assert.equal(rec.ref.date, '2026-10-20');
  assert.equal(rec.basis, 'same');
  // Records: one book with every press workout.
  const categories = new Map(allOptions(st.program).map((o) => [o.key, o.slot.category]));
  const books = buildRecordBook(performances({ sessions: liveSessions(st), sets: st.sets.values(), categories }).list);
  assert.equal(books.has(CRUNCH.key), false);
  assert.deepEqual(new Set(books.get(PRESS.key).perfs.map((x) => x.date)), new Set(['2026-10-16', '2026-10-20', '2026-10-25', '2026-10-29']));
  // Search: the old name finds the press and is not offered as a new exercise; the prayer crunch stays separate.
  const index = indexOf(st);
  assert.equal(index.some((e) => e.key === CRUNCH.key), false);
  assert.equal(findExact(index, 'Скручивания в тренажере').key, PRESS.key);
  const found = searchExercises(index, 'Скручивания в тренажере');
  assert.deepEqual([found[0].key, found[0].matched], [PRESS.key, CRUNCH.name]);
  assert.equal(searchExercises(index, 'молитва')[0].key, PRAYER.key);
  const press = index.find((e) => e.key === PRESS.key);
  assert.deepEqual([press.count, press.last.date, press.where.map((w) => [w.day, w.main])], [4, '2026-10-29', [[1, true], [3, true]]]);
});

test('«Отменить» puts the sets, the 20.10 item and the program back; the card is offered again', async () => {
  const { phone } = await today();
  const before = live(phone.store).map((x) => `${x.id}:${x.seriesKey}:${x.exercise}`).sort();
  const programBefore = structuredClone(phone.store.state.program.days);
  await applyFix(phone.store, FIX);
  assert.equal(await revertFix(phone.store, FIX), true);
  const st = phone.store.state;
  assert.deepEqual(live(phone.store).map((x) => `${x.id}:${x.seriesKey}:${x.exercise}`).sort(), before);
  assert.equal(st.sessions.get(SID_1020).items.find((i) => i.slotId === 'D3-07').seriesKey, CRUNCH.key);
  assert.deepEqual(st.program.days, programBefore);
  assert.ok(pendingFix(st, FIX), 'offered again');
});

test('the sheet: rows updated in place, nothing added; a second phone gets it and a new one offers nothing', async () => {
  const { gas, token, net, phone } = await today();
  const rowsBefore = sheetRows(gas, 'App_Sets');
  const tablet = await device(token, net);
  await tablet.sync.syncNow();
  assert.ok(pendingFix(tablet.store.state, FIX));
  await applyFix(phone.store, FIX);
  await phone.sync.syncNow();
  const rows = sheetRows(gas, 'App_Sets');
  assert.equal(rows.length, rowsBefore.length);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  for (const r of rows) {
    const b = rowsBefore.find((x) => x.id === r.id);
    for (const col of ['date', 'set_no', 'weight_kg', 'reps', 'rir', 'note', 'session_id', 'slot_id', 'created_at']) assert.equal(String(r[col]), String(b[col]));
    assert.equal(r.series_key, SET_IDS_1020.includes(r.id) ? PRESS.key : b.series_key);
  }
  const d37 = sheetRows(gas, 'App_Program').find((r) => r.slot_id === 'D3-07');
  assert.deepEqual([d37.exercise, d37.alternatives, d37.keys], [PRESS.name, PRAYER.name, `${PRESS.key} / ${PRAYER.key}`]);
  await tablet.sync.syncNow();
  assert.equal(pendingFix(tablet.store.state, FIX), null);
  const fresh = await device(token, net);
  await fresh.sync.syncNow();
  assert.equal(pendingFix(fresh.store.state, FIX), null);
  assert.equal(live(fresh.store).filter((x) => x.seriesKey === PRESS.key).length, 12);
});

test('steps: lateral raise 1 kg and concentration curl 2 kg; no set and no other exercise changes; undo; a slot set by hand is left alone', async () => {
  const { gas, token, net, phone } = await today();
  const before = structuredClone(phone.store.state.program);
  const setsBefore = live(phone.store).map((x) => JSON.stringify(x)).sort();
  const plan = pendingFix(phone.store.state, STEPS);
  assert.deepEqual([plan.moves.length, !!plan.program], [0, true]);
  const res = await applyFix(phone.store, STEPS);
  assert.deepEqual([res.sets, res.program], [0, true]);
  const st = phone.store.state;
  const steps = (p) => p.days.flatMap((d) => d.slots.map((s) => `${s.id}:${s.step}`));
  assert.deepEqual(steps(st.program), steps(before).map((x) => (x === 'D2-04:2.5' ? 'D2-04:1' : x === 'D3-02:2.5' ? 'D3-02:2' : x)));
  assert.equal(slotOf(st, 'D4-06').step, 2.5, 'rear-delt dumbbells are not changed without a check');
  assert.deepEqual(live(phone.store).map((x) => JSON.stringify(x)).sort(), setsBefore);
  assert.equal(pendingFix(st, STEPS), null);
  // New workouts take the step; the composer and the recommendation use the item's step.
  assert.equal(itemsForDay(st.program, 2).find((i) => i.slotId === 'D2-04').step, 1);
  assert.equal(itemsForDay(st.program, 3).find((i) => i.slotId === 'D3-02').step, 2);
  await phone.sync.syncNow();
  const rows = sheetRows(gas, 'App_Program');
  assert.deepEqual(['D2-04', 'D3-02', 'D4-06'].map((id) => String(rows.find((r) => r.slot_id === id).step)), ['1', '2', '2.5']);
  const fresh = await device(token, net);
  await fresh.sync.syncNow();
  assert.equal(pendingFix(fresh.store.state, STEPS), null, 'a device that gets the new program offers nothing');

  assert.equal(await revertFix(phone.store, STEPS), true);
  assert.deepEqual(steps(phone.store.state.program), steps(before));
  assert.ok(pendingFix(phone.store.state, STEPS), 'offered again after undo');

  // The owner already set the lateral raise to 2 kg by hand: only the curl is offered.
  const p = programNow();
  p.days[1].slots.find((s) => s.id === 'D2-04').step = 2;
  const other = await today(p);
  await applyFix(other.phone.store, STEPS);
  assert.deepEqual(['D2-04', 'D3-02'].map((id) => slotOf(other.phone.store.state, id).step), [2, 2]);
});
