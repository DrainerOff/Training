// Layout and scrolling on iPhone screen sizes (home-screen app = full screen + safe areas).
// Regressions from a real iPhone: the tab bar floated mid-screen with a gap under it after the
// settings page (keyboard), and during a workout the set composer, the tab bar and the list
// overlapped while scrolling. Now: one fixed shell, only the list scrolls, the bottom parts
// are in normal flow, the tab bar is hidden during a workout.
import { test, expect, devices } from '@playwright/test';
import { startStatic } from '../helpers/servers.js';
import { ready } from './helpers.js';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

const SCREENS = [
  { name: 'iPhone SE (1st gen)', width: 320, height: 568, safe: [20, 0] },
  { name: 'iPhone SE (3rd gen)', width: 375, height: 667, safe: [20, 0] },
  { name: 'iPhone 13 mini', width: 375, height: 812, safe: [50, 34] },
  { name: 'iPhone 13', width: 390, height: 844, safe: [47, 34] },
  { name: 'iPhone 15 Pro Max', width: 430, height: 932, safe: [59, 34] },
];

async function open(browser, screen) {
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: screen.width, height: screen.height },
    screen: { width: screen.width, height: screen.height },
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  });
  // env(safe-area-inset-*) can't be emulated in Chromium; the app reads them through these.
  await context.addInitScript(([top, bottom]) => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.setProperty('--safe-top', `${top}px`);
      document.documentElement.style.setProperty('--safe-bottom', `${bottom}px`);
    });
  }, screen.safe);
  const page = await context.newPage();
  await page.goto(base);
  await ready(page);
  return page;
}

// Geometry of the parts that matter, in one round trip.
function geometry(page) {
  return page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), height: Math.round(b.height) };
    };
    return {
      vh: window.innerHeight,
      vw: window.innerWidth,
      winScroll: window.scrollY,
      docScrollable: document.scrollingElement.scrollHeight > window.innerHeight + 1,
      shell: r('.shell'),
      screen: r('.screen'),
      dock: r('.dock'),
      tabbar: r('.tabbar'),
      scrollTop: document.querySelector('.screen')?.scrollTop ?? null,
    };
  });
}

// Is this element the topmost thing on screen, all of it?
function reachable(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return `${sel}: missing`;
    const b = el.getBoundingClientRect();
    if (b.top < 0 || b.bottom > window.innerHeight + 0.5 || b.left < 0 || b.right > window.innerWidth + 0.5) return `${sel}: off screen ${JSON.stringify(b)}`;
    // The centre and the middle of each edge (rounded corners are not part of the element).
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    for (const [x, y] of [[cx, cy], [cx, b.top + 3], [cx, b.bottom - 3], [b.left + 3, cy], [b.right - 3, cy]]) {
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(el === hit || el.contains(hit))) return `${sel}: covered at ${Math.round(x)},${Math.round(y)} by ${hit?.className || hit?.tagName}`;
    }
    return 'ok';
  }, selector);
}

function expectPinned(g, screen, bottomPart) {
  expect(g.winScroll).toBe(0);
  expect(g.docScrollable).toBe(false);
  expect(g.shell).toMatchObject({ top: 0, bottom: g.vh, left: 0, right: g.vw });
  expect(g.screen.top).toBe(screen.safe[0]); // the list starts below the status bar
  const bottom = g[bottomPart];
  expect(bottom.bottom).toBe(g.vh); // flush with the bottom: no gap under it
  expect(g.screen.bottom).toBeLessThanOrEqual(bottom.top); // the list ends where it starts
}

async function wheelTo(page, deltaY, steps = 12) {
  const box = await page.locator('.screen').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 200));
  for (let i = 0; i < steps; i++) await page.mouse.wheel(0, deltaY / steps);
  await page.waitForTimeout(250);
}

// A touch fling: scrolls with momentum like a finger on the phone.
async function fling(page, distance) {
  const box = await page.locator('.screen').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.synthesizeScrollGesture', {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
    yDistance: -distance,
    speed: 2400,
    gestureSourceType: 'touch',
  });
  await page.waitForTimeout(600);
}

