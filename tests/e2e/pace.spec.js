// v1.7.0: under the workout header — how much of the plan is done and roughly how long the rest takes,
// with the clock time of the end. Learned from the intervals between sets of past workouts.
// Synthetic data.
import { test, expect } from '@playwright/test';
import { startStatic } from '../helpers/servers.js';
import { ready, logSet, seedOwner } from './helpers.js';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

const MIN = 60 * 1000;
const NOW = new Date('2026-11-20T21:00:00+03:00').getTime();
const pace = (page) => page.locator('.wk-pace');

// Three past day-1 workouts of week 2: first set 5 min after «Начать», then 3 min per set, 5 min to
// change exercise. Returns the planned sets of each exercise of today's day 1, week 2.
async function seedPast(page) {
  return page.evaluate(async ({ NOW, MIN }) => {
    const { store } = window.__trainer;
    const { itemsForDay } = await import('./js/lib/planner.js');
    const { targetFor } = await import('./js/lib/program.js');
    const items = itemsForDay(store.state.program, 1);
    const sessions = [];
    const sets = [];
    for (let d = 1; d <= 3; d++) {
      const id = `ss-past-${d}`;
      const start = NOW - d * 7 * 24 * 60 * MIN;
      let t = start;
      sessions.push({ id, date: new Date(start).toISOString().slice(0, 10), cycle: 1, week: 2, day: 1, status: 'done', startedAt: start, finishedAt: null, note: '', items, updatedAt: start, deleted: false });
      items.forEach((it, i) => {
        const n = targetFor(it, 2).sets;
        for (let k = 1; k <= n; k++) {
          t += k === 1 ? 5 * MIN : 3 * MIN;
          sets.push({ id: `st-past-${d}-${i}-${k}`, sessionId: id, slotId: it.slotId, seriesKey: it.seriesKey, exercise: it.name, date: sessions[sessions.length - 1].date, cycle: 1, week: 2, day: 1,
            setNo: k, weight: 20, reps: 10, rir: 2, drop: false, pain: false, technique: false, note: '', createdAt: t, updatedAt: t, deleted: false });
        }
      });
      sessions[sessions.length - 1].finishedAt = t;
    }
    await store.applyRemote({ sessions, sets }, { queue: false });
    return items.map((it) => targetFor(it, 2).sets + targetFor(it, 2).drop);
  }, { NOW, MIN });
}

const round = (m) => (m < 10 ? Math.round(m) : Math.round(m / 5) * 5);
const clock = (ms) => {
  const d = new Date(Math.round(ms / (5 * MIN)) * 5 * MIN + 3 * 60 * MIN); // Moscow, UTC+3
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const left = (m) => (round(m) >= 60 ? `≈${Math.floor(round(m) / 60)} ч${round(m) % 60 ? ` ${round(m) % 60} мин` : ''}` : `≈${round(m)} мин`);

test('percent and time left from past workouts; the end time follows the clock', async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW - 60 * MIN));
  await page.goto(base);
  await ready(page);
  await seedOwner(page, { workout: false });
  const plan = await seedPast(page);
  const total = plan.reduce((a, b) => a + b, 0);

  await page.clock.setFixedTime(new Date(NOW));
  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 2, day: 1 }));
  await expect(pace(page)).toBeVisible();
  // Before the first set: 5 to start, 5 per change of exercise, 3 per further set.
  const before = 5 + 5 * (plan.length - 1) + 3 * plan.reduce((a, n) => a + n - 1, 0);
  // Week 2 has no drop sets in the sample program, so every planned set is one of the history's.
  await expect(pace(page)).toContainText(`0% · осталось ${left(before)}, до ${clock(NOW + before * MIN)}`);
  await expect(pace(page).getByRole('progressbar', { name: 'Выполнено' })).toHaveAttribute('aria-valuenow', '0');

  // The first set 5 minutes later, as usual: the rest is the plan minus that.
  await page.clock.setFixedTime(new Date(NOW + 5 * MIN));
  await logSet(page);
  const pct = Math.round((1 / total) * 100);
  await expect(pace(page)).toContainText(`${pct}% · осталось ${left(before - 5)}, до ${clock(NOW + before * MIN)}`);
  await expect(pace(page).getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(pct));
});

test('without past workouts: the percent at once, the time after a couple of sets; all done — «план выполнен»', async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(base);
  await ready(page);
  await seedOwner(page, { workout: false });
  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 2, day: 1 }));
  await expect(pace(page)).toContainText('0% · время появится после пары подходов');

  // Every planned set logged: 100%, nothing left.
  await page.evaluate(async () => {
    const { store } = window.__trainer;
    const { targetFor } = await import('./js/lib/program.js');
    const s = store.liveSessions().find((x) => x.status === 'active');
    const sets = [];
    s.items.forEach((it, i) => {
      const n = targetFor(it, 2).sets + targetFor(it, 2).drop;
      for (let k = 1; k <= n; k++) {
        const at = s.startedAt + (i * 10 + k) * 60000;
        sets.push({ id: `all-${i}-${k}`, sessionId: s.id, slotId: it.slotId, seriesKey: it.seriesKey, exercise: it.name, date: s.date, cycle: s.cycle, week: s.week, day: s.day,
          setNo: k, weight: 20, reps: 10, rir: 2, drop: k > targetFor(it, 2).sets, pain: false, technique: false, note: '', createdAt: at, updatedAt: at, deleted: false });
      }
    });
    await store.applyRemote({ sets }, { queue: false });
  });
  await expect(pace(page)).toContainText('100% · план выполнен');
});

test('a past workout opened from «История» shows no estimate', async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(base);
  await ready(page);
  await seedOwner(page, { workout: true });
  await page.getByRole('button', { name: 'История' }).click();
  await page.locator('.row--day').first().click();
  await expect(page.locator('.wk-head')).toBeVisible();
  await expect(pace(page)).toHaveCount(0);
});
