// v1.3: the upright row in Smith had two series — 18.10 (day 2) under «…в Смите», 22.10 (day 4)
// under the barbell key the v1.0.1 correction left on day 4. The owner confirms it is one exercise;
// the correction moves exactly the 22.10 sets (and day 4 workouts started from the old program),
// keeps every fact of every set, and from then on history, «Прошлый раз», progress and records see
// both days as one variant. Ids and keys as recorded, values synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas } from '../helpers/fake-gas.js';
import { createStore } from '../../app/js/data/store.js';
import { memoryAdapter } from '../../app/js/data/db.js';
import { createSync, SyncError } from '../../app/js/data/sync.js';
import { FIX_2026_10_22 as FIX, FIX_2026_10_18, pendingFix, pendingFixes, applyFix, revertFix } from '../../app/js/data/fixes.js';
import { buildExposures, previousExposures, seriesComparisons } from '../../app/js/lib/plateau.js';
import { performances, buildRecordBook } from '../../app/js/lib/records.js';
import { allOptions } from '../../app/js/lib/program.js';
import { itemsForDay } from '../../app/js/lib/planner.js';
import { programBefore1022, workout1018Fixed, workout1022, day4Workout, SID_1022, SMITH, BARBELL, SET_IDS_1022 } from '../helpers/workout-2026-10-22.js';

let clock = 1_792_800_000_000; // after 22.10
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

// The iPhone today: the program after v1.0.1, 18.10 corrected, 22.10 as recorded; all in the sheet.
async function today({ extra = [] } = {}) {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const phone = await device(token, net);
  const w18 = workout1018Fixed();
  const w22 = workout1022();
  await phone.store.applyRemote({ program: programBefore1022(), sessions: [w18.session, w22.session, ...extra.map((w) => w.session)], sets: [...w18.sets, ...w22.sets, ...extra.flatMap((w) => w.sets)] }, { queue: true });
  await phone.sync.syncNow();
  assert.equal(phone.store.state.outbox.size, 0);
  return { gas, token, net, phone };
}

