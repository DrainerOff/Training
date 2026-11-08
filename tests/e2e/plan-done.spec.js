// v1.6.4: once the plan of an exercise is done, the dock stops asking for a set. Before, after the last
// planned set the composer stayed open with «Подход 4, сверх плана» and «Записать», even with the whole
// workout done, and the same in a past workout opened from «История». Now it folds into one line:
// «Ещё подход» opens the composer on purpose, «Завершить тренировку» is there when everything is done.
// Synthetic data.
import { test, expect } from '@playwright/test';
import { startStatic } from '../helpers/servers.js';
import { ready, dock, logSet, seedOwner, state } from './helpers.js';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

// Day 1, week 2: every exercise done 20 minutes ago except the last one, which has one set to go.
async function gym(page) {
  await page.goto(base);
  await ready(page);
  await seedOwner(page);
  const last = await page.evaluate(async () => {
    const { store } = window.__trainer;
    const { targetFor } = await import('./js/lib/program.js');
    const s = await store.startSession({ cycle: 2, week: 2, day: 1 });
    const t = Date.now() - 20 * 60 * 1000;
    const sets = [];
    s.items.forEach((it, i) => {
      const n = targetFor(it, 2).sets - (i === s.items.length - 1 ? 1 : 0);
      for (let k = 1; k <= n; k++) {
        const at = t + (i * 5 + k) * 1000;
        sets.push({ id: `seed-${it.slotId}-${k}`, sessionId: s.id, slotId: it.slotId, seriesKey: it.seriesKey, exercise: it.name, date: s.date, cycle: s.cycle, week: s.week, day: s.day,
          setNo: k, weight: it.category === 'pullup' ? 0 : 20, reps: 9, rir: 2, drop: false, pain: false, technique: false, note: '', createdAt: at, updatedAt: at, deleted: false });
      }
    });
    await store.applyRemote({ sets }, { queue: true });
    const it = s.items[s.items.length - 1];
    return { name: it.name, key: it.seriesKey, sets: targetFor(it, 2).sets };
  });
  await dock(page).waitFor();
  return last;
}

const lastSets = (page, key) => state(page).then((st) => st.activeSets.filter((s) => s.key === key).length);

test('the plan done: the dock folds — no «сверх плана», a set over the plan only on purpose, «Завершить тренировку» at hand', async ({ page }) => {
  const last = await gym(page);
  await expect(dock(page)).toContainText(`Подход ${last.sets} из ${last.sets} ${last.name}`);
  await logSet(page, { rir: 1 });

  // The last planned set: what was recorded and «Отменить», nothing more to enter.
  await expect(dock(page)).toContainText('Все упражнения выполнены');
  await expect(dock(page).getByRole('button', { name: 'Отменить' })).toBeVisible();
  await expect(dock(page)).not.toContainText('сверх плана');
  await expect(dock(page).getByRole('button', { name: /^Записать/ })).toHaveCount(0);
  await expect(dock(page).getByRole('group', { name: 'Фактический RIR' })).toHaveCount(0);
  await expect(dock(page).getByRole('button', { name: 'Ещё подход' })).toBeVisible();
  await expect(dock(page).getByRole('button', { name: 'Завершить тренировку' })).toBeVisible();
  await expect(dock(page)).not.toContainText('отдых');

  // «Отменить» takes the set back: the composer for it again.
  await dock(page).getByRole('button', { name: 'Отменить' }).click();
  await expect(dock(page)).toContainText(`Подход ${last.sets} из ${last.sets} ${last.name}`);
  expect(await lastSets(page, last.key)).toBe(last.sets - 1);
  await page.getByRole('button', { name: 'Уменьшить: Повторения' }).click();
  await logSet(page, { rir: 2 });
  // The notice goes after a few seconds; the line says the plan is done.
  await expect(dock(page)).toContainText(`План выполнен ${last.name}`, { timeout: 8000 });
  // Today's weight is far below the same week last time: the «нарочно?» question stays in the folded dock.
  await expect(dock(page).locator('.dock__ask')).toContainText('нарочно?');
  await expect(dock(page).locator('.dock__ask').getByRole('button', { name: 'Нет, это просадка' })).toBeVisible();

  // A set over the plan — only when asked for; then the dock folds again.
  await dock(page).getByRole('button', { name: 'Ещё подход' }).click();
  await expect(dock(page)).toContainText(`Подход ${last.sets + 1}, сверх плана ${last.name}`);
  await page.getByRole('button', { name: 'Уменьшить: Повторения' }).click();
  await logSet(page, { rir: 1 });
  await expect(dock(page).getByRole('button', { name: 'Ещё подход' })).toBeVisible();
  await expect(dock(page).getByRole('button', { name: /^Записать/ })).toHaveCount(0);
  expect(await lastSets(page, last.key)).toBe(last.sets + 1);

  // An exercise done earlier, opened to look at it: folded too, «Завершить тренировку» as everything is done.
  // (The «Подход … записан» notice may still stand there for its few seconds.)
  await page.locator('.ex__row').first().click();
  await expect(dock(page)).toContainText('План выполнен', { timeout: 8000 });
  await expect(dock(page).getByRole('button', { name: 'Завершить тренировку' })).toBeVisible();

  // «Завершить тренировку» right from the dock.
  await dock(page).getByRole('button', { name: 'Завершить тренировку' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Завершить' }).click();
  await expect(page.locator('.next__title')).toBeVisible();

  // The same workout from «История»: nothing asks to be entered, a forgotten set is one tap away.
  await page.getByRole('button', { name: 'История' }).click();
  await page.locator('.row--day').first().click();
  await expect(dock(page)).toContainText('План выполнен');
  await expect(dock(page)).not.toContainText('сверх плана');
  await expect(dock(page).getByRole('button', { name: /^Записать/ })).toHaveCount(0);
  await expect(dock(page).getByRole('button', { name: 'Завершить тренировку' })).toHaveCount(0);
  await dock(page).getByRole('button', { name: 'Ещё подход' }).click();
  await expect(dock(page)).toContainText('сверх плана');
});

test('an exercise not done yet keeps the composer; one done earlier folds while others are still to do', async ({ page }) => {
  const last = await gym(page);
  // The first exercise is done, the last is not: looking at the first shows no composer and no
  // «Завершить тренировку» (the workout is not done), the rest timer is still there.
  await page.locator('.ex__row').first().click();
  await expect(dock(page)).toContainText('План выполнен');
  await expect(dock(page).getByRole('button', { name: 'Ещё подход' })).toBeVisible();
  await expect(dock(page).getByRole('button', { name: 'Завершить тренировку' })).toHaveCount(0);
  await expect(dock(page)).toContainText('отдых');
  await page.locator('.ex__row').filter({ hasText: last.name }).click();
  await expect(dock(page)).toContainText(`Подход ${last.sets} из ${last.sets} ${last.name}`);
  await expect(dock(page).getByRole('button', { name: /^Записать/ })).toBeVisible();
});
