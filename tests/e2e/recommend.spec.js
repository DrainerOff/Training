// v1.3: «Рекомендуем сегодня» in the set composer. «Прошлый раз» and the pre-filled weight stay as
// they were; the recommendation is a separate line, changes the weight only on «Использовать», says
// why under ⓘ, never uses another week of the cycle, counts today's sets, fits the smallest iPhone.
// Synthetic data: the owner-like 16.10 workout, and 18.10 / 22.10 for the upright row.
import { test, expect, devices } from '@playwright/test';
import { startStatic } from '../helpers/servers.js';
import { programBefore1022, workout1018Fixed, workout1022 } from '../helpers/workout-2026-10-22.js';
import { convertSnapshot } from '../helpers/legacy-import.js';
import { ready, dock, logButton, seedOwner, pickRir } from './helpers.js';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

const rec = (page) => page.locator('.dock__rec');
const prev = (page) => page.locator('.dock__prev');

// A fixed day two weeks after 16.10, so nothing here depends on when the tests run.
async function open(page, { at = '2026-10-30T10:00:00+03:00' } = {}) {
  await page.clock.setFixedTime(new Date(at));
  await page.goto(base);
  await ready(page);
}
async function startDay(page, week, day) {
  await page.getByRole('button', { name: 'Другой день или неделя' }).click();
  await page.getByRole('group', { name: 'Неделя цикла' }).getByRole('button').nth(week - 1).click();
  await page.getByRole('group', { name: 'День' }).getByRole('button', { name: String(day), exact: true }).click();
  await page.getByRole('button', { name: 'Выбрать' }).click();
  await page.getByRole('button', { name: 'Начать тренировку' }).click();
  await dock(page).waitFor();
}

