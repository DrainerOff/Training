// Release v1.3.0 checks: the owner's sheet goes from the API 5 script of v1.2.0 to API 6 with its rows
// untouched (App_Exercises only gains bw_share at the end; three nutrition sheets are added); the
// v1.2.0 app (still on the phone until Pages updates) keeps syncing with API 6 and never receives
// what it does not know; the same access key and Shortcuts key keep working. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas } from '../helpers/fake-gas.js';
import { createStore } from '../../app/js/data/store.js';
import { memoryAdapter } from '../../app/js/data/db.js';
import { createSync } from '../../app/js/data/sync.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API5 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/apps-script/Code.api5.gs'), 'utf8');
const LEGACY = { Дневник: [['Дата', 'Упражнение', 'Вес'], ['16.10.2026', 'Жим', '80']], Программа: [['День', 'Упражнение'], ['1', 'Жим']] };

let clock = Date.now() - 3600000;
const now = () => (clock += 17);
const post = (gas) => async (_u, p) => gas.post(JSON.parse(JSON.stringify(p)));
const table = (gas, name) => gas.sheet(name)?.rows() ?? null;

async function v120(gas, token) {
  const old = await import('../fixtures/releases/05f067e/js/data/store.js');
  const oldDb = await import('../fixtures/releases/05f067e/js/data/db.js');
  const oldSync = await import('../fixtures/releases/05f067e/js/data/sync.js');
  const store = old.createStore(oldDb.memoryAdapter(), { now });
  await store.load();
  await store.setKV({ sync: { url: 'https://example/exec', token } });
  return { store, sync: oldSync.createSync(store, { transport: post(gas), now }) };
}
async function v130(gas, token) {
  const store = createStore(memoryAdapter(), { now });
  await store.load();
  await store.setKV({ sync: { url: 'https://example/exec', token } });
  return { store, sync: createSync(store, { transport: post(gas), now }) };
}

async function sheetOfV120() {
  const gas = createGas({ code: API5, legacy: LEGACY });
  const token = gas.call('setup');
  const key = gas.call('showIngestKey');
  const phone = await v120(gas, token);
  const s = await phone.store.startSession({ cycle: 1, week: 2, day: 1 });
  await phone.store.logSet(s.id, s.items[0].slotId, { weight: 100, reps: 8, rir: 2 });
  await phone.store.finishSession(s.id);
  await phone.store.saveMetric('2026-10-21', { recovery: 4 });
  await phone.store.saveRecord({ date: '2026-10-10', seriesKey: 'bench', exercise: 'Жим', weight: 110, reps: 1 });
  await phone.store.saveSetup(s.items[0].seriesKey, s.items[0].name, 'сиденье 4');
  await phone.store.savePhase({ mode: 'bulk', start: '2026-10-01', targetPct: 0.25 });
  await phone.sync.syncNow();
  assert.equal(phone.sync.status.state, 'idle');
  gas.post({ action: 'ingest', key, type: 'weight', lines: '80.4|2026-10-21T07:10:00+03:00|2026-10-21T07:10:00+03:00|Zepp Life' });
  gas.post({ action: 'ingest', key, type: 'sleep', lines: 'Core|2026-10-21T00:30:00+03:00|2026-10-21T07:00:00+03:00|' });
  return { gas, token, key, phone };
}

