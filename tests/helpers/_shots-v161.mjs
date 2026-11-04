// v1.6.1 screenshots for the PR (the «Ориентир» after every set, the order note), synthetic data only. Run from the repo root:
//   node tests/helpers/_shots-v161.mjs <out dir> [dark|light] [width]   (PW_CHROMIUM=<path> to use another Chromium)
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
import { startStatic } from './servers.js';
import { history, HAMMER } from './order-history.js';

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
p.setDefaultTimeout(5000);
await p.clock.setFixedTime(new Date('2026-10-30T10:00:00+03:00'));
await p.goto(base);
await p.waitForFunction(() => window.__trainer?.store.state.loaded);
const shot = async (name) => {
  await p.waitForTimeout(450);
  await p.screenshot({ path: `${out}/${name}-${tag}.png` });
  console.log('shot', name, tag);
};
const log = (weight, reps, rir) => p.evaluate(async (v) => {
  const { store } = window.__trainer;
  const s = store.liveSessions().find((x) => x.status === 'active');
  await store.logSet(s.id, v.slot, { weight: v.weight, reps: v.reps, rir: v.rir });
}, { slot: HAMMER, weight, reps, rir });

// Day 1 with Hammer moved from 2nd to 4th; its last heavy week (made-up 100×7) was 2nd in the day.
await p.evaluate(async (data) => window.__trainer.store.applyRemote(data, { queue: false }), history());
await p.waitForFunction(() => !window.__trainer.store.state.program.draft);
await p.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 1, day: 1, date: '2026-10-30' }));
await p.waitForTimeout(300);
await p.getByRole('button', { name: /^Наклонный жим: Hammer - наклон/ }).click();

// 1. The hint with the order note under it, and its ⓘ.
await shot('01-order-note');
const why = async (name) => {
  await p.locator('.dock__rec-why').click();
  await shot(name);
  await p.getByRole('dialog').getByRole('button', { name: 'Понятно' }).click();
  await p.waitForTimeout(400);
};
await why('02-order-why');

// 2. The first set on target, then the second below it: the hint follows the second set.
await log(85, 12, 2);
await log(85, 10, 1);
await shot('03-after-second-set');
await why('04-after-second-set-why');

await browser.close();
web.close();
