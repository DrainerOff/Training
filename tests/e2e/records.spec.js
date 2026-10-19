// «Прогресс → Рекорды»: manual entry, automatic detection from workouts, history that never
// loses an earlier achievement, offline, sync (also against the Apps Script deployed today),
// the IndexedDB upgrade from a published release, and the smallest iPhone screen.
import { test, expect, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { startStatic, startFakeGas } from '../helpers/servers.js';
import { startPages, APP, RELEASES, ROOT } from '../helpers/pages-server.js';
import { ready, dock, logButton, connectSync } from './helpers.js';

const API1 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/apps-script/Code.api1.gs'), 'utf8');
const HAMMER = 'Наклонный жим: Hammer - наклон';

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
  await page.getByRole('button', { name: 'Понятно' }).click();
}

async function toRecords(page) {
  await page.locator('.tabbar').getByRole('button', { name: 'Прогресс' }).click();
  await page.getByRole('group', { name: 'Раздел' }).getByRole('button', { name: 'Рекорды' }).click();
  await expect(page.getByRole('heading', { name: 'Рекорды' })).toBeVisible();
}

async function pad(page, keys) {
  for (const k of keys) await page.locator('.pad__keys button', { hasText: new RegExp(`^${k}$`) }).click();
  await page.getByRole('button', { name: 'Готово' }).click();
}

async function addManual(page, { search, exercise, weight, reps, date, rir = null, note = '' }) {
  await page.getByRole('button', { name: 'Добавить рекорд' }).click();
  const sheet = page.getByRole('dialog', { name: 'Новый рекорд' });
  await sheet.getByRole('button', { name: /^Упражнение:/ }).click();
  await page.getByRole('searchbox', { name: 'Поиск упражнения' }).fill(search);
  await page.getByRole('dialog', { name: 'Упражнение' }).getByRole('button', { name: new RegExp(exercise) }).click();
  await sheet.getByRole('button', { name: /^Вес: .*Нажмите/ }).click();
  await pad(page, [...String(weight).replace('.', ',')]);
  await sheet.getByRole('button', { name: /^Повторения: .*Нажмите/ }).click();
  await pad(page, [...String(reps)]);
  if (rir != null) await sheet.getByRole('group', { name: 'Фактический RIR' }).getByRole('button', { name: String(rir), exact: true }).click();
  await sheet.getByLabel('Дата').fill(date);
  if (note) await sheet.getByLabel(/Заметка/).fill(note);
  await sheet.getByRole('button', { name: 'Сохранить' }).click();
  await expect(sheet).toHaveCount(0);
}

test('manual record: any past date, marked «вручную», kept after a relaunch and offline', async ({ page, context }) => {
  await open(page);
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready) && !!navigator.serviceWorker.controller);
  await toRecords(page);
  await addManual(page, { search: 'hammer', exercise: HAMMER, weight: 95, reps: 5, rir: 1, date: '2025-04-12', note: 'до перерыва' });
  await expect(page.locator('.toast')).toContainText('Сохранено: 95×5 — первый результат на 5 повторений');

  await page.getByRole('button', { name: new RegExp(HAMMER) }).first().click();
  const row5 = page.locator('.rec').filter({ hasText: /^5повт\./ });
  await expect(row5).toContainText('95 кг');
  await expect(row5).toContainText('12 апреля 2025, RIR 1');
  await expect(row5.locator('.src--manual')).toHaveText('вручную');
  await expect(page.locator('.rec-history')).toContainText('12 апреля 2025 · вручную ›');
  await expect(page.locator('.rows').last()).toContainText('до перерыва');

  // Close and reopen: still there. Then airplane mode: the app starts and takes another entry.
  await page.reload();
  await ready(page);
  await toRecords(page);
  await expect(page.locator('.rows')).toContainText(HAMMER);
  await context.setOffline(true);
  await page.reload();
  await ready(page);
  await toRecords(page);
  await addManual(page, { search: 'жим штанги', exercise: 'Штанга - горизонт', weight: 82.5, reps: 5, date: '2026-10-10' });
  await page.getByRole('button', { name: /Штанга - горизонт/ }).first().click();
  await expect(page.locator('.rec').filter({ hasText: /^5повт\./ })).toContainText('82,5 кг');
  await context.setOffline(false);
});

