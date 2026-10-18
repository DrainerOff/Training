// Store guarantees added in v1.0.1: a failed write leaves nothing behind (nothing to sync), a double
// tap on the last set of an exercise records one set, a wrong variant can be corrected without
// touching what was lifted, and variant keys never repeat within a slot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../app/js/data/store.js';
import { memoryAdapter } from '../../app/js/data/db.js';
import { parseProgramText, optionsFromNames } from '../../app/js/lib/program.js';

const PROGRAM = parseProgramText(`День 1
- Подтягивания прямым хватом [pullup]
- Наклонный жим: Hammer - наклон [hammer] / Наклонный жим: Гантели - наклон
- Горизонтальная тяга блока [base]`).program;

function flakyAdapter() {
  const inner = memoryAdapter();
  const a = { fail: false, getAll: (s) => inner.getAll(s), write: (ops) => (a.fail ? Promise.reject(new Error('диск занят')) : inner.write(ops)) };
  return a;
}

async function setup(adapter = memoryAdapter(), t0 = 1_000_000) {
  let clock = t0;
  const store = createStore(adapter, { now: () => clock });
  await store.load();
  await store.saveProgram(PROGRAM);
  const s = await store.startSession({ cycle: 1, week: 2, day: 1 });
  return { store, s, tick: (ms) => (clock += ms) };
}

test('a write that fails is taken back: not shown, not queued, not sent; the error is reported', async () => {
  const adapter = flakyAdapter();
  const { store, s, tick } = await setup(adapter);
  tick(10_000);
  await store.logSet(s.id, s.items[0].slotId, { weight: 20, reps: 6 });
  const outbox = new Map(store.state.outbox);
  const sets = store.state.sets.size;
  adapter.fail = true;
  tick(10_000);
  await assert.rejects(store.logSet(s.id, s.items[0].slotId, { weight: 22.5, reps: 6 }), /диск занят/);
  assert.equal(store.state.sets.size, sets, 'the set is not left in memory');
  assert.equal(store.setsOf(s.id).length, 1);
  assert.deepEqual(new Map(store.state.outbox), outbox, 'nothing new waits to be sent');
  assert.match(store.state.storageError, /Не удалось сохранить/);
  // An edit that fails keeps the previous version, including its queue entry.
  const first = store.setsOf(s.id)[0];
  await assert.rejects(store.updateSet(first.id, { weight: 25 }));
  assert.equal(store.state.sets.get(first.id).weight, 20);
  assert.deepEqual(new Map(store.state.outbox), outbox);
  // A failed program save keeps the program that is on the phone.
  const program = store.state.program;
  await assert.rejects(store.saveProgram({ ...program, days: [] }));
  assert.equal(store.state.program, program);
  // Once the device writes again, everything works and the error goes away.
  adapter.fail = false;
  await store.logSet(s.id, s.items[0].slotId, { weight: 22.5, reps: 6 });
  assert.equal(store.setsOf(s.id).length, 2);
  assert.equal(store.state.storageError, null);
});

test('double tap on the last set: the second tap does not become the first set of the next exercise', async () => {
  const { store, s, tick } = await setup();
  const [pull, press] = s.items;
  tick(60_000);
  await store.logSet(s.id, pull.slotId, { weight: 24, reps: 6 });
  tick(300); // the next exercise opened under the finger
  const second = await store.logSet(s.id, press.slotId, { weight: 90, reps: 9 });
  assert.equal(second.duplicate, true);
  assert.equal(store.setsOf(s.id, press.slotId).length, 0);
  tick(60_000); // a real first set after the rest
  const real = await store.logSet(s.id, press.slotId, { weight: 90, reps: 9 });
  assert.equal(real.duplicate, false);
  assert.equal(store.setsOf(s.id, press.slotId).length, 1);
});

