// «Тело» in v1.1: loading history from files (preview, re-import, undo), manual measurements and
// corrections, sleep, offline, sync to App_Body / App_Sleep (and waiting while the deployed
// Apps Script is API 3), the update from v1.0.2 and the smallest iPhone. Synthetic data only.
import { test, expect, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { startStatic, startFakeGas } from '../helpers/servers.js';
import { startPages, APP, RELEASES, ROOT } from '../helpers/pages-server.js';
import { ready, connectSync, seedOwner } from './helpers.js';

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
  await seedOwner(page);
  await page.locator('.tabbar').getByRole('button', { name: 'Тело' }).click();
  await expect(page.getByRole('heading', { name: 'Тело', exact: true })).toBeVisible();
}

// Raw data sits behind the «Данные» rows; the «+» opens the menu of what can be added.
async function weighIns(page) {
  await page.locator('main .row', { hasText: 'Взвешивания' }).click();
  return page.getByRole('dialog', { name: 'Вес' }).first(); // a weigh-in opens over it, also named «Вес»
}
async function addMenu(page, item) {
  await page.getByRole('button', { name: 'Добавить: самочувствие, замер или файл' }).click();
  await page.getByRole('dialog', { name: 'Добавить' }).getByRole('button', { name: item }).click();
}
const waistTile = (page) => page.locator('.tile', { hasText: 'Талия' });

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
  let list = await weighIns(page);
  await expect(list.locator('.row', { hasText: '94 кг' })).toContainText('под вопросом');
  await list.getByRole('button', { name: 'Закрыть' }).click();
  await expect(page.locator('.weight-card')).toContainText('за 4 недели');

  sheet = await upload(page, 'weight.csv', WEIGHT);
  await expect(sheet.getByRole('listitem').filter({ hasText: 'Уже есть' })).toContainText('6');
  await expect(sheet.getByRole('button', { name: 'Нечего загружать' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Закрыть' }).click();

  sheet = await upload(page, 'fitdays.csv', FITDAYS);
  await expect(sheet).toContainText('Замеры Fitdays+');
  await sheet.getByRole('button', { name: 'Загрузить 2' }).click();
  await expect(waistTile(page)).toContainText('84,5');
  await expect(page.locator('main .row', { hasText: 'Обхваты' })).toContainText('талия 84,5');

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
  await addMenu(page, 'Добавить замер');
  let sheet = page.getByRole('dialog', { name: 'Новый замер' });
  await sheet.getByLabel('Что измерили').selectOption('waist');
  await sheet.getByLabel(/Значение/).fill('85,5');
  await sheet.getByLabel('Дата').fill('2026-10-10');
  await sheet.getByLabel('Время').fill('08:00');
  await sheet.getByRole('button', { name: 'Сохранить' }).click();
  await expect(waistTile(page)).toContainText('85,5');

  sheet = await upload(page, 'weight.csv', WEIGHT);
  await sheet.getByRole('button', { name: 'Загрузить 6' }).click();
  let list = await weighIns(page);
  await list.locator('.row', { hasText: '79,85 кг' }).click();
  sheet = page.getByRole('dialog', { name: 'Вес' }).last();
  await sheet.getByLabel(/Значение/).fill('79,5');
  await sheet.getByRole('button', { name: 'Сохранить' }).click();
  await list.locator('.row', { hasText: '80,3 кг' }).click();
  await page.getByRole('dialog', { name: 'Вес' }).last().getByRole('button', { name: 'Удалить' }).click();
  await expect(list.locator('.row', { hasText: '80,3 кг' })).toContainText('удалён');
  await expect(page.getByRole('dialog', { name: 'Вес' })).toHaveCount(1); // the record sheet has slid away
  await list.getByRole('button', { name: 'Закрыть' }).click();

  sheet = await upload(page, 'weight.csv', WEIGHT);
  await expect(sheet.getByRole('listitem').filter({ hasText: 'Исправлены вручную' })).toContainText('1');
  await expect(sheet.getByRole('listitem').filter({ hasText: 'Удалены вами' })).toContainText('1');
  await sheet.getByRole('button', { name: 'Закрыть' }).click();

  await context.setOffline(true);
  await page.reload();
  await ready(page);
  await page.locator('.tabbar').getByRole('button', { name: 'Тело' }).click();
  await expect(waistTile(page)).toContainText('85,5');
  list = await weighIns(page);
  await expect(list.locator('.row', { hasText: '79,5 кг' })).toContainText('исправлено');
  await expect(list.locator('.row', { hasText: '80,3 кг' })).toContainText('удалён');
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
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'trainer', version: 5 }]);
    expect(await page.evaluate(() => ({ sets: window.__trainer.store.state.sets.size, metrics: window.__trainer.store.state.metrics.size }))).toEqual(before);

    await page.locator('.tabbar').getByRole('button', { name: 'Тело' }).click();
    const sheet = await upload(page, 'weight.csv', WEIGHT);
    await sheet.getByRole('button', { name: 'Загрузить 6' }).click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => live(page, 'body')).toBe(6);
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

    // Rollback to v1.0.2 (if main were reverted): it opens the v5 database as it is, workouts and
    // check-ins intact; going forward again, measurements are still there.
    await page.evaluate(() => window.__trainer.store.savePhase({ mode: 'bulk', start: '2026-10-01', targetPct: 0.25 }));
    pages.publish(path.join(RELEASES, 'bf41b45'), 'bf41b45');
    for (let i = 0; i < 5 && !(await page.evaluate(() => window.__trainer?.build === 'bf41b45')); i++) {
      await page.waitForTimeout(1500);
      await page.reload();
      await page.waitForFunction(() => window.__trainer?.store.state.loaded || document.querySelector('.diag'));
    }
    expect(await page.evaluate(() => window.__trainer.build)).toBe('bf41b45');
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'trainer', version: 5 }]);
    expect(await page.evaluate(() => ({ sets: window.__trainer.store.state.sets.size, metrics: window.__trainer.store.state.metrics.size }))).toEqual(before);
    pages.publish(APP, 'new2');
    for (let i = 0; i < 5 && !(await page.evaluate(() => window.__trainer?.build === 'new2')); i++) {
      await page.waitForTimeout(1500);
      await page.reload();
      await page.waitForFunction(() => window.__trainer?.store.state.loaded || document.querySelector('.diag'));
    }
    expect(await live(page, 'body')).toBe(6);
    expect(await live(page, 'phases')).toBe(1);
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
  await addMenu(page, 'Добавить замер');
  const add = page.getByRole('dialog', { name: 'Новый замер' });
  await page.waitForTimeout(350);
  const save = await add.getByRole('button', { name: 'Сохранить' }).boundingBox();
  expect(save.y + save.height).toBeLessThanOrEqual(568.5);
  await add.getByRole('button', { name: 'Закрыть' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.close();
});

