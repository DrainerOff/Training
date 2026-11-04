// v1.6.2: the independent review of v1.4.2–v1.6.1, the parts that live in the set composer.
//  * Light week without a «Ориентир» (pain on the heavy week): the heavy weight is not put under the light
//    week's reps.
//  * «−N% · нарочно?» after «Заменить» keeping the sets: today's sets of the other variant are not
//    today's weight of this one.
// Synthetic data on the owner's program.
import { test, expect } from '@playwright/test';
import { startStatic } from '../helpers/servers.js';
import { ready, dock, logButton } from './helpers.js';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

const rec = (page) => page.locator('.dock__rec');

async function open(page) {
  await page.clock.setFixedTime(new Date('2026-10-30T10:00:00+03:00'));
  await page.goto(base);
  await ready(page);
}
async function seed(page, ws) {
  const { programNow } = await import('../helpers/workout-2026-10-20.js');
  await page.evaluate(async (data) => window.__trainer.store.applyRemote(data, { queue: true }), {
    program: programNow(), sessions: ws.map((w) => w.session), sets: ws.flatMap((w) => w.sets),
  });
}

test('review 4: light week, no «Ориентир» after pain on week 3 — the weight field stays empty, reps from the light target', async ({ page }) => {
  const { absWorkout, programNow, PRESS } = await import('../helpers/workout-2026-10-20.js');
  const program = programNow();
  const w3 = absWorkout(program, { id: 'ss-1029', date: '2026-10-29', day: 3, week: 3, abs: [[37.5, 8, 1], [37.5, 7, 1], [37.5, 7, 0]], absAs: PRESS });
  w3.sets.find((s) => s.id === 'ss-1029-a2').pain = true;
  await open(page);
  await seed(page, [w3]);
  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 1, day: 1, date: '2026-10-30' }));
  await page.getByRole('button', { name: /^Пресс в тренажере/ }).click();
  await expect(rec(page)).toHaveAttribute('data-kind', 'none');
  await expect(dock(page).locator('.dock__prev')).toHaveAttribute('aria-label', 'Другая фаза, неделя 3, 29 октября: 37,5×8, 37,5×7, 37,5×7');
  // Before: «Записать 37,5 × 12» — the week-3 weight (with pain) under 12 reps.
  await expect(logButton(page)).toHaveText('Введите вес');
  await expect(dock(page)).not.toContainText('из другой фазы');
  await dock(page).getByRole('button', { name: 'Увеличить: Вес' }).click();
  await expect(logButton(page)).toContainText('× 12');
});

test('review 4: without pain the light week still starts from the «Ориентир»', async ({ page }) => {
  const { absWorkout, programNow, PRESS } = await import('../helpers/workout-2026-10-20.js');
  const w3 = absWorkout(programNow(), { id: 'ss-1029', date: '2026-10-29', day: 3, week: 3, abs: [[37.5, 8, 1], [37.5, 7, 1], [37.5, 7, 0]], absAs: PRESS });
  await open(page);
  await seed(page, [w3]);
  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 1, day: 1, date: '2026-10-30' }));
  await page.getByRole('button', { name: /^Пресс в тренажере/ }).click();
  await expect(rec(page)).toHaveAttribute('data-kind', 'estimate');
  await expect(dock(page)).toContainText('ориентир, ≈');
  await expect(logButton(page)).toContainText(/Записать (27,5|30|32,5) × 12/);
});

test('review 10: «Заменить» keeping the sets — no «−N% · нарочно?» for the new variant before its own set', async ({ page }) => {
  const { pressHistory, CRUNCH } = await import('../helpers/workout-2026-10-20.js');
  await open(page);
  await seed(page, pressHistory().slice(0, 2)); // the crunch machine on week 2: 30, 32,5, 32,5
  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 2, day: 1, date: '2026-10-30' }));
  await page.getByRole('button', { name: /^Пресс в тренажере/ }).click();
  // Two light sets on the press, then «Заменить» → the crunch, the press sets stay the press's.
  await page.evaluate(async (crunch) => {
    const { store } = window.__trainer;
    const s = store.liveSessions().find((x) => x.status === 'active');
    const slot = s.items.find((i) => i.name === 'Пресс в тренажере').slotId;
    await store.logSet(s.id, slot, { weight: 15, reps: 12, rir: 2 });
    await new Promise((r) => setTimeout(r, 1600));
    await store.logSet(s.id, slot, { weight: 15, reps: 12, rir: 2 });
    await store.swapVariant(s.id, slot, crunch);
  }, CRUNCH);
  await expect(dock(page)).toContainText('Скручивания в тренажере');
  await expect(dock(page).locator('.dock__prev')).toHaveAttribute('aria-label', /^Прошлый раз, 20 октября: 30×10, 32,5×10, 32,5×10/);
  // Before: «Вес −54% · нарочно?» — the press's 15 kg against the crunch's 32,5.
  await expect(dock(page).locator('.dock__ask')).toHaveCount(0);
  await expect(rec(page)).toBeVisible();
  // A lighter set on the crunch itself is asked about.
  await page.evaluate(async () => {
    const { store } = window.__trainer;
    const s = store.liveSessions().find((x) => x.status === 'active');
    const slot = s.items.find((i) => i.name === 'Скручивания в тренажере').slotId;
    await new Promise((r) => setTimeout(r, 1600));
    await store.logSet(s.id, slot, { weight: 25, reps: 10, rir: 2 });
  });
  await expect(dock(page).locator('.dock__ask')).toContainText('−23%');
});