test('a record set in a workout is detected right away; earlier achievements stay in the history', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Другой день или неделя' }).click();
  await page.getByRole('group', { name: 'Неделя цикла' }).getByRole('button').nth(1).click();
  await page.getByRole('group', { name: 'День' }).getByRole('button', { name: '1', exact: true }).click();
  await page.getByRole('button', { name: 'Выбрать' }).click();
  await page.getByRole('button', { name: 'Начать тренировку' }).click();
  await page.getByRole('button', { name: new RegExp(HAMMER) }).click();
  await expect(logButton(page)).toContainText('90 × 9'); // last time, same week
  await page.getByRole('button', { name: 'Увеличить: Вес' }).click();
  await expect(logButton(page)).toContainText('92,5 × 9');
  await logButton(page).click();
  await expect(dock(page)).toContainText('Новый рекорд: 92,5×9');

  // The tab bar is hidden during a workout: the workout menu leads to Прогресс.
  await page.getByRole('button', { name: 'Меню тренировки' }).click();
  await page.getByRole('group', { name: 'Разделы' }).getByRole('button', { name: 'Прогресс' }).click();
  await page.getByRole('group', { name: 'Раздел' }).getByRole('button', { name: 'Рекорды' }).click();
  await expect(page.locator('.rows').first()).toContainText('92,5×9 — рекорд на 9 повторений (было 90 кг, 16 октября)');
  await page.locator('.rows').last().getByRole('button', { name: new RegExp(HAMMER) }).click();
  await expect(page.locator('.callout')).toContainText('Новый рекорд');
  const history = page.locator('.rec-event__text');
  await expect(history).toHaveText(['92,5×9 — рекорд на 9 повторений (было 90 кг, 16 октября)', '90×9 — первый результат на 9 повторений']);
  await expect(page.locator('.rec').filter({ hasText: /^9повт\./ })).toContainText('92,5 кг');
});