// 19.10.2026 on the real phone: a day of two parts (main sleep 3,9 ч, all sleep 7,8 ч). The title
// counts all sleep of the day; the line says the time and the stages are those of the main sleep;
// Core is «базовый», so «основной» means only the main sleep.
test('a split day of sleep: all sleep in the title, the main sleep named apart, stages not called «основной»', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const { store } = window.__trainer;
    await store.applyRemote({
      sleep: [
        { id: 's:2026-10-19', wakeDate: '2026-10-19', hours: 3.93, total: 7.81, episodes: 2, start: '2026-10-19T07:02:02+03:00', end: '2026-10-19T11:19:17+03:00', core: 2.36, deep: 0.81, rem: 0.76, unspec: 0, segments: 16, source: 'Apple Watch', via: 'shortcut', updatedAt: 1, deleted: false },
        { id: 's:2026-10-17', wakeDate: '2026-10-17', hours: null, total: 1.22, episodes: 1, start: '2026-10-17T09:49:25+03:00', end: '2026-10-17T11:02:38+03:00', core: 0, deep: 0, rem: 0, unspec: 1.22, segments: 1, source: 'Apple Watch', via: 'shortcut', updatedAt: 1, deleted: false },
      ],
    });
  });
  const day = page.locator('main .row', { hasText: '7,8 ч' });
  await expect(day).toContainText('2 части, основной сон 3,9 ч · основной 07:02–11:19 · базовый 2,4 · глубокий 0,8 · REM 0,8');
  await day.click();
  const sheet = page.getByRole('dialog', { name: 'Сон по дням' });
  await expect(sheet).toContainText('весь сон за сутки');
  await expect(sheet.locator('.row', { hasText: '1,2 ч' })).toContainText('нет эпизода от 2 ч · 09:49–11:02 · без фаз');
});

test('import while the sheet cannot be reached: the preview warns that recent «Команды» records may repeat', async ({ page }) => {
  await open(page);
  await connectSync(page, 'http://127.0.0.1:9/exec', 'a'.repeat(64)); // nothing listens on port 9
  const sheet = await upload(page, 'weight.csv', WEIGHT);
  await expect(sheet).toContainText('Таблица сейчас недоступна');
});

test('bulk phase: set it, an honest «данных недостаточно», then the rate against the target from weigh-ins', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 568 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const page = await context.newPage();
  await open(page);
  const card = page.locator('.phase');
  await expect(card).toContainText('Режим не задан');
  await card.getByRole('button', { name: 'Задать режим' }).click();
  const sheet = page.getByRole('dialog', { name: 'Новый режим' });
  await sheet.getByRole('button', { name: 'Сушка' }).click();
  await expect(sheet.getByLabel('Целевой темп, % массы в неделю')).toHaveValue('-0,5');
  await sheet.getByRole('button', { name: 'Набор' }).click();
  await expect(sheet.getByLabel('Целевой темп, % массы в неделю')).toHaveValue('0,25');
  const start = await page.evaluate(() => {
    const d = new Date(Date.now() - 27 * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await sheet.getByLabel('Начало').fill(start);
  await sheet.getByRole('button', { name: 'Сохранить' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(card).toContainText('Набор');
  await expect(card).toContainText('Темп веса: данных недостаточно');
  await expect(waistTile(page)).toContainText('нужны 2 замера');

  // Synthetic weigh-ins: +0.2 kg a week from 80 kg, every day of the phase.
  await page.evaluate(async (from) => {
    const { store } = window.__trainer;
    const t0 = Date.parse(from + 'T07:00:00');
    for (let i = 0; i < 28; i++) {
      const d = new Date(t0 + i * 86400000);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await store.addBody({ kind: 'weight', value: Math.round((80 + (0.2 / 7) * i) * 100) / 100, measuredAt: `${iso}T07:00` });
    }
  }, start);
  await expect(card).toContainText('в пределах цели');
  await expect(card).toContainText('По 28 дням со взвешиванием');
  await expect(page.locator('.gauge')).toHaveAttribute('aria-label', /коридор цели от \+0,15 до \+0,35/);
  await page.getByText('Средний вес по неделям').click();
  // Full weeks have an average; the week in progress may show only how many weigh-ins it has.
  expect(await page.locator('.phase__weeks li', { hasText: 'кг' }).count()).toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Survives a relaunch.
  await page.reload();
  await page.waitForFunction(() => window.__trainer?.store.state.loaded);
  await page.locator('.tabbar').getByRole('button', { name: 'Тело' }).click();
  await expect(page.locator('.phase')).toContainText('в пределах цели');
  await context.close();
});
