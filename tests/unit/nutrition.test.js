// Calories and macros (lib/nutrition.js) and the store around them: values and ranges, a pasted
// ChatGPT block, an import of old days, the conflict rules, goals per phase (switching phases and a
// phase moved back in time), the accounting day after midnight, honest averages. Synthetic numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount, parseNutritionText, parseNutritionCsv, planNutritionImport, applyExternal, normalizeEntry,
  accountingDate, goalsOn, goalsFromSameMode, targets, against, percent, summarize, coverageText, weekStart, fmtAmount,
} from '../../app/js/lib/nutrition.js';
import { createStore } from '../../app/js/data/store.js';
import { memoryAdapter } from '../../app/js/data/db.js';

const TODAY = '2026-10-24';

test('amounts: numbers, spaces and commas, «~» approximate, ranges kept as ranges, nonsense refused', () => {
  assert.deepEqual(parseAmount('3 200', 'kcal'), { value: 3200, approx: false });
  assert.deepEqual(parseAmount('160,5 г', 'protein'), { value: 160.5, approx: false });
  assert.deepEqual(parseAmount('~3200', 'kcal'), { value: 3200, approx: true });
  assert.deepEqual(parseAmount('2800–3000', 'kcal'), { range: [2800, 3000], approx: true });
  assert.deepEqual(parseAmount('3000-3000', 'kcal'), { value: 3000, approx: false });
  assert.equal(parseAmount('', 'kcal'), null);
  assert.ok(parseAmount('3000-2800', 'kcal').error);
  assert.ok(parseAmount('много', 'kcal').error);
  assert.ok(parseAmount('20000', 'kcal').error);
  assert.ok(parseAmount(-5, 'fat').error);
});

test('a block pasted from ChatGPT: one day per date, several pairs per line, the date first or last', () => {
  const text = `КБЖУ за день
Дата: 2026-10-22
Ккал: 3250 · Белки: 160 · Жиры: 90 · Углеводы: 420
Статус: итог · Приблизительно: да · Комментарий: ужин в гостях, оценка

Ккал: 2800-3000; Б: 150; Ж: 85; У: ~400; Статус: черновик
Дата: 21.10.2026`;
  const { entries, errors } = parseNutritionText(text, { today: TODAY });
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 2);
  const [a, b] = entries.map((e) => e.entry);
  assert.deepEqual([a.date, a.kcal, a.protein, a.fat, a.carbs, a.status, a.approx, a.comment], ['2026-10-22', 3250, 160, 90, 420, 'final', true, 'ужин в гостях, оценка']);
  assert.deepEqual([b.date, b.kcal, b.ranges, b.carbs, b.status, b.approx], ['2026-10-21', null, { kcal: [2800, 3000] }, 400, 'draft', true]);
  const bad = parseNutritionText('Дата: 2026-13-01\nКкал: 3000', { today: TODAY });
  assert.equal(bad.entries.length, 0);
  assert.match(bad.errors[0].errors[0], /^дата/);
  assert.match(parseNutritionText('Дата: 2026-10-30\nКкал: 3000', { today: TODAY }).errors[0].errors[0], /не позже завтрашнего/);
});

test('old days from a table: header names in Russian or English; the same date twice is an error, never a sum', () => {
  const csv = 'Дата;Калории, ккал;Белки, г;Жиры, г;Углеводы, г;Статус\n2026-10-19;3300;165;95;430;итог\n2026-10-19;500;20;10;60;итог\n2026-10-18;3100;;;;черновик\n2026-10-17;;;;;итог';
  const parsed = parseNutritionCsv(csv, { today: TODAY });
  assert.equal(parsed.entries.length, 3);
  const plan = planNutritionImport(parsed, new Map());
  assert.deepEqual(plan.add.map((e) => e.entry.date), ['2026-10-19', '2026-10-18']);
  assert.deepEqual(plan.errors.map((e) => e.line), [5, 3]);
  assert.match(plan.errors[1].errors[0], /дни не складываются/);
  const en = parseNutritionCsv('date,kcal,protein_g,fat_g,carbs_g,status,approx,comment\n2026-10-16,3000,150,80,400,final,yes,"a, b"', { today: TODAY });
  assert.deepEqual([en.entries[0].entry.approx, en.entries[0].entry.comment], [true, 'a, b']);
});

