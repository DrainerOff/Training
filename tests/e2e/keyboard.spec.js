// v1.6.5: typing in a sheet on the iPhone. A real iPhone (iOS 26, home-screen app): in
// «Редактировать программу» → an exercise → «Особые подходы» the keyboard came up, the sheet slid
// down behind it with «Готово» under the keyboard's ˄ ˅ ✓ bar, and the field being typed in was
// not on screen at all. iOS had scrolled the page up to the field (visualViewport.offsetTop > 0)
// while the sheet stayed where it was on screen, and the sheet's list kept its old scroll position.
//
// Chromium has no iOS keyboard, so it is played here the way iOS reports it: while a text field
// has focus, window.visualViewport is shorter by the keyboard (with its ˄ ˅ ✓ bar) and, when the
// field was low, scrolled by `offsetTop`; the window and position:fixed stay put — on screen, as
// the screenshot showed. navigator.vendor is Apple's, as in every browser on an iPhone.
import { test, expect, devices } from '@playwright/test';
import { startStatic } from '../helpers/servers.js';
import { ready, seedOwner, pickRir, logButton } from './helpers.js';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

const SCREENS = [
  // The owner's iPhone: 393×852, the third-party keyboard with its bar ≈ 410 pt.
  { name: 'iPhone 15', width: 393, height: 852, safe: [59, 34], keyboard: 410 },
  { name: 'iPhone SE (3rd gen)', width: 375, height: 667, safe: [20, 0], keyboard: 300 },
];

async function phone(browser, screen, { staleAfterClose = 0 } = {}) {
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: screen.width, height: screen.height },
    screen: { width: screen.width, height: screen.height },
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  });
  await context.addInitScript(([top, bottom, keyboard, stale]) => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.setProperty('--safe-top', `${top}px`);
      document.documentElement.style.setProperty('--safe-bottom', `${bottom}px`);
    });
    Object.defineProperty(Navigator.prototype, 'vendor', { get: () => 'Apple Computer, Inc.', configurable: true });
    const vv = new EventTarget();
    let shown = 0; // how much of the bottom the keyboard covers
    let pan = 0; // how far iOS scrolled the page up to the field
    const define = (name, get) => Object.defineProperty(vv, name, { get, configurable: true });
    define('height', () => window.innerHeight - shown);
    define('width', () => window.innerWidth);
    define('offsetTop', () => pan);
    define('offsetLeft', () => 0);
    define('pageTop', () => pan);
    define('pageLeft', () => 0);
    define('scale', () => 1);
    Object.defineProperty(window, 'visualViewport', { get: () => vv, configurable: true });
    const typing = (el) => !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|file|range|button|submit|hidden)$/.test(el.type)));
    const fire = () => {
      vv.dispatchEvent(new Event('resize'));
      vv.dispatchEvent(new Event('scroll'));
    };
    const update = () => {
      const el = document.activeElement;
      if (typing(el)) {
        // iOS scrolls the page so that the field clears the keyboard, measured before anything moved.
        const visible = window.innerHeight - keyboard;
        const r = el.getBoundingClientRect();
        if (!shown) pan = Math.max(0, Math.min(keyboard, Math.round(Math.min(r.bottom, r.top + 40) + 12 - visible)));
        shown = keyboard;
      } else {
        // Some iOS 26 builds keep reporting a slightly shorter visible area after the keyboard closes.
        shown = stale;
        pan = 0;
      }
      fire();
    };
    document.addEventListener('focusin', () => setTimeout(update, 30));
    document.addEventListener('focusout', () => setTimeout(update, 30));
    window.__keyboard = () => ({ shown, pan, visibleBottom: window.innerHeight - shown });
  }, [...screen.safe, screen.keyboard, staleAfterClose]);
  const page = await context.newPage();
  await page.goto(base);
  await ready(page);
  await seedOwner(page);
  return { context, page };
}

const settled = (loc) => loc.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));

