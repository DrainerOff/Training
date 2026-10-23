// v1.3: the card that joins the upright row of 22.10 to the Smith series of 18.10 — what it shows,
// nothing changes before «Исправить», then «Прошлый раз» on day 4 is the earlier workouts of the
// same machine; «Отменить»; the smallest iPhone. Ids and keys as recorded, values synthetic.
import { test, expect, devices } from '@playwright/test';
import { startStatic } from '../helpers/servers.js';
import { programBefore1022, workout1018Fixed, workout1022, SID_1022, SET_IDS_1022 } from '../helpers/workout-2026-10-22.js';
import { convertSnapshot } from '../helpers/legacy-import.js';
import { ready } from './helpers.js';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

async function phone(page) {
  await page.goto(base);
  await ready(page);
  const owner = convertSnapshot();
  const w18 = workout1018Fixed();
  const w22 = workout1022();
  await page.evaluate(async (data) => window.__trainer.store.applyRemote(data, { queue: true }), {
    program: programBefore1022(),
    sessions: [...owner.sessions, w18.session, w22.session],
    sets: [...owner.sets, ...w18.sets, ...w22.sets],
  });
}
const card = (page) => page.getByLabel('Объединение тяги к подбородку');
const rowSets = (page) => page.evaluate((ids) => ids.map((id) => window.__trainer.store.state.sets.get(id)).map((x) => `${x.seriesKey}|${x.weight}x${x.reps}@${x.rir}|${x.date}`), SET_IDS_1022);

test('the card lists the three 22.10 sets; «Исправить» joins them to the Smith series and day 4 shows them as «Прошлый раз»', async ({ page }) => {
  await phone(page);
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByRole('heading')).toHaveText('Объединить тягу к подбородку');
  await expect(card(page).locator('.fix__list li')).toHaveCount(1);
  await expect(card(page).locator('.fix__list li')).toContainText('Тяга штанги к подбородку → Тяга штанги к подбородку в Смите');
  await expect(card(page).locator('.fix__list li')).toContainText('40×10, 45×10, 45×9');
  await expect(card(page)).toContainText('Программа, день 4: основной станет «Тяга штанги к подбородку в Смите»');
  const before = await rowSets(page);
  await page.reload();
  await ready(page);
  expect(await rowSets(page)).toEqual(before); // showing the card changed nothing

  await card(page).getByRole('button', { name: 'Исправить' }).click();
  await expect(page.getByText('Исправлено: 3 подхода, программа дня 4')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  expect(await rowSets(page)).toEqual(before.map((r) => r.replace(/^[^|]+/, 'tyaga-shtangi-k-podborodku-v-smite')));

  // The next week 2 day 4 (cycle 2): the upright row is the Smith variant, last time = 22.10.
  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 2, day: 4 }));
  await page.getByRole('button', { name: /^Тяга штанги к подбородку в Смите/ }).click();
  await expect(page.locator('.dock__prev')).toHaveAttribute('aria-label', 'Прошлый раз, 22 октября: 40×10, 45×10, 45×9');
  // The 22.10 workout itself now names the Smith variant.
  const item = await page.evaluate((id) => window.__trainer.store.state.sessions.get(id).items.find((i) => i.slotId === 'D4-05').name, SID_1022);
  expect(item).toBe('Тяга штанги к подбородку в Смите');
});

test('«Отменить» right after puts the sets and day 4 back; the card is offered again', async ({ page }) => {
  await phone(page);
  const before = await rowSets(page);
  const program = await page.evaluate(() => JSON.stringify(window.__trainer.store.state.program.days));
  await card(page).getByRole('button', { name: 'Исправить' }).click();
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(card(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.__trainer.store.state.program.days))).toBe(program);
  await expect.poll(() => rowSets(page)).toEqual(before);
});

test('smallest iPhone: the card fits, nothing runs off the screen', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 568 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const page = await context.newPage();
  await phone(page);
  await expect(card(page)).toBeVisible();
  const box = await card(page).boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320.5);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await context.close();
});
