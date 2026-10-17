// The real data from the owner's Google Sheet, as a fresh install sees it.
import { test, expect, devices } from '@playwright/test';
import { startStatic, startFakeGas } from '../helpers/servers.js';
import { ready, state, dock, connectSync } from './helpers.js';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

test('fresh install shows the real program and the 16.10 workout once; sync keeps one copy', async ({ page, browser }) => {
  const gas = await startFakeGas({ port: 0 });
  const gasUrl = `http://127.0.0.1:${gas.server.address().port}/exec`;
  const sheet = async () => (await fetch(`http://127.0.0.1:${gas.server.address().port}/__state`)).json();
  try {
    await page.goto(base);
    await ready(page);
    await expect(page.locator('.notice').first()).toContainText('Перенесено из Google Таблицы');
    await expect(page.locator('.notice').first()).toContainText('тренировка 16 октября: 23 подходов');
    // Next by plan = session 6 of the sheet: cycle 1, week 2, day 2.
    await expect(page.locator('.next__title')).toHaveText('День 2');
    await expect(page.locator('.next__meta')).toContainText('Цикл 1. Тяжёлая неделя');
    await expect(page.locator('.plan-list li')).toHaveCount(7);
    await expect(page.locator('.plan-list')).toContainText('Маятниковый присед');
    await expect(page.locator('.plan-list')).toContainText(/Икры в жиме ногами3 × 10–\u2060?12, RIR\s1–\u2060?2/);

    await page.getByRole('button', { name: 'Открыть 16 октября' }).click();
    await expect(page.locator('.wk-head__title')).toContainText('16 октября');
    await expect(page.locator('.ex__count')).toHaveText(['3/3', '4/4', '4/4', '3/3', '3/3', '3/3']);
    await expect(page.locator('.panel__title')).toHaveText('Подтягивания прямым хватом');
    await expect(page.locator('.set__main')).toHaveText(['24кг×6', '24кг×6', '24кг×6']);

    // Reload: still exactly one imported workout, notice gone.
    await page.reload();
    await ready(page);
    let st = await state(page);
    expect([st.sessions, st.allSets]).toEqual([1, 23]);
    await expect(page.getByText('Перенесено из Google Таблицы')).toHaveCount(0);

    // Variants stay separate: the incline barbell press has no history; the horizontal one has 16.10.
    await page.getByRole('button', { name: 'Другой день или неделя' }).click();
    await page.getByRole('group', { name: 'Неделя цикла' }).getByRole('button').nth(2).click();
    await page.getByRole('group', { name: 'День' }).getByRole('button', { name: '1', exact: true }).click();
    await page.getByRole('button', { name: 'Выбрать' }).click();
    await page.getByRole('button', { name: 'Начать тренировку' }).click();
    await page.getByRole('button', { name: /Жим штанги лежа: Штанга - наклон/ }).click();
    await expect(page.locator('.prev__label')).toContainText('ещё не выполнялось');
    await page.getByRole('button', { name: 'Заменить' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Штанга - горизонт/ }).click();
    await expect(page.locator('.prev__label')).toHaveText('Последний раз — неделя 2 (другая фаза), 16 октября');
    await expect(page.locator('.ghost')).toHaveText(['80×7', '75×9', '75×9', '75×10']);
    await expect(dock(page)).toContainText('как в прошлый раз');
    st = await state(page);
    expect(st.activeSets).toEqual([]);

    // Sync: the sheet gets one copy; a second phone importing again changes nothing.
    await connectSync(page, gasUrl, gas.token);
    await page.evaluate(() => window.__trainer.sync.syncNow());
    await expect.poll(async () => (await state(page)).outbox).toBe(0);
    let rows = await sheet();
    expect(rows.App_Sets.length - 1).toBe(23);
    expect(rows.App_Program.length - 1).toBe(29);

    const phone2 = await browser.newContext({ ...devices['iPhone 13'] });
    const p2 = await phone2.newPage();
    await p2.goto(base);
    await ready(p2);
    await connectSync(p2, gasUrl, gas.token);
    await p2.evaluate(() => window.__trainer.sync.syncNow());
    await expect.poll(async () => (await state(p2)).outbox).toBe(0);
    rows = await sheet();
    expect(rows.App_Sets.length - 1).toBe(23);
    expect(rows.App_Sessions.length - 1).toBe(2); // the imported one + the workout started above
    expect((await state(p2)).allSets).toBe(23);
    await phone2.close();
  } finally {
    gas.server.close();
  }
});
