// «Тело» in v1.1: loading history from files (preview, re-import, undo), manual measurements and
// corrections, sleep, offline, sync to App_Body / App_Sleep (and waiting while the deployed
// Apps Script is API 3), the update from v1.0.2 and the smallest iPhone. Synthetic data only.
import { test, expect, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { startStatic, startFakeGas } from '../helpers/servers.js';
import { startPages, APP, RELEASES, ROOT } from '../helpers/pages-server.js';
import { ready, connectSync } from './helpers.js';

const API3 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/apps-script/Code.api3.gs'), 'utf8');

const WEIGHT = [
  'local_datetime,weight_kg,source',
  '2026-10-01 07:10:05 +0300,80.10,Zepp Life',
  '2026-10-02 07:12:40 +0300,79.85,Zepp Life',
  '2026-10-03 07:05:00 +0300,80.30,Zepp Life',
  '2026-10-04 07:01:00 +0300,94.00,Zepp Life',
  '2026-10-05 07:02:00 +0300,80.40,Zepp Life',
  '2026-10-06 07:03:00 +0300,80.20,Zepp Life',
  'вчера,80,Zepp Life',
].join('\n');
const FITDAYS = '﻿Время;Шея;Талия;Л Рука;Соотношение талии и бедер\n19/10/2026 18:06;38.0 cm;84.5 cm;--;0.85\n';
const SLEEP = [
  'wake_date,sleep_start_local,sleep_end_local,sleep_hours,core_hours,deep_hours,rem_hours,unspecified_hours,segments,method',
  '2026-10-18,2026-10-17 23:30:00 +0300,2026-10-18 07:00:00 +0300,7.2,4.5,1.2,1.5,0,3,stages',
  '2026-10-19,2026-10-18 23:50:00 +0300,2026-10-19 06:40:00 +0300,6.5,4,1,1.5,0,2,stages',
].join('\n');

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
  await page.locator('.tabbar').getByRole('button', { name: 'Тело' }).click();
  await expect(page.getByRole('heading', { name: 'Тело и восстановление' })).toBeVisible();
}

async function upload(page, name, text) {
  await page.locator('.body-import input[type=file]').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });
  return page.getByRole('dialog', { name: 'Загрузка из файла' });
}

const live = (page, entity) => page.evaluate((e) => [...window.__trainer.store.state[e].values()].filter((r) => !r.deleted).length, entity);

test('without measurements the tab explains where they come from', async ({ page }) => {
  await open(page);
  await expect(page.getByText(/Взвешиваний из «Здоровья» пока нет/)).toBeVisible();
  await expect(page.getByText('Нет замеров.')).toBeVisible();
});

