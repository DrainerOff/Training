// v1.5: «Новая точка отсчёта» after a deliberate weight drop (stricter technique, full range, other
// settings). From the mark on, «Прошлый раз», the pre-filled weight, the status and the charts start
// over; what was before stays visible for reference only. A drop of 10%+ against the same week asks
// whether it was meant. Synthetic data: the day 3 machine row, 80 → 90 kg in cycle 1, 60 / 70 / 75 kg
// after the mark on the light week of cycle 2.
import { test, expect, devices } from '@playwright/test';
import { startStatic } from '../helpers/servers.js';
import { history } from '../helpers/baseline-history.js';
import { ready, dock, logButton, pickRir } from './helpers.js';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

const rowName = /^Горизонтальная тяга в тренажере/;
const prev = (page) => page.locator('.dock__prev');
const rec = (page) => page.locator('.dock__rec');
const ask = (page) => page.locator('.dock__ask');

async function phone(page, data, at = '2026-11-20T10:00:00+03:00') {
  await page.clock.setFixedTime(new Date(at));
  await page.goto(base);
  await ready(page);
  await page.evaluate(async (d) => window.__trainer.store.applyRemote(d, { queue: true }), data);
  await page.waitForFunction(() => !window.__trainer.store.state.program.draft);
}
async function startRow(page, { cycle, week, date }) {
  await page.evaluate((s) => window.__trainer.store.startSession({ ...s, day: 3 }), { cycle, week, date });
  await dock(page).waitFor();
  await page.getByRole('button', { name: rowName }).click();
  await expect(dock(page)).toContainText('Горизонтальная тяга в тренажере');
}

test('week 3 after the mark: last time and the pre-fill come from after it, the old week 3 only for reference', async ({ page }) => {
  await phone(page, history());
  await startRow(page, { cycle: 2, week: 3, date: '2026-11-17' });
  // The latest result since the mark (week 2, new technique) — not 90 kg from before it.
  await expect(prev(page)).toHaveAttribute('data-kind', 'other');
  await expect(prev(page)).toHaveAttribute('aria-label', 'Другая фаза, неделя 2, 10 ноября: 70×8, 70×8, 70×8, 70×8');
  await expect(rec(page)).toHaveAttribute('data-kind', 'estimate');
  const w = (await rec(page).getAttribute('aria-label')).match(/приблизительно: ([\d,]+) кг/)[1];
  await expect(logButton(page)).toContainText(`${w} ×`); // the pre-fill is the «Ориентир»
  await expect(dock(page)).toContainText('ориентир, ≈');
  const hint = page.locator('.panel .prev');
  await expect(hint).toContainText('Последний раз — неделя 2 (другая фаза), 10 ноября');
  await expect(hint).toContainText('До новой точки отсчёта (с 3 ноября): 29 октября — только для справки');
  await expect(hint).toContainText('90×6');
});

test('week 2 right after a mark on the light week: no weight from before it, the field waits for the owner', async ({ page }) => {
  await phone(page, history({ upTo: 'c2w1' }), '2026-11-10T10:00:00+03:00');
  await startRow(page, { cycle: 2, week: 2, date: '2026-11-10' });
  await expect(prev(page)).toHaveAttribute('aria-label', 'Другая фаза, неделя 1, 3 ноября: 60×12, 60×12, 60×12');
  await expect(rec(page)).toHaveAttribute('aria-label', 'Рекомендация: недостаточно данных');
  await expect(logButton(page)).toHaveText('Введите вес');
  await expect(page.locator('.panel .prev')).toContainText('До новой точки отсчёта (с 3 ноября): 20 октября — только для справки');
  await expect(page.locator('.panel .prev')).toContainText('80×8');

  // The home screen says the same before the workout.
  await page.evaluate(async () => {
    const { store } = window.__trainer;
    await store.deleteSession(store.liveSessions().find((s) => s.status === 'active').id);
  });
  await page.getByRole('button', { name: 'Другой день или неделя' }).click();
  await page.getByRole('group', { name: 'Неделя цикла' }).getByRole('button').nth(1).click();
  await page.getByRole('group', { name: 'День' }).getByRole('button', { name: '3', exact: true }).click();
  await page.getByRole('button', { name: 'Выбрать' }).click();
  await expect(page.locator('.plan-list li', { hasText: 'Горизонтальная тяга в тренажере' })).toContainText('последний раз (неделя 1): 60×12, 60×12, 60×12');
});