test('API 5 → API 6 on the same sheet: every cell stays, bw_share appended, three nutrition sheets added; keys keep working', async () => {
  const { gas, token, key } = await sheetOfV120();
  const names = ['Дневник', 'Программа', 'App_Sessions', 'App_Sets', 'App_Metrics', 'App_Records', 'App_Exercises', 'App_Body', 'App_Sleep', 'App_Phases', 'App_Program'];
  const before = Object.fromEntries(names.map((n) => [n, JSON.stringify(table(gas, n))]));
  for (const n of ['App_Nutrition', 'App_NutritionGoals', 'App_NutritionInbox']) assert.equal(table(gas, n), null, n);

  gas.redeploy();
  assert.equal(gas.post({ action: 'ping', token }).api, 6);
  const phone = await v130(gas, token);
  await phone.sync.syncNow();
  assert.equal(phone.sync.status.state, 'idle');
  const added = { App_Exercises: ['bw_share'] };
  for (const n of names) {
    const was = JSON.parse(before[n]);
    const cur = table(gas, n);
    const width = was[0].length;
    assert.deepEqual(cur[0].slice(width), added[n] || [], `${n}: columns added at the end only`);
    assert.equal(JSON.stringify(cur.map((r) => r.slice(0, width))), before[n], `${n} unchanged`);
  }
  assert.deepEqual(table(gas, 'App_Nutrition')[0].slice(0, 5), ['date', 'kcal', 'protein_g', 'fat_g', 'carbs_g']);
  assert.deepEqual(table(gas, 'App_NutritionGoals')[0].slice(0, 3), ['phase_id', 'from', 'kcal_min']);
  assert.deepEqual(table(gas, 'App_NutritionInbox'), [['date', 'kcal', 'protein_g', 'fat_g', 'carbs_g', 'status', 'approx', 'comment', 'written_at', 'result', 'processed_at']]);
  // The new phone got everything from the sheet.
  const st = phone.store.state;
  assert.equal([...st.sets.values()].length, 1);
  assert.equal(st.records.size, 1);
  assert.equal([...st.exercises.values()][0].setup, 'сиденье 4');
  assert.equal(st.phases.size, 1);
  assert.equal(st.body.size, 1);
  assert.equal(st.sleep.size, 1);
  // Same access key, same Shortcuts key.
  assert.equal(gas.post({ action: 'ingest', key, type: 'waist', lines: '84.5|2026-10-21T07:12:00+03:00|2026-10-21T07:12:00+03:00|Fitdays+' }).added, 1);
  // Nutrition through the new sheets: a day and goals from the phone, a row from ChatGPT.
  const phase = [...st.phases.values()][0];
  await phone.store.saveNutritionGoals({ phaseId: phase.id, from: '2026-10-01', kcalMin: 3200, kcalMax: 3500, proteinMin: 150, proteinMax: 170, fatMin: 80, fatMax: 100, carbsMode: 'rest' });
  await phone.store.saveNutrition({ date: '2026-10-21', kcal: 3300, protein: 160, fat: 90, carbs: 420, status: 'final' });
  const inbox = gas.sheet('App_NutritionInbox');
  inbox.getRange(2, 1, 1, 11).setValues([['2026-10-22', '3250', '160', '90', '420', 'итог', 'нет', '', '2026-10-23 02:10', '', '']]);
  await phone.sync.syncNow();
  assert.deepEqual(table(gas, 'App_Nutrition').slice(1).map((r) => [r[0], r[1], r[8]]).sort(), [['2026-10-21', 3300, 'manual'], ['2026-10-22', 3250, 'chatgpt']]);
  assert.equal(table(gas, 'App_NutritionInbox')[1][9], 'создан');
  assert.equal(table(gas, 'App_NutritionGoals').length, 2);
});

test('v1.2.0 and v1.3 side by side on API 6: workouts go both ways, v1.2.0 never receives nutrition and keeps the share it does not know', async () => {
  const { gas, token, phone: old } = await sheetOfV120();
  gas.redeploy();
  const neu = await v130(gas, token);
  await neu.sync.syncNow();
  const key = [...neu.store.state.exercises.values()][0].seriesKey;
  await neu.store.saveSetup(key, 'Жим', 'сиденье 4', { bwShare: 0.4 });
  await neu.store.saveNutrition({ date: '2026-10-21', kcal: 3300, status: 'final' });
  const s = await neu.store.startSession({ cycle: 1, week: 2, day: 2 });
  await neu.store.logSet(s.id, s.items[0].slotId, { weight: 60, reps: 10, rir: 2 });
  await neu.store.finishSession(s.id);
  await neu.sync.syncNow();
  assert.equal(neu.sync.status.pending, 0);

  // The old phone: syncs without errors, gets the workout, nothing of nutrition.
  await old.sync.syncNow();
  assert.equal(old.sync.status.error, null);
  assert.equal(old.store.state.nutrition, undefined);
  assert.equal([...old.store.state.sets.values()].length, 2);
  // It edits the setup text (without knowing bw_share) and logs a set: the share stays, the set arrives.
  await old.store.saveSetup(key, 'Жим', 'сиденье 5');
  const s2 = await old.store.startSession({ cycle: 1, week: 2, day: 3 });
  await old.store.logSet(s2.id, s2.items[0].slotId, { weight: 30, reps: 12, rir: 2 });
  await old.store.finishSession(s2.id);
  await old.sync.syncNow();
  await neu.sync.syncNow();
  const ex = neu.store.state.exercises.get(`x:${key}`);
  assert.deepEqual([ex.setup, ex.bwShare], ['сиденье 5', 0.4]);
  assert.equal([...neu.store.state.sets.values()].length, 3);
  assert.equal(table(gas, 'App_Nutrition').length - 1, 1);
  assert.equal(neu.store.state.nutrition.get('n:2026-10-21').kcal, 3300);
});