test('edit and delete a manual entry; undo brings it back; the rest of the history is untouched', async ({ page }) => {
  await open(page);
  await toRecords(page);
  await addManual(page, { search: 'hammer', exercise: HAMMER, weight: 95, reps: 5, date: '2025-04-12' });
  await page.getByRole('button', { name: new RegExp(HAMMER) }).first().click();
  await page.locator('.rows').last().getByRole('button').first().click();
  const sheet = page.getByRole('dialog', { name: 'Изменить рекорд' });
  await sheet.getByRole('button', { name: 'Увеличить: Повторения' }).click();
  await sheet.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('.rec').filter({ hasText: /^6повт\./ })).toContainText('95 кг');
  await expect(page.locator('.rec').filter({ hasText: /^5повт\./ })).toHaveCount(0);
  const ids = await page.evaluate(() => [...window.__trainer.store.state.records.keys()]);
  expect(ids).toHaveLength(1); // edited in place: same id

  await page.locator('.rows').last().getByRole('button').first().click();
  await page.getByRole('dialog', { name: 'Изменить рекорд' }).getByRole('button', { name: 'Удалить' }).click();
  await page.getByRole('dialog', { name: 'Удалить запись?' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(page.locator('.toast')).toContainText('Запись удалена');
  await expect(page.locator('.rec').filter({ hasText: /^6повт\./ })).toHaveCount(0);
  await expect(page.locator('.rec').filter({ hasText: /^9повт\./ })).toContainText('90 кг'); // 16.10 untouched
  await page.locator('.toast').getByRole('button', { name: 'Вернуть' }).click();
  await expect(page.locator('.rec').filter({ hasText: /^6повт\./ })).toContainText('95 кг');
});

test('16.10.2026: no invented 1-rep record, the 1RM estimate is labelled as a reference, honest "not enough data"', async ({ page }) => {
  await open(page);
  await toRecords(page);
  await page.getByRole('button', { name: /Жим штанги лежа: Штанга - горизонт/ }).click();
  await expect(page.locator('.rec__reps b')).toHaveText(['7', '10']); // 9 reps is covered by 75×10
  await page.getByRole('button', { name: /Показать перекрытые/ }).click();
  await expect(page.locator('.rec__reps b')).toHaveText(['7', '9', '10']);
  await expect(page.locator('.rec--covered')).toContainText('перекрыт: 75×10');
  await expect(page.locator('.rec-facts')).toContainText('Максимальный вес: 80 кг на 7 повторений');
  await expect(page.locator('.rec-facts')).toContainText('Расчётный 1ПМ ≈ 100 кг — ориентир по формуле, а не рекорд: подхода на 1 повторение не было');
  await expect(page.locator('.callout')).toContainText('Мало данных');
  await expect(page.locator('.callout')).toContainText('Недостаточно данных для оценки');
  await page.getByRole('button', { name: '1ПМ (расчёт)' }).click();
  await expect(page.locator('figcaption')).toContainText('Это не рекорд');
});

test('sync: a manual record reaches App_Records; with the old Apps Script it waits on the phone', async ({ page }) => {
  for (const [label, code] of [['new', null], ['old', API1]]) {
    const gas = await startFakeGas({ port: 0, ...(code ? { code } : {}) });
    const port = gas.server.address().port;
    try {
      await page.goto(base);
      await ready(page);
      await page.evaluate(() => Promise.all([...window.__trainer.store.state.records.keys()].map((id) => window.__trainer.store.deleteRecord(id))));
      await connectSync(page, `http://127.0.0.1:${port}/exec`, gas.token);
      await page.evaluate(async () => {
        const { store, sync } = window.__trainer;
        await store.saveRecord({ seriesKey: 'naklonnyy-zhim-hammer-naklon', exercise: 'Наклонный жим: Hammer - наклон', category: 'hammer', date: '2025-04-12', weight: 95, reps: 5 });
        await sync.syncNow();
      });
      const sheet = await (await fetch(`http://127.0.0.1:${port}/__state`)).json();
      if (label === 'new') {
        expect(sheet.App_Records.filter((r) => r[2] === 95)).toHaveLength(1);
        expect(await page.evaluate(() => window.__trainer.sync.status.notice)).toBeNull();
      } else {
        expect(sheet.App_Records).toBeUndefined();
        const st = await page.evaluate(() => ({ ...window.__trainer.sync.status }));
        expect(st.waiting).toBeGreaterThan(0);
        expect(st.pending).toBe(0); // waiting for the script is not «в очереди»
        await page.getByRole('button', { name: /Синхронизация:/ }).first().click();
        await expect(page.locator('.sync-notice')).toContainText(/рекорды, добавленные вручную — \d+/);
        await expect(page.locator('.sync-notice')).toContainText('после обновления Apps Script');
      }
    } finally {
      gas.server.close();
    }
  }
});

test('update from release 7705635: the database gains the records store, workouts stay, records survive a relaunch', async ({ page }) => {
  const pages = await startPages();
  try {
    pages.publish(path.join(RELEASES, '7705635'), '7705635');
    await page.goto(pages.url);
    await page.waitForFunction(() => window.__trainer?.store.state.loaded);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const sets = await page.evaluate(async () => {
      const { store } = window.__trainer;
      const s = await store.startSession({ cycle: 1, week: 2, day: 1 });
      await store.logSet(s.id, s.items[1].slotId, { weight: 92.5, reps: 9, rir: 1 });
      return store.state.sets.size;
    });
    pages.publish(APP, 'new1');
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL && fetch('./sw.js?probe=1').then(() => true)), { timeout: 20_000 }).toBe(true);
    for (let i = 0; i < 3 && !(await page.evaluate(() => window.__trainer?.build === 'new1')); i++) {
      await page.waitForTimeout(1500);
      await page.reload();
      await page.waitForFunction(() => window.__trainer?.store.state.loaded || document.querySelector('.diag'));
    }
    expect(await page.evaluate(() => window.__trainer.build)).toBe('new1');
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'trainer', version: 5 }]);
    expect(await page.evaluate(() => window.__trainer.store.state.sets.size)).toBe(sets);
    await page.evaluate(() => window.__trainer.store.saveRecord({ seriesKey: 'naklonnyy-zhim-hammer-naklon', exercise: 'Наклонный жим: Hammer - наклон', category: 'hammer', date: '2025-04-12', weight: 95, reps: 5 }));
    await page.reload();
    await page.waitForFunction(() => window.__trainer?.store.state.loaded);
    expect(await page.evaluate(() => [...window.__trainer.store.state.records.values()].map((r) => `${r.weight}x${r.reps}`))).toEqual(['95x5']);
    // The workout set logged in the old release is now a record in the new one.
    const hammer = await page.evaluate(() => import('./js/ui/derive.js').then(({ recordsDerived }) => recordsDerived().books.get('naklonnyy-zhim-hammer-naklon').table.map((r) => `${r.reps}:${r.best.weight}`)));
    expect(hammer).toContain('9:92.5');
  } finally {
    await pages.close();
  }
});