test('pull-ups without RIR: a conditional +2,5 kg; the pre-fill stays until «Использовать»', async ({ page }) => {
  await open(page);
  await seedOwner(page);
  await startDay(page, 2, 1);
  await expect(dock(page)).toContainText('Подтягивания прямым хватом');
  // «Прошлый раз» and the pre-filled weight as before v1.3.
  await expect(prev(page)).toHaveAttribute('aria-label', 'Прошлый раз, 16 октября: 20×6, 20×6, 20×6');
  await expect(dock(page)).toContainText('как в прошлый раз');
  await expect(logButton(page)).toContainText('20 × 6');
  await expect(rec(page)).toHaveAttribute('aria-label', 'Рекомендуем сегодня: +22,5 кг, можно повысить, условно');
  await expect(rec(page)).toContainText('условно');

  await rec(page).getByRole('button', { name: /Почему/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Рекомендация на сегодня' });
  await expect(sheet).toContainText('Можно повысить: +22,5 кг (условно)');
  await expect(sheet).toContainText('Прошлый раз на неделе 2, 16 октября: 20×6, 20×6, 20×6.');
  await expect(sheet).toContainText('RIR в тот раз записан не везде');
  await expect(sheet).toContainText('Вес в поле меняется, только если нажать «Использовать»');
  await sheet.getByRole('button', { name: 'Понятно' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(logButton(page)).toContainText('20 × 6'); // still untouched

  await rec(page).getByRole('button', { name: 'Использовать' }).click();
  await expect(logButton(page)).toContainText('22,5 × 6');
  await expect(rec(page).getByRole('button', { name: 'Использовать' })).toHaveCount(0);

  // Today's set at the new weight below the range: back to «закрепить» the old weight.
  await page.getByRole('button', { name: 'Уменьшить: Повторения' }).click();
  await page.getByRole('button', { name: 'Уменьшить: Повторения' }).click();
  await expect(logButton(page)).toContainText('22,5 × 4');
  await pickRir(page);
  await logButton(page).click();
  await expect(rec(page)).toHaveAttribute('aria-label', 'Рекомендуем сегодня: +20 кг, лучше закрепить');
  // The pre-fill follows today's set as before; the recommendation only offers.
  await expect(logButton(page)).toContainText('22,5 × 4');
  await expect(rec(page).getByRole('button', { name: 'Использовать' })).toBeVisible();
});

test('sets below the top of the range: «закрепить» the same weight, with the goal', async ({ page }) => {
  await open(page);
  await seedOwner(page);
  await startDay(page, 2, 1);
  await page.getByRole('button', { name: /Наклонный жим: Hammer - наклон/ }).click();
  await expect(rec(page)).toHaveAttribute('aria-label', 'Рекомендуем сегодня: 85 кг, лучше закрепить');
  await rec(page).getByRole('button', { name: /Почему/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Цель — 10 повторений при RIR 1–2 во всех подходах по 85 кг.');
});

test('another week of the cycle is never a reason: week 3 after a week 2 → not enough data', async ({ page }) => {
  await open(page);
  await seedOwner(page);
  await startDay(page, 3, 1);
  await page.getByRole('button', { name: /Наклонный жим: Hammer - наклон/ }).click();
  await expect(prev(page)).toHaveAttribute('data-kind', 'other'); // unchanged: shown as another phase
  await expect(rec(page)).toHaveAttribute('aria-label', 'Рекомендация: недостаточно данных');
  await expect(rec(page).getByRole('button', { name: 'Использовать' })).toHaveCount(0);
  await rec(page).getByRole('button', { name: /Почему/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Результат другой недели цикла для повышения не используется');
});

// v1.4: where the same week has nothing yet, «Ориентир» from another week — always approximate,
// with its source; never «повысить» or «закрепить». The light week pre-fills it, a heavy week does not.
async function absPhone(page, ws) {
  const { programNow } = await import('../helpers/workout-2026-10-20.js');
  await page.evaluate(async (data) => window.__trainer.store.applyRemote(data, { queue: true }), {
    program: programNow(), sessions: ws.map((w) => w.session), sets: ws.flatMap((w) => w.sets),
  });
}

test('«Ориентир» on week 3 from week 2 (RIR in every set): approximate, its source under ⓘ, the pre-fill stays', async ({ page }) => {
  const { pressHistory } = await import('../helpers/workout-2026-10-20.js');
  await open(page);
  await absPhone(page, pressHistory().slice(0, 2)); // 16.10 and 20.10: week 2 only
  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 1, week: 3, day: 1, date: '2026-10-30' }));
  await page.getByRole('button', { name: /^Пресс в тренажере/ }).click();
  await expect(rec(page)).toHaveAttribute('data-kind', 'estimate');
  await expect(rec(page)).toHaveAttribute('aria-label', /^Ориентир на сегодня, приблизительно: \d/);
  await expect(rec(page)).toContainText('Ориентир:');
  await expect(rec(page)).toContainText('≈');
  await expect(rec(page)).toContainText('примерно');
  expect(await rec(page).locator('.dock__rec-tag').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true); // never cut
  await expect(dock(page)).toContainText('из другой фазы'); // the pre-fill is untouched on a heavy week
  await rec(page).getByRole('button', { name: /Почему/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Рекомендация на сегодня' });
  await expect(sheet).toContainText('По сопоставимой тяжёлой неделе — приблизительно');
  await expect(sheet).toContainText('На неделе 3 этот вариант ещё не выполнялся, поэтому взята неделя 2');
  await expect(sheet).toContainText('проверьте его первым подходом');
  await expect(sheet).not.toContainText('Можно повысить');
});

test('light week: «Ориентир» with a range, and the weight field is pre-filled with it', async ({ page }) => {
  const { pressHistory } = await import('../helpers/workout-2026-10-20.js');
  await open(page);
  await absPhone(page, pressHistory());
  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 1, day: 1, date: '2026-10-30' }));
  await page.getByRole('button', { name: /^Пресс в тренажере/ }).click();
  await expect(rec(page)).toHaveAttribute('aria-label', /^Ориентир на сегодня, приблизительно: [\d,]+ кг \(от [\d,]+ кг до [\d,]+ кг\)$/);
  await expect(dock(page)).toContainText('ориентир, ≈');
  const label = await rec(page).getAttribute('aria-label');
  const w = label.match(/приблизительно: ([\d,]+) кг/)[1];
  await expect(logButton(page)).toContainText(`${w} ×`);
  await rec(page).getByRole('button', { name: /Почему/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Приблизительная оценка по другой неделе');
  await expect(page.getByRole('dialog')).toContainText('Лёгкой недели в истории этого варианта ещё нет');
});

test('the upright row after joining 18.10 and 22.10: day 2 sees the day 4 workout of the same machine', async ({ page }) => {
  await open(page, { at: '2026-11-05T10:00:00+03:00' });
  const owner = convertSnapshot();
  const w18 = workout1018Fixed();
  const w22 = workout1022();
  await page.evaluate(async (data) => window.__trainer.store.applyRemote(data, { queue: true }), {
    program: programBefore1022(),
    sessions: [...owner.sessions, w18.session, w22.session],
    sets: [...owner.sets, ...w18.sets, ...w22.sets],
  });
  const smith = /^Тяга штанги к подбородку в Смите/;
  // Before the fix, day 2 knows only 18.10 (45×10, 50×10, 50×9).
  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 2, day: 2 }));
  await page.getByRole('button', { name: smith }).click();
  await expect(prev(page)).toHaveAttribute('aria-label', /^Прошлый раз, 18 октября/);
  await expect(rec(page)).toHaveAttribute('aria-label', 'Рекомендуем сегодня: 50 кг, лучше закрепить');
  await page.evaluate(async () => {
    const { store } = window.__trainer;
    await store.deleteSession(store.liveSessions().find((s) => s.status === 'active').id);
  });

  await page.getByLabel('Объединение тяги к подбородку').getByRole('button', { name: 'Исправить' }).click();
  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 2, day: 2 }));
  await page.getByRole('button', { name: smith }).click();
  await expect(prev(page)).toHaveAttribute('aria-label', 'Прошлый раз, 22 октября: 40×10, 45×10, 45×9');
  await expect(rec(page)).toHaveAttribute('aria-label', 'Рекомендуем сегодня: 45 кг, лучше закрепить');
});

