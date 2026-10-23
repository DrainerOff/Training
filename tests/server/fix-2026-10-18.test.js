// The v1.0.1 correction of the owner's 18.10.2026 workout, on its rows as the sheet stored them
// (ids and keys as recorded, values synthetic — tests/fixtures/synthetic): what changes, what never changes, the sheet, other devices, offline,
// both phones applying it, the records and the way back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas } from '../helpers/fake-gas.js';
import { session1018, sets1018, programDay2Before1018 } from '../helpers/workout-2026-10-18.js';
import { createStore } from '../../app/js/data/store.js';
import { memoryAdapter } from '../../app/js/data/db.js';
import { createSync, SyncError } from '../../app/js/data/sync.js';
import { programFromSnapshot } from '../helpers/legacy-import.js';
import { FIX_2026_10_18 as FIX, pendingFix, applyFix, revertFix } from '../../app/js/data/fixes.js';
import { performances, buildRecordBook } from '../../app/js/lib/records.js';
import { buildExposures } from '../../app/js/lib/plateau.js';
import { allOptions } from '../../app/js/lib/program.js';

let clock = 1_792_400_000_000; // after the workout
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

// The iPhone as it is today: the real program, the 18.10 workout, everything in the sheet.
async function today() {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const phone = await device(token, net);
  await phone.store.saveProgram(programFromSnapshot().program);
  await phone.store.applyRemote({ sessions: [session1018()], sets: sets1018() }, { queue: true });
  await phone.sync.syncNow();
  assert.equal(phone.store.state.outbox.size, 0);
  return { gas, token, net, phone };
}

const SET_FACTS = (x) => ({ id: x.id, date: x.date, cycle: x.cycle, week: x.week, day: x.day, setNo: x.setNo, weight: x.weight, reps: x.reps, rir: x.rir, drop: x.drop, pain: x.pain, technique: x.technique, note: x.note, createdAt: x.createdAt, sessionId: x.sessionId, slotId: x.slotId });
const liveSets = (store) => [...store.state.sets.values()].filter((x) => !x.deleted && x.sessionId === FIX.sessionId);
const MOVED = new Map(FIX.moves.flatMap((m) => m.setIds.map((id) => [id, m])));

