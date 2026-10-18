// The owner's iPhone runs v1.0.0 — the code of 3f386f8 (accepted on the phone), published from main
// as 6a3334c. Updating to the current release (the database gains a store) must keep every
// workout, set, note, record and measurement, not repeat the one-time import, not add a single row
// to the sheet for data it already has, and keep working offline.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { startFakeGas } from '../helpers/servers.js';
import { startPages, APP, RELEASES } from '../helpers/pages-server.js';
import { connectSync } from './helpers.js';

const PHONE = path.join(RELEASES, '3f386f8');

const booted = (page) => page.waitForFunction(() => window.__trainer?.store.state.loaded && !document.getElementById('boot'));

// Everything the owner would lose if the update went wrong.
function snapshot(page) {
  return page.evaluate(() => {
    const st = window.__trainer.store.state;
    const live = (m) => [...m.values()].filter((r) => !r.deleted);
    return {
      sessions: live(st.sessions).map((s) => `${s.id}|${s.date}|${s.status}`).sort(),
      sets: live(st.sets).map((s) => `${s.id}|${s.seriesKey}|${s.weight}x${s.reps}|${s.note}`).sort(),
      notes: live(st.sessions).flatMap((s) => s.items.filter((i) => i.note).map((i) => `${s.id}|${i.slotId}|${i.note}`)).sort(),
      metrics: live(st.metrics).map((m) => `${m.id}|${m.bodyweight}`).sort(),
      records: live(st.records).map((r) => `${r.id}|${r.date}|${r.weight}x${r.reps}`).sort(),
      imports: Object.keys(st.kv.imports || {}),
      outbox: st.outbox.size,
    };
  });
}

// Rows per data sheet, and whether any id appears twice.
const DATA_SHEETS = ['App_Sessions', 'App_Sets', 'App_Metrics', 'App_Records'];
async function sheet(port) {
  const dump = await (await fetch(`http://127.0.0.1:${port}/__state`)).json();
  const out = {};
  for (const name of DATA_SHEETS) {
    const rows = dump[name];
    const id = rows[0].indexOf('id');
    const ids = rows.slice(1).map((r) => r[id]);
    out[name] = { rows: ids.length, unique: new Set(ids).size === ids.length };
  }
  return out;
}

const syncNow = (page) => page.evaluate(() => window.__trainer.sync.syncNow().then(() => ({ ...window.__trainer.sync.status })));

test('update from 3f386f8 (on the phone) to the release from main: data, records and the sheet stay as they are; offline still works', async ({ page, context }) => {
  const pages = await startPages();
  const gas = await startFakeGas({ port: 0 });
  const port = gas.server.address().port;
  try {
    // 1. The phone today: 3f386f8, the 16.10 import done, a finished workout, a manual record,
    //    bodyweight, everything synced to the sheet.
    pages.publish(PHONE, '3f386f8');
    await page.goto(pages.url);
    await booted(page);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await connectSync(page, `http://127.0.0.1:${port}/exec`, gas.token);
    await page.evaluate(async () => {
      const { store } = window.__trainer;
      const s = await store.startSession({ cycle: 1, week: 2, day: 1 });
      await store.logSet(s.id, s.items[0].slotId, { weight: 95, reps: 9, rir: 1 });
      const second = await store.logSet(s.id, s.items[0].slotId, { weight: 95, reps: 8, rir: 1 });
      await store.updateSet(second.set.id, { note: 'последний тяжело' });
      await store.updateItem(s.id, s.items[0].slotId, { note: 'хват чуть шире' });
      await store.finishSession(s.id);
      await store.saveRecord({ seriesKey: 'naklonnyy-zhim-hammer-naklon', exercise: 'Наклонный жим: Hammer - наклон', category: 'hammer', date: '2025-04-12', weight: 95, reps: 5, note: 'старый рекорд' });
      await store.saveMetric('2026-10-17', { bodyweight: 81.5 });
    });
    expect((await syncNow(page)).pending).toBe(0);
    const before = await snapshot(page);
    expect(before.imports).toEqual(['gsheets-2026-10-17']);
    expect(before.records).toHaveLength(1);
    expect(before.outbox).toBe(0);
    const sheetBefore = await sheet(port);
    expect(sheetBefore.App_Records.rows).toBe(1);
    for (const s of Object.values(sheetBefore)) expect(s.unique).toBe(true);

    // 2. v1.0.0 from main is published. The open app takes it on a relaunch.
    pages.publish(APP, 'main100');
    for (let i = 0; i < 5 && !(await page.evaluate(() => window.__trainer?.build === 'main100')); i++) {
      await page.waitForTimeout(1500);
      await page.reload();
      await page.waitForFunction(() => window.__trainer?.store.state.loaded || document.querySelector('.diag'));
    }
    await booted(page);
    expect(await page.evaluate(() => [window.__boot?.build, window.__trainer?.build])).toEqual(['main100', 'main100']);
    await expect(page.locator('.diag')).toHaveCount(0);
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'trainer', version: 3 }]);
    expect(await page.evaluate(() => caches.keys())).toEqual(['trainer-main100']);
    expect(await snapshot(page)).toEqual(before);

    // 3. Syncing after the update sends nothing new and pulls nothing twice.
    expect((await syncNow(page)).pending).toBe(0);
    expect(await sheet(port)).toEqual(sheetBefore);
    expect(await snapshot(page)).toEqual(before);

    // 4. Tomorrow's workout: sets logged after the update reach the sheet once.
    await page.evaluate(async () => {
      const { store } = window.__trainer;
      const s = await store.startSession({ cycle: 1, week: 2, day: 2 });
      await store.logSet(s.id, s.items[0].slotId, { weight: 24, reps: 6, rir: 2 });
    });
    await syncNow(page);
    await syncNow(page);
    const after = await sheet(port);
    expect(after.App_Sets.rows).toBe(sheetBefore.App_Sets.rows + 1);
    expect(after.App_Sessions.rows).toBe(sheetBefore.App_Sessions.rows + 1);
    expect(after.App_Records).toEqual(sheetBefore.App_Records);
    for (const s of Object.values(after)) expect(s.unique).toBe(true);
    const synced = await snapshot(page);

    // 5. Airplane mode, full close, cold start: the release starts from its cache with all data,
    //    a set logged offline is kept and reaches the sheet once the phone is online again.
    await page.close();
    await context.setOffline(true);
    page = await context.newPage();
    await page.goto(pages.url);
    await booted(page);
    expect(await page.evaluate(() => window.__trainer.build)).toBe('main100');
    expect(await snapshot(page)).toEqual(synced);
    await page.evaluate(async () => {
      const { store } = window.__trainer;
      const s = store.liveSessions().find((x) => x.status === 'active');
      await store.logSet(s.id, s.items[0].slotId, { weight: 26, reps: 6, rir: 1 });
    });
    await page.reload();
    await booted(page);
    expect((await snapshot(page)).sets).toHaveLength(synced.sets.length + 1);
    await context.setOffline(false);
    expect((await syncNow(page)).pending).toBe(0);
    const online = await sheet(port);
    expect(online.App_Sets.rows).toBe(after.App_Sets.rows + 1);
    for (const s of Object.values(online)) expect(s.unique).toBe(true);
  } finally {
    gas.server.close();
    await pages.close();
  }
});
