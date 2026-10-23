// «Питание» in v1.3: a day entered by hand (offline, then synced once), ChatGPT's rows from
// App_NutritionInbox through the real Code.gs (created, the same «Закрыть день» again, a draft after
// the final, «Вернуть мои»), a pasted block, old days from a table with conflicts and undo, goals per
// phase, the accounting day after midnight, the weekly report and its copy, the smallest iPhone.
// Synthetic numbers only.
import { test, expect, devices } from '@playwright/test';
import { startStatic, startFakeGas } from '../helpers/servers.js';
import { ready, connectSync } from './helpers.js';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

async function open(page) {
  await page.goto(base);
  await ready(page);
}
async function nutritionTab(page) {
  await page.locator('.tabbar').getByRole('button', { name: 'Тело' }).click();
  await page.getByRole('group', { name: 'Раздел' }).getByRole('button', { name: 'Питание' }).click();
  await expect(page.getByRole('heading', { name: 'Питание', exact: true })).toBeVisible();
}
const days = (page) => page.getByRole('list', { name: 'Питание по дням' });
// Twice: a sync started earlier (after a save) may still be on its way; the second one starts after it.
const syncNow = (page) => page.evaluate(async () => {
  const { sync } = window.__trainer;
  await sync.syncNow();
  await sync.syncNow();
  return { ...sync.status };
});
const rec = (page, date) => page.evaluate((d) => window.__trainer.store.state.nutrition.get(`n:${d}`) || null, date);
function rows(gas, name) {
  const sh = gas.sheet(name);
  if (!sh) return [];
  const [head, ...data] = sh.rows();
  return data.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
// What ChatGPT does with write access: one appended row in App_NutritionInbox, cells as text.
function chatgpt(gas, row) {
  const sh = gas.sheet('App_NutritionInbox');
  const head = sh.rows()[0];
  sh.getRange(sh.getLastRow() + 1, 1, 1, head.length).setValues([head.map((h) => (row[h] == null ? '' : String(row[h])))]);
}

test('a day entered by hand offline: kept on the phone, reaches App_Nutrition once; edit, delete and «Вернуть»', async ({ page, context }) => {
  const fake = await startFakeGas({ port: 0 });
  try {
    await open(page);
    await nutritionTab(page);
    await expect(page.locator('.nutr-empty')).toContainText('Дней пока нет');
    await connectSync(page, `http://127.0.0.1:${fake.server.address().port}/exec`, fake.token);
    await syncNow(page);
    await context.setOffline(true);

    await page.getByRole('button', { name: 'Записать итог дня' }).click();
    const sheet = page.getByRole('dialog', { name: 'Итог дня' });
    await sheet.getByLabel('Учётный день').fill('2026-10-20');
    await sheet.getByLabel('Калории, ккал').fill('3250');
    await sheet.getByLabel('Белки, г').fill('160');
    await sheet.getByLabel('Жиры, г').fill('90');
    await sheet.getByLabel('Углеводы, г').fill('400-440');
    await sheet.getByRole('button', { name: 'Сохранить' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('.toast')).toContainText('20 октября: сохранено');
    const row = days(page).getByRole('button', { name: /20 октября/ });
    await expect(row).toContainText('3250 ккал');
    await expect(row).toContainText('У 400–440 · вручную · итог подтверждён · приблизительно');
    expect((await syncNow(page)).pending).toBeGreaterThan(0); // offline: waits on the phone

    await context.setOffline(false);
    expect((await syncNow(page)).pending).toBe(0);
    let sheetRows = rows(fake.gas, 'App_Nutrition');
    expect(sheetRows.map((r) => [r.date, r.kcal, r.protein_g, r.carbs_g, r.status, r.source])).toEqual([['2026-10-20', 3250, 160, '', 'final', 'manual']]);
    expect(JSON.parse(sheetRows[0].ranges)).toEqual({ carbs: [400, 440] });

    // A correction: the same row in the sheet, not a second one.
    await row.click();
    const edit = page.getByRole('dialog', { name: 'Питание, 20 октября' });
    await edit.getByLabel('Калории, ккал').fill('3300');
    await edit.getByRole('button', { name: 'Сохранить' }).click();
    await expect(row).toContainText('3300 ккал');
    await syncNow(page);
    sheetRows = rows(fake.gas, 'App_Nutrition');
    expect(sheetRows.map((r) => [r.date, r.kcal])).toEqual([['2026-10-20', 3300]]);

    // Delete, then «Вернуть» from the toast.
    await row.click();
    await page.getByRole('dialog', { name: 'Питание, 20 октября' }).getByRole('button', { name: 'Удалить день' }).click();
    await page.getByRole('dialog', { name: 'Удалить 20 октября?' }).getByRole('button', { name: 'Удалить' }).click();
    await expect(days(page)).toHaveCount(0);
    await page.locator('.toast').getByRole('button', { name: 'Вернуть' }).click();
    await expect(row).toContainText('3300 ккал');
    await page.reload();
    await ready(page);
    await nutritionTab(page);
    await expect(row).toContainText('3300 ккал');
    await syncNow(page);
    expect(rows(fake.gas, 'App_Nutrition').map((r) => [r.date, r.kcal, r.deleted])).toEqual([['2026-10-20', 3300, false]]);
  } finally {
    fake.server.close();
  }
});

test('ChatGPT through App_NutritionInbox: created, the same «Закрыть день» again changes nothing, a draft never replaces the final, «Вернуть мои»', async ({ page }) => {
  const fake = await startFakeGas({ port: 0 });
  try {
    await open(page);
    await connectSync(page, `http://127.0.0.1:${fake.server.address().port}/exec`, fake.token);
    await page.evaluate(() => window.__trainer.store.saveNutrition({ date: '2026-10-21', kcal: 3000, protein: 150, fat: 85, carbs: 380, status: 'final' }));
    await syncNow(page);
    await nutritionTab(page);

    const closeDay = { date: '2026-10-21', kcal: '3250', protein_g: '160', fat_g: '90', carbs_g: '420', status: 'итог', approx: 'нет', comment: 'пересчитал ужин', written_at: '2026-10-22 01:40' };
    chatgpt(fake.gas, closeDay);
    chatgpt(fake.gas, { date: '2026-10-22', kcal: '3400', protein_g: '165', fat_g: '95', carbs_g: '430', status: 'итог', written_at: '2026-10-23 02:10' });
    await syncNow(page);
    expect(rows(fake.gas, 'App_NutritionInbox').map((r) => r.result)).toEqual(['обновлён', 'создан']);
    await expect(days(page).getByRole('button', { name: /22 октября/ })).toContainText('3400 ккал');
    await expect(days(page).getByRole('button', { name: /21 октября/ })).toContainText('ChatGPT · итог подтверждён');
    const notice = page.getByRole('status', { name: 'Замена ручной записи, 21 октября' });
    await expect(notice).toContainText('Сейчас: 3250 ккал · Б 160 · Ж 90 · У 420. Было вручную: 3000 ккал · Б 150 · Ж 85 · У 380.');

    // «Закрыть день» sent again and a late draft: nothing changes, nothing doubles.
    chatgpt(fake.gas, closeDay);
    chatgpt(fake.gas, { date: '2026-10-22', kcal: '1800', status: 'черновик', written_at: '2026-10-23 03:00' });
    await syncNow(page);
    expect(rows(fake.gas, 'App_NutritionInbox').map((r) => r.result).slice(2)).toEqual(['без изменений', 'пропущен: черновик не заменяет итог']);
    expect(rows(fake.gas, 'App_Nutrition').map((r) => [r.date, r.kcal, r.source]).sort()).toEqual([['2026-10-21', 3250, 'chatgpt'], ['2026-10-22', 3400, 'chatgpt']]);

    await notice.getByRole('button', { name: 'Вернуть мои' }).click();
    await expect(notice).toHaveCount(0);
    await expect(days(page).getByRole('button', { name: /21 октября/ })).toContainText('3000 ккал');
    await syncNow(page);
    expect(rows(fake.gas, 'App_Nutrition').filter((r) => r.date === '2026-10-21').map((r) => [r.kcal, r.source])).toEqual([[3000, 'manual']]);
  } finally {
    fake.server.close();
  }
});

test('a block pasted from ChatGPT: preview first, then written; the same paste again writes nothing', async ({ page }) => {
  await open(page);
  await nutritionTab(page);
  const block = `Дата: 2026-10-22
Ккал: 3250 · Белки: 160 · Жиры: 90 · Углеводы: 420
Статус: итог · Приблизительно: нет

Дата: 2026-10-23
Ккал: 2100 · Белки: 120
Статус: черновик`;
  await page.getByRole('button', { name: 'Вставить из ChatGPT' }).click();
  let sheet = page.getByRole('dialog', { name: 'Вставить из ChatGPT' });
  await sheet.getByLabel('Текст').fill(block);
  const preview = sheet.getByRole('list', { name: 'Что будет записано' });
  await expect(preview.locator('.row')).toHaveCount(2);
  await expect(preview.locator('.row').first()).toContainText('22 октября');
  await expect(preview.locator('.row').first()).toContainText('создан');
  await expect(preview.locator('.row').nth(1)).toContainText('черновик');
  expect(await rec(page, '2026-10-22')).toBeNull(); // nothing written by the preview
  await sheet.getByRole('button', { name: 'Записать 2 дня' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Записано дней: 2');
  expect(await rec(page, '2026-10-22')).toMatchObject({ kcal: 3250, source: 'chatgpt', status: 'final' });

  // Again: «без изменений», and the button has nothing to write.
  await page.getByRole('button', { name: 'Вставить из ChatGPT' }).click();
  sheet = page.getByRole('dialog', { name: 'Вставить из ChatGPT' });
  await sheet.getByLabel('Текст').fill(block.split('\n\n')[0]);
  await expect(sheet.getByRole('list', { name: 'Что будет записано' })).toContainText('без изменений');
  await expect(sheet.getByRole('button', { name: 'Нечего записывать' })).toBeDisabled();
  // A draft for a day with the final: skipped.
  await sheet.getByLabel('Текст').fill('Дата: 2026-10-22\nКкал: 1500\nСтатус: черновик');
  await expect(sheet.getByRole('list', { name: 'Что будет записано' })).toContainText('пропущен: черновик не заменяет итог');
  await expect(sheet.getByRole('button', { name: 'Нечего записывать' })).toBeDisabled();
});

test('old days from a table: new, same, different and errors before writing; only ticked days replaced; «Отменить»', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const { store } = window.__trainer;
    await store.saveNutrition({ date: '2026-10-01', kcal: 3200, protein: 155, fat: 85, carbs: 410, status: 'final' });
    await store.saveNutrition({ date: '2026-10-02', kcal: 3300, protein: 160, fat: 90, carbs: 420, status: 'final' });
  });
  await nutritionTab(page);
  await page.locator('main .row', { hasText: 'Загрузить старые дни' }).click();
  const sheet = page.getByRole('dialog', { name: 'Старые дни' });
  await sheet.locator('input[type=file]').setInputFiles({ name: 'kbju.csv', mimeType: 'text/csv', buffer: Buffer.from([
    'дата;ккал;белки;жиры;углеводы;статус',
    '2026-10-01;3200;155;85;410;итог',
    '2026-10-02;3500;170;95;430;итог',
    '2026-10-03;3100;150;80;400;итог',
    '2026-10-04;;;;;итог',
    '2026-10-05;3000;150;80;390;итог',
    '05.10.2026;3100;150;80;400;итог',
  ].join('\n'), 'utf8') });
  await expect(sheet.locator('.nutr-plan')).toHaveText('Новых: 2 · совпадают: 1 · отличаются: 1 · ошибок: 2');
  await expect(sheet.getByRole('alert')).toContainText('Строка 5: нет ни одного значения');
  await expect(sheet.getByRole('alert')).toContainText('Строка 7: дата 2026-10-05 уже есть выше в этом файле — дни не складываются');
  await expect(sheet.getByRole('button', { name: 'Записать 2 дня' })).toBeEnabled();
  await sheet.getByRole('checkbox').check();
  await sheet.getByRole('button', { name: 'Записать 3 дня' }).click();
  await expect(sheet).toHaveCount(0);
  expect((await rec(page, '2026-10-02')).kcal).toBe(3500);
  expect((await rec(page, '2026-10-03')).source).toBe('import');
  expect((await rec(page, '2026-10-05')).kcal).toBe(3000); // the second 5.10 is an error, not a sum or a replacement
  await page.locator('.toast').getByRole('button', { name: 'Отменить' }).click();
  await expect.poll(async () => (await rec(page, '2026-10-02')).kcal).toBe(3300);
  expect((await rec(page, '2026-10-03'))?.deleted ?? true).toBe(true);
  expect((await rec(page, '2026-10-05'))?.deleted ?? true).toBe(true);
  expect((await rec(page, '2026-10-01')).kcal).toBe(3200);
});

test('goals per phase: set in the app with the carbs remainder; a new phase has its own; past days keep theirs', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-24T12:00:00+03:00'));
  await open(page);
  await page.evaluate(async () => {
    const { store } = window.__trainer;
    await store.savePhase({ mode: 'bulk', start: '2026-10-01', targetPct: 0.25 });
    await store.saveNutrition({ date: '2026-10-24', kcal: 3300, protein: 145, fat: 90, carbs: 450, status: 'final' });
  });
  await nutritionTab(page);
  const goalsCard = page.getByRole('region', { name: 'Цели по питанию' });
  await expect(goalsCard).toContainText('Цели для этого режима не заданы.');
  await goalsCard.getByRole('button', { name: 'Задать цели' }).click();
  const sheet = page.getByRole('dialog', { name: 'Цели по питанию' });
  await expect(sheet.getByLabel('Действуют с')).toHaveValue('2026-10-01');
  await sheet.getByLabel('Калории: от').fill('3200');
  await sheet.getByLabel('Калории: до').fill('3500');
  await sheet.getByLabel('Белки: от').fill('150');
  await sheet.getByLabel('Белки: до').fill('170');
  await sheet.getByLabel('Жиры: от').fill('80');
  await sheet.getByLabel('Жиры: до').fill('100');
  await expect(sheet).toContainText('Остаток калорий после белков (4 ккал/г) и жиров (9 ккал/г): 405–545 г.');
  await sheet.getByRole('button', { name: 'Сохранить' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(goalsCard).toContainText('Калории: 3200–3500 ккал');
  await expect(goalsCard).toContainText('Углеводы: остаток, 405–545 г');

  const today = page.getByRole('region', { name: 'Питание за учётный день' });
  await expect(today).toContainText('из 3200–3500 ккал');
  await expect(today.locator('.nutr-cell').first()).toContainText('ниже цели');

  // A cut from 25.10: no goals of its own yet; 24.10 still counts against the bulk.
  await page.evaluate(() => window.__trainer.store.savePhase({ mode: 'cut', start: '2026-10-25', targetPct: -0.5 }));
  const on = (date) => page.evaluate(async (d) => {
    const { goalsOn } = await import('./js/lib/nutrition.js');
    const st = window.__trainer.store.state;
    return goalsOn([...st.nutritionGoals.values()], [...st.phases.values()], d)?.kcalMin ?? null;
  }, date);
  expect(await on('2026-10-24')).toBe(3200);
  expect(await on('2026-10-25')).toBe(null);
  // The phase moved back to 20.10: 24.10 now belongs to the cut, without goals.
  await page.evaluate(async () => {
    const { store } = window.__trainer;
    const cut = [...store.state.phases.values()].find((p) => p.mode === 'cut');
    const bulk = [...store.state.phases.values()].find((p) => p.mode === 'bulk');
    await store.savePhase({ ...bulk, end: '2026-10-19' });
    await store.savePhase({ ...cut, start: '2026-10-20' });
  });
  expect(await on('2026-10-24')).toBe(null);
  await expect(today).toContainText('цель не задана');
});

test('the accounting day: at 02:30 a new entry goes to yesterday; the hour is a setting; an explicit date wins', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-24T02:30:00+03:00'));
  await open(page);
  await nutritionTab(page);
  const today = page.getByRole('region', { name: 'Питание за учётный день' });
  await expect(today).toContainText('23 октября');
  await expect(today).toContainText('Учётный день сменится в 07:00, а не в полночь.');
  await page.getByRole('button', { name: 'Записать итог дня' }).click();
  const sheet = page.getByRole('dialog', { name: 'Итог дня' });
  await expect(sheet.getByLabel('Учётный день')).toHaveValue('2026-10-23');
  await sheet.getByLabel('Калории, ккал').fill('3350');
  await sheet.getByRole('button', { name: 'Сохранить' }).click();
  expect((await rec(page, '2026-10-23')).kcal).toBe(3350);
  expect(await rec(page, '2026-10-24')).toBeNull();
  await expect(today).toContainText('3350');

  // A new day from midnight instead: today is 24.10, the 23rd stays where it was.
  await page.locator('main .row', { hasText: 'Учётный день' }).click();
  const set = page.getByRole('dialog', { name: 'Учётный день' });
  await set.getByLabel('Новый день начинается в').selectOption('0');
  await set.getByRole('button', { name: 'Сохранить' }).click();
  await expect(today).toContainText('24 октября');
  expect((await rec(page, '2026-10-23')).kcal).toBe(3350);
  // An explicit date in the entry.
  await page.getByRole('button', { name: 'Записать итог дня' }).click();
  await sheet.getByLabel('Учётный день').fill('2026-10-21');
  await sheet.getByLabel('Калории, ккал').fill('3100');
  await sheet.getByRole('button', { name: 'Сохранить' }).click();
  expect((await rec(page, '2026-10-21')).kcal).toBe(3100);
});

test('the weekly report from Home, Тело and Питание; the copy for ChatGPT holds totals only', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.clock.setFixedTime(new Date('2026-10-29T12:00:00+03:00'));
  await open(page);
  await page.evaluate(async () => {
    const { store } = window.__trainer;
    await store.savePhase({ mode: 'bulk', start: '2026-09-01', targetPct: 0.25 });
    for (let d = 19; d <= 25; d++) await store.saveNutrition({ date: `2026-10-${d}`, kcal: 3300, protein: 160, fat: 90, carbs: 400, status: 'final', comment: 'гости у соседа' });
  });
  await page.getByRole('button', { name: 'Отчёт за неделю' }).click();
  await expect(page.getByRole('heading', { name: 'Отчёт за неделю' })).toBeVisible();
  await expect(page.locator('.report-period').first()).toContainText('19 октября — 25 октября: последняя полная неделя');
  for (const title of ['Тренировки', 'Тело', 'Питание', 'Сон']) await expect(page.getByRole('region', { name: title })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Питание' })).toContainText('Средняя калорийность по 7 из 7 дней — 3300 ккал.');
  await expect(page.getByRole('region', { name: 'Питание' })).toContainText('недостаточно данных');
  await expect(page.getByRole('region', { name: 'Сон' })).toContainText('Сон: за неделю данных нет — недостаточно данных.');
  await page.getByRole('button', { name: 'Скопировать отчёт для ChatGPT' }).click();
  await expect(page.locator('.toast')).toContainText('Скопировано');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^Отчёт за неделю 19 октября — 25 октября, режим: Набор с 1 сентября/);
  expect(text).toContain('Питание:\n- ');
  expect(text).not.toContain('гости у соседа');

  await page.getByRole('button', { name: 'Назад' }).click();
  await page.locator('.tabbar').getByRole('button', { name: 'Тело' }).click();
  await page.locator('main .row', { hasText: 'Отчёт за неделю' }).click();
  await expect(page.getByRole('heading', { name: 'Отчёт за неделю' })).toBeVisible();
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('group', { name: 'Раздел' }).getByRole('button', { name: 'Питание' }).click();
  await page.getByRole('region', { name: 'Питание за неделю' }).getByRole('button', { name: 'Отчёт за неделю' }).click();
  await expect(page.getByRole('heading', { name: 'Отчёт за неделю' })).toBeVisible();
});