function sheetRows(gas, name) {
  const [head, ...rows] = gas.sheet(name).rows();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

test('the app program is the one in the sheet: day 2 slots, keys and names match App_Program', () => {
  const day2 = programFromSnapshot().program.days.find((d) => d.day === 2);
  assert.deepEqual(
    day2.slots.map((s) => ({ slotId: s.id, keys: s.options.map((o) => o.key), names: s.options.map((o) => o.name) })),
    programDay2Before1018(),
  );
});

test('found exactly: one workout, three exercises, the nine recorded sets — nothing guessed by name', async () => {
  const { phone } = await today();
  const plan = pendingFix(phone.store.state);
  assert.ok(plan);
  assert.deepEqual(plan.moves.map((m) => [m.slotId, m.item.name, m.sets.map((x) => `${x.weight}×${x.reps}@${x.rir}`).join(' ')]), [
    ['D2-03', 'Гиперэкстензия с весом', '40×10@4 45×10@3 50×10@2'],
    ['D2-05', 'Кроссовер на заднюю дельту', '25×9@1 25×9@0 25×8@0'],
    ['D2-06', 'Подъем EZ-грифа перед собой', '45×10@3 50×10@2 50×9@1'],
  ]);
  assert.equal(plan.skipped.length, 0);
  // A set that is not the recorded one (here: one more set added since) → that exercise is not offered.
  const s = phone.store.state.sessions.get(FIX.sessionId);
  await phone.store.logSet(s.id, 'D2-05', { weight: 32.5, reps: 8 });
  const again = pendingFix(phone.store.state);
  assert.deepEqual(again.moves.map((m) => m.slotId), ['D2-03', 'D2-06']);
  assert.deepEqual(again.skipped.map((m) => m.slotId), ['D2-05']);
});

test('apply: series and names change; weights, reps, RIR, dates, order and ids stay; backup kept', async () => {
  const { phone } = await today();
  const before = new Map(liveSets(phone.store).map((x) => [x.id, x]));
  const res = await applyFix(phone.store);
  assert.equal(res.sets, 9);
  assert.equal(res.program, true);

  const after = liveSets(phone.store);
  assert.equal(after.length, 22, 'no set added or removed');
  for (const x of after) {
    const b = before.get(x.id);
    assert.deepEqual(SET_FACTS(x), SET_FACTS(b), 'facts of every set unchanged');
    const m = MOVED.get(x.id);
    if (m) {
      assert.equal(x.seriesKey, m.to.key);
      assert.equal(x.exercise, m.to.name);
      assert.ok(x.updatedAt > b.updatedAt, 'newer version, so every device takes it');
    } else {
      assert.deepEqual(x, b, 'the other 13 sets are not touched at all');
    }
  }
  const items = phone.store.state.sessions.get(FIX.sessionId).items;
  assert.deepEqual(items.map((i) => i.name), [
    'Подтягивания обратным хватом', 'Маятниковый присед', 'Гиперэкстензия в тренажере', 'Разведения гантелей в стороны',
    'Обратная бабочка двумя руками', 'Тяга штанги к подбородку в Смите', 'Икры в жиме ногами',
  ]);

  const day2 = phone.store.state.program.days.find((d) => d.day === 2);
  assert.deepEqual(day2.slots.map((s) => s.options.map((o) => o.name).join(' / ')), [
    'Подтягивания обратным хватом',
    'Маятниковый присед',
    'Гиперэкстензия в тренажере / Гиперэкстензия с весом',
    'Разведения гантелей в стороны',
    'Кроссовер на заднюю дельту / Обратная бабочка двумя руками / Обратная бабочка одной рукой',
    'Тяга штанги к подбородку в Смите / Подъем EZ-грифа перед собой',
    'Икры в жиме ногами',
  ]);
  // Every variant has its own series key; old variants keep theirs (their history stays theirs).
  for (const s of day2.slots) assert.equal(new Set(s.options.map((o) => o.key)).size, s.options.length);
  assert.deepEqual(day2.slots[2].options.map((o) => o.key), ['giperekstenziya-v-trenazhere', 'giperekstenziya-s-vesom']);
  assert.deepEqual(day2.slots[4].options.map((o) => o.key), ['krossover-na-zadnyuyu-deltu', 'obratnaya-babochka-dvumya-rukami', 'obratnaya-babochka-odnoy-rukoy']);
  assert.deepEqual(day2.slots[5].options.map((o) => o.key), ['tyaga-shtangi-k-podborodku-v-smite', 'podem-ez-grifa-pered-soboy']);
  // Other days, slot ids, notes and categories are as they were.
  const orig = programFromSnapshot().program;
  assert.deepEqual(phone.store.state.program.days.filter((d) => d.day !== 2), orig.days.filter((d) => d.day !== 2));
  assert.deepEqual(day2.slots.map((s) => [s.id, s.category, s.note]), orig.days[1].slots.map((s) => [s.id, s.category, s.note]));

  // Backup of exactly what changed, on the phone.
  const backups = phone.store.state.kv.corrections;
  assert.equal(backups.length, 3);
  assert.deepEqual(backups.map((b) => [b.from.key, b.to.key, b.sets.map((x) => `${x.id}:${x.seriesKey}:${x.weight}x${x.reps}`).join(',')]), FIX.moves.map((m) => [
    m.from.key, m.to.key, m.setIds.map((id) => `${id}:${m.from.key}:${before.get(id).weight}x${before.get(id).reps}`).join(','),
  ]));
  assert.ok(phone.store.state.kv.fixes[FIX.id].programBefore);

  // Applied once: not offered again, applying again changes nothing.
  assert.equal(pendingFix(phone.store.state), null);
  assert.equal(await applyFix(phone.store), null);
});

test('the sheet: the same rows are updated in place, nothing added; other devices take it; no duplicates', async () => {
  const { gas, token, net, phone } = await today();
  const rowsBefore = sheetRows(gas, 'App_Sets');
  // A second device that already had the workout (and stays offline for now).
  const tablet = await device(token, net);
  await tablet.sync.syncNow();
  assert.equal(liveSets(tablet.store).length, 22);

  await applyFix(phone.store);
  await phone.sync.syncNow();
  assert.equal(phone.store.state.outbox.size, 0);

  const rows = sheetRows(gas, 'App_Sets');
  assert.equal(rows.length, rowsBefore.length, 'no row added');
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'ids unique');
  for (const r of rows) {
    const b = rowsBefore.find((x) => x.id === r.id);
    const m = MOVED.get(r.id);
    for (const col of ['date', 'set_no', 'weight_kg', 'reps', 'rir', 'session_id', 'slot_id', 'created_at']) assert.equal(String(r[col]), String(b[col]), `${r.id} ${col}`);
    assert.equal(r.series_key, m ? m.to.key : b.series_key);
    assert.equal(r.exercise, m ? m.to.name : b.exercise);
  }
  assert.equal(sheetRows(gas, 'App_Sessions').filter((r) => r.id === FIX.sessionId).length, 1);
  const prog = sheetRows(gas, 'App_Program').filter((r) => String(r.day) === '2');
  assert.deepEqual(prog.map((r) => [r.slot_id, r.exercise, r.alternatives, r.keys]).slice(2, 6), [
    ['D2-03', 'Гиперэкстензия в тренажере', 'Гиперэкстензия с весом', 'giperekstenziya-v-trenazhere / giperekstenziya-s-vesom'],
    ['D2-04', 'Разведения гантелей в стороны', '', 'razvedeniya-ganteley-v-storony'],
    ['D2-05', 'Кроссовер на заднюю дельту', 'Обратная бабочка двумя руками / Обратная бабочка одной рукой', 'krossover-na-zadnyuyu-deltu / obratnaya-babochka-dvumya-rukami / obratnaya-babochka-odnoy-rukoy'],
    ['D2-06', 'Тяга штанги к подбородку в Смите', 'Подъем EZ-грифа перед собой', 'tyaga-shtangi-k-podborodku-v-smite / podem-ez-grifa-pered-soboy'],
  ]);

  // The tablet syncs: it gets the corrected sets and program, offers nothing, adds nothing.
  await tablet.sync.syncNow();
  assert.deepEqual(liveSets(tablet.store).map((x) => `${x.id}:${x.seriesKey}`).sort(), liveSets(phone.store).map((x) => `${x.id}:${x.seriesKey}`).sort());
  assert.deepEqual(tablet.store.state.program.days, phone.store.state.program.days);
  assert.equal(pendingFix(tablet.store.state), null);
  assert.equal(sheetRows(gas, 'App_Sets').length, rowsBefore.length);

  // A brand-new device gets the corrected workout straight away.
  const fresh = await device(token, net);
  await fresh.sync.syncNow();
  assert.equal(pendingFix(fresh.store.state), null);
  assert.equal(liveSets(fresh.store).filter((x) => x.seriesKey === 'obratnaya-babochka-dvumya-rukami').length, 3);
});

