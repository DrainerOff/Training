// Regression tests for the «endless Загрузка…» report: updating a phone that already has an
// older release (service worker + caches + IndexedDB), relaunching with an existing database,
// broken cached files, and an IndexedDB that never answers.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { startPages, APP, RELEASES } from '../helpers/pages-server.js';

const OLD = path.join(RELEASES, 'ea0febc');
let pages;
test.beforeEach(async () => {
  pages = await startPages();
});
test.afterEach(async () => pages?.close());

// Documents loaded in this tab, including ones the service worker served from its cache.
function countLoads(page) {
  const counter = { n: 0 };
  page.on('load', () => counter.n++);
  return counter;
}
const booted = (page) => page.waitForFunction(() => window.__trainer?.store.state.loaded && !document.getElementById('boot'));
const workerBuild = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const c = navigator.serviceWorker.controller;
        if (!c) return resolve(null);
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => resolve(e.data?.build ?? null);
        setTimeout(() => resolve(null), 1000);
        c.postMessage({ type: 'version' }, [ch.port2]);
      }),
  );
async function waitForWorker(page, build) {
  await expect.poll(() => workerBuild(page), { timeout: 20_000 }).toBe(build);
}

// Everything the user would lose if an update went wrong.
function snapshot(page) {
  return page.evaluate(() => {
    const st = window.__trainer.store.state;
    const live = (m) => [...m.values()].filter((r) => !r.deleted);
    return {
      sessions: live(st.sessions).map((s) => `${s.id}|${s.date}|${s.status}`).sort(),
      sets: live(st.sets).map((s) => `${s.id}|${s.weight}x${s.reps}`).sort(),
      metrics: live(st.metrics).map((m) => `${m.id}|${m.bodyweight}`).sort(),
      imports: Object.keys(st.kv.imports || {}),
      program: st.program.updatedAt,
      outbox: st.outbox.size,
    };
  });
}

// Reads straight from IndexedDB (the launch check writes there, not into the loaded state).
const idbKv = (page, key) =>
  page.evaluate(
    (k) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('trainer');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('kv').objectStore('kv').get(k);
          get.onsuccess = () => {
            open.result.close();
            resolve(get.result?.v);
          };
          get.onerror = () => reject(get.error);
        };
      }),
    key,
  );
const appBuild = (page) => page.evaluate(() => [window.__boot?.build, window.__trainer?.build]);

async function recordWorkout(page) {
  await page.evaluate(async () => {
    const { store } = window.__trainer;
    const s = await store.startSession({ cycle: 1, week: 2, day: 2 });
    await store.logSet(s.id, s.items[0].slotId, { weight: 24, reps: 6, rir: 2 });
    await store.saveMetric('2026-10-17', { bodyweight: 81.5 });
  });
}