test('correcting the variant moves only the sets recorded under it; lifted numbers stay; backup kept', async () => {
  const { store, s, tick } = await setup();
  const press = s.items[1];
  tick(60_000);
  await store.logSet(s.id, press.slotId, { weight: 90, reps: 9, rir: 1 });
  tick(60_000);
  await store.logSet(s.id, press.slotId, { weight: 90, reps: 8, rir: 0 });
  // Mid-exercise swap to dumbbells: the next set belongs to that series and must stay there.
  await store.swapVariant(s.id, press.slotId, press.options[1]);
  tick(60_000);
  await store.logSet(s.id, press.slotId, { weight: 32, reps: 10 });
  await store.swapVariant(s.id, press.slotId, press.options[0]);
  const before = store.setsOf(s.id, press.slotId);

  const res = await store.reassignVariant(s.id, press.slotId, { name: 'Наклонный жим: Смит' });
  assert.equal(res.moved, 2);
  const after = store.setsOf(s.id, press.slotId);
  assert.deepEqual(after.map((x) => [x.id, x.weight, x.reps, x.rir, x.setNo, x.createdAt, x.date]), before.map((x) => [x.id, x.weight, x.reps, x.rir, x.setNo, x.createdAt, x.date]));
  assert.deepEqual(after.map((x) => x.seriesKey), ['naklonnyy-zhim-smit', 'naklonnyy-zhim-smit', 'naklonnyy-zhim-ganteli-naklon']);
  const item = store.state.sessions.get(s.id).items[1];
  assert.equal(item.name, 'Наклонный жим: Смит');
  assert.ok(item.options.some((o) => o.key === 'naklonnyy-zhim-smit'));
  const [backup] = store.state.kv.corrections;
  assert.equal(backup.from.key, 'naklonnyy-zhim-hammer-naklon');
  assert.deepEqual(backup.sets.map((x) => x.seriesKey), ['naklonnyy-zhim-hammer-naklon', 'naklonnyy-zhim-hammer-naklon']);
  // Every changed record is queued for the sheet.
  for (const x of after.slice(0, 2)) assert.ok(store.state.outbox.has(`sets:${x.id}`));
  // And back again: the same two sets return.
  await store.reassignVariant(s.id, press.slotId, { key: backup.from.key, name: backup.from.name });
  assert.deepEqual(store.setsOf(s.id, press.slotId).map((x) => x.seriesKey), before.map((x) => x.seriesKey));
});

test('program editor: a new main variant gets its own key; the old one keeps its history key', () => {
  const old = [{ key: 'giperekstenziya-s-vesom', name: 'Гиперэкстензия с весом' }];
  // Before v1.0.1 the new main name took the old key while the old name kept it too → one series.
  assert.deepEqual(optionsFromNames(['Гиперэкстензия в тренажере', 'Гиперэкстензия с весом'], old), [
    { key: 'giperekstenziya-v-trenazhere', name: 'Гиперэкстензия в тренажере' },
    { key: 'giperekstenziya-s-vesom', name: 'Гиперэкстензия с весом' },
  ]);
  // A plain rename still keeps the history.
  assert.deepEqual(optionsFromNames(['Гиперэкстензия с отягощением'], old), [{ key: 'giperekstenziya-s-vesom', name: 'Гиперэкстензия с отягощением' }]);
  // Adding alternatives keeps every existing key.
  assert.deepEqual(
    optionsFromNames(['Кроссовер на заднюю дельту', 'Обратная бабочка двумя руками', 'Обратная бабочка одной рукой'], [{ key: 'krossover-na-zadnyuyu-deltu', name: 'Кроссовер на заднюю дельту' }]).map((o) => o.key),
    ['krossover-na-zadnyuyu-deltu', 'obratnaya-babochka-dvumya-rukami', 'obratnaya-babochka-odnoy-rukoy'],
  );
  // The same name twice, or a new name whose key is taken in this slot: keys still differ.
  const twice = optionsFromNames(['Жим', 'Жим'], []);
  assert.notEqual(twice[0].key, twice[1].key);
  const taken = optionsFromNames(['Жим', 'Тяга'], [{ key: 'zhim', name: 'Тяга' }]);
  assert.deepEqual(taken.map((o) => o.key), ['zhim-2', 'zhim']);
});

test('variant settings: one record per variant, trimmed and short; the same text is not re-saved', async () => {
  const { store, tick } = await setup();
  const a = await store.saveSetup('gorizontalnaya-tyaga-bloka', 'Горизонтальная тяга блока', '  сиденье 5, ручки 3  ');
  assert.equal(a.id, 'x:gorizontalnaya-tyaga-bloka');
  assert.equal(store.setupOf('gorizontalnaya-tyaga-bloka'), 'сиденье 5, ручки 3');
  tick(1000);
  const same = await store.saveSetup('gorizontalnaya-tyaga-bloka', 'Горизонтальная тяга блока', 'сиденье 5, ручки 3');
  assert.equal(same.updatedAt, a.updatedAt);
  await store.saveSetup('gorizontalnaya-tyaga-bloka', 'Горизонтальная тяга блока', 'сиденье 6');
  assert.equal(store.state.exercises.size, 1);
  assert.equal(store.setupOf('naklonnyy-zhim-hammer-naklon'), '');
});