test('offline: applied in the gym without network, kept after a restart, reaches the sheet later', async () => {
  const { gas, token, net, phone } = await today();
  net.online = false;
  await applyFix(phone.store);
  await phone.sync.syncNow();
  assert.equal(phone.sync.status.state, 'offline');
  const restarted = await device(token, net, phone.adapter);
  assert.equal(pendingFix(restarted.store.state), null, 'applied state survives a restart');
  assert.equal(liveSets(restarted.store).filter((x) => x.seriesKey === 'giperekstenziya-v-trenazhere').length, 3);
  assert.ok(restarted.store.state.outbox.size > 0);
  net.online = true;
  await restarted.sync.syncNow();
  assert.equal(restarted.store.state.outbox.size, 0);
  assert.equal(sheetRows(gas, 'App_Sets').filter((r) => r.series_key === 'giperekstenziya-v-trenazhere').length, 3);
});

test('both phones apply it before syncing: one result, no duplicates', async () => {
  const { gas, token, net, phone } = await today();
  const other = await device(token, net);
  await other.sync.syncNow();
  net.online = false;
  await applyFix(phone.store);
  await applyFix(other.store);
  net.online = true;
  await phone.sync.syncNow();
  await other.sync.syncNow();
  await phone.sync.syncNow();
  const rows = sheetRows(gas, 'App_Sets');
  assert.equal(rows.length, 22, 'the 22 sets of 18.10, nothing added');
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.deepEqual(liveSets(phone.store).map((x) => `${x.id}:${x.seriesKey}`).sort(), liveSets(other.store).map((x) => `${x.id}:${x.seriesKey}`).sort());
  assert.deepEqual(phone.store.state.program.days, other.store.state.program.days);
});

