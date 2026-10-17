import { test, expect, chromium, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startStatic, startFakeGas } from '../helpers/servers.js';
import { ready, importProgramViaUi, seedHistory, state, dock, logButton, logSet, connectSync } from './helpers.js';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

async function pad(page, keys) {
  for (const k of keys) await page.locator('.pad__keys button', { hasText: new RegExp(`^${k === ',' ? ',' : k}$`) }).click();
  await page.getByRole('button', { name: 'Готово' }).click();
}

test('gym flow: carry-over weight, per-set weights, edit, undo, swap, resume after reload, finish', async ({ page }) => {
  await page.goto(base);
  await ready(page);
  await importProgramViaUi(page);
  await page.getByRole('button', { name: 'Начать тренировку' }).click();

  // Pull-ups: 3×6 strict at bodyweight, pre-filled — one tap per set.
  await expect(dock(page)).toContainText('Подтягивания прямым хватом: подход 1 из 3');
  await expect(logButton(page)).toContainText('СВ × 6');
  await logSet(page);
  await page.getByRole('button', { name: 'Уменьшить: Повторения' }).click();
  await logSet(page);
  await page.getByRole('button', { name: 'Увеличить: Повторения' }).click();
  await logSet(page);

  // Auto-advance to the next exercise; light week = 3 sets; no history → weight must be entered.
  await expect(page.locator('.panel__title')).toHaveText('Жим штанги под наклоном');
  await expect(dock(page)).toContainText('Готово: Подтягивания прямым хватом');
  await expect(dock(page)).toContainText('Жим штанги под наклоном: подход 1 из 3', { timeout: 8000 });
  await expect(logButton(page)).toHaveText('Введите вес');
  await page.locator('.dock .stepper__value').nth(0).click();
  await pad(page, ['6', '0']);
  await page.locator('.dock .stepper__value').nth(1).click();
  await pad(page, ['1', '0']);
  await expect(logButton(page)).toContainText('60 × 10');
  await logSet(page);

  // Weight carries over — not typed again.
  await expect(page.locator('.dock .stepper__value').nth(0)).toHaveText('60');
  await expect(dock(page)).toContainText('как подход 1');
  await page.getByRole('button', { name: 'Уменьшить: Повторения' }).click();
  await logSet(page);
  // Lower the weight for the last set only.
  await page.getByRole('button', { name: 'Уменьшить: Вес' }).click();
  await logSet(page);
  let st = await state(page);
  expect(st.activeSets.filter((s) => s.key.startsWith('zhim')).map((s) => [s.w, s.r])).toEqual([[60, 10], [60, 9], [57.5, 9]]);

  // Edit set 2 individually.
  await page.getByRole('button', { name: /Жим штанги под наклоном: 3 из 3/ }).click();
  await page.getByRole('button', { name: /Подход 2: 60 на 9/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Увеличить: Вес' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  st = await state(page);
  expect(st.activeSets.filter((s) => s.key.startsWith('zhim')).map((s) => [s.w, s.r])).toEqual([[60, 10], [62.5, 9], [57.5, 9]]);

  // Swap Hammer → dumbbells: a different series.
  await page.getByRole('button', { name: /Наклонный Hammer: 0 из 3/ }).click();
  await page.getByRole('button', { name: 'Заменить' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Наклонный жим гантелей/ }).click();
  await expect(dock(page)).toContainText('Наклонный жим гантелей: подход 1 из 3');
  await page.locator('.dock .stepper__value').nth(0).click();
  await pad(page, ['2', '6']);
  await page.locator('.dock .stepper__value').nth(1).click();
  await pad(page, ['1', '2']);
  await logSet(page);
  // Undo right from the dock.
  await page.getByRole('button', { name: 'Уменьшить: Повторения' }).click();
  await logSet(page);
  await page.locator('.dock__undo').click();
  st = await state(page);
  const db = st.activeSets.filter((s) => s.key === 'naklonnyy-zhim-ganteley');
  expect(db.map((s) => [s.w, s.r])).toEqual([[26, 12]]);

  // Unsaved input survives a full reload, as does the whole workout.
  await page.getByRole('button', { name: 'Увеличить: Вес' }).click();
  await page.getByRole('button', { name: 'Увеличить: Вес' }).click();
  const before = await state(page);
  await page.reload();
  await ready(page);
  const after = await state(page);
  expect(after.active.id).toBe(before.active.id);
  expect(after.activeSets).toEqual(before.activeSets);
  await expect(dock(page)).toContainText('Наклонный жим гантелей: подход 2 из 3');
  await expect(page.locator('.dock .stepper__value').nth(0)).toHaveText('31');

  // Finish → next workout is day 2.
  await page.getByRole('button', { name: 'Завершить тренировку' }).click();
  await expect(page.getByRole('dialog')).toContainText('Наклонный жим гантелей');
  await page.getByRole('dialog').getByRole('button', { name: 'Завершить' }).click();
  await expect(page.locator('.next__title')).toHaveText('День 2');
  await page.getByRole('button', { name: 'История' }).click();
  await expect(page.locator('.row').first()).toContainText('3 упражнения, 7 подходов');
});

test('previous results are hints only; double tap records one set', async ({ page }) => {
  await page.goto(base);
  await ready(page);
  await importProgramViaUi(page);
  await seedHistory(page);
  // Choose week 3, day 1 of cycle 2 (comparable to cycle 1, week 3).
  await page.getByRole('button', { name: 'Другой день или неделя' }).click();
  await page.getByRole('group', { name: 'Неделя цикла' }).getByRole('button').nth(2).click();
  await page.getByRole('group', { name: 'День' }).getByRole('button', { name: '1', exact: true }).click();
  await page.getByRole('button', { name: 'Выбрать' }).click();
  await expect(page.locator('.plan-list')).toContainText('прошлый раз на этой неделе: 85×8, 85×7, 85×7, 85×6');
  await page.getByRole('button', { name: 'Начать тренировку' }).click();
  await page.getByRole('button', { name: /Жим штанги под наклоном/ }).click();

  await expect(page.locator('.prev__label')).toHaveText('Цикл 1, та же неделя, 2 октября');
  await expect(page.locator('.ghost')).toHaveCount(4);
  let st = await state(page);
  expect(st.activeSets).toEqual([]); // nothing recorded until the owner taps
  await expect(dock(page)).toContainText('как в прошлый раз');
  await expect(logButton(page)).toContainText('85 × 8');

  await logButton(page).dblclick();
  await page.waitForTimeout(300);
  st = await state(page);
  expect(st.activeSets.map((s) => [s.w, s.r])).toEqual([[85, 8]]);
});

test('progress compares the same week of the cycle and keeps alternatives apart', async ({ page }) => {
  await page.goto(base);
  await ready(page);
  await importProgramViaUi(page);
  await seedHistory(page);
  await page.getByRole('button', { name: 'Прогресс' }).click();
  const row = (name) => page.locator('.row').filter({ hasText: name }).first();
  await expect(row('Жим штанги под наклоном')).toContainText('Прогресс');
  await expect(row('Жим штанги под наклоном')).toContainText('+2 повторения при том же весе');
  await expect(row('Сгибание ног лёжа')).toContainText('Разовая просадка');
  await expect(row('Наклонный жим гантелей')).toContainText('Мало данных');
  await expect(row('Наклонный Hammer')).toContainText('Мало данных');
  await expect(row('Подтягивания прямым хватом')).toContainText('+2,5 кг при тех же повторениях');

  await row('Жим штанги под наклоном').click();
  await expect(page.locator('.expo').first()).toContainText('к 25 сентября');
  await expect(page.locator('.chart circle')).toHaveCount(12);
});

test('sync: lost responses and retries never duplicate rows in the sheet', async ({ page }) => {
  const gas = await startFakeGas({ port: 0 });
  const url = `http://127.0.0.1:${gas.server.address().port}/exec`;
  try {
    await page.goto(base);
    await ready(page);
    await importProgramViaUi(page);
    await connectSync(page, url, gas.token);
    await page.getByRole('button', { name: 'Начать тренировку' }).click();
    gas.control.dropResponses = 2;
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'Уменьшить: Повторения' }).click();
      await logSet(page);
    }
    for (let i = 0; i < 4; i++) await page.evaluate(() => window.__trainer.sync.syncNow());
    await expect.poll(async () => (await state(page)).outbox).toBe(0);
    const sheet = await (await fetch(`http://127.0.0.1:${gas.server.address().port}/__state`)).json();
    expect(sheet.App_Sets.length - 1).toBe(3);
    expect(sheet.App_Sessions.length - 1).toBe(1);
    await expect(page.locator('.sync').first()).toHaveText(/Сохранено/);

    // Wrong key → visible error, data stays queued.
    await connectSync(page, url, 'wrong');
    await page.evaluate(() => window.__trainer.store.saveMetric('2026-10-17', { bodyweight: 80.4 }));
    await page.evaluate(() => window.__trainer.sync.syncNow());
    await expect(page.locator('.sync').first()).toContainText('Ошибка');
    expect((await state(page)).outbox).toBeGreaterThan(0);
  } finally {
    gas.server.close();
  }
});

