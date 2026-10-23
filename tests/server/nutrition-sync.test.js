// Calories and macros through the real Code.gs (API 6): a day entered on the phone, ChatGPT's rows in
// App_NutritionInbox (created, the same «Закрыть день» again, recalculated later, a draft after a
// final, after a delete, an offline edit on a phone), goals, an older Apps Script, the same revision
// in the app and in the script. Synthetic numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas } from '../helpers/fake-gas.js';
import { createStore } from '../../app/js/data/store.js';
import { memoryAdapter } from '../../app/js/data/db.js';
import { createSync } from '../../app/js/data/sync.js';
import { normalizeEntry } from '../../app/js/lib/nutrition.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API5 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/apps-script/Code.api5.gs'), 'utf8');

// Phones run an hour behind the script's clock: an entry taken in by the script is the later action.
let clock = Date.now() - 3600000;
const now = () => (clock += 17);
const post = (gas) => async (_u, p) => gas.post(JSON.parse(JSON.stringify(p)));

async function phone(gas, token) {
  const store = createStore(memoryAdapter(), { now });
  await store.load();
  await store.setKV({ sync: { url: 'https://example/exec', token } });
  return { store, sync: createSync(store, { transport: post(gas), now }) };
}
function rows(gas, name) {
  const sh = gas.sheet(name);
  if (!sh) return [];
  const [head, ...data] = sh.rows();
  return data.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
// What ChatGPT does: one appended row, cells as text.
function chatgpt(gas, row) {
  const sh = gas.sheet('App_NutritionInbox');
  const head = sh.rows()[0];
  const r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, head.length).setValues([head.map((h) => (row[h] == null ? '' : String(row[h])))]);
  return r;
}
const inbox = (gas) => rows(gas, 'App_NutritionInbox');
const day = (store, date) => store.state.nutrition.get(`n:${date}`);

async function setup() {
  const gas = createGas({ legacy: { Дневник: [['Дата', 'Упражнение'], ['16.10.2026', 'Жим']] } });
  const token = gas.call('setup');
  const a = await phone(gas, token);
  await a.sync.syncNow();
  return { gas, token, a };
}

test('a day entered by hand reaches the sheet and the other phone; one row per date', async () => {
  const { gas, token, a } = await setup();
  await a.store.saveNutrition({ date: '2026-10-22', kcal: 3300, protein: 160, fat: 90, carbs: 430, status: 'final' });
  await a.sync.syncNow();
  let r = rows(gas, 'App_Nutrition');
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].date, r[0].kcal, r[0].protein_g, r[0].status, r[0].source, r[0].id], ['2026-10-22', 3300, 160, 'final', 'manual', 'n:2026-10-22']);
  const b = await phone(gas, token);
  await b.sync.syncNow();
  assert.equal(day(b.store, '2026-10-22').kcal, 3300);
  // Edited on the second phone: the same row.
  await b.store.saveNutrition({ ...day(b.store, '2026-10-22'), kcal: 3350 });
  await b.sync.syncNow();
  await a.sync.syncNow();
  r = rows(gas, 'App_Nutrition');
  assert.equal(r.length, 1);
  assert.equal(day(a.store, '2026-10-22').kcal, 3350);
  // The eight original tabs: a legacy one is untouched.
  assert.deepEqual(gas.sheet('Дневник').rows(), [['Дата', 'Упражнение'], ['16.10.2026', 'Жим']]);
});