const FACTS = (x) => ({ id: x.id, date: x.date, cycle: x.cycle, week: x.week, day: x.day, setNo: x.setNo, weight: x.weight, reps: x.reps, rir: x.rir, drop: x.drop, pain: x.pain, technique: x.technique, note: x.note, createdAt: x.createdAt, sessionId: x.sessionId, slotId: x.slotId });
const live = (store) => [...store.state.sets.values()].filter((x) => !x.deleted);
const seriesOf = (st) => buildExposures([...st.sessions.values()].filter((s) => !s.deleted), st.sets.values());
const day4 = (x) => (x.program || x).days.find((d) => d.day === 4);
function sheetRows(gas, name) {
  const [head, ...rows] = gas.sheet(name).rows();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

test('as recorded: one exercise in two series — 18.10 under «в Смите», 22.10 under the barbell; the card names exactly the 22.10 sets', async () => {
  const { phone } = await today();
  const st = phone.store.state;
  const series = seriesOf(st);
  assert.deepEqual(series.get(SMITH.key).map((e) => e.date), ['2026-10-18']);
  assert.deepEqual(series.get(BARBELL.key).map((e) => e.date), ['2026-10-22']);
  // The bug as the owner saw it: on 22.10 «Прошлый раз» did not show 18.10.
  const item = st.sessions.get(SID_1022).items.find((i) => i.slotId === 'D4-05');
  assert.equal(item.seriesKey, BARBELL.key);
  assert.equal(previousExposures(series.get(item.seriesKey), { week: 2, sessionId: SID_1022, date: '2026-10-22' }).latest, null);

  const plan = pendingFix(st, FIX);
  assert.ok(plan);
  assert.deepEqual(plan.moves.map((m) => [m.sessionId, m.slotId, m.item.name, m.sets.map((x) => `${x.id}:${x.weight}×${x.reps}@${x.rir}`).join(' ')]), [
    [SID_1022, 'D4-05', BARBELL.name, `${SET_IDS_1022[0]}:40×10@3 ${SET_IDS_1022[1]}:45×10@2 ${SET_IDS_1022[2]}:45×9@1`],
  ]);
  assert.equal(plan.skipped.length, 0);
  assert.ok(plan.program);
  // The 18.10 correction is done: only this one is offered.
  assert.deepEqual(pendingFixes(st).map((x) => x.fix.id), [FIX.id]);
});

test('apply: the three sets join the Smith series; every fact, id and the other sets stay; day 4 gets Smith as main, barbell as alternative', async () => {
  const { phone } = await today();
  const before = new Map(live(phone.store).map((x) => [x.id, x]));
  const programBefore = structuredClone(phone.store.state.program);
  const res = await applyFix(phone.store, FIX);
  assert.equal(res.sets, 3);
  assert.equal(res.program, true);
  const after = live(phone.store);
  assert.equal(after.length, before.size, 'nothing added or removed');
  for (const x of after) {
    const b = before.get(x.id);
    assert.deepEqual(FACTS(x), FACTS(b));
    if (SET_IDS_1022.includes(x.id)) {
      assert.equal(x.seriesKey, SMITH.key);
      assert.equal(x.exercise, SMITH.name);
      assert.ok(x.updatedAt > b.updatedAt);
    } else assert.deepEqual(x, b);
  }
  const item = phone.store.state.sessions.get(SID_1022).items.find((i) => i.slotId === 'D4-05');
  assert.deepEqual([item.seriesKey, item.name], [SMITH.key, SMITH.name]);
  const slot = day4(phone.store.state).slots.find((s) => s.id === 'D4-05');
  assert.deepEqual(slot.options.map((o) => o.key), [SMITH.key, BARBELL.key]);
  // Only that slot changed: day 2, the other slots, ids, notes and categories as they were.
  const p = phone.store.state.program;
  assert.deepEqual(p.days.filter((d) => d.day !== 4), programBefore.days.filter((d) => d.day !== 4));
  assert.deepEqual(day4(p).slots.filter((s) => s.id !== 'D4-05'), day4(programBefore).slots.filter((s) => s.id !== 'D4-05'));
  assert.deepEqual([slot.category, slot.note, slot.step], [day4(programBefore).slots[4].category, day4(programBefore).slots[4].note, day4(programBefore).slots[4].step]);
  // A backup of exactly what changed.
  const backup = phone.store.state.kv.corrections.at(-1);
  assert.deepEqual([backup.reason, backup.from.key, backup.to.key, backup.sets.map((x) => x.id)], [FIX.id, BARBELL.key, SMITH.key, SET_IDS_1022]);
  assert.ok(phone.store.state.kv.fixes[FIX.id].programBefore);
  assert.equal(pendingFix(phone.store.state, FIX), null);
  assert.equal(await applyFix(phone.store, FIX), null, 'applying again changes nothing');
});

test('after the fix: one series across days — history, «Прошлый раз», the same-week comparison and records see 18.10 and 22.10', async () => {
  const { phone } = await today();
  await applyFix(phone.store, FIX);
  const st = phone.store.state;
  const series = seriesOf(st);
  assert.equal(series.get(BARBELL.key), undefined);
  const list = series.get(SMITH.key);
  assert.deepEqual(list.map((e) => [e.date, e.day, e.week]), [['2026-10-18', 2, 2], ['2026-10-22', 4, 2]]);
  // Same variant on another program day = the same series: 22.10 is compared with 18.10 (both week 2).
  const cmp = seriesComparisons(list)[1];
  assert.equal(cmp.cmp.prev.date, '2026-10-18');
  // A new day 4 workout takes Smith from the program, and «Прошлый раз» is 22.10, then 18.10.
  const item = itemsForDay(st.program, 4).find((i) => i.slotId === 'D4-05');
  assert.equal(item.seriesKey, SMITH.key);
  const p = previousExposures(list, { week: 2, sessionId: 'next', date: '2026-11-12' });
  assert.equal(p.samePhase.date, '2026-10-22');
  const p2 = previousExposures(list, { week: 2, sessionId: SID_1022, date: '2026-10-22', startedAt: st.sessions.get(SID_1022).startedAt });
  assert.equal(p2.latest.date, '2026-10-18');
  // Records: one book with every set of both days; none left on the barbell.
  const categories = new Map(allOptions(st.program).map((o) => [o.key, o.slot.category]));
  const books = buildRecordBook(performances({ sessions: [...st.sessions.values()], sets: st.sets.values(), categories }).list);
  assert.equal(books.has(BARBELL.key), false);
  assert.deepEqual(new Set(books.get(SMITH.key).perfs.map((x) => x.date)), new Set(['2026-10-18', '2026-10-22']));
});

test('a day 4 workout started from the old program before the update is offered with it; one done with the barbell on purpose later is not', async () => {
  const old = day4Workout(programBefore1022(), { id: 'ss-1105', date: '2026-11-05', week: 3, row: [[47.5, 8, 1], [47.5, 7, 0]] });
  const { phone } = await today({ extra: [old] });
  const plan = pendingFix(phone.store.state, FIX);
  assert.deepEqual(plan.moves.map((m) => [m.date, m.sets.length, !!m.later]), [['2026-10-22', 3, false], ['2026-11-05', 2, true]]);
  const res = await applyFix(phone.store, FIX);
  assert.equal(res.sets, 5);
  assert.deepEqual(seriesOf(phone.store.state).get(SMITH.key).map((e) => e.date), ['2026-10-18', '2026-10-22', '2026-11-05']);

  // After the fix the owner picks the barbell as the alternative for a workout: that is a choice, not the mix-up.
  const s = await phone.store.startSession({ cycle: 2, week: 1, day: 4, date: '2026-11-12' });
  await phone.store.reassignVariant(s.id, 'D4-05', BARBELL);
  await phone.store.logSet(s.id, 'D4-05', { weight: 40, reps: 12 });
  const item = phone.store.state.sessions.get(s.id).items.find((i) => i.slotId === 'D4-05');
  assert.deepEqual([item.seriesKey, item.options[0].key], [BARBELL.key, SMITH.key]);
  assert.equal(pendingFix(phone.store.state, FIX), null);

  // Undo right after applying puts both earlier workouts back as recorded.
  const { phone: p2 } = await today({ extra: [day4Workout(programBefore1022(), { id: 'ss-1105', date: '2026-11-05', week: 3, row: [[47.5, 8, 1]] })] });
  const before = live(p2.store).map((x) => `${x.id}:${x.seriesKey}`).sort();
  await applyFix(p2.store, FIX);
  assert.equal(await revertFix(p2.store, FIX), true);
  assert.deepEqual(live(p2.store).map((x) => `${x.id}:${x.seriesKey}`).sort(), before);
  assert.equal(p2.store.state.sessions.get('ss-1105').items.find((i) => i.slotId === 'D4-05').seriesKey, BARBELL.key);
  assert.deepEqual(day4(p2.store.state).slots.find((s) => s.id === 'D4-05').options.map((o) => o.key), [BARBELL.key]);
  assert.ok(pendingFix(p2.store.state, FIX), 'offered again');
});

test('the sheet: rows updated in place, nothing added; a second phone and a new one get it and offer nothing', async () => {
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
    for (const col of ['date', 'set_no', 'weight_kg', 'reps', 'rir', 'session_id', 'slot_id', 'created_at']) assert.equal(String(r[col]), String(b[col]));
    assert.equal(r.series_key, SET_IDS_1022.includes(r.id) ? SMITH.key : b.series_key);
  }
  assert.equal(sheetRows(gas, 'App_Program').find((r) => r.slot_id === 'D4-05').keys, `${SMITH.key} / ${BARBELL.key}`);
  await tablet.sync.syncNow();
  assert.equal(pendingFix(tablet.store.state, FIX), null);
  const fresh = await device(token, net);
  await fresh.sync.syncNow();
  assert.equal(pendingFix(fresh.store.state, FIX), null);
  assert.equal(live(fresh.store).filter((x) => x.seriesKey === SMITH.key).length, 6);
});

