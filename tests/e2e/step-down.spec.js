// v1.6.3: the «Ориентир» after a set a rep below the window, where one step of 2,5 kg is large for the
// weight (a cable stack with light plates): it keeps the weight instead of halving it, and the ⓘ names
// the weight between the two. The program editor offers a step of 0,5 kg for small add-on weights.
// Synthetic data on the owner's program.
import { test, expect } from '@playwright/test';
import { startStatic } from '../helpers/servers.js';
import { ready, dock, logButton, pickRir } from './helpers.js';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

const rec = (page) => page.locator('.dock__rec');

async function open(page, viewport = null) {
  if (viewport) await page.setViewportSize(viewport);
  await page.clock.setFixedTime(new Date('2026-10-30T10:00:00+03:00'));
  await page.goto(base);
  await ready(page);
}
// Week 3, day 3: the abs machine 7,5×8 at RIR 1, three sets.
async function seedWeek3(page) {
  const { absWorkout, programNow, PRESS } = await import('../helpers/workout-2026-10-20.js');
  const program = programNow();
  const w3 = absWorkout(program, { id: 'ss-1029', date: '2026-10-29', day: 3, week: 3, abs: [[7.5, 8, 1], [7.5, 8, 1], [7.5, 8, 1]], absAs: PRESS });
  await page.evaluate(async (data) => window.__trainer.store.applyRemote(data, { queue: true }), {
    program, sessions: [w3.session], sets: w3.sets,
  });
}
async function startLight(page) {
  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 1, day: 1, date: '2026-10-30' }));
  await page.getByRole('button', { name: /^Пресс в тренажере/ }).click();
}
async function log(page, reps, rir) {
  const now = Number((await logButton(page).textContent()).match(/× (\d+)/)[1]);
  for (let i = now; i < reps; i++) await dock(page).getByRole('button', { name: 'Увеличить: Повторения' }).click();
  for (let i = now; i > reps; i--) await dock(page).getByRole('button', { name: 'Уменьшить: Повторения' }).click();
  await pickRir(page, rir);
  await logButton(page).click();
  await page.waitForTimeout(120);
}

test('light week, step 2,5 at 5 kg: a set a rep below the window keeps 5 kg (not 2,5), the ⓘ names ≈4,5 kg', async ({ page }) => {
  await open(page);
  await seedWeek3(page);
  await startLight(page);
  // (Before v1.6.4, aimed at the middle of the window: «5 кг (от 5 кг до 7,5 кг)»; now both formulas give 5.)
  await expect(rec(page)).toHaveAttribute('aria-label', 'Ориентир на сегодня, приблизительно: 5 кг');
  await expect(logButton(page)).toHaveText('Записать 5 × 12');
  await log(page, 13, 2); // 15 to failure: in the window (14–18)
  await expect(rec(page)).toHaveAttribute('aria-label', 'Ориентир на сегодня, приблизительно: 5 кг');
  await log(page, 12, 1); // 13: a rep below
  await expect.poll(() => page.evaluate(() => [...window.__trainer.store.state.sets.values()].filter((s) => !s.deleted && s.slotId === 'D1-07' && s.date === '2026-10-30').length)).toBe(2);
  // Before: «Ориентир: ≈2,5 кг» — half the weight, ≈54 reps to failure.
  await expect(rec(page)).toHaveAttribute('aria-label', 'Ориентир на сегодня, приблизительно: 5 кг');
  await expect(rec(page).getByRole('button', { name: 'Использовать' })).toHaveCount(0);
  await rec(page).getByRole('button', { name: /Почему/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Рекомендация на сегодня' });
  await expect(sheet).toContainText('Ориентир: ≈5 кг');
  await expect(sheet).toContainText('Сегодня второй подход 5×12 (RIR 1) — ниже цели, но шаг 2,5 кг для этого веса крупный');
  await expect(sheet).toContainText('Точнее — около 4,5 кг, если есть чем добрать вес');
});

test('the program editor offers a step of 0,5 kg; the next workout steps by 0,5 and the «Ориентир» goes down to 4,5 kg', async ({ page }) => {
  await open(page, { width: 320, height: 640 });
  await seedWeek3(page);
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: /Редактировать программу/ }).click();
  await page.getByRole('group', { name: 'День' }).getByRole('button', { name: 'День 1' }).click();
  await page.locator('.slot-edit', { hasText: 'Пресс в тренажере' }).locator('button').first().click();
  const sheet = page.getByRole('dialog', { name: 'Упражнение' });
  const steps = sheet.getByRole('group', { name: 'Шаг веса' });
  await expect(steps.getByRole('button')).toHaveText(['0,5', '1', '1,25', '2', '2,5', '5']);
  // All six fit at 320 pt: nothing past the right edge of the sheet.
  const box = await sheet.boundingBox();
  for (const b of await steps.getByRole('button').all()) {
    const r = await b.boundingBox();
    expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width);
  }
  await steps.getByRole('button', { name: '0,5' }).click();
  await sheet.getByRole('button', { name: 'Готово' }).click();
  await page.getByRole('button', { name: 'Сохранить программу' }).click();
  await expect.poll(() => page.evaluate(() => window.__trainer.store.state.program.days[0].slots.find((s) => s.id === 'D1-07').step)).toBe(0.5);

  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 1, day: 1, date: '2026-10-30' }));
  await page.locator('.tabbar').getByRole('button', { name: 'Тренировка' }).click();
  await page.getByRole('button', { name: /^Пресс в тренажере/ }).click();
  // With the finer step the first hint sits on the 0,5 grid (≈5,5 kg since v1.6.4, the top of the
  // window); ± moves by 0,5.
  await expect(rec(page)).toHaveAttribute('aria-label', /^Ориентир на сегодня, приблизительно: 5,5 кг/);
  await expect(logButton(page)).toHaveText('Записать 5,5 × 12');
  await dock(page).getByRole('button', { name: 'Уменьшить: Вес' }).click();
  await log(page, 13, 2);
  await expect(logButton(page)).toHaveText('Записать 5 × 13');
  await log(page, 12, 1);
  await expect(rec(page)).toHaveAttribute('aria-label', 'Ориентир на сегодня, приблизительно: 4,5 кг');
  await expect(rec(page).getByRole('button', { name: 'Использовать' })).toBeVisible();
});
