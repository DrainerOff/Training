// Release v1.3.0 on the phone: the owner's iPhone runs v1.2.0 (05f067e). The update keeps every
// IndexedDB record (database 5 → 6 only adds the nutrition stores), does not repeat the one-time
// import, starts offline, and nutrition works after it. Going back to v1.2.0 (if main were
// reverted) opens the newer database as it is; going forward again, the days are still there.
// Synthetic data only (the fixture carries the synthetic snapshot instead of the owner's cells).
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { startPages, APP, RELEASES } from '../helpers/pages-server.js';

const V120 = path.join(RELEASES, '05f067e');

async function until(page, build) {
  for (let i = 0; i < 6 && (await page.evaluate(() => window.__trainer?.build)) !== build; i++) {
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForFunction(() => window.__trainer?.store.state.loaded || document.querySelector('.diag'));
  }
  expect(await page.evaluate(() => window.__trainer.build)).toBe(build);
  await expect(page.locator('.diag')).toHaveCount(0);
}
const counts = (page) => page.evaluate(() => {
  const st = window.__trainer.store.state;
  const live = (m) => [...m.values()].filter((r) => !r.deleted).length;
  return {
    sessions: live(st.sessions), sets: live(st.sets), metrics: live(st.metrics), records: live(st.records),
    exercises: live(st.exercises), body: live(st.body), sleep: live(st.sleep), phases: live(st.phases),
    imports: Object.keys(st.kv.imports || {}), outbox: st.outbox.size,
  };
});

test('update from v1.2.0 (05f067e): every record stays, database 6, nutrition works, offline start; rollback and forward again', async ({ page, context }) => {
  const pages = await startPages();
  try {
    pages.publish(V120, '05f067e');
    await page.goto(pages.url);
    await page.waitForFunction(() => window.__trainer?.store.state.loaded);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.evaluate(async () => {
      const { store } = window.__trainer;
      const s = await store.startSession({ cycle: 1, week: 2, day: 2 });
      await store.logSet(s.id, s.items[0].slotId, { weight: 40, reps: 9, rir: 2 });
      await store.logSet(s.id, s.items[0].slotId, { weight: 40, reps: 8, rir: 1 });
      await store.finishSession(s.id);
      await store.saveMetric('2026-10-21', { recovery: 4 });
      await store.saveRecord({ seriesKey: 'bench', exercise: 'Жим', category: 'base', date: '2026-10-10', weight: 100, reps: 3 });
      await store.saveSetup(s.items[0].seriesKey, s.items[0].name, 'сиденье 4');
      await store.addBody({ kind: 'weight', value: 80.4, measuredAt: '2026-10-21T07:10' });
      await store.addBody({ kind: 'waist', value: 84.5, measuredAt: '2026-10-21T07:12' });
      await store.savePhase({ mode: 'bulk', start: '2026-10-01', targetPct: 0.25 });
    });
    const before = await counts(page);
    expect(before.imports).toEqual(['gsheets-2026-10-17']);
    expect(before.sets).toBeGreaterThan(2);
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'trainer', version: 5 }]);

    pages.publish(APP, 'v130');
    await page.reload();
    await until(page, 'v130');
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'trainer', version: 6 }]);
    expect(await counts(page)).toEqual(before);
    expect(await page.evaluate(() => caches.keys())).toEqual(['trainer-v130']);
    // The setup text and the phase survived as they were.
    expect(await page.evaluate(() => [...window.__trainer.store.state.exercises.values()].map((x) => x.setup))).toEqual(['сиденье 4']);
    expect(await page.evaluate(() => [...window.__trainer.store.state.phases.values()].map((p) => `${p.mode}:${p.start}:${p.targetPct}`))).toEqual(['bulk:2026-10-01:0.25']);

    // Nutrition after the update: a day, a reload, offline start.
    await page.evaluate(() => window.__trainer.store.saveNutrition({ date: '2026-10-21', kcal: 3300, protein: 160, fat: 90, carbs: 420, status: 'final' }));
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => window.__trainer?.store.state.loaded);
    expect(await page.evaluate(() => window.__trainer.store.state.nutrition.get('n:2026-10-21')?.kcal)).toBe(3300);
    await page.locator('.tabbar').getByRole('button', { name: 'Тело' }).click();
    await page.getByRole('group', { name: 'Раздел' }).getByRole('button', { name: 'Питание' }).click();
    await expect(page.getByRole('list', { name: 'Питание по дням' })).toContainText('3300 ккал');
    await context.setOffline(false);

    // Back to v1.2.0: it opens database 6 as it is; its records intact.
    pages.publish(V120, '05f067e');
    await until(page, '05f067e');
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'trainer', version: 6 }]);
    const back = await counts(page);
    expect({ ...back, outbox: 0 }).toEqual({ ...before, outbox: 0 });
    // Forward again: the day is still there.
    pages.publish(APP, 'v130b');
    await until(page, 'v130b');
    expect(await page.evaluate(() => window.__trainer.store.state.nutrition.get('n:2026-10-21')?.kcal)).toBe(3300);
    expect({ ...(await counts(page)), outbox: 0 }).toEqual({ ...before, outbox: 0 });
  } finally {
    await pages.close();
  }
});