test('ChatGPT closes 22.10, closes it again, recalculates it later: one record, outcomes in the inbox', async () => {
  const { gas, a } = await setup();
  assert.deepEqual(gas.sheet('App_NutritionInbox').rows()[0], ['date', 'kcal', 'protein_g', 'fat_g', 'carbs_g', 'status', 'approx', 'comment', 'written_at', 'result', 'processed_at']);
  chatgpt(gas, { date: '2026-10-22', kcal: '3250', protein_g: '160', fat_g: '90', carbs_g: '420', status: 'итог', approx: 'да', comment: 'оценка' });
  await a.sync.syncNow();
  let d = day(a.store, '2026-10-22');
  assert.deepEqual([d.kcal, d.protein, d.fat, d.carbs, d.status, d.source, d.approx], [3250, 160, 90, 420, 'final', 'chatgpt', true]);
  assert.equal(inbox(gas)[0].result, 'создан');
  assert.ok(inbox(gas)[0].processed_at);

  // «Закрыть день» once more with the same numbers.
  chatgpt(gas, { date: '2026-10-22', kcal: '3250', protein_g: '160', fat_g: '90', carbs_g: '420', status: 'итог', approx: 'да', comment: 'оценка' });
  await a.sync.syncNow();
  assert.equal(inbox(gas)[1].result, 'без изменений');
  // Recalculated a day later.
  chatgpt(gas, { date: '2026-10-22', kcal: '3400', protein_g: '165', fat_g: '95', carbs_g: '430', status: 'итог', approx: 'нет' });
  await a.sync.syncNow();
  assert.equal(inbox(gas)[2].result, 'обновлён');
  d = day(a.store, '2026-10-22');
  assert.deepEqual([d.kcal, d.approx, d.comment, d.prev], [3400, false, '', null]);
  assert.equal(rows(gas, 'App_Nutrition').length, 1);
  // A draft after the final day: skipped.
  chatgpt(gas, { date: '2026-10-22', kcal: '1200', status: 'черновик' });
  await a.sync.syncNow();
  assert.equal(inbox(gas)[3].result, 'пропущен: черновик не заменяет итог');
  assert.equal(day(a.store, '2026-10-22').kcal, 3400);
  // Processed rows are not taken again; ChatGPT's own cells are as written.
  await a.sync.syncNow();
  assert.deepEqual(inbox(gas).map((x) => x.result), ['создан', 'без изменений', 'обновлён', 'пропущен: черновик не заменяет итог']);
  assert.equal(inbox(gas)[0].kcal, '3250');
});

test('a range stays a range; a bad row is refused with the reason and changes nothing', async () => {
  const { gas, a } = await setup();
  chatgpt(gas, { date: '2026-10-21', kcal: '2800-3000', protein_g: '~150', fat_g: '85', carbs_g: '', status: 'черновик' });
  chatgpt(gas, { date: '21/10/2026', kcal: '3000', status: 'итог' });
  chatgpt(gas, { date: '2026-10-20', kcal: '-200', status: 'итог' });
  chatgpt(gas, { date: '2026-10-19', kcal: '3100', status: 'почти' });
  chatgpt(gas, { date: '2026-10-18', kcal: '3100' });
  await a.sync.syncNow();
  const d = day(a.store, '2026-10-21');
  assert.deepEqual([d.kcal, d.ranges, d.protein, d.approx, d.carbs, d.status], [null, { kcal: [2800, 3000] }, 150, true, null, 'draft']);
  const r = rows(gas, 'App_Nutrition').find((x) => x.date === '2026-10-21');
  assert.equal(r.kcal, '');
  assert.match(inbox(gas)[1].result, /^отклонён: дата/);
  assert.match(inbox(gas)[2].result, /^отклонён: калории: не число/);
  assert.match(inbox(gas)[3].result, /^отклонён: статус/);
  assert.equal(inbox(gas)[4].result, 'создан (статус не указан — черновик)');
  assert.deepEqual(rows(gas, 'App_Nutrition').map((x) => x.date).sort(), ['2026-10-18', '2026-10-21']);
});

test('hand-entered values replaced by ChatGPT are kept and can be put back; the same entry again does not undo it', async () => {
  const { gas, a } = await setup();
  await a.store.saveNutrition({ date: '2026-10-22', kcal: 3100, protein: 150, fat: 85, carbs: 400, status: 'final' });
  await a.sync.syncNow();
  chatgpt(gas, { date: '2026-10-22', kcal: '3250', protein_g: '160', fat_g: '90', carbs_g: '420', status: 'итог' });
  await a.sync.syncNow();
  let d = day(a.store, '2026-10-22');
  assert.equal(d.kcal, 3250);
  assert.deepEqual([d.prev.kcal, d.prev.source], [3100, 'manual']);
  await a.store.revertNutrition(d.id);
  await a.sync.syncNow();
  d = day(a.store, '2026-10-22');
  assert.deepEqual([d.kcal, d.source, d.prev], [3100, 'manual', null]);
  // ChatGPT repeats the same entry: the hand-entered day stays.
  chatgpt(gas, { date: '2026-10-22', kcal: '3250', protein_g: '160', fat_g: '90', carbs_g: '420', status: 'итог' });
  await a.sync.syncNow();
  assert.equal(day(a.store, '2026-10-22').kcal, 3100);
  assert.equal(inbox(gas)[1].result, 'без изменений');
});