// With the keyboard up: the field being typed in is in the visible part of the sheet's list (not
// under the header, not under the footer, not under the keyboard), the footer with the main
// action is whole above the keyboard, and the sheet's header is below the status bar.
async function expectTypable(page, dialog, field, screen, what) {
  await field.focus();
  await page.waitForTimeout(150);
  await settled(dialog);
  const g = await dialog.evaluate((sheet, el) => {
    const r = (x) => (x ? x.getBoundingClientRect().toJSON() : null);
    const visible = window.__keyboard().visibleBottom;
    return { visible, sheet: r(sheet), head: r(sheet.querySelector('.sheet__head')), body: r(sheet.querySelector('.sheet__body')), foot: r(sheet.querySelector('.sheet__foot')), field: r(el.ownerDocument.activeElement), same: el.ownerDocument.activeElement === el };
  }, await field.elementHandle());
  expect(g.same, `${what}: focused`).toBe(true);
  const at = (n) => Math.round(n);
  expect(at(g.sheet.bottom), `${what}: the sheet ends at the keyboard`).toBeLessThanOrEqual(g.visible + 1);
  expect(at(g.head.top), `${what}: the header is below the status bar`).toBeGreaterThanOrEqual(screen.safe[0]);
  if (g.foot) expect(at(g.foot.bottom), `${what}: the footer is above the keyboard`).toBeLessThanOrEqual(g.visible + 1);
  const viewBottom = Math.min(g.body.bottom, g.visible);
  // The field (its top line at least, for a tall one) is in the visible part of the list.
  expect(at(g.field.top), `${what}: the field is not under the header`).toBeGreaterThanOrEqual(at(g.body.top));
  expect(at(Math.min(g.field.bottom, g.field.top + 40)), `${what}: the field is not under the footer or the keyboard`).toBeLessThanOrEqual(at(viewBottom));
  return g;
}

async function blur(page) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(120);
}

// Settings → «Редактировать программу» → an exercise.
async function exerciseSheet(page, name = 'Наклонный жим: Hammer - наклон') {
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: /Редактировать программу/ }).click();
  await page.locator('.slot-edit button', { hasText: name }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Упражнение' });
  await settled(sheet);
  return sheet;
}

for (const screen of SCREENS) {
  test(`${screen.name}: «Особые подходы» — the field being typed in and «Готово» stay in sight above the keyboard`, async ({ browser }) => {
    const { context, page } = await phone(browser, screen);
    const sheet = await exerciseSheet(page);
    // As on the iPhone: scrolled down to «Особые подходы», then a tap on a week's field.
    const week = (n) => sheet.getByPlaceholder('например 3x10-12@1-2').nth(n - 1);
    await week(1).scrollIntoViewIfNeeded();
    for (const n of [1, 2, 3]) {
      await expectTypable(page, sheet, week(n), screen, `Неделя ${n}`);
      await page.keyboard.type('3x12');
      await expect(week(n)).toHaveValue('3x12');
    }
    // «Готово» can be tapped right away, with the keyboard still up.
    await expect(sheet.getByRole('button', { name: 'Готово' })).toBeEnabled();
    const done = await sheet.getByRole('button', { name: 'Готово' }).boundingBox();
    expect(done.y + done.height).toBeLessThanOrEqual((await page.evaluate(() => window.__keyboard().visibleBottom)) + 1);
    await context.close();
  });

  test(`${screen.name}: every text field of the exercise sheet, top to bottom and back`, async ({ browser }) => {
    const { context, page } = await phone(browser, screen);
    const sheet = await exerciseSheet(page);
    const fields = sheet.locator('.sheet__body').locator('input:not([type=checkbox]):not([type=file]), textarea');
    const n = await fields.count();
    expect(n).toBeGreaterThanOrEqual(7);
    // Down: the keyboard closed in between, a tap on the next field as it is seen in the full sheet.
    for (let i = 0; i < n; i++) {
      await blur(page);
      await fields.nth(i).scrollIntoViewIfNeeded();
      await expectTypable(page, sheet, fields.nth(i), screen, `field ${i + 1} of ${n} (down)`);
    }
    // Up: the keyboard stays, ˄ to the previous field.
    for (let i = n - 1; i >= 0; i--) await expectTypable(page, sheet, fields.nth(i), screen, `field ${i + 1} of ${n} (up)`);
    // The keyboard closes: the sheet is back at the bottom of the screen, full height again.
    await blur(page);
    await settled(sheet);
    const g = await sheet.evaluate((el) => ({ bottom: el.getBoundingClientRect().bottom, top: el.getBoundingClientRect().top, vh: window.innerHeight }));
    expect(Math.round(g.bottom)).toBe(g.vh);
    expect(Math.round(g.top)).toBe(screen.safe[0] + 12);
    await context.close();
  });
}

test('after the keyboard closes the sheet is back at the bottom, even when iOS still reports a shorter visible area', async ({ browser }) => {
  const screen = SCREENS[0];
  const { context, page } = await phone(browser, screen, { staleAfterClose: 24 });
  const sheet = await exerciseSheet(page);
  await expectTypable(page, sheet, sheet.getByLabel('Заметка тренера'), screen, 'Заметка тренера');
  await blur(page);
  await settled(sheet);
  const foot = await sheet.locator('.sheet__foot').boundingBox();
  expect(Math.round(foot.y + foot.height)).toBe(screen.height);
  await context.close();
});