for (const screen of SCREENS) {
  test(`${screen.name}: settings scroll both ways; tab bar stays at the bottom, also after the keyboard`, async ({ browser }) => {
    const page = await open(browser, screen);
    expectPinned(await geometry(page), screen, 'tabbar');

    await page.getByRole('button', { name: 'Настройки' }).click();
    await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible();
    const before = await geometry(page);
    expectPinned(before, screen, 'tabbar');

    // Down to the very end: the last line is above the tab bar, nothing moved but the list.
    await wheelTo(page, 20000);
    let g = await geometry(page);
    expect(g.scrollTop).toBeGreaterThan(200);
    expect(g.tabbar).toEqual(before.tabbar);
    expectPinned(g, screen, 'tabbar');
    const last = await page.getByText(/^Версия \d+\.\d+\.\d+/).boundingBox();
    expect(last.y + last.height).toBeLessThanOrEqual(g.tabbar.top);
    expect(await reachable(page, '.tabbar')).toBe('ok');

    // And back up: all the way to the title, no getting stuck.
    await wheelTo(page, -20000);
    g = await geometry(page);
    expect(g.scrollTop).toBe(0);
    expect(await reachable(page, '.topbar')).toBe('ok');

    // The keyboard: focus a field, the visible area shrinks, then closes again.
    await page.getByPlaceholder(/script\.google\.com/).first().focus();
    await page.setViewportSize({ width: screen.width, height: screen.height - 300 });
    await page.keyboard.type('x');
    await page.getByPlaceholder(/script\.google\.com/).first().blur();
    await page.setViewportSize({ width: screen.width, height: screen.height });
    await page.waitForTimeout(200);
    expectPinned(await geometry(page), screen, 'tabbar');
    expect(await reachable(page, '.tabbar')).toBe('ok');

    // Even if iOS leaves the document scrolled, it is put back.
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForTimeout(150);
    expect((await geometry(page)).winScroll).toBe(0);
    await page.context().close();
  });

  test(`${screen.name}: workout — the composer is always whole, the list scrolls on its own`, async ({ browser }) => {
    const page = await open(browser, screen);
    await page.getByRole('button', { name: 'Понятно' }).click();
    await page.getByRole('button', { name: 'Начать тренировку' }).click();
    await page.locator('.dock').waitFor();

    let g = await geometry(page);
    expect(g.tabbar).toBeNull(); // hidden during the workout: the composer is the bottom
    expectPinned(g, screen, 'dock');
    const dockAtRest = g.dock;
    const controls = ['.dock__prev', '.dock__grid > div:nth-child(1) .stepper', '.dock__grid > div:nth-child(2) .stepper', '.dock .rir', '.dock__log .btn'];
    for (const sel of controls) expect(await reachable(page, sel), sel).toBe('ok');
    // The log button clears the home indicator.
    const log = await page.locator('.dock__log .btn').boundingBox();
    expect(log.y + log.height).toBeLessThanOrEqual(g.vh - screen.safe[1]);

    // Scroll the list to its end (wheel, then a touch fling back and forth).
    await wheelTo(page, 20000);
    g = await geometry(page);
    expect(g.dock).toEqual(dockAtRest);
    expectPinned(g, screen, 'dock');
    const finish = await page.getByRole('button', { name: 'Завершить тренировку' }).boundingBox();
    expect(finish.y + finish.height).toBeLessThanOrEqual(g.dock.top); // the end of the list is reachable
    expect(await reachable(page, '.finish .btn')).toBe('ok');
    await fling(page, -3000);
    await fling(page, 3000);
    g = await geometry(page);
    expect(g.dock).toEqual(dockAtRest);
    expectPinned(g, screen, 'dock');
    for (const sel of controls) expect(await reachable(page, sel), sel).toBe('ok');

    // Record a set: still whole; the number pad opens as a sheet fully on screen.
    await page.locator('.dock__log .btn').click();
    await page.waitForTimeout(200);
    expect((await geometry(page)).dock.bottom).toBe(g.vh);
    await page.locator('.dock .stepper__value').first().click();
    const sheet = page.getByRole('dialog');
    await sheet.waitFor();
    await page.waitForTimeout(350); // the rise-in animation
    const sb = await sheet.boundingBox();
    expect(sb.y).toBeGreaterThanOrEqual(screen.safe[0]);
    expect(sb.y + sb.height).toBeLessThanOrEqual(g.vh + 0.5);
    expect(await reachable(page, '[role=dialog] .pad__keys')).toBe('ok');
    await sheet.getByRole('button', { name: 'Готово' }).click();

    // A toast sits above the composer, never over it.
    await page.evaluate(() => import('./js/ui/core.js').then(({ app }) => app.ui.toast('Проверка')));
    await page.waitForTimeout(300); // the rise-in animation
    const toast = await page.locator('.toast').boundingBox();
    expect(toast.y + toast.height).toBeLessThanOrEqual((await geometry(page)).dock.top);
    await page.context().close();
  });
}

test('during a workout the other sections are in the workout menu; the tab brings the workout back', async ({ browser }) => {
  const page = await open(browser, SCREENS[3]);
  await page.getByRole('button', { name: 'Понятно' }).click();
  await page.getByRole('button', { name: 'Начать тренировку' }).click();
  await expect(page.locator('.tabbar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Меню тренировки' }).click();
  await page.getByRole('group', { name: 'Разделы' }).getByRole('button', { name: 'История' }).click();
  await expect(page.locator('.tabbar')).toBeVisible();
  await expect(page.locator('.tabbar__dot')).toHaveCount(1); // a workout is running
  await page.locator('.tabbar').getByRole('button', { name: 'Тренировка' }).click();
  await expect(page.locator('.dock')).toBeVisible();
  await expect(page.locator('.tabbar')).toHaveCount(0);
  await page.context().close();
});