test('smallest iPhone: the line fits in the dock, the log button stays in view', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 568 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const page = await context.newPage();
  await open(page);
  await seedOwner(page);
  await startDay(page, 2, 1);
  await expect(rec(page)).toBeVisible();
  const [line, grid, log, d] = await Promise.all(['.dock__rec', '.dock__grid', '.dock__log .btn', '.dock'].map((s) => page.locator(s).boundingBox()));
  expect(line.x).toBeGreaterThanOrEqual(d.x);
  expect(line.x + line.width).toBeLessThanOrEqual(d.x + d.width + 0.5);
  expect(line.y + line.height).toBeLessThanOrEqual(grid.y + 0.5);
  expect(log.y + log.height).toBeLessThanOrEqual(568);
  const use = await rec(page).getByRole('button', { name: 'Использовать' }).boundingBox();
  expect(use.x + use.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await context.close();
});

test('smallest iPhone: «Ориентир» keeps «примерно» whole next to «Использовать»', async ({ browser }) => {
  const { pressHistory } = await import('../helpers/workout-2026-10-20.js');
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 568 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const page = await context.newPage();
  await open(page);
  await absPhone(page, pressHistory().slice(0, 2));
  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 1, week: 3, day: 1, date: '2026-10-30' }));
  await page.getByRole('button', { name: /^Пресс в тренажере/ }).click();
  await expect(rec(page)).toHaveAttribute('data-kind', 'estimate');
  await expect(rec(page).locator('.dock__rec-tag')).toHaveText('· примерно');
  expect(await rec(page).locator('.dock__rec-tag').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const use = await rec(page).getByRole('button', { name: 'Использовать' }).boundingBox();
  expect(use.x + use.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await context.close();
});