test('records and progress follow the variant: no record left on the old series, nothing mixed', async () => {
  const { phone } = await today();
  const books = (st) => {
    const categories = new Map(allOptions(st.program).map((o) => [o.key, o.slot.category]));
    const sessions = [...st.sessions.values()].filter((s) => !s.deleted);
    return buildRecordBook(performances({ sessions, sets: st.sets.values(), manual: [...st.records.values()], categories }).list);
  };
  const before = books(phone.store.state);
  assert.ok(before.has('giperekstenziya-s-vesom'));
  await applyFix(phone.store);
  const after = books(phone.store.state);
  for (const m of FIX.moves) {
    assert.ok(!after.has(m.from.key), `${m.from.key}: no records once its sets moved`);
    const b = after.get(m.to.key);
    assert.ok(b, `${m.to.key}: records from the moved sets`);
    assert.deepEqual(b.perfs.map((p) => p.setId).sort(), [...m.setIds].sort());
  }
  assert.deepEqual(after.get('giperekstenziya-v-trenazhere').table.map((r) => `${r.reps}:${r.best.weight}`), ['10:50']);
  // Untouched exercises keep exactly their records.
  for (const key of ['mayatnikovyy-prised', 'podtyagivaniya-obratnym-hvatom', 'ikry-v-zhime-nogami']) {
    assert.deepEqual(after.get(key).table, before.get(key).table);
  }
  // Progress series: each variant only its own sets.
  const st = phone.store.state;
  const series = buildExposures([...st.sessions.values()], st.sets.values(), { metricsByDate: new Map() });
  assert.equal(series.get('krossover-na-zadnyuyu-deltu'), undefined);
  assert.deepEqual(series.get('obratnaya-babochka-dvumya-rukami').flatMap((e) => e.sets.map((x) => x.weight)), [25, 25, 25]);
});

test('the way back: undo puts the sets and the program back as they were, and the fix is offered again', async () => {
  const { gas, phone } = await today();
  const setsBefore = liveSets(phone.store).map((x) => `${x.id}:${x.seriesKey}:${x.exercise}`).sort();
  const programBefore = phone.store.state.program.days;
  await applyFix(phone.store);
  await phone.sync.syncNow();
  assert.equal(await revertFix(phone.store), true);
  assert.deepEqual(liveSets(phone.store).map((x) => `${x.id}:${x.seriesKey}:${x.exercise}`).sort(), setsBefore);
  assert.deepEqual(phone.store.state.program.days, programBefore);
  assert.ok(pendingFix(phone.store.state));
  await phone.sync.syncNow();
  const rows = sheetRows(gas, 'App_Sets');
  assert.equal(rows.filter((r) => r.series_key === 'giperekstenziya-s-vesom').length, 3);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
});

test('a double tap on «Исправить» applies it once; «Отменить» then puts the program back too', async () => {
  const { phone } = await today();
  const program = JSON.stringify(phone.store.state.program.days);
  const [a, b] = await Promise.all([applyFix(phone.store), applyFix(phone.store)]);
  assert.equal(a, b, 'the second tap waits for the first');
  assert.equal(a.sets, 9);
  assert.equal(await applyFix(phone.store), null, 'nothing left to do');
  assert.equal(phone.store.state.kv.corrections.length, 3);
  await revertFix(phone.store);
  assert.equal(JSON.stringify(phone.store.state.program.days), program);
  assert.equal(liveSets(phone.store).filter((x) => FIX.moves.some((m) => x.seriesKey === m.from.key)).length, 9);
});

