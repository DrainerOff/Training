// v1.6.4 screenshots for the PR (the light-week «Ориентир», the dock folded after the plan), synthetic
// data only. Run from the repo root:
//   node tests/helpers/_shots-v164.mjs <out dir> [dark|light] [width]   (PW_CHROMIUM=<path> to use another Chromium)
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
import { startStatic } from './servers.js';
import { absWorkout, programNow, PRESS } from './workout-2026-10-20.js';

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
await p.goto(base);
await p.waitForFunction(() => window.__trainer?.store.state.loaded);
const shot = async (name) => {
  await p.waitForTimeout(450);
  await p.screenshot({ path: `${out}/${name}-${tag}.png` });
  console.log('shot', name, tag);
};
const why = async (name) => {
  await p.locator('.dock__rec-why').click();
  await shot(name);
  await p.getByRole('dialog').getByRole('button', { name: 'Понятно' }).click();
  await p.waitForTimeout(400);
};
const log = (slot, weight, reps, rir) => p.evaluate(async (v) => {
  const { store } = window.__trainer;
  const s = store.liveSessions().find((x) => x.status === 'active');
  await store.logSet(s.id, v.slot, { weight: v.weight, reps: v.reps, rir: v.rir });
}, { slot, weight, reps, rir });

// Week 3 of the abs machine (made-up 50×9, 50×9, 50×8 at RIR 1), then the light week, day 1.
const program = programNow();
const w3 = absWorkout(program, { id: 'ss-w3', date: '2026-11-04', day: 1, week: 3, abs: [[50, 9, 1], [50, 9, 1], [50, 8, 1]], absAs: PRESS });
await p.evaluate(async (data) => window.__trainer.store.applyRemote(data, { queue: false }), { program, sessions: [w3.session], sets: w3.sets });
await p.waitForFunction(() => !window.__trainer.store.state.program.draft);
await p.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 1, day: 1 }));
await p.waitForTimeout(300);
await p.getByRole('button', { name: /^Пресс в тренажере/ }).click();

// 1. The light-week hint (the top of the window) and its ⓘ.
await shot('01-light-hint');
await why('02-light-hint-why');

// 2. A set in the window, then one far below it: several steps lighter, not one.
await log('D1-07', 40, 13, 2);
await log('D1-07', 40, 7, 1);
await shot('03-after-big-miss');
await why('04-after-big-miss-why');

// 3. Every exercise done (made-up sets 20 minutes ago), the last set from the dock: it folds.
await p.evaluate(async () => {
  const { store } = window.__trainer;
  const s = store.liveSessions().find((x) => x.status === 'active');
  const t = Date.now() - 20 * 60 * 1000;
  const sets = [];
  s.items.filter((it) => it.slotId !== 'D1-07').forEach((it, i) => {
    for (let k = 1; k <= 3; k++) {
      const at = t + (i * 5 + k) * 1000;
      sets.push({ id: `shot-${it.slotId}-${k}`, sessionId: s.id, slotId: it.slotId, seriesKey: it.seriesKey, exercise: it.name, date: s.date, cycle: s.cycle, week: s.week, day: s.day,
        setNo: k, weight: it.category === 'pullup' ? 0 : 30, reps: 12, rir: 2, drop: false, pain: false, technique: false, note: '', createdAt: at, updatedAt: at, deleted: false });
    }
  });
  await store.applyRemote({ sets }, { queue: false });
});
await p.waitForTimeout(400);
await p.getByRole('button', { name: /^Пресс в тренажере/ }).click().catch(() => {});
// The third set by the hint: «Использовать», 13 reps, RIR 2.
await p.locator('.dock').getByRole('button', { name: 'Использовать' }).click();
for (let i = 0; i < 6; i++) await p.locator('.dock').getByRole('button', { name: 'Увеличить: Повторения' }).click();
await p.locator('.dock').getByRole('group', { name: 'Фактический RIR' }).getByRole('button', { name: '2', exact: true }).click();
await p.locator('.dock .dock__log .btn').click();
await shot('05-last-set-logged');
await p.waitForTimeout(5500);
await shot('06-folded');
await browser.close();
web.close();