test('import with a preview; re-import adds nothing; undo removes the whole import', async ({ page }) => {
  await open(page);
  let sheet = await upload(page, 'weight.csv', WEIGHT);
  await expect(sheet).toContainText('Вес из «Здоровья» (Zepp Life)');
  await expect(sheet.getByRole('listitem').filter({ hasText: 'Новые' })).toContainText('6');
  await expect(sheet).toContainText('строка 8: не распознаны дата и время');
  await sheet.getByRole('button', { name: 'Загрузить 6' }).click();
  await expect(sheet).toHaveCount(0);
  expect(await live(page, 'body')).toBe(6);

  // The 94 kg weigh-in is flagged, not deleted, and stays out of the average.
  const odd = page.locator('main .row', { hasText: '94 кг' });
  await expect(odd).toContainText('под вопросом');
  await expect(page.locator('.stat').first()).not.toContainText('–');

  sheet = await upload(page, 'weight.csv', WEIGHT);
  await expect(sheet.getByRole('listitem').filter({ hasText: 'Уже есть' })).toContainText('6');
  await expect(sheet.getByRole('button', { name: 'Нечего загружать' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Закрыть' }).click();

  sheet = await upload(page, 'fitdays.csv', FITDAYS);
  await expect(sheet).toContainText('Замеры Fitdays+');
  await sheet.getByRole('button', { name: 'Загрузить 2' }).click();
  await expect(page.locator('main .row', { hasText: 'Талия' })).toContainText('84,5 см');

  sheet = await upload(page, 'sleep.csv', SLEEP);
  await sheet.getByRole('button', { name: 'Загрузить 2' }).click();
  await expect(page.locator('main .row', { hasText: '6,5 ч' })).toContainText('глубокий 1');

  page.on('dialog', (d) => d.accept());
  await page.locator('.choice', { hasText: 'fitdays.csv' }).getByRole('button', { name: 'Отменить' }).click();
  await page.getByRole('button', { name: 'Отменить загрузку' }).click();
  await expect(page.locator('.choice', { hasText: 'fitdays.csv' })).toContainText('отменена');
  expect(await live(page, 'body')).toBe(6);

  // The same file again brings the undone rows back.
  sheet = await upload(page, 'fitdays.csv', FITDAYS);
  await sheet.getByRole('button', { name: 'Загрузить 2' }).click();
  expect(await live(page, 'body')).toBe(8);
});

test('manual measurement, a correction and a deletion survive a re-import, a relaunch and offline', async ({ page, context }) => {
  await open(page);
  await page.getByRole('button', { name: 'Добавить замер' }).click();
  let sheet = page.getByRole('dialog', { name: 'Новый замер' });
  await sheet.getByLabel('Что измерили').selectOption('waist');
  await sheet.getByLabel(/Значение/).fill('85,5');
  await sheet.getByLabel('Дата').fill('2026-10-10');
  await sheet.getByLabel('Время').fill('08:00');
  await sheet.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('main .row', { hasText: 'Талия' })).toContainText('85,5 см');

  sheet = await upload(page, 'weight.csv', WEIGHT);
  await sheet.getByRole('button', { name: 'Загрузить 6' }).click();
  await page.locator('main .row', { hasText: '79,85 кг' }).click();
  sheet = page.getByRole('dialog', { name: 'Вес' });
  await sheet.getByLabel(/Значение/).fill('79,5');
  await sheet.getByRole('button', { name: 'Сохранить' }).click();
  await page.locator('main .row', { hasText: '80,3 кг' }).click();
  await page.getByRole('dialog', { name: 'Вес' }).getByRole('button', { name: 'Удалить' }).click();

  sheet = await upload(page, 'weight.csv', WEIGHT);
  await expect(sheet.getByRole('listitem').filter({ hasText: 'Исправлены вручную' })).toContainText('1');
  await expect(sheet.getByRole('listitem').filter({ hasText: 'Удалены вами' })).toContainText('1');
  await sheet.getByRole('button', { name: 'Закрыть' }).click();

  await context.setOffline(true);
  await page.reload();
  await ready(page);
  await page.locator('.tabbar').getByRole('button', { name: 'Тело' }).click();
  await expect(page.locator('main .row', { hasText: '79,5 кг' })).toContainText('исправлено');
  await expect(page.locator('main .row', { hasText: '80,3 кг' })).toHaveCount(0);
  await expect(page.locator('main .row', { hasText: 'Талия' })).toContainText('85,5 см');
  await context.setOffline(false);
});

test('sync: measurements and sleep reach App_Body / App_Sleep; with the v1.0.2 Apps Script they wait on the phone', async ({ browser }) => {
  for (const [label, code] of [['new', null], ['old', API3]]) {
    const gas = await startFakeGas({ port: 0, ...(code ? { code } : {}) });
    const port = gas.server.address().port;
    const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
    const page = await context.newPage();
    try {
      await page.goto(base);
      await ready(page);
      await connectSync(page, `http://127.0.0.1:${port}/exec`, gas.token);
      await page.evaluate(async ([w, s]) => {
        const { store, sync } = window.__trainer;
        const { parseFile, planImport } = await import('./js/lib/bodydata.js');
        for (const [text, batch] of [[w, 'iw'], [s, 'is']]) {
          const plan = planImport(parseFile(text), { body: store.state.body, sleep: store.state.sleep });
          if (plan.add.length) await store.importBody(plan, { batch });
        }
        await sync.syncNow();
      }, [WEIGHT, SLEEP]);
      const sheet = await (await fetch(`http://127.0.0.1:${port}/__state`)).json();
      if (label === 'new') {
        expect(sheet.App_Body).toHaveLength(7);
        expect(sheet.App_Sleep).toHaveLength(3);
        expect(await page.evaluate(() => window.__trainer.sync.status.notice)).toBeNull();
      } else {
        expect(sheet.App_Body).toBeUndefined();
        const st = await page.evaluate(() => ({ ...window.__trainer.sync.status }));
        expect(st.waitingBy).toEqual({ body: 6, sleep: 2 });
        expect(st.pending).toBe(0);
      }
    } finally {
      gas.server.close();
      await context.close();
    }
  }
});

test('update from v1.0.2: the database gains body and sleep, workouts and check-ins stay', async ({ page }) => {
  const pages = await startPages();
  try {
    pages.publish(path.join(RELEASES, 'bf41b45'), 'bf41b45');
    await page.goto(pages.url);
    await page.waitForFunction(() => window.__trainer?.store.state.loaded);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const before = await page.evaluate(async () => {
      const { store } = window.__trainer;
      const s = await store.startSession({ cycle: 1, week: 2, day: 1 });
      await store.logSet(s.id, s.items[1].slotId, { weight: 92.5, reps: 9, rir: 1 });
      await store.finishSession(s.id);
      await store.saveMetric('2026-10-02', { bodyweight: 82, sleep: 8 });
      await store.saveMetric('2026-09-30', { bodyweight: 81, recovery: 4 });
      return { sets: store.state.sets.size, metrics: store.state.metrics.size };
    });
    pages.publish(APP, 'new1');
    await page.reload();
    for (let i = 0; i < 4 && !(await page.evaluate(() => window.__trainer?.build === 'new1')); i++) {
      await page.waitForTimeout(1500);
      await page.reload();
      await page.waitForFunction(() => window.__trainer?.store.state.loaded || document.querySelector('.diag'));
    }
    expect(await page.evaluate(() => window.__trainer.build)).toBe('new1');
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'trainer', version: 4 }]);
    expect(await page.evaluate(() => ({ sets: window.__trainer.store.state.sets.size, metrics: window.__trainer.store.state.metrics.size }))).toEqual(before);

    await page.locator('.tabbar').getByRole('button', { name: 'Тело' }).click();
    const sheet = await upload(page, 'weight.csv', WEIGHT);
    await sheet.getByRole('button', { name: 'Загрузить 6' }).click();
    await page.reload();
    await page.waitForFunction(() => window.__trainer?.store.state.loaded);
    expect(await live(page, 'body')).toBe(6);
    // The 2.10 check-in weight is replaced by that day's weigh-in, the 30.09 one still counts.
    const days = await page.evaluate(async () => {
      const { dailyWeights } = await import('./js/lib/bodydata.js');
      const st = window.__trainer.store.state;
      return dailyWeights(st.body.values(), st.metrics.values()).days.slice(0, 3).map((d) => `${d.date}:${d.bodyweight}:${d.from}`);
    });
    expect(days).toEqual(['2026-09-30:81:metrics', '2026-10-01:80.1:body', '2026-10-02:79.85:body']);
  } finally {
    await pages.close();
  }
});

test('smallest iPhone: the tab and the import preview fit without sideways scrolling', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 568 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const page = await context.newPage();
  await open(page);
  const sheet = await upload(page, 'fitdays.csv', FITDAYS);
  await page.waitForTimeout(350);
  const sb = await sheet.boundingBox();
  expect(sb.y + sb.height).toBeLessThanOrEqual(568.5);
  const go = await sheet.getByRole('button', { name: 'Загрузить 2' }).boundingBox();
  expect(go.y + go.height).toBeLessThanOrEqual(568.5);
  await sheet.getByRole('button', { name: 'Загрузить 2' }).click();
  await page.getByRole('button', { name: 'Добавить замер' }).click();
  const add = page.getByRole('dialog', { name: 'Новый замер' });
  await page.waitForTimeout(350);
  const save = await add.getByRole('button', { name: 'Сохранить' }).boundingBox();
  expect(save.y + save.height).toBeLessThanOrEqual(568.5);
  await add.getByRole('button', { name: 'Закрыть' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.close();
});
