// v1.4: the card that joins «Скручивания в тренажере» of 20.10 to the press series — what it shows,
// nothing changes before «Исправить», then the press has one history on day 1 and day 3: «Прошлый
// раз», the recommendation, «Прогресс» and search. «Отменить». The dumbbell steps card. Ids and keys
// as recorded, values synthetic.
import { test, expect, devices } from '@playwright/test';
import { startStatic } from '../helpers/servers.js';
import { programNow, pressHistory, SID_1020, SET_IDS_1020 } from '../helpers/workout-2026-10-20.js';
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
  const ws = pressHistory();
  await page.evaluate(async (data) => window.__trainer.store.applyRemote(data, { queue: true }), {
    program: programNow(),
    sessions: ws.map((w) => w.session),
    sets: ws.flatMap((w) => w.sets),
  });
}
const card = (page) => page.getByLabel('Объединение пресса');
const stepsCard = (page) => page.getByLabel('Шаг веса для гантелей');
const rowSets = (page) => page.evaluate((ids) => ids.map((id) => window.__trainer.store.state.sets.get(id)).map((x) => `${x.seriesKey}|${x.exercise}|${x.weight}x${x.reps}@${x.rir}|${x.date}|${x.sessionId}`), SET_IDS_1020);
const slotKeys = (page, id) => page.evaluate((sid) => window.__trainer.store.state.program.days.flatMap((d) => d.slots).find((s) => s.id === sid).options.map((o) => o.name), id);

test('the card lists the three 20.10 sets; «Исправить» joins them to the press; day 1 and day 3 show one history', async ({ page }) => {
  await phone(page);
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByRole('heading')).toHaveText('Объединить пресс');
  await expect(card(page).locator('.fix__list li')).toHaveCount(1);
  await expect(card(page).locator('.fix__list li')).toContainText('Скручивания в тренажере → Пресс в тренажере');
  await expect(card(page).locator('.fix__list li')).toContainText('30×10, 32,5×10, 32,5×10');
  await expect(card(page)).toContainText('Программа, день 3: основным станет «Пресс в тренажере»');
  const before = await rowSets(page);
  await page.reload();
  await ready(page);
  expect(await rowSets(page)).toEqual(before); // showing the card changed nothing

  await card(page).getByRole('button', { name: 'Исправить' }).click();
  await expect(page.getByText('Исправлено: 3 подхода, программа дня 3')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  expect(await rowSets(page)).toEqual(before.map((r) => r.replace(/^[^|]+\|[^|]+/, 'press-v-trenazhere|Пресс в тренажере')));
  expect(await slotKeys(page, 'D3-07')).toEqual(['Пресс в тренажере', 'Скручивание на блоке («молитва»)']);
  // The 20.10 workout itself now names the press; it stays finished.
  const s = await page.evaluate((id) => { const x = window.__trainer.store.state.sessions.get(id); return [x.status, x.items.find((i) => i.slotId === 'D3-07').name]; }, SID_1020);
  expect(s).toEqual(['done', 'Пресс в тренажере']);

  // Week 2 of the next cycle, day 1 and day 3: the press opens with 20.10 as last time on that week.
  for (const day of [1, 3]) {
    await page.evaluate((d) => window.__trainer.store.startSession({ cycle: 2, week: 2, day: d, date: `2026-11-1${d}` }), day);
    await page.getByRole('button', { name: /^Пресс в тренажере/ }).click();
    await expect(page.locator('.dock__prev')).toHaveAttribute('aria-label', 'Прошлый раз, 20 октября: 30×10, 32,5×10, 32,5×10');
    await expect(page.locator('.dock__rec')).toBeVisible();
    await page.evaluate(() => { const { store } = window.__trainer; const s = store.liveSessions().find((x) => x.status === 'active'); return store.deleteSession(s.id); });
  }

  // «Прогресс»: one exercise with all four workouts, days 1 and 3.
  await page.evaluate(() => import('./js/ui/core.js').then(({ app }) => app.ui.go({ tab: 'progress', view: { type: 'exercise', key: 'press-v-trenazhere' } })));
  await expect(page.locator('.expo')).toHaveCount(4);
  const rows = await page.locator('.expo__head').allTextContents();
  expect(rows.map((t) => t.replace(/\s+/g, ''))).toEqual([
    '29октябряцикл1,неделя3,день3',
    '25октябряцикл1,неделя3,день1',
    '20октябряцикл1,неделя2,день3',
    '16октябряцикл1,неделя2,день1',
  ]);
});

test('«Отменить» right after puts the sets and day 3 back; the card is offered again', async ({ page }) => {
  await phone(page);
  const before = await rowSets(page);
  const program = await page.evaluate(() => JSON.stringify(window.__trainer.store.state.program.days));
  await card(page).getByRole('button', { name: 'Исправить' }).click();
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(card(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.__trainer.store.state.program.days))).toBe(program);
  await expect.poll(() => rowSets(page)).toEqual(before);
});

test('steps card: lateral raise 1 kg, concentration curl 2 kg; the composer steps by them', async ({ page }) => {
  await phone(page);
  await expect(stepsCard(page)).toContainText('«Разведения гантелей в стороны» — шаг 1 кг, «Концентрированное сгибание на бицепс» — шаг 2 кг');
  await expect(stepsCard(page).locator('.fix__list')).toHaveCount(0);
  await stepsCard(page).getByRole('button', { name: 'Исправить' }).click();
  await expect(page.getByText('Исправлено: программа')).toBeVisible();
  await expect(stepsCard(page)).toHaveCount(0);
  const steps = await page.evaluate(() => Object.fromEntries(window.__trainer.store.state.program.days.flatMap((d) => d.slots).map((s) => [s.id, s.step])));
  expect([steps['D2-04'], steps['D3-02'], steps['D4-06'], steps['D1-07']]).toEqual([1, 2, 2.5, 2.5]);
  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 2, day: 2, date: '2026-11-12' }));
  await page.getByRole('button', { name: /^Разведения гантелей в стороны/ }).click();
  // No history yet: «+» goes 1, 2 kg — not 2,5.
  const weight = page.locator('.dock__grid > div').first().locator('.stepper__value');
  await page.getByRole('button', { name: 'Увеличить: Вес' }).click();
  await expect(weight).toHaveText('1');
  await page.getByRole('button', { name: 'Увеличить: Вес' }).click();
  await expect(weight).toHaveText('2');
});

test('smallest iPhone: both cards fit, nothing runs off the screen', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 568 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const page = await context.newPage();
  await phone(page);
  for (const c of [card(page), stepsCard(page)]) {
    await expect(c).toBeVisible();
    const box = await c.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320.5);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await context.close();
});