test('import plan: new, the same, different (a conflict for the owner); a deleted day counts as new', () => {
  const e = (date, kcal) => normalizeEntry({ date, kcal, status: 'итог' }, { today: TODAY });
  const parsed = { entries: [e('2026-10-20', 3000), e('2026-10-21', 3100), e('2026-10-22', 3200), e('2026-10-23', 3300)], errors: [] };
  const existing = new Map([
    ['n:2026-10-21', { id: 'n:2026-10-21', date: '2026-10-21', kcal: 3100, protein: null, fat: null, carbs: null, status: 'final', approx: false, comment: '', source: 'manual' }],
    ['n:2026-10-22', { id: 'n:2026-10-22', date: '2026-10-22', kcal: 3150, status: 'final', source: 'manual' }],
    ['n:2026-10-23', { id: 'n:2026-10-23', date: '2026-10-23', kcal: 9, status: 'final', source: 'manual', deleted: true }],
  ]);
  const plan = planNutritionImport(parsed, existing);
  assert.deepEqual([plan.add, plan.same, plan.conflicts].map((l) => l.map((x) => x.entry.date)), [['2026-10-20', '2026-10-23'], ['2026-10-21'], ['2026-10-22']]);
});

test('rules for an entry from outside: one per date, a repeat changes nothing, a draft never replaces a final day, hand values kept', () => {
  const n = (x) => normalizeEntry({ date: '2026-10-22', ...x }, { today: TODAY });
  const a = n({ kcal: 3250, status: 'итог' });
  let r = applyExternal(null, a.entry, { rev: a.rev, at: 100 });
  assert.equal(r.action, 'create');
  const first = r.rec;
  assert.deepEqual([first.id, first.source, first.extRev, first.prev], ['n:2026-10-22', 'chatgpt', a.rev, null]);
  assert.equal(applyExternal(first, a.entry, { rev: a.rev, at: 200 }).action, 'same');
  const d = n({ kcal: 1000, status: 'черновик' });
  assert.equal(applyExternal(first, d.entry, { rev: d.rev, at: 200 }).action, 'draft');
  const manual = { ...first, kcal: 3100, source: 'manual', updatedAt: 300 };
  const b = n({ kcal: 3400, status: 'итог' });
  r = applyExternal(manual, b.entry, { rev: b.rev, at: 250 });
  assert.equal(r.action, 'update');
  assert.equal(r.rec.updatedAt, 301, 'always newer than what it replaces');
  assert.deepEqual([r.rec.kcal, r.rec.prev.kcal, r.rec.prev.source], [3400, 3100, 'manual']);
  // A deleted day: the same revision keeps it deleted, a new one brings it back.
  const gone = { ...first, deleted: true };
  assert.equal(applyExternal(gone, a.entry, { rev: a.rev, at: 400 }).action, 'deleted');
  assert.equal(applyExternal(gone, b.entry, { rev: b.rev, at: 400 }).rec.deleted, false);
  // A draft may replace a draft.
  const dd = n({ kcal: 2000, status: 'черновик' });
  assert.equal(applyExternal({ ...first, status: 'draft' }, dd.entry, { rev: dd.rev, at: 500 }).action, 'update');
});

test('accounting day: before 07:00 it is still yesterday — midnight does not move the day', () => {
  assert.equal(accountingDate(new Date(2026, 9, 23, 3, 30)), '2026-10-22');
  assert.equal(accountingDate(new Date(2026, 9, 23, 6, 59)), '2026-10-22');
  assert.equal(accountingDate(new Date(2026, 9, 23, 7, 0)), '2026-10-23');
  assert.equal(accountingDate(new Date(2026, 9, 23, 23, 50)), '2026-10-23');
  assert.equal(accountingDate(new Date(2026, 9, 23, 4, 0), 4), '2026-10-23');
});

