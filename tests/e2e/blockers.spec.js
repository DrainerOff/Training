// Safari content blockers (AdGuard, 1Blocker, Wipr, …): with blocking on, release 7705635
// never started — EasyPrivacy's rule "/lib/analytics.js" refused js/lib/analytics.js, and
// with it the whole module graph. Here a content blocker is emulated with the real rules
// (tests/fixtures/blocklists, refreshed by tools/blockers/check.mjs --update).
import { test, expect, devices } from '@playwright/test';
import path from 'node:path';
import { startPages, APP, RELEASES } from '../helpers/pages-server.js';
import { emulateContentBlocker, snapshotSelectors } from '../helpers/content-blocker.js';
import { matchSelectors, walkScreens, walkBootScreens } from '../../tools/blockers/screens.js';

let pages;
test.beforeEach(async () => {
  pages = await startPages();
});
test.afterEach(async () => pages?.close());

const OLD = path.join(RELEASES, '7705635');
const booted = (page) => page.waitForFunction(() => window.__trainer?.store.state.loaded && !document.getElementById('boot'));

test('the release that failed on the iPhone: EasyPrivacy refuses js/lib/analytics.js', async ({ page, context }) => {
  const root = path.join(RELEASES, 'ea0febc');
  pages.publish(root, 'ea0febc');
  const refused = await emulateContentBlocker(page, pages.url, { roots: [root] });
  await page.goto(pages.url);
  await page.waitForTimeout(3000);
  expect(refused).toContainEqual({ path: 'js/lib/analytics.js', rule: '/lib/analytics.js' });
  await expect(page.locator('#boot')).toHaveText('Загрузка…');
  expect(await page.evaluate(() => window.__trainer)).toBeUndefined();
});

test('with a content blocker on, the app starts, works and nothing of it is hidden', async ({ page, browser }) => {
  pages.publish(APP, 'new1');
  const refused = await emulateContentBlocker(page, pages.url);
  const selectors = snapshotSelectors();
  expect(selectors.length).toBeGreaterThan(1000);
  const hidden = [];
  const scan = (p) => async (screen) => {
    for (const hit of await matchSelectors(p, selectors)) hidden.push(`${screen}: ${hit.element} ← ##${hit.selector}`);
  };
  await walkScreens(page, pages.url, scan(page));
  // boot.js screens: the diagnostic screen and the temporary-mode warning.
  const other = await (await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU' })).newPage();
  const refusedBoot = await emulateContentBlocker(other, pages.url);
  await walkBootScreens(other, pages.url, scan(other));
  await other.context().close();
  expect([...refused, ...refusedBoot]).toEqual([]);
  expect(hidden).toEqual([]);
});

test('a file refused by a content blocker is named on the diagnostic screen', async ({ page }) => {
  pages.publish(APP, 'new1');
  // A rule that today's lists don't have, in case some list adds one like it tomorrow.
  const refused = await emulateContentBlocker(page, pages.url, { extraRules: '/lib/planner.js' });
  let loads = 0;
  page.on('load', () => loads++);
  await page.goto(pages.url);
  const diag = page.locator('.diag');
  await expect(diag).toContainText('Не загружается: js/lib/planner.js', { timeout: 20_000 });
  await expect(diag).toContainText('блокировщик контента Safari');
  await expect(diag.locator('textarea')).toHaveValue(/Проверка модулей: \d+ файлов, не загружаются: js\/lib\/planner\.js \(запрос отклонён/);
  expect(refused.map((r) => r.path)).toContain('js/lib/planner.js');
  await page.waitForTimeout(2000);
  expect(loads).toBe(1); // re-downloading can't help, so the page isn't reloaded
});

// The phone as it is now: release 7705635 installed (service worker, cache, IndexedDB with
// data recorded while blocking was off), blocking back on. The fix must arrive and start
// without turning protection off.
test('a phone with 7705635 and a content blocker on gets the fix; data kept', async ({ page }) => {
  pages.publish(OLD, '7705635');
  await page.goto(pages.url);
  await booted(page);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.evaluate(async () => {
    const { store } = window.__trainer;
    const s = await store.startSession({ cycle: 1, week: 2, day: 2 });
    await store.logSet(s.id, s.items[0].slotId, { weight: 24, reps: 6, rir: 2 });
  });
  const before = await page.evaluate(() => [...window.__trainer.store.state.sets.keys()].sort());

  // Blocking on: 7705635 can't start, even from its offline cache.
  const refused = await emulateContentBlocker(page, pages.url, { roots: [OLD] });
  await page.reload();
  await expect(page.locator('.diag')).toContainText('Приложение не запустилось', { timeout: 30_000 });
  expect(refused.map((r) => r.path)).toContain('js/lib/analytics.js');

  // The fix is published. The old release's page can't hand over, so the new worker takes
  // over by itself; the next start is the new release, with blocking still on.
  pages.publish(APP, 'new1');
  await page.reload();
  await expect
    .poll(
      () =>
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
        ),
      { timeout: 30_000 },
    )
    .toBe('new1');
  await page.goto(pages.url);
  await booted(page);
  expect(await page.evaluate(() => window.__trainer.build)).toBe('new1');
  expect(await page.evaluate(() => [...window.__trainer.store.state.sets.keys()].sort())).toEqual(before);
});
