// v1.7.0 screenshots for the PR (percent and time left under the workout header), synthetic data only.
// Run from the repo root:
//   node tests/helpers/_shots-v170.mjs <out dir> [dark|light] [width]   (PW_CHROMIUM=<path> to use another Chromium)
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
import { startStatic } from './servers.js';
import { convertSnapshot } from './legacy-import.js';

const out = process.argv[2];
const scheme = process.argv[3] || 'dark';
const width = Number(process.argv[4]) || 390;
const tag = `${scheme}${width === 390 ? '' : `-${width}`}`;
fs.mkdirSync(out, { recursive: true });
const web = await startStatic({ port: 0 });
const base = `http://127.0.0.1:${web.address().port}/`;
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const c = await browser.newContext({ ...devices['iPhone 13'], viewport: { width, height: width === 390 ? 844 : 568 }, colorScheme: scheme, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
await c.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.style.setProperty('--safe-top', '47px');
  document.documentElement.style.setProperty('--safe-bottom', '34px');
}));
const p = await c.newPage();
p.setDefaultTimeout(8000);
const MIN = 60000;
const START = new Date('2026-11-20T21:30:00+03:00').getTime();
await p.clock.setFixedTime(new Date(START - 60 * MIN));
await p.goto(base);
await p.waitForFunction(() => window.__trainer?.store.state.loaded);
const OWNER = convertSnapshot();
await p.evaluate(async (data) => window.__trainer.store.applyRemote(data, { queue: false }), { program: OWNER.program });
await p.waitForFunction(() => !window.__trainer.store.state.program.draft);

// Three past day-1 workouts: ~3 min per set, ~5 min to change exercise (made-up timing and weights).
await p.evaluate(async ({ START, MIN }) => {
  const { store } = window.__trainer;
  const { itemsForDay } = await import('./js/lib/planner.js');
  const { targetFor } = await import('./js/lib/program.js');
  const items = itemsForDay(store.state.program, 1);
  const sessions = [];
  const sets = [];
  for (let d = 1; d <= 3; d++) {
    const id = `ss-past-${d}`;
    const start = START - d * 7 * 24 * 60 * MIN;
    const date = new Date(start).toISOString().slice(0, 10);
    let t = start;
    items.forEach((it, i) => {
      const n = targetFor(it, 2).sets;
      for (let k = 1; k <= n; k++) {
        t += (k === 1 ? 5 : 3) * MIN + ((d + i + k) % 3) * 20000;
        sets.push({ id: `st-${d}-${i}-${k}`, sessionId: id, slotId: it.slotId, seriesKey: it.seriesKey, exercise: it.name, date, cycle: 1, week: 2, day: 1,
          setNo: k, weight: 20, reps: 10, rir: 2, drop: false, pain: false, technique: false, note: '', createdAt: t, updatedAt: t, deleted: false });
      }
    });
    sessions.push({ id, date, cycle: 1, week: 2, day: 1, status: 'done', startedAt: start, finishedAt: t, note: '', items, updatedAt: start, deleted: false });
  }
  await store.applyRemote({ sessions, sets }, { queue: false });
}, { START, MIN });

await p.clock.setFixedTime(new Date(START));
await p.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 2, day: 1 }));
const shot = async (name) => {
  await p.waitForTimeout(450);
  // 320×568: the dock covers the header area; the line shows once the list is scrolled a little.
  if (width < 390) await p.evaluate(() => document.querySelector('.wk-pace')?.scrollIntoView({ block: 'start' }));
  await p.waitForTimeout(150);
  await p.screenshot({ path: `${out}/${name}-${tag}.png` });
  console.log('shot', name, tag);
};
await p.locator('.wk-pace').waitFor();
await shot('01-start');

// Two exercises done, the third one started (one set forgotten and logged late).
await p.evaluate(async ({ START, MIN }) => {
  const { store } = window.__trainer;
  const { targetFor } = await import('./js/lib/program.js');
  const s = store.liveSessions().find((x) => x.status === 'active');
  const sets = [];
  let t = START;
  s.items.slice(0, 3).forEach((it, i) => {
    const n = i < 2 ? targetFor(it, 2).sets : 1;
    for (let k = 1; k <= n; k++) {
      t += (k === 1 ? 5 : i === 1 && k === 2 ? 11 : 3) * MIN;
      sets.push({ id: `now-${i}-${k}`, sessionId: s.id, slotId: it.slotId, seriesKey: it.seriesKey, exercise: it.name, date: s.date, cycle: s.cycle, week: s.week, day: s.day,
        setNo: k, weight: 20, reps: 10, rir: 2, drop: false, pain: false, technique: false, note: '', createdAt: t, updatedAt: t, deleted: false });
    }
  });
  await store.applyRemote({ sets }, { queue: false });
  return t;
}, { START, MIN }).then((last) => p.clock.setFixedTime(new Date(last + MIN)));
await p.evaluate(() => window.__trainer.store.liveSessions()); // re-render on the next tick
await p.waitForTimeout(16000); // the line refreshes every 15 s
await shot('02-mid');
await browser.close();
web.close();
