// v1.6.0 screenshots for the PR (light-week reps by category), synthetic data only. Run from the repo root:
//   node tests/helpers/_shots-v160.mjs <out dir> [dark|light] [width] [app root]   (PW_CHROMIUM=<path> to use another Chromium)
// `app root` — another build of app/ (for «before» shots of the released version); then the editor is not shot.
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
import { startStatic } from './servers.js';
import { programNow, pressHistory } from './workout-2026-10-20.js';
import { FIX_2026_10_20, FIX_2026_10_30_STEPS, programAfterFix } from '../../app/js/data/fixes.js';

const out = process.argv[2];
const scheme = process.argv[3] || 'dark';
const width = Number(process.argv[4]) || 390;
const root = process.argv[5] || null;
const tag = `${scheme}${width === 390 ? '' : `-${width}`}`;
fs.mkdirSync(out, { recursive: true });
const web = await startStatic({ port: 0, ...(root ? { root } : {}) });
const base = `http://127.0.0.1:${web.address().port}/`;
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const c = await browser.newContext({ ...devices['iPhone 13'], viewport: { width, height: width === 390 ? 844 : 568 }, colorScheme: scheme, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
await c.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.style.setProperty('--safe-top', '47px');
  document.documentElement.style.setProperty('--safe-bottom', '34px');
}));
const p = await c.newPage();
p.setDefaultTimeout(5000);
await p.clock.setFixedTime(new Date('2026-11-02T10:00:00+03:00'));
await p.goto(base);
await p.waitForFunction(() => window.__trainer?.store.state.loaded);
const shot = async (name) => {
  await p.waitForTimeout(450);
  await p.screenshot({ path: `${out}/${name}-${tag}.png` });
  console.log('shot', name, tag);
};

// The program as in the sheet since v1.4.0, the abs history, plus made-up incline bench press sets
// (a base lift) on the two day 1 workouts, RIR in every set.
const program = { ...programAfterFix(programAfterFix(programNow(), FIX_2026_10_20), FIX_2026_10_30_STEPS), updatedAt: Date.UTC(2026, 9, 30, 17, 0, 0) };
const ws = pressHistory(program);
const bench = { 'ss-1016': [[60, 10, 2], [60, 10, 1], [60, 9, 1], [60, 9, 1]], 'ss-1025': [[65, 8, 1], [65, 7, 1], [65, 7, 1], [65, 6, 0]] };
for (const w of ws) {
  const rows = bench[w.session.id];
  if (!rows) continue;
  const item = w.session.items.find((i) => i.slotId === 'D1-04');
  const start = w.session.startedAt + 1200000;
  rows.forEach(([weight, reps, rir], i) => w.sets.push({
    id: `${w.session.id}-b${i}`, sessionId: w.session.id, date: w.session.date, cycle: w.session.cycle, week: w.session.week, day: w.session.day,
    slotId: 'D1-04', seriesKey: item.seriesKey, exercise: item.name, setNo: i + 1, weight, reps, rir,
    drop: false, pain: false, technique: false, note: '', deleted: false, createdAt: start + i * 180000, updatedAt: start + i * 180000,
  }));
}
await p.evaluate(async (data) => window.__trainer.store.applyRemote(data, { queue: false }), {
  program, sessions: ws.map((w) => w.session), sets: ws.flatMap((w) => w.sets),
});

// 1. Home: the next workout picked as cycle 2, week 1, day 1 — the week line and a target per exercise.
await p.evaluate(() => import('./js/ui/core.js').then(({ app }) => app.ui.go({ tab: 'today', view: null })));
await p.waitForTimeout(300);
await p.getByRole('button', { name: 'Другой день или неделя' }).click();
const pick = p.getByRole('dialog', { name: 'Выбрать тренировку' });
await pick.getByRole('group', { name: 'Неделя цикла' }).getByRole('button', { name: /лёгкая/ }).click();
await pick.getByRole('group', { name: 'День' }).getByRole('button', { name: '1', exact: true }).click();
while (!(await pick.getByRole('button', { name: /^Цикл: 2\./ }).count())) await pick.getByRole('button', { name: 'Увеличить: Цикл' }).click();
await pick.getByRole('button', { name: 'Выбрать' }).click();
await p.waitForTimeout(400);
await p.getByRole('button', { name: 'Позже' }).click().catch(() => {});
await p.waitForTimeout(300);
await p.evaluate(() => document.querySelector('.next').scrollIntoView({ block: 'start' }));
await shot('01-home-light-week');

// 2. The workout: the list with targets, the bench press (base, 10–12), the abs machine (isolation, 12–15) and its ⓘ.
await p.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 1, day: 1, date: '2026-11-02' }));
await p.waitForTimeout(300);
await shot('02-light-week-workout');
await p.getByRole('button', { name: /^Жим штанги лежа/ }).first().click();
await shot('03-light-week-bench');
await p.getByRole('button', { name: /^Пресс в тренажере/ }).click();
await shot('04-light-week-abs');
await p.locator('.dock__rec-why').click();
await shot('05-light-week-abs-why');
await p.getByRole('dialog').getByRole('button', { name: 'Понятно' }).click();
await p.waitForTimeout(400);
await p.evaluate(() => { const { store } = window.__trainer; return store.deleteSession(store.liveSessions().find((x) => x.status === 'active').id); });
await p.waitForTimeout(300);

if (!root) {
  // 3. The program editor: the week rules of an isolation exercise (week 1 — 3 × 12–15, RIR 2–3).
  await p.getByRole('button', { name: 'Настройки' }).click();
  await p.getByRole('button', { name: /Редактировать программу/ }).click();
  const days = p.getByRole('group', { name: 'День' });
  await days.getByRole('button', { name: 'День 1' }).click();
  await p.locator('.slot-edit', { hasText: 'Сгибание рук на нижнем блоке' }).locator('button').first().click();
  const sheet = p.getByRole('dialog', { name: 'Упражнение' });
  await sheet.locator('.sheet__body').evaluate((el) => {
    const label = [...el.querySelectorAll('.sheet__label')].find((x) => x.textContent.startsWith('Особые подходы'));
    el.scrollTo(0, label.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 16);
  });
  await shot('06-editor-week-rules');
}

await browser.close();
web.close();