test('deleted in the app: the same entry does not bring it back, a new one does', async () => {
  const { gas, a } = await setup();
  chatgpt(gas, { date: '2026-10-22', kcal: '3250', status: 'итог' });
  await a.sync.syncNow();
  await a.store.deleteNutrition('n:2026-10-22');
  await a.sync.syncNow();
  chatgpt(gas, { date: '2026-10-22', kcal: '3250', status: 'итог' });
  await a.sync.syncNow();
  assert.equal(day(a.store, '2026-10-22').deleted, true);
  assert.equal(inbox(gas)[1].result, 'без изменений: день удалён в приложении');
  chatgpt(gas, { date: '2026-10-22', kcal: '3300', status: 'итог' });
  await a.sync.syncNow();
  assert.deepEqual([day(a.store, '2026-10-22').deleted, day(a.store, '2026-10-22').kcal], [false, 3300]);
});

test('a phone offline: its hand entry is older than the ChatGPT entry taken in meanwhile — kept as «Вернуть», not lost', async () => {
  const { gas, token, a } = await setup();
  const b = await phone(gas, token);
  await b.sync.syncNow();
  // b edits offline (no sync), then ChatGPT's row is taken in by a's sync.
  await b.store.saveNutrition({ date: '2026-10-22', kcal: 2900, protein: 140, fat: 80, carbs: 380, status: 'final', comment: 'с телефона' });
  chatgpt(gas, { date: '2026-10-22', kcal: '3250', protein_g: '160', fat_g: '90', carbs_g: '420', status: 'итог' });
  await a.sync.syncNow();
  await b.sync.syncNow();
  const d = day(b.store, '2026-10-22');
  assert.deepEqual([d.kcal, d.source], [3250, 'chatgpt']);
  assert.deepEqual([d.prev.kcal, d.prev.comment, d.prev.source], [2900, 'с телефона', 'manual']);
  assert.equal(b.store.state.outbox.size, 0);
  await a.sync.syncNow();
  assert.equal(day(a.store, '2026-10-22').prev.kcal, 2900);
  assert.equal(rows(gas, 'App_Nutrition').length, 1);
});

test('the menu takes the inbox in without a phone; goals per phase round-trip', async () => {
  const { gas, token, a } = await setup();
  chatgpt(gas, { date: '2026-10-22', kcal: '3250', status: 'итог' });
  const res = gas.call('processNutritionInbox');
  assert.deepEqual([res.rows, res.create], [1, 1]);
  const phase = await a.store.savePhase({ mode: 'bulk', start: '2026-10-01', targetPct: 0.25 });
  await a.store.saveNutritionGoals({ phaseId: phase.id, from: '2026-10-01', kcalMin: 3200, kcalMax: 3500, proteinMin: 150, proteinMax: 170, fatMin: 80, fatMax: 100, carbsMode: 'rest' });
  await a.sync.syncNow();
  assert.equal(day(a.store, '2026-10-22').kcal, 3250);
  const g = rows(gas, 'App_NutritionGoals');
  assert.deepEqual([g.length, g[0].kcal_min, g[0].carbs_mode, g[0].carbs_min_g], [1, 3200, 'rest', '']);
  const b = await phone(gas, token);
  await b.sync.syncNow();
  assert.equal(b.store.state.nutritionGoals.get(`g:${phase.id}:2026-10-01`).proteinMin, 150);
});

test('the app and the script give one revision for one entry (so a paste and the inbox agree)', () => {
  const gas = createGas();
  const inputs = [
    { date: '2026-10-22', kcal: '3250', protein: '160', fat: '90', carbs: '420', status: 'итог', approx: 'да', comment: 'оценка' },
    { date: '22.10.2026', kcal: '2800–3000', protein: '~150', fat: '', carbs: '400 г', status: 'черновик' },
    { date: '2026-10-22', kcal: 3250.5, protein: 160, status: 'final', approx: false },
  ];
  for (const x of inputs) {
    const js = normalizeEntry(x, { today: '2026-10-24' });
    const gs = JSON.parse(JSON.stringify(gas.ctx.normalizeNutrition_(x, '2026-10-24')));
    assert.equal(gs.rev, js.rev, JSON.stringify(x));
    assert.deepEqual(gs.entry, JSON.parse(JSON.stringify(js.entry)));
  }
});

test('with the API 5 script the days wait on the phone, named; nothing is lost', async () => {
  const gas = createGas({ code: API5 });
  const token = gas.call('setup');
  const a = await phone(gas, token);
  await a.store.saveNutrition({ date: '2026-10-22', kcal: 3300, status: 'final' });
  await a.sync.syncNow();
  assert.equal(a.sync.status.waiting, 1);
  assert.match(a.sync.status.notice, /питание по дням — 1/);
  gas.redeploy();
  await a.sync.syncNow();
  assert.equal(a.sync.status.waiting, 0);
  assert.equal(rows(gas, 'App_Nutrition')[0].kcal, 3300);
});