test('offline in the gym, then sync; both phones applying before a sync give one result', async () => {
  const { gas, token, net, phone } = await today();
  const other = await device(token, net);
  await other.sync.syncNow();
  net.online = false;
  await applyFix(phone.store, FIX);
  await applyFix(other.store, FIX);
  const restarted = await device(token, net, phone.adapter);
  assert.equal(pendingFix(restarted.store.state, FIX), null, 'kept after a restart');
  net.online = true;
  await restarted.sync.syncNow();
  await other.sync.syncNow();
  await restarted.sync.syncNow();
  const rows = sheetRows(gas, 'App_Sets');
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.deepEqual(live(restarted.store).map((x) => `${x.id}:${x.seriesKey}`).sort(), live(other.store).map((x) => `${x.id}:${x.seriesKey}`).sort());
  assert.deepEqual(restarted.store.state.program.days, other.store.state.program.days);
});

test('the 18.10 correction is not offered again by this one, and this one does not touch the other day 2 variants', async () => {
  const { phone } = await today();
  assert.equal(pendingFix(phone.store.state, FIX_2026_10_18), null);
  await applyFix(phone.store, FIX);
  assert.equal(pendingFix(phone.store.state, FIX_2026_10_18), null);
  const d2 = phone.store.state.program.days.find((d) => d.day === 2).slots.map((s) => s.options.map((o) => o.key).join('/'));
  assert.ok(d2.includes(`${SMITH.key}/podem-ez-grifa-pered-soboy`));
});