test('smallest iPhone: records card and the entry sheet fit, nothing hidden behind the tab bar', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 568 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const page = await context.newPage();
  await open(page);
  await toRecords(page);
  await page.getByRole('button', { name: new RegExp(HAMMER) }).first().click();
  await expect(page.getByRole('button', { name: 'Добавить рекорд вручную' })).toBeAttached();
  // Opening a card scrolls it to the top after paint; scroll down once that has happened.
  await expect(async () => {
    await page.locator('.screen').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(100);
    const add = await page.getByRole('button', { name: 'Добавить рекорд вручную' }).boundingBox();
    const tab = await page.locator('.tabbar').boundingBox();
    expect(add.y + add.height).toBeLessThanOrEqual(tab.y);
  }).toPass({ timeout: 3000 });
  await page.getByRole('button', { name: 'Добавить рекорд вручную' }).click();
  const sheet = page.getByRole('dialog', { name: 'Новый рекорд' });
  await page.waitForTimeout(350);
  const sb = await sheet.boundingBox();
  expect(sb.y).toBeGreaterThanOrEqual(0);
  expect(sb.y + sb.height).toBeLessThanOrEqual(568.5);
  await sheet.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const save = await sheet.getByRole('button', { name: /Укажите вес|Сохранить/ }).boundingBox();
  expect(save.y + save.height).toBeLessThanOrEqual(568.5);
  await context.close();
});

test('pull-ups: added weight, optional bodyweight — an impossible bodyweight is not accepted', async ({ page }) => {
  await open(page);
  await toRecords(page);
  await page.getByRole('button', { name: 'Добавить рекорд' }).click();
  const sheet = page.getByRole('dialog', { name: 'Новый рекорд' });
  await sheet.getByRole('button', { name: /^Упражнение:/ }).click();
  await page.getByRole('searchbox', { name: 'Поиск упражнения' }).fill('нейтральным');
  await page.getByRole('dialog', { name: 'Упражнение' }).getByRole('button', { name: /Подтягивания нейтральным хватом/ }).click();
  await expect(sheet).toContainText('Доп. вес, кг');
  await expect(sheet).toContainText('0 — свой вес');
  await sheet.getByRole('button', { name: 'Увеличить: Дополнительный вес' }).click();
  await sheet.getByRole('button', { name: 'Увеличить: Повторения' }).click();
  await sheet.getByLabel(/Масса тела/).fill('-80');
  await expect(sheet.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  await expect(sheet).toContainText('Масса тела — от 1 до 400 кг или пусто');
  await sheet.getByLabel(/Масса тела/).fill('82,5');
  await sheet.getByRole('button', { name: 'Сохранить' }).click();
  const rec = await page.evaluate(() => [...window.__trainer.store.state.records.values()][0]);
  expect([rec.category, rec.weight, rec.reps, rec.bodyweight]).toEqual(['pullup', 2.5, 1, 82.5]);
});
