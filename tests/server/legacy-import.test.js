// The bundled import end to end: store → outbox → real Code.gs on emulated Sheets.
// Covers idempotency (re-run, two phones, deletion) and "the owner's data wins".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas } from '../helpers/fake-gas.js';
import { createStore } from '../../app/js/data/store.js';
import { memoryAdapter } from '../../app/js/data/db.js';
import { createSync } from '../../app/js/data/sync.js';
import { applyLegacyImport, IMPORT_ID } from '../../app/js/data/legacy-import.js';
import { parseProgramText } from '../../app/js/lib/program.js';

let clock = 1_792_300_000_000;
const now = () => (clock += 11);

async function phone(gas, token) {
  const adapter = memoryAdapter();
  const store = createStore(adapter, { now });
  await store.load();
  await store.setKV({ sync: { url: 'https://example/exec', token } });
  const sync = createSync(store, { now, transport: async (url, payload) => gas.post(JSON.parse(JSON.stringify(payload))) });
  return { adapter, store, sync };
}

test('fresh install: real program and the 16.10 workout appear once, then reach the sheet', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const a = await phone(gas, token);
  const r = await applyLegacyImport(a.store);
  assert.deepEqual([r.program, r.sessions, r.sets, r.metrics, r.problems], [true, 1, 23, 1, []]);
  assert.equal(a.store.state.program.days.length, 4);
  assert.equal(a.store.setsOf('gs-s5').length, 23);
  assert.equal(await applyLegacyImport(a.store), null, 'second run is a no-op');
  assert.ok(a.store.state.kv.imports[IMPORT_ID]);

  await a.sync.syncNow();
  assert.equal(a.store.state.outbox.size, 0);
  assert.equal(gas.sheet('App_Sets').getLastRow() - 1, 23);
  assert.equal(gas.sheet('App_Sessions').getLastRow() - 1, 1);
  assert.equal(gas.sheet('App_Metrics').getLastRow() - 1, 1);
  assert.equal(gas.sheet('App_Program').getLastRow() - 1, 29);
  const summary = gas.sheet('App_Summary').rows().slice(1);
  assert.equal(summary.length, 7);
  assert.ok(summary.some((row) => row[4] === 'Жим штанги лежа: Штанга - горизонт' && row[5] === '80×7, 75×9, 75×9, 75×10'));
});

test('two phones importing and syncing still give exactly one copy in the sheet', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const a = await phone(gas, token);
  const b = await phone(gas, token);
  await applyLegacyImport(a.store);
  await applyLegacyImport(b.store);
  await a.sync.syncNow();
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.equal(gas.sheet('App_Sets').getLastRow() - 1, 23);
  assert.equal(gas.sheet('App_Sessions').getLastRow() - 1, 1);
  assert.equal(b.store.liveSessions().length, 1);
});

test('a deleted imported workout does not come back from another phone', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const a = await phone(gas, token);
  await applyLegacyImport(a.store);
  await a.sync.syncNow();
  await a.store.deleteSession('gs-s5');
  await a.sync.syncNow();
  const b = await phone(gas, token);
  await applyLegacyImport(b.store); // fresh phone imports the original version…
  await b.sync.syncNow(); // …but the newer deletion from the sheet wins
  assert.equal(b.store.liveSessions().length, 0);
  assert.equal(gas.post({ action: 'sync', token, since: 0 }).pull.sessions[0].deleted, true);
});

test("the owner's data wins: own program kept, an already entered 16.10 workout not duplicated", async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const a = await phone(gas, token);
  await a.store.saveProgram(parseProgramText('День 1\n- Подтягивания прямым хватом [pullup]').program);
  const manual = await a.store.startSession({ cycle: 1, week: 2, day: 1, date: '2026-10-16', status: 'done' });
  await a.store.saveMetric('2026-10-16', { bodyweight: 79.5 });
  const r = await applyLegacyImport(a.store);
  assert.equal(r.program, false);
  assert.equal(r.sessions, 0);
  assert.equal(r.metrics, 0);
  assert.equal(r.skipped.length, 3);
  assert.equal(a.store.state.program.days[0].slots.length, 1);
  assert.deepEqual(a.store.liveSessions().map((s) => s.id), [manual.id]);
  assert.equal(a.store.state.metrics.get('m2026-10-16').bodyweight, 79.5);
});

test('a snapshot the converter does not understand writes nothing and is retried later', async () => {
  const { SNAPSHOT } = await import('../../app/js/data/gsheets-snapshot.js');
  const broken = structuredClone(SNAPSHOT);
  broken.diary.rows[1][7] = 'Неизвестный тренажёр';
  const gas = createGas();
  const a = await phone(gas, gas.call('setup'));
  const r = await applyLegacyImport(a.store, { snapshot: broken });
  assert.ok(r.problems.length);
  assert.equal(a.store.liveSessions().length, 0);
  assert.equal(a.store.state.outbox.size, 0);
  assert.equal(a.store.state.kv.imports?.[IMPORT_ID], undefined, 'not marked as done');
  const ok = await applyLegacyImport(a.store);
  assert.equal(ok.sessions, 1, 'the correct snapshot still imports afterwards');
});

test('the program pulled from the sheet on a second phone is not overwritten by its import', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const a = await phone(gas, token);
  await applyLegacyImport(a.store);
  const edited = structuredClone(a.store.state.program);
  edited.days[0].slots[6].note = 'Настройка: сиденье 4';
  await a.store.saveProgram(edited);
  await a.sync.syncNow();
  const b = await phone(gas, token);
  await b.sync.syncNow(); // pulls the edited program first
  const r = await applyLegacyImport(b.store);
  assert.equal(r.program, false);
  assert.equal(b.store.state.program.days[0].slots[6].note, 'Настройка: сиденье 4');
});