test('goals per phase by date: a change starts a new record, a new phase uses its own, the same mode is a starting point', () => {
  const phases = [
    { id: 'p1', mode: 'cut', start: '2026-08-01', end: '2026-09-30', targetPct: -0.5 },
    { id: 'p2', mode: 'bulk', start: '2026-10-01', end: null, targetPct: 0.25 },
  ];
  const goals = [
    { id: 'g:p1:2026-08-01', phaseId: 'p1', from: '2026-08-01', kcalMin: 2400, kcalMax: 2400, proteinMin: 170, carbsMode: 'rest', updatedAt: 1 },
    { id: 'g:p2:2026-10-05', phaseId: 'p2', from: '2026-10-05', kcalMin: 3200, kcalMax: 3500, proteinMin: 150, proteinMax: 170, fatMin: 80, fatMax: 100, carbsMode: 'rest', updatedAt: 2 },
    { id: 'g:p2:2026-10-20', phaseId: 'p2', from: '2026-10-20', kcalMin: 3300, kcalMax: 3600, proteinMin: 150, proteinMax: 170, fatMin: 80, fatMax: 100, carbsMode: 'rest', updatedAt: 3 },
  ];
  assert.equal(goalsOn(goals, phases, '2026-09-15').kcalMin, 2400);
  assert.equal(goalsOn(goals, phases, '2026-10-02').kcalMin, 3200, 'days before the first goals of the phase use them');
  assert.equal(goalsOn(goals, phases, '2026-10-19').kcalMin, 3200);
  assert.equal(goalsOn(goals, phases, '2026-10-20').kcalMin, 3300);
  assert.equal(goalsOn(goals, phases, '2026-07-01'), null, 'no phase, no goals');
  // The bulk moved back to 15.09: those days now belong to it (nothing stored per day changes).
  const moved = [{ ...phases[0], end: '2026-09-14' }, { ...phases[1], start: '2026-09-15' }];
  assert.equal(goalsOn(goals, moved, '2026-09-20').kcalMin, 3200);
  assert.equal(goalsFromSameMode(goals, [...phases, { id: 'p3', mode: 'cut', start: '2027-01-01' }], { id: 'p3', mode: 'cut' }).id, 'g:p1:2026-08-01');
});

test('targets: kcal range, protein minimum or range, fat, carbs explicit or the remainder', () => {
  const t = targets({ kcalMin: 3200, kcalMax: 3500, proteinMin: 150, proteinMax: 170, fatMin: 80, fatMax: 100, carbsMode: 'rest' });
  assert.deepEqual(t, { kcal: [3200, 3500], protein: [150, 170], fat: [80, 100], carbs: [405, 545], carbsRest: true });
  const m = targets({ kcalMin: 3000, kcalMax: 3000, proteinMin: 160, fatMin: 90, fatMax: 90, carbsMin: 380, carbsMax: 420, carbsMode: 'explicit' });
  assert.deepEqual([m.protein, m.carbs], [[160, null], [380, 420]]);
  assert.equal(against(155, m.protein), 'below');
  assert.equal(against(220, m.protein), 'within', 'a minimum has no ceiling');
  assert.equal(against(3600, t.kcal), 'above');
  assert.equal(percent(165, m.protein), 103);
  assert.equal(percent(3350, t.kcal), 100);
});

test('a week: final days only, drafts named, ranges marked approximate, coverage says how many days', () => {
  const phases = [{ id: 'p2', mode: 'bulk', start: '2026-10-01', end: null }];
  const goals = [{ id: 'g', phaseId: 'p2', from: '2026-10-01', kcalMin: 3200, kcalMax: 3500, proteinMin: 150, proteinMax: 170, fatMin: 80, fatMax: 100, carbsMode: 'rest', updatedAt: 1 }];
  const rec = (date, kcal, protein, extra = {}) => ({ id: `n:${date}`, date, kcal, protein, fat: 90, carbs: 420, status: 'final', approx: false, ...extra });
  const records = [
    rec('2026-10-19', 3300, 160),
    rec('2026-10-20', 3100, 140),
    rec('2026-10-21', null, 145, { ranges: { kcal: [2800, 3000] } }),
    rec('2026-10-22', 1500, 60, { status: 'draft' }),
    rec('2026-10-23', 3400, 155, { deleted: true }),
  ];
  const s = summarize(records, { from: '2026-10-19', to: '2026-10-25', phase: phases[0], goals, phases, today: TODAY });
  assert.deepEqual([s.days, s.final, s.drafts, s.approxDays], [6, 3, 1, 1]);
  assert.deepEqual([s.avg.kcal.value, s.avg.kcal.n, s.avg.kcal.approx], [(3300 + 3100 + 2900) / 3, 3, true]);
  assert.deepEqual(s.check.protein.below, ['2026-10-20', '2026-10-21']);
  assert.deepEqual(s.check.kcal.below, ['2026-10-20', '2026-10-21']);
  assert.equal(coverageText(s), 'записано 3 из 6 дней; черновик (1) не в счёте');
  // Only the days of the phase: a week that starts before it counts its days in the phase.
  const s2 = summarize(records, { from: '2026-09-28', to: '2026-10-04', phase: phases[0], goals, phases, today: TODAY });
  assert.equal(s2.days, 4);
  assert.equal(weekStart('2026-10-22'), '2026-10-19');
  assert.equal(fmtAmount(records[2], 'kcal'), '2800–3000');
});