test('320 px: «Питание», its sheets and the report fit without sideways scrolling', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 568 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const page = await context.newPage();
  try {
    await page.clock.setFixedTime(new Date('2026-10-24T12:00:00+03:00'));
    await open(page);
    await page.evaluate(async () => {
      const { store } = window.__trainer;
      const p = await store.savePhase({ mode: 'bulk', start: '2026-10-01', targetPct: 0.25 });
      await store.saveNutritionGoals({ phaseId: p.id, from: '2026-10-01', kcalMin: 3200, kcalMax: 3500, proteinMin: 150, proteinMax: 170, fatMin: 80, fatMax: 100, carbsMode: 'rest' });
      for (let d = 18; d <= 24; d++) await store.saveNutrition({ date: `2026-10-${d}`, kcal: 3280 + d, protein: 158, fat: 91, carbs: 455, status: d === 24 ? 'draft' : 'final', approx: d === 21 });
    });
    await nutritionTab(page);
    const wide = () => page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    expect(await wide()).toBeLessThanOrEqual(0);
    for (const cell of await page.locator('.nutr-cell').all()) {
      const box = await cell.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
    await page.getByRole('button', { name: 'Записать итог дня' }).click();
    const sheet = page.getByRole('dialog', { name: /Питание, 24 октября/ });
    await expect(sheet.getByRole('button', { name: 'Сохранить' })).toBeInViewport();
    expect(await wide()).toBeLessThanOrEqual(0);
    await sheet.getByRole('button', { name: 'Закрыть' }).click();
    await page.getByRole('region', { name: 'Питание за неделю' }).getByRole('button', { name: 'Отчёт за неделю' }).click();
    await expect(page.getByRole('button', { name: 'Скопировать отчёт для ChatGPT' })).toBeVisible();
    expect(await wide()).toBeLessThanOrEqual(0);
  } finally {
    await context.close();
  }
});
