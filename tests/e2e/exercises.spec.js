// v1.4: «Заменить» and «Добавить упражнение» search the program and the whole history. A found
// exercise keeps its series (history, «Прошлый раз»), its category and weight step; a typed name of
// a known exercise is never offered as a new one. «Изменить программу на будущее» makes the choice
// the slot's main variant, the old one stays an alternative. Synthetic data.
import { test, expect, devices } from '@playwright/test';
import { startStatic } from '../helpers/servers.js';
import { ready, dock, seedOwner } from './helpers.js';

const PRAYER = 'Скручивание на блоке («молитва»)';
const PRESS = 'Пресс в тренажере';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

// The owner-like phone, plus an old workout of an exercise that is not in the program (dumbbells, 2 kg step).
async function gym(page, day = 3) {
  await page.goto(base);
  await ready(page);
  await seedOwner(page);
  await page.evaluate(async () => {
    const { store } = window.__trainer;
    const s = await store.startSession({ cycle: 1, week: 2, day: 1, date: '2026-09-29', status: 'done' });
    const it = await store.addItem(s.id, { name: 'Жим гантелей сидя', category: 'base', step: 2 });
    await store.logSet(s.id, it.slotId, { weight: 24, reps: 8, rir: 2 });
  });
  await page.evaluate((d) => window.__trainer.store.startSession({ cycle: 2, week: 2, day: d }), day);
  await dock(page).waitFor();
}
async function openExercise(page, name) {
  const title = page.locator('.panel .panel__title');
  await expect(async () => {
    if ((await title.textContent()) !== name) await page.locator('.ex__row', { hasText: name }).click({ timeout: 1000 });
    await expect(title).toHaveText(name, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}
const swapSheet = (page) => page.getByRole('dialog', { name: 'Заменить упражнение' });
const slot = (page, id) => page.evaluate((sid) => window.__trainer.store.state.program.days.flatMap((d) => d.slots).find((s) => s.id === sid), id);
const activeItem = (page, slotId) => page.evaluate((sid) => {
  const { store } = window.__trainer;
  return store.liveSessions().find((x) => x.status === 'active').items.find((i) => i.slotId === sid);
}, slotId);

test('«Заменить» → search → «Изменить программу на будущее»: the press becomes day 3 main, the prayer crunch an alternative; history follows', async ({ page }) => {
  await gym(page, 3);
  await openExercise(page, PRAYER);
  await page.locator('.panel').getByRole('button', { name: 'Заменить' }).click();
  const sheet = swapSheet(page);
  await sheet.getByRole('button', { name: /Изменить программу на будущее/ }).click();
  await expect(sheet.getByRole('button', { name: new RegExp(`Оставить «${PRAYER.replace(/[()]/g, '.')}» альтернативой`) })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('searchbox', { name: 'Найти упражнение' }).fill('пресс');
  const hit = sheet.locator('.ex-search .choice').first();
  await expect(hit).toContainText(PRESS);
  await expect(hit).toContainText('день 1');
  await expect(hit).toContainText('16 октября');
  await hit.click();
  await expect(page.getByText(`Программа, день 3: основное — «${PRESS}»`)).toBeVisible();
  await expect(page.locator('.panel .panel__title')).toHaveText(PRESS);
  expect((await slot(page, 'D3-07')).options.map((o) => o.name)).toEqual([PRESS, PRAYER]);
  // The press history from day 1 is «Прошлый раз» here, on day 3.
  await expect(page.locator('.dock__prev')).toHaveAttribute('data-kind', 'same');
  await expect(page.locator('.dock__prev .dock__prev-date')).toHaveText('16.10');
  // Day 1 is not touched; the next day 3 starts with the press.
  expect((await slot(page, 'D1-07')).options.map((o) => o.name)).toEqual([PRESS]);
  const next = await page.evaluate(async () => (await import('./js/lib/planner.js')).itemsForDay(window.__trainer.store.state.program, 3).find((i) => i.slotId === 'D3-07').seriesKey);
  expect(next).toBe('press-v-trenazhere');
});

test('«Заменить» only for this workout; a known name is never «new»; a new name is its own series', async ({ page }) => {
  await gym(page, 3);
  await openExercise(page, PRAYER);
  const programBefore = await slot(page, 'D3-07');
  await page.locator('.panel').getByRole('button', { name: 'Заменить' }).click();
  const sheet = swapSheet(page);
  await expect(sheet.getByRole('button', { name: /Изменить программу на будущее/ })).toHaveAttribute('aria-pressed', 'false');
  const box = sheet.getByRole('searchbox', { name: 'Найти упражнение' });
  // Case and «ё» do not make a new exercise.
  await box.fill('ПРЕСС В ТРЕНАЖЁРЕ');
  await expect(sheet.locator('.ex-search .choice').first()).toContainText(PRESS);
  await expect(sheet.getByRole('button', { name: /Заменить на новое/ })).toHaveCount(0);
  // A typo still finds it; the similar one is pointed out next to «new».
  await box.fill('прес в тренажоре');
  await expect(sheet.locator('.ex-search .choice').first()).toContainText(PRESS);
  await expect(sheet.locator('.ex-search__hint')).toContainText(`«${PRESS}»`);
  await box.fill('Пресс на фитболе');
  await sheet.getByRole('group', { name: 'Категория' }).getByRole('button', { name: 'Изоляция' }).click();
  await sheet.getByRole('button', { name: 'Заменить на новое «Пресс на фитболе»' }).click();
  await expect(page.locator('.panel .panel__title')).toHaveText('Пресс на фитболе');
  expect((await activeItem(page, 'D3-07')).seriesKey).toBe('press-na-fitbole');
  await expect(page.locator('.dock__prev')).toHaveAttribute('data-kind', 'first');
  expect(await slot(page, 'D3-07')).toEqual(programBefore); // the program is as it was
});

test('«Добавить упражнение»: an exercise from the history keeps its series, category and 2 kg step', async ({ page }) => {
  await gym(page, 1);
  await page.getByRole('button', { name: 'Добавить упражнение' }).click();
  const sheet = page.getByRole('dialog', { name: 'Добавить упражнение' });
  await sheet.getByRole('searchbox', { name: 'Найти упражнение' }).fill('жим гантелей');
  const hit = sheet.locator('.ex-search .choice', { hasText: 'Жим гантелей сидя' });
  await expect(hit).toContainText('Базовое');
  await expect(hit).toContainText('29 сентября, 24 кг');
  await hit.click();
  await expect(page.locator('.panel .panel__title')).toHaveText('Жим гантелей сидя');
  const item = await page.evaluate(() => window.__trainer.store.liveSessions().find((x) => x.status === 'active').items.at(-1));
  expect([item.seriesKey, item.category, item.step, item.adhoc]).toEqual(['zhim-ganteley-sidya', 'base', 2, true]);
  await expect(page.locator('.dock__prev .dock__prev-date')).toHaveText('29.09');
});

test('smallest iPhone: the search results and the «new» block fit', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 568 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const page = await context.newPage();
  await gym(page, 3);
  await openExercise(page, PRAYER);
  await page.locator('.panel').getByRole('button', { name: 'Заменить' }).click();
  const sheet = swapSheet(page);
  await sheet.getByRole('searchbox', { name: 'Найти упражнение' }).fill('скручивания на полу');
  await expect(sheet.getByRole('button', { name: /Заменить на новое/ })).toBeVisible();
  const btn = await sheet.getByRole('button', { name: /Заменить на новое/ }).boundingBox();
  expect(btn.x).toBeGreaterThanOrEqual(0);
  expect(btn.x + btn.width).toBeLessThanOrEqual(320.5);
  expect(await page.evaluate(() => [...document.querySelectorAll('.sheet__body, .ex-search')].every((el) => el.scrollWidth <= el.clientWidth + 1))).toBe(true);
  await context.close();
});
