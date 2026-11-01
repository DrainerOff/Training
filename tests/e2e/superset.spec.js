// v1.4.3: a superset done by alternating two exercises (calves in the leg press ↔ upright row), with
// «Пропустить» pressed on the calves before their first set. A set logged after «Пропустить» means the
// exercise is being done: no «пропущено», no check mark at 1/3 and 2/3, and when the row is finished the
// workout moves on to the calves instead of «Все упражнения выполнены». Synthetic data.
import { test, expect } from '@playwright/test';
import { startStatic } from '../helpers/servers.js';
import { ready, dock, logSet as logOne, seedOwner } from './helpers.js';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

const CALVES = 'Икры в жиме ногами';
const ROW = 'Тяга штанги к подбородку';

// Day 4, week 3: everything but the upright row and the calves already done (20 minutes ago).
async function gym(page) {
  await page.goto(base);
  await ready(page);
  await seedOwner(page);
  await page.evaluate(async (open) => {
    const { store } = window.__trainer;
    const s = await store.startSession({ cycle: 2, week: 3, day: 4 });
    const t = Date.now() - 20 * 60 * 1000;
    const sets = [];
    s.items.filter((it) => !open.includes(it.name)).forEach((it, i) => {
      for (let n = 1; n <= (it.category === 'base' ? 4 : 3); n++) {
        const at = t + (i * 4 + n) * 1000;
        sets.push({ id: `seed-${it.slotId}-${n}`, sessionId: s.id, slotId: it.slotId, seriesKey: it.seriesKey, exercise: it.name, date: s.date, cycle: s.cycle, week: s.week, day: s.day,
          setNo: n, weight: it.category === 'pullup' ? 0 : 20, reps: 6, rir: 1, drop: false, pain: false, technique: false, note: '', createdAt: at, updatedAt: at, deleted: false });
      }
    });
    await store.applyRemote({ sets }, { queue: true });
  }, [CALVES, ROW]);
  await dock(page).waitFor();
}

const row = (page, name) => page.locator('.ex__row').filter({ hasText: name });
const open = (page, name) => row(page, name).click();
const skipped = (page) => page.evaluate((name) => {
  const { store } = window.__trainer;
  const s = store.liveSessions().find((x) => x.status === 'active');
  return s.items.find((it) => it.name === name).skipped ?? null;
}, CALVES);
const pause = (page) => page.waitForTimeout(1600); // a real next set, not the double-tap guard
// No history for these two: the first set of each needs a weight typed in.
async function logSet(page, opts) {
  if (await dock(page).getByRole('button', { name: 'Введите вес' }).count()) await dock(page).getByRole('button', { name: 'Увеличить: Вес' }).click();
  await logOne(page, opts);
}

test('superset after «Пропустить» on the calves: the first set clears the mark, counts read 1/3 and 2/3, the row hands over to the calves', async ({ page }) => {
  await gym(page);
  await open(page, CALVES);
  await expect(dock(page)).toContainText(`Подход 1 из 3 ${CALVES}`);

  // «Пропустить» before the first set (to get to the row first, or a stray tap).
  await page.locator('.panel').getByRole('button', { name: 'Пропустить' }).click();
  await expect(page.locator('.panel').getByRole('button', { name: 'Вернуть' })).toBeVisible();
  expect(await skipped(page)).toBe(true);

  // The calves set is logged anyway: not skipped any more, in the store and on screen.
  await logSet(page, { rir: 2 });
  await expect.poll(() => skipped(page)).toBe(false);
  await expect(page.locator('.panel').getByRole('button', { name: 'Вернуть' })).toHaveCount(0);

  await pause(page);
  await open(page, ROW);
  await expect(row(page, CALVES)).not.toContainText('пропущено');
  await expect(row(page, CALVES).locator('.ex__count')).toHaveText('1/3');
  await expect(row(page, CALVES).locator('.ex__check')).toHaveClass(/ex__check--part/);
  await expect(row(page, CALVES).locator('.ex__check')).not.toHaveClass(/ex__check--done/);
  await logSet(page, { rir: 1 });

  await pause(page);
  await open(page, CALVES);
  await logSet(page, { rir: 1 });
  await pause(page);
  await open(page, ROW);
  await expect(row(page, CALVES).locator('.ex__count')).toHaveText('2/3');
  await expect(row(page, CALVES).locator('.ex__check')).not.toHaveClass(/ex__check--done/);
  await logSet(page, { rir: 1 });
  await pause(page);
  await logSet(page, { rir: 0 });

  // The row is done: on to the calves (the only exercise left), not «Все упражнения выполнены».
  await expect(dock(page)).toContainText(`Готово: ${ROW}`);
  await expect(page.locator('.panel__title')).toHaveText(CALVES);
  await expect(dock(page)).not.toContainText('Все упражнения выполнены');
  await pause(page);
  await logSet(page, { rir: 0 });
  await expect(row(page, CALVES)).toHaveCount(0); // its panel is open, the third set in the list
  await expect(page.locator('.panel .set')).toHaveCount(4); // 3 sets + the drop set planned on week 3
  await expect(dock(page)).toContainText('≈70% веса'); // the drop set is next
});

test('an old workout that still carries «пропущено» next to logged sets reads as done by its sets, and «Пропустить» alone still skips', async ({ page }) => {
  await gym(page);
  // As recorded by v1.4.2: the mark stayed on the calves after their sets.
  await page.evaluate(async (name) => {
    const { store } = window.__trainer;
    const s = store.liveSessions().find((x) => x.status === 'active');
    const it = s.items.find((x) => x.name === name);
    await store.updateItem(s.id, it.slotId, { skipped: true });
    const t = Date.now() - 5 * 60 * 1000;
    await store.applyRemote({ sets: [{ id: 'old-calf-1', sessionId: s.id, slotId: it.slotId, seriesKey: it.seriesKey, exercise: it.name, date: s.date, cycle: s.cycle, week: s.week, day: s.day,
      setNo: 1, weight: 100, reps: 12, rir: 1, drop: false, pain: false, technique: false, note: '', createdAt: t, updatedAt: t, deleted: false }] }, { queue: true });
  }, CALVES);
  await expect(page.locator('.panel__title')).toHaveText(ROW); // the first exercise not done is open
  await expect(row(page, CALVES)).not.toContainText('пропущено');
  await expect(row(page, CALVES).locator('.ex__count')).toHaveText('1/3');
  await expect(row(page, CALVES).locator('.ex__check')).not.toHaveClass(/ex__check--done/);

  // Skipping the row with no sets is still a skip: «пропущено», a check mark, nothing missing for it.
  await page.locator('.panel').getByRole('button', { name: 'Пропустить' }).click();
  await expect(page.locator('.panel__title')).toHaveText(CALVES); // the one left open
  await expect(row(page, ROW)).toContainText('пропущено');
  await expect(row(page, ROW).locator('.ex__check')).toHaveClass(/ex__check--done/);
  await page.getByRole('button', { name: 'Завершить тренировку' }).click();
  await expect(page.locator('.warn-line')).toHaveText('Не выполнено подходов по плану: 2. Можно завершить и так.');
});