test('«Отменить» and «Исправить» tapped while the other is still writing run one after the other', async () => {
  const { phone } = await today();
  const recorded = liveSets(phone.store).map((x) => `${x.id}:${x.seriesKey}`).sort();
  const program = JSON.stringify(phone.store.state.program.days);
  await applyFix(phone.store);
  const undo = revertFix(phone.store);
  const again = applyFix(phone.store); // queued behind the undo, not mixed into it
  await Promise.all([undo, again]);
  assert.equal(pendingFix(phone.store.state), null);
  assert.equal(liveSets(phone.store).filter((x) => FIX.moves.some((m) => x.seriesKey === m.to.key)).length, 9);
  await revertFix(phone.store);
  assert.deepEqual(liveSets(phone.store).map((x) => `${x.id}:${x.seriesKey}`).sort(), recorded);
  assert.equal(JSON.stringify(phone.store.state.program.days), program);
});

test('edits on another device before it synced put parts back: they are offered again and finished, the edits stay', async () => {
  const { gas, token, net, phone } = await today();
  const tablet = await device(token, net);
  await tablet.sync.syncNow(); // the tablet has the workout as recorded
  await applyFix(phone.store);
  await phone.sync.syncNow();

  // The tablet, still without the fix, is used offline: a note on a moved set, a comment on another
  // exercise of 18.10 (the whole workout record), a change of day 1 in the program.
  net.online = false;
  const set = tablet.store.state.sets.get(FIX.moves[0].setIds[1]);
  await tablet.store.updateSet(set.id, { note: 'спина устала' });
  await tablet.store.updateItem(FIX.sessionId, 'D2-04', { note: 'пауза 1 с' });
  const p = structuredClone(tablet.store.state.program);
  p.days[0].slots[0].step = 1.25;
  await tablet.store.saveProgram(p);
  net.online = true;
  await tablet.sync.syncNow(); // its newer whole records win in the sheet
  await phone.sync.syncNow();

  // The phone now has parts of the fix undone — and offers exactly those.
  const plan = pendingFix(phone.store.state);
  assert.ok(plan, 'offered again');
  const byslot = Object.fromEntries(plan.moves.map((m) => [m.slotId, { item: m.item.seriesKey, sets: m.sets.map((x) => x.id) }]));
  assert.deepEqual(byslot['D2-03'], { item: FIX.moves[0].from.key, sets: [set.id] });
  assert.deepEqual(byslot['D2-05'], { item: FIX.moves[1].from.key, sets: [] });
  assert.ok(plan.program, 'day 2 variants are missing again');

  await applyFix(phone.store);
  await phone.sync.syncNow();
  await tablet.sync.syncNow();
  for (const dev of [phone, tablet]) {
    const st = dev.store.state;
    assert.equal(pendingFix(st), null);
    for (const m of FIX.moves) {
      for (const id of m.setIds) assert.equal(st.sets.get(id).seriesKey, m.to.key);
      assert.equal(st.sessions.get(FIX.sessionId).items.find((i) => i.slotId === m.slotId).seriesKey, m.to.key);
    }
    // What was done on the tablet stays.
    assert.equal(st.sets.get(set.id).note, 'спина устала');
    assert.equal(st.sessions.get(FIX.sessionId).items.find((i) => i.slotId === 'D2-04').note, 'пауза 1 с');
    assert.equal(st.program.days[0].slots[0].step, 1.25);
    assert.equal(st.program.days[1].slots[2].options[0].key, 'giperekstenziya-v-trenazhere');
  }
  const rows = sheetRows(gas, 'App_Sets');
  assert.equal(rows.length, 22);
  assert.equal(new Set(rows.map((r) => r.id)).size, 22);
});

test('a later change of day 2 by the owner is not undone: the card does not come back for it', async () => {
  const { phone } = await today();
  await applyFix(phone.store);
  const p = structuredClone(phone.store.state.program);
  p.days[1].slots[4].options = p.days[1].slots[4].options.filter((o) => o.key !== 'obratnaya-babochka-odnoy-rukoy');
  await phone.store.saveProgram(p);
  assert.equal(pendingFix(phone.store.state), null);
});