let clock = Date.parse('2026-10-24T09:00:00Z');
const now = () => (clock += 13);
async function store() {
  const s = createStore(memoryAdapter(), { now });
  await s.load();
  return s;
}

test('store: a day by hand is saved offline with its outbox entry; a new date moves it; delete keeps a tombstone', async () => {
  const s = await store();
  await s.saveNutrition({ date: '2026-10-22', kcal: 3200, protein: 150, status: 'final' });
  assert.ok(s.state.outbox.has('nutrition:n:2026-10-22'));
  await s.saveNutrition({ date: '2026-10-21', kcal: 3200, protein: 150, status: 'final' }, { from: '2026-10-22' });
  assert.equal(s.state.nutrition.get('n:2026-10-22').deleted, true);
  assert.equal(s.state.nutrition.get('n:2026-10-21').kcal, 3200);
  await assert.rejects(s.saveNutrition({ date: '2026-10-21', status: 'final' }), /Нет ни одного значения/);
  await s.deleteNutrition('n:2026-10-21');
  assert.equal(s.state.nutrition.get('n:2026-10-21').deleted, true);
  assert.equal(s.state.nutrition.size, 2, 'nothing is removed, deletes are marks');
});

test('store: a paste follows the rules, the same paste again changes nothing, undo puts each day back', async () => {
  const s = await store();
  await s.saveNutrition({ date: '2026-10-21', kcal: 3000, protein: 140, status: 'final' });
  const text = 'Дата: 2026-10-21\nКкал: 3150; Б: 150; Статус: итог\n\nДата: 2026-10-22\nКкал: 3250; Б: 160; Статус: итог';
  const p = parseNutritionText(text, { today: TODAY });
  const r = await s.importNutrition(p.entries, { source: 'chatgpt' });
  assert.deepEqual([r.create, r.update], [1, 1]);
  assert.equal(s.state.nutrition.get('n:2026-10-21').prev.kcal, 3000);
  const again = await s.importNutrition(p.entries, { source: 'chatgpt' });
  assert.deepEqual([again.same, again.create, again.update], [2, 0, 0]);
  await s.undoNutritionImport(r.batch);
  assert.equal(s.state.nutrition.get('n:2026-10-21').kcal, 3000);
  assert.equal(s.state.nutrition.get('n:2026-10-21').source, 'manual');
  assert.equal(s.state.nutrition.get('n:2026-10-22').deleted, true);
});

test('store: an import leaves conflicts alone unless chosen; goals keep history by date', async () => {
  const s = await store();
  await s.saveNutrition({ date: '2026-10-20', kcal: 3000, status: 'final' });
  const parsed = parseNutritionCsv('date;kcal;status\n2026-10-20;3100;итог\n2026-10-19;3200;итог', { today: TODAY });
  let r = await s.importNutrition(parsed.entries, { source: 'import', conflicts: 'ask', replace: new Set() });
  assert.deepEqual([r.create, r.kept], [1, 1]);
  assert.equal(s.state.nutrition.get('n:2026-10-20').kcal, 3000);
  r = await s.importNutrition(parsed.entries, { source: 'import', conflicts: 'ask', replace: new Set(['2026-10-20']) });
  assert.equal(s.state.nutrition.get('n:2026-10-20').kcal, 3100);
  assert.equal(s.state.nutrition.get('n:2026-10-20').source, 'import');
  const ph = await s.savePhase({ mode: 'bulk', start: '2026-10-01', targetPct: 0.25 });
  await s.saveNutritionGoals({ phaseId: ph.id, from: '2026-10-01', kcalMin: 3200, kcalMax: 3500, proteinMin: 150, carbsMode: 'rest' });
  await s.saveNutritionGoals({ phaseId: ph.id, from: '2026-10-20', kcalMin: 3300, kcalMax: 3600, proteinMin: 150, carbsMode: 'rest' });
  assert.equal(s.state.nutritionGoals.size, 2);
  await assert.rejects(s.saveNutritionGoals({ phaseId: ph.id, from: '2026-10-20', kcalMin: 3600, kcalMax: 3300 }), /Начало диапазона больше конца/);
});