test('airplane mode: cold start after full close, keep training, sync later without duplicates', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-e2e-'));
  const appSrv = await startStatic({ port: 0 });
  const port = appSrv.address().port;
  const appUrl = `http://127.0.0.1:${port}/`;
  const gas = await startFakeGas({ port: 0 });
  const gasUrl = `http://127.0.0.1:${gas.server.address().port}/exec`;
  const launch = () => chromium.launchPersistentContext(profile, { ...devices['iPhone 13'] });
  try {
    // 1. First visit online: install the app shell, set things up.
    let ctx = await launch();
    let page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(appUrl);
    await ready(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await importProgramViaUi(page);
    await connectSync(page, gasUrl, gas.token);
    await page.evaluate(() => window.__trainer.sync.syncNow());
    await ctx.close();

    // 2. Airplane mode: the web server is gone AND the browser is offline. Full cold start.
    await new Promise((r) => appSrv.close(r));
    ctx = await launch();
    await ctx.setOffline(true);
    page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(appUrl);
    await ready(page);
    await page.getByRole('button', { name: 'Начать тренировку' }).click();
    await logSet(page);
    await page.getByRole('button', { name: 'Уменьшить: Повторения' }).click();
    await logSet(page);
    await page.evaluate(() => window.__trainer.sync.syncNow());
    await expect(page.locator('.sync').first()).toContainText('Офлайн');
    let st = await state(page);
    expect(st.activeSets.length).toBe(2);
    expect(st.outbox).toBeGreaterThan(0);
    await ctx.close();

    // 3. Still offline, closed and reopened again: nothing lost.
    ctx = await launch();
    await ctx.setOffline(true);
    page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(appUrl);
    await ready(page);
    st = await state(page);
    expect(st.activeSets.length).toBe(2);
    await page.getByRole('button', { name: 'Уменьшить: Повторения' }).click();
    await logSet(page);
    expect((await state(page)).activeSets.length).toBe(3);

    // 4. Connection is back: everything reaches the sheet exactly once.
    await ctx.setOffline(false);
    gas.control.dropResponses = 1;
    for (let i = 0; i < 3; i++) await page.evaluate(() => window.__trainer.sync.syncNow());
    await expect.poll(async () => (await state(page)).outbox).toBe(0);
    const sheet = await (await fetch(`http://127.0.0.1:${gas.server.address().port}/__state`)).json();
    expect(sheet.App_Sets.length - 1).toBe(3);
    await ctx.close();
  } finally {
    gas.server.close();
    appSrv.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
