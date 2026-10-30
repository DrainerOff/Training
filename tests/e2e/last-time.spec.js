// «Прошлый раз» in the set composer, on the real data imported from the sheet (16.10.2026 =
// cycle 1, week 2, day 1). Priority: the same variant in the same week of the cycle; else its
// latest result from another week, marked as another phase; else «Первое выполнение».
// Variants never mix: Hammer vs dumbbells, barbell incline vs flat, pull-up grips.
import { test, expect, devices } from '@playwright/test';
import { startStatic } from '../helpers/servers.js';
import { ready, dock, logButton, seedOwner, pickRir } from './helpers.js';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

const prev = (page) => page.locator('.dock__prev');

async function start(page, { week, day } = {}) {
  await page.goto(base);
  await ready(page);
  await seedOwner(page);
  if (week) {
    await page.getByRole('button', { name: 'Другой день или неделя' }).click();
    await page.getByRole('group', { name: 'Неделя цикла' }).getByRole('button').nth(week - 1).click();
    await page.getByRole('group', { name: 'День' }).getByRole('button', { name: String(day), exact: true }).click();
    await page.getByRole('button', { name: 'Выбрать' }).click();
  }
  await page.getByRole('button', { name: 'Начать тренировку' }).click();
  await dock(page).waitFor();
}

async function swapTo(page, variant) {
  await page.locator('.panel').getByRole('button', { name: 'Заменить' }).click();
  await page.getByRole('dialog').getByRole('button', { name: variant }).click();
}

test('same week of the cycle: last time for this exact variant, the current set marked', async ({ page }) => {
  await start(page, { week: 2, day: 1 });
  await expect(dock(page)).toContainText('Подтягивания прямым хватом');
  await expect(prev(page)).toHaveAttribute('data-kind', 'same');
  await expect(prev(page)).toHaveAttribute('aria-label', 'Прошлый раз, 16 октября: 20×6, 20×6, 20×6');
  await expect(prev(page).locator('.dock__prev-label')).toHaveText('Прошлый раз');
  await expect(prev(page).locator('.dock__prev-date')).toHaveText('16.10');
  await expect(prev(page).locator('.is-now')).toHaveCount(1);
  await expect(prev(page).locator('.dock__prev-sets > span').nth(0)).toHaveClass('is-now');
  await expect(dock(page)).toContainText('как в прошлый раз');
  await pickRir(page);
  await logButton(page).click();
  await expect(prev(page).locator('.dock__prev-sets > span').nth(1)).toHaveClass('is-now'); // set 2 ↔ last time's set 2

  // Hammer has history, the dumbbell variant of the same slot does not — never mixed.
  await page.getByRole('button', { name: /Наклонный жим: Hammer - наклон/ }).click();
  await expect(prev(page)).toHaveAttribute('aria-label', 'Прошлый раз, 16 октября: 85×10, 85×9, 85×9');
  await swapTo(page, /Гантели - наклон/);
  await expect(prev(page)).toHaveAttribute('data-kind', 'first');
  await expect(prev(page)).toHaveText('Первое выполнение');

  // Barbell: incline has no history, flat has.
  await page.getByRole('button', { name: /Жим штанги лежа: Штанга - наклон/ }).click();
  await expect(prev(page)).toHaveText('Первое выполнение');
  await swapTo(page, /Штанга - горизонт/);
  await expect(prev(page)).toHaveAttribute('aria-label', 'Прошлый раз, 16 октября: 70×8, 70×9, 67,5×10, 67,5×10');
});

test('another week: the latest result is shown as another phase, reps follow this week', async ({ page }) => {
  await start(page, { week: 3, day: 1 });
  await page.getByRole('button', { name: /Наклонный жим: Hammer - наклон/ }).click();
  await expect(prev(page)).toHaveAttribute('data-kind', 'other');
  await expect(prev(page).locator('.dock__prev-label')).toHaveText('Другая фаза · нед. 2');
  await expect(prev(page)).toHaveAttribute('aria-label', 'Другая фаза, неделя 2, 16 октября: 85×10, 85×9, 85×9');
  await expect(dock(page)).toContainText('из другой фазы');
  // Week 3 is 6–8 reps: the weight comes from week 2 as a reference, the 10 reps don't.
  await expect(logButton(page)).toContainText('85 × 8');
});

test('no history for this variant: «Первое выполнение», nothing borrowed from another grip', async ({ page }) => {
  await start(page); // next by plan: day 2, week 2 — pull-ups with an underhand grip
  await expect(dock(page)).toContainText('Подтягивания обратным хватом');
  await expect(prev(page)).toHaveAttribute('data-kind', 'first');
  await expect(prev(page)).toHaveText('Первое выполнение');
});

test('smallest iPhone: last time is in view without scrolling, also with the list scrolled', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 568 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const page = await context.newPage();
  await start(page, { week: 2, day: 1 });
  const inView = () =>
    page.evaluate(() => {
      const el = document.querySelector('.dock__prev');
      const b = el.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return b.top >= 0 && b.bottom <= window.innerHeight && el.contains(hit);
    });
  expect(await inView()).toBe(true);
  await page.locator('.screen').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(100);
  expect(await inView()).toBe(true);
  await context.close();
});