test('update from the published ea0febc release keeps IndexedDB data, imports once and starts offline', async ({ page, context }) => {
  // 1. The phone as it is today: release ea0febc installed, the one-time import done, data recorded.
  pages.publish(OLD, 'ea0febc');
  await page.goto(pages.url);
  await page.waitForFunction(() => window.__trainer?.store.state.loaded);
  await expect(page.getByText('Перенесено из Google Таблицы')).toBeVisible();
  await waitForWorker(page, null); // the old worker has no 'version' reply…
  await page.waitForFunction(() => !!navigator.serviceWorker.controller); // …but it controls the page
  await recordWorkout(page);
  const before = await snapshot(page);
  expect(before.sessions).toHaveLength(2); // 16.10 from the sheet + the one just recorded
  expect(before.sets).toHaveLength(24);
  expect(before.imports).toEqual(['gsheets-2026-10-17']);

  // 2. The fix is published. The old worker still serves the old page, the new one installs
  //    in the background and replaces it without waiting (old pages can't ask for it).
  pages.publish(APP, 'new1');
  await page.reload();
  await waitForWorker(page, 'new1');
  await page.reload();
  await booted(page);
  expect(await appBuild(page)).toEqual(['new1', 'new1']); // the new code runs, not a leftover
  await expect(page.locator('.diag')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  expect(typeof (await idbKv(page, 'lastLaunchAt'))).toBe('number');
  expect(await page.evaluate(() => caches.keys())).toEqual(['trainer-new1']);

  // 3. Full close, airplane mode, cold start: everything comes from the new cache.
  await page.close();
  await context.setOffline(true);
  page = await context.newPage();
  await page.goto(pages.url);
  await booted(page);
  expect(await appBuild(page)).toEqual(['new1', 'new1']);
  expect(await snapshot(page)).toEqual(before);
  await context.setOffline(false);

  // 4. A later release while the app is open: the page itself hands over once its code has
  //    loaded, offers a restart, and the restart lands on the new release with the same data.
  pages.publish(APP, 'new2');
  await page.reload();
  await booted(page);
  await expect(page.getByRole('button', { name: 'Перезапустить' })).toBeVisible({ timeout: 20_000 });
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Перезапустить' }).click()]);
  await booted(page);
  expect(await appBuild(page)).toEqual(['new2', 'new2']);
  expect(await snapshot(page)).toEqual(before);
});

test('relaunch with an existing IndexedDB: same data, no second import, every stage reported', async ({ page, context }) => {
  pages.publish(APP, 'new1');
  await page.goto(pages.url);
  await booted(page);
  await expect(page.getByText('Перенесено из Google Таблицы')).toBeVisible();
  await page.getByRole('button', { name: 'Понятно' }).click();
  await recordWorkout(page);
  const before = await snapshot(page);
  const firstLaunch = await idbKv(page, 'lastLaunchAt');
  expect(typeof firstLaunch).toBe('number');
  await page.close();

  for (let i = 0; i < 2; i++) {
    page = await context.newPage();
    await page.goto(pages.url);
    await booted(page);
    expect(await snapshot(page)).toEqual(before);
    const last = await page.evaluate(() => JSON.parse(localStorage.getItem('trainer.lastBoot')));
    expect(last).toMatchObject({ build: 'new1', ok: true });
    await page.close();
  }
  page = await context.newPage();
  await page.goto(pages.url);
  await booted(page);
  expect(await page.evaluate(() => window.__trainer.store.state.kv.lastLaunchAt)).toBeGreaterThan(firstLaunch); // written by the previous launch
  await expect(page.getByText('Перенесено из Google Таблицы')).toHaveCount(0);
});

test('a corrupted cached file is repaired automatically; data untouched', async ({ page }) => {
  pages.publish(APP, 'new1');
  await page.goto(pages.url);
  await booted(page);
  await waitForWorker(page, 'new1');
  await recordWorkout(page);
  const before = await snapshot(page);

  // A cached module that no longer fits the rest (what a half-applied update looks like).
  await page.evaluate(async () => {
    const cache = await caches.open('trainer-new1');
    await cache.put('./js/data/store.js', new Response('export const broken = true;', { headers: { 'Content-Type': 'text/javascript' } }));
  });
  const loads = countLoads(page);
  await page.reload();
  await booted(page);
  expect(loads.n).toBe(2); // the failed start + one repair reload
  expect(await snapshot(page)).toEqual(before);
  expect(page.url()).toBe(pages.url); // the repair marker is removed from the address
  const repaired = await page.evaluate(async () => (await (await caches.open('trainer-new1')).match('./js/data/store.js')).text());
  expect(repaired).toContain('export function createStore');
});

test('a file that stays broken: one repair attempt, then a diagnostic screen naming the stage', async ({ page }) => {
  pages.publish(APP, 'new1');
  await page.goto(pages.url);
  await booted(page);
  await waitForWorker(page, 'new1');
  await recordWorkout(page);
  const before = await snapshot(page);

  // The server itself serves a broken file now, so re-downloading can't fix it.
  pages.override('js/data/store.js', 'export const broken = true;');
  await page.evaluate(async () => {
    const cache = await caches.open('trainer-new1');
    await cache.put('./js/data/store.js', new Response('export const broken = true;', { headers: { 'Content-Type': 'text/javascript' } }));
  });
  const loads = countLoads(page);
  await page.reload();
  const diag = page.locator('.diag');
  await expect(diag).toContainText('Приложение не запустилось', { timeout: 20_000 });
  await expect(diag).toContainText('Этап: Загрузка файлов приложения');
  await expect(diag).toContainText('Сохранённые тренировки не удалялись');
  await expect(diag.locator('textarea')).toHaveValue(/Сборка: new1[\s\S]*\[modules\][\s\S]*Ход запуска: modules/);
  await expect(diag.getByRole('button', { name: 'Продолжить без сохранения' })).toHaveCount(0); // storage is fine
  await page.waitForTimeout(3000);
  expect(loads.n).toBe(2); // one repair attempt, no reload loop

  // Once the release is fixed, the button re-downloads the files and the data is all there.
  pages.override('js/data/store.js', null);
  await diag.getByRole('button', { name: 'Обновить файлы приложения' }).click();
  await booted(page);
  expect(await snapshot(page)).toEqual(before);
});

test('code that never arrives: the watchdog shows the stage instead of an endless «Загрузка…»', async ({ page }) => {
  await page.addInitScript(() => {
    window.__TRAINER_BOOT_TIMEOUT_MS = 1500;
  });
  pages.publish(APP, 'new1');
  pages.override('js/ui/workout.js', { hang: true });
  // The page never fires 'load' here (a module request stays open), so count requests instead.
  await page.goto(pages.url, { waitUntil: 'commit' });
  const diag = page.locator('.diag');
  await expect(diag).toContainText('Этап: Загрузка файлов приложения', { timeout: 20_000 });
  await expect(diag).toContainText('нет ответа 2 с');
  await page.waitForTimeout(2500);
  expect(pages.navigations()).toBe(2); // the first visit + one repair attempt
});

test('IndexedDB that never answers: diagnostic screen, temporary mode only by explicit choice', async ({ page }) => {
  await page.addInitScript(() => {
    window.__TRAINER_IDB_TIMEOUT_MS = 300;
    // The WebKit failure mode: requests that fire neither success nor error.
    indexedDB.open = () => ({});
    indexedDB.databases = () => new Promise(() => {});
  });
  pages.publish(APP, 'new1');
  await page.goto(pages.url);
  const diag = page.locator('.diag');
  await expect(diag).toContainText('Этап: Открытие базы данных на устройстве (IndexedDB)', { timeout: 20_000 });
  await expect(diag).toContainText('IndexedDB не ответила');
  await expect(diag).toContainText('попыток: 2');
  await expect(diag.locator('textarea')).toHaveValue(/\[storage-open\]/);
  expect(await page.evaluate(() => window.__trainer)).toBeUndefined(); // no silent in-memory app

  // Temporary mode exists, but only behind an explicit warning and choice.
  await expect(diag).toContainText('Внимание: это временный режим');
  await diag.getByRole('button', { name: 'Продолжить без сохранения' }).click();
  await page.waitForFunction(() => window.__trainer?.store.state.loaded);
  await expect(page.locator('.temp-banner')).toContainText('Временный режим: данные не сохраняются на устройстве');
  await page.getByRole('button', { name: 'Настройки' }).click();
  await expect(page.getByText(/Хранилище: временное, только в памяти/)).toBeVisible();

  // Leaving it tries the real database again (still broken here → the diagnostic screen).
  await page.locator('.temp-banner').getByRole('button', { name: 'Открыть с сохранением' }).click();
  await expect(diag).toContainText('Этап: Открытие базы данных на устройстве (IndexedDB)', { timeout: 20_000 });
});

// The reported case: a regular Safari tab with release ea0febc shows «Загрузка…» forever while
// a private tab (in-memory IndexedDB) works. Emulates the WebKit failure modes: an open request
// that stays silent until IndexedDB is poked (bug 226547), and a database that never answers.
test('a phone stuck on «Загрузка…» with ea0febc gets the fix through the old service worker; data kept', async ({ page }) => {
  await page.addInitScript(() => {
    const mode = localStorage.getItem('test.idb');
    if (!mode) return;
    window.__TRAINER_IDB_TIMEOUT_MS = 300;
    const realOpen = IDBFactory.prototype.open;
    const realDatabases = IDBFactory.prototype.databases;
    let poked = false;
    indexedDB.databases = function () {
      poked = true;
      return mode === 'dead' ? new Promise(() => {}) : realDatabases.call(this);
    };
    indexedDB.open = function (...args) {
      if (mode === 'stall-until-poked' && poked) return realOpen.apply(this, args);
      return {}; // fires neither success nor error
    };
  });
  pages.publish(OLD, 'ea0febc');
  await page.goto(pages.url);
  await page.waitForFunction(() => window.__trainer?.store.state.loaded);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await recordWorkout(page);
  const before = await snapshot(page);

  // The bug as reported: the old release waits forever.
  await page.evaluate(() => localStorage.setItem('test.idb', 'stall-until-poked'));
  await page.reload();
  await page.waitForTimeout(3000);
  await expect(page.locator('#boot')).toHaveText('Загрузка…');
  expect(await page.evaluate(() => window.__trainer)).toBeUndefined();

  // The fix is published; the stuck page can't help, the old worker's update check does.
  pages.publish(APP, 'new1');
  await page.reload();
  await waitForWorker(page, 'new1');
  await page.reload();
  await booted(page); // poking IndexedDB before opening it gets past the stall
  expect(await appBuild(page)).toEqual(['new1', 'new1']);
  expect(await snapshot(page)).toEqual(before);

  // A database that never answers at all: a named stage within seconds, not an endless wait.
  await page.evaluate(() => localStorage.setItem('test.idb', 'dead'));
  await page.reload();
  const diag = page.locator('.diag');
  await expect(diag).toContainText('Этап: Открытие базы данных на устройстве (IndexedDB)', { timeout: 20_000 });
  await page.evaluate(() => localStorage.removeItem('test.idb'));
  await diag.getByRole('button', { name: 'Повторить' }).click();
  await booted(page);
  expect(await snapshot(page)).toEqual(before);
});