test('a drop of 10%+ asks whether it was meant; marking it switches last time to «до отсчёта»', async ({ page }) => {
  await phone(page, history({ mark: false, upTo: 'c1w3' }), '2026-11-10T10:00:00+03:00');
  await startRow(page, { cycle: 2, week: 2, date: '2026-11-10' });
  await expect(prev(page)).toHaveAttribute('aria-label', 'Прошлый раз, 20 октября: 80×8, 80×8, 80×8, 80×8');
  await expect(logButton(page)).toContainText('80 × 8');
  // 75 kg: −6% — nothing asked.
  await page.getByRole('button', { name: 'Уменьшить: Вес' }).click();
  await page.getByRole('button', { name: 'Уменьшить: Вес' }).click();
  await pickRir(page);
  await logButton(page).click();
  await expect(page.locator('.panel .set__nums')).toHaveCount(1);
  await expect(ask(page)).toHaveCount(0);
  await page.evaluate(() => {
    const { store } = window.__trainer;
    return store.deleteSet(store.setsOf(store.liveSessions().find((s) => s.status === 'active').id)[0].id);
  });
  await expect(page.locator('.panel .set__nums')).toHaveCount(0);
  // 70 kg: −13% — asked, logging is not blocked. (The composer may keep 75 typed for set 1 or start
  // from 80 again: step down to 70 either way.)
  await expect(ask(page)).toHaveCount(0);
  await expect(logButton(page)).toContainText(/(75|80) × 8/);
  const steps = (await logButton(page).textContent()).includes('80 × 8') ? 4 : 2;
  for (let i = 0; i < steps; i++) await page.getByRole('button', { name: 'Уменьшить: Вес' }).click();
  await expect(logButton(page)).toContainText('70 × 8');
  await pickRir(page);
  await logButton(page).click();
  // In place of the recommendation (which says «закрепить» 80): «−13% · нарочно?», ⓘ says it in full.
  await expect(ask(page)).toContainText('−13%');
  await expect(ask(page)).toContainText('нарочно?');
  await expect(page.locator('.dock__rec:not(.dock__ask)')).toHaveCount(0);
  await expect(logButton(page)).toBeEnabled();
  await ask(page).getByRole('button', { name: /Подробнее/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Вес ниже прошлого раза' });
  await expect(sheet).toContainText('Вес на 13% ниже, чем 20 октября: было 80\u00a0кг, сегодня 70\u00a0кг.');
  await expect(sheet).toContainText('сравнение начнётся с сегодняшней тренировки');
  await sheet.getByRole('button', { name: 'Отметить точку отсчёта' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(ask(page)).toHaveCount(0);
  await expect(page.locator('.panel .item-note')).toContainText('новая точка отсчёта');
  const flags = await page.evaluate(() => window.__trainer.store.liveSessions().find((s) => s.status === 'active').items.find((i) => i.slotId === 'D3-04').flags);
  expect(flags.baseline).toBe(true);
  await expect(prev(page)).toHaveAttribute('data-kind', 'before');
  await expect(prev(page)).toContainText('До отсчёта · нед. 2');
  await expect(rec(page)).toHaveAttribute('aria-label', 'Рекомендация: недостаточно данных');
  await expect(logButton(page)).toContainText('70 × 8'); // the next set follows today's
});

test('«Нет» hides the question for this workout, the recommendation comes back', async ({ page }) => {
  await phone(page, history({ mark: false, upTo: 'c1w3' }), '2026-11-10T10:00:00+03:00');
  await startRow(page, { cycle: 2, week: 2, date: '2026-11-10' });
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Уменьшить: Вес' }).click();
  await pickRir(page);
  await logButton(page).click();
  await ask(page).getByRole('button', { name: 'Нет, это просадка' }).click();
  await expect(ask(page)).toHaveCount(0);
  await expect(rec(page)).toHaveAttribute('aria-label', 'Рекомендуем сегодня: 80 кг, лучше закрепить'); // back as it was
  await page.getByRole('button', { name: 'Уменьшить: Повторения' }).click(); // the clock stands still: not the same tap
  await pickRir(page);
  await logButton(page).click();
  await expect(page.locator('.panel .set__nums')).toHaveCount(2);
  await expect(ask(page)).toHaveCount(0);
  const flags = await page.evaluate(() => window.__trainer.store.liveSessions().find((s) => s.status === 'active').items.find((i) => i.slotId === 'D3-04').flags);
  expect(flags.baseline).toBe(false);
});

test('progress: without the mark a regress; with it nothing to compare yet, a dashed line on the chart', async ({ page }) => {
  await phone(page, history({ mark: false, upTo: 'c2w3' }));
  await page.getByRole('button', { name: 'Прогресс' }).click();
  const row = page.locator('.rows li', { hasText: 'Горизонтальная тяга в тренажере' });
  await expect(row).toContainText('Регресс');

  // The same history with the mark on the light week of cycle 2.
  await page.evaluate(() => window.__trainer.store.updateItem('c2w1', 'D3-04', { flags: { baseline: true } }));
  await expect(row).toContainText('Мало данных');
  await row.getByRole('button').click();
  await expect(page.locator('.callout')).toContainText('После новой точки отсчёта (3 ноября) сравнивать пока не с чем');
  const chart = page.locator('.chart');
  await expect(chart.locator('.chart__mark')).toHaveCount(1);
  await expect(chart.locator('.chart__mark text')).toHaveText('новая точка');
  await expect(chart).toContainText('Пунктир — новая точка отсчёта');
  // The mark sits between 29.10 (index 1) and 10.11 (index 2) of the heavy weeks shown.
  const [m, a, b] = await page.evaluate(() => {
    const svg = document.querySelector('.chart svg');
    const x = Number(svg.querySelector('.chart__mark line').getAttribute('x1'));
    const cols = [...svg.querySelectorAll('rect[role="button"]')].map((r) => Number(r.getAttribute('x')) + 14);
    return [x, cols[1], cols[2]];
  });
  expect(m).toBeGreaterThan(a);
  expect(m).toBeLessThan(b);
  // Light week only: the mark is the first point shown, nothing to divide.
  await page.getByRole('group', { name: 'Фаза' }).getByRole('button', { name: /лёгкая/ }).click();
  await expect(chart).toHaveCount(1);
  await expect(page.locator('.chart__mark')).toHaveCount(0);
});

test('smallest iPhone: the question and «До отсчёта» fit the dock, the log button stays in view', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 568 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const page = await context.newPage();
  await phone(page, history({ mark: false, upTo: 'c1w3' }), '2026-11-10T10:00:00+03:00');
  await startRow(page, { cycle: 2, week: 2, date: '2026-11-10' });
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Уменьшить: Вес' }).click();
  await pickRir(page);
  await logButton(page).click();
  await expect(ask(page)).toBeVisible();
  const [line0, d0] = await Promise.all(['.dock__ask', '.dock'].map((x) => page.locator(x).boundingBox()));
  expect(line0.x + line0.width).toBeLessThanOrEqual(d0.x + d0.width + 0.5);
  expect(await ask(page).locator('.dock__rec-tag').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true); // «нарочно?» whole
  for (const b of await ask(page).getByRole('button').all()) {
    const box = await b.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  expect((await page.locator('.dock__log .btn').boundingBox()).y + 56).toBeLessThanOrEqual(568);
  await ask(page).getByRole('button', { name: 'Да, отметить новую точку отсчёта' }).click();
  await expect(prev(page)).toHaveAttribute('data-kind', 'before');
  const [line, d, log] = await Promise.all(['.dock__prev', '.dock', '.dock__log .btn'].map((s) => page.locator(s).boundingBox()));
  expect(line.x + line.width).toBeLessThanOrEqual(d.x + d.width + 0.5);
  expect(log.y + log.height).toBeLessThanOrEqual(568);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await context.close();
});