// The same in the other sheets with text fields: each field, with the keyboard up, in sight.
test('other sheets with text fields: each field and the main action stay in sight above the keyboard', async ({ browser }) => {
  test.setTimeout(120_000);
  const screen = SCREENS[1];
  const { context, page } = await phone(browser, screen);
  const fieldsOf = (dialog) => dialog.locator('.sheet__body').locator('input:not([type=checkbox]):not([type=file]):not([type=date]), textarea');
  const sweep = async (name) => {
    const dialog = page.getByRole('dialog', { name });
    await settled(dialog);
    const fields = fieldsOf(dialog);
    const n = await fields.count();
    expect(n, `${name}: has text fields`).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) if (await fields.nth(i).isVisible()) await expectTypable(page, dialog, fields.nth(i), screen, `«${name}», field ${i + 1}`);
    await blur(page);
    return dialog;
  };
  const close = async (dialog) => {
    await dialog.getByRole('button', { name: 'Закрыть' }).click();
    const drop = page.getByRole('dialog', { name: 'Закрыть без сохранения?' });
    if (await drop.isVisible().catch(() => false)) await drop.getByRole('button', { name: 'Не сохранять' }).click();
    await expect(dialog).toHaveCount(0);
  };

  // A new exercise (with «Быстрый выбор» on top).
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: /Редактировать программу/ }).click();
  await page.getByRole('button', { name: 'Добавить упражнение' }).first().click();
  await close(await sweep('Новое упражнение'));
  await page.goto(base);
  await ready(page);

  // Тело: weight and sleep for a day; a new measurement; a phase.
  const body = async () => {
    await page.goto(base);
    await ready(page);
    await page.locator('.tabbar').getByRole('button', { name: 'Тело' }).click();
  };
  const addMenu = async (item) => {
    await page.getByRole('button', { name: 'Добавить: вес и сон за день, замер или файл' }).click();
    await page.getByRole('dialog', { name: 'Добавить' }).getByRole('button', { name: item }).click();
  };
  await body();
  await addMenu(/Записать вес и сон/);
  await close(await sweep('Вес и сон за день'));
  await addMenu('Добавить замер');
  await close(await sweep('Новый замер'));
  await page.locator('.phase').getByRole('button', { name: 'Задать режим' }).click();
  await close(await sweep('Новый режим'));
  // Питание: a day's totals.
  await page.getByRole('group', { name: 'Раздел' }).getByRole('button', { name: 'Питание' }).click();
  await page.getByRole('button', { name: 'Записать итог дня' }).click();
  await close(await sweep('Итог дня'));

  // A workout: a set, this workout's comment.
  await page.goto(base);
  await ready(page);
  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 2, day: 1 }));
  await pickRir(page);
  await logButton(page).click();
  await page.locator('.panel').getByRole('button', { name: /^Подход 1: .* Изменить$/ }).click();
  await close(await sweep(/^Подход 1:/));
  await page.locator('.panel').getByRole('button', { name: 'Отметки и комментарий' }).click();
  await close(await sweep('Подтягивания прямым хватом'));
  await context.close();
});

// Screens with text fields (Настройки, «Программа текстом», «Перенести из текста»): the field
// being typed in is scrolled up above the keyboard, also the last one on the screen.
test('screens with text fields: the field being typed in is above the keyboard', async ({ browser }) => {
  const screen = SCREENS[1];
  const { context, page } = await phone(browser, screen);
  const check = async (field, what) => {
    await blur(page);
    await field.scrollIntoViewIfNeeded();
    await field.focus();
    await page.waitForTimeout(150);
    const g = await field.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const s = el.closest('.screen').getBoundingClientRect();
      return { top: r.top, bottom: Math.min(r.bottom, r.top + 40), screenTop: s.top, visible: window.__keyboard().visibleBottom, focused: document.activeElement === el };
    });
    expect(g.focused, what).toBe(true);
    expect(Math.round(g.top), `${what}: not above the screen`).toBeGreaterThanOrEqual(Math.round(g.screenTop));
    expect(Math.round(g.bottom), `${what}: above the keyboard`).toBeLessThanOrEqual(g.visible);
  };
  await page.getByRole('button', { name: 'Настройки' }).click();
  await check(page.locator('#sync-url'), 'Адрес Apps Script');
  await check(page.locator('#sync-token'), 'Ключ доступа');
  await page.getByRole('button', { name: /Вставить программу текстом/ }).click();
  await check(page.getByPlaceholder('Вставьте программу'), 'Программа текстом');
  await page.goto(base);
  await ready(page);
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: /Перенести из текста/ }).click();
  const fields = page.locator('.screen').locator('input:not([type=checkbox]):not([type=file]), textarea');
  const n = await fields.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) if (await fields.nth(i).isVisible()) await check(fields.nth(i), `Перенести из текста, поле ${i + 1}`);
  // Back without the keyboard: the screen has its usual padding again (nothing left scrolled off).
  await blur(page);
  expect(await page.evaluate(() => document.documentElement.classList.contains('kb-open'))).toBe(false);
  await context.close();
});
