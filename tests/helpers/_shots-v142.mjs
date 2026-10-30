// v1.4.2 screenshots for the PR, synthetic data only. Run from the repo root:
//   node tests/helpers/_shots-v142.mjs <out dir> [dark|light] [width] [app root]   (PW_CHROMIUM=<path> to use another Chromium)
// `app root` — another build of app/ (for «before» shots of the released version); then only the light week is shot.
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
await p.clock.setFixedTime(new Date('2026-11-01T10:00:00+03:00'));
await p.goto(base);
await p.waitForFunction(() => window.__trainer?.store.state.loaded);
const shot = async (name) => {
  await p.waitForTimeout(450);
  await p.screenshot({ path: `${out}/${name}-${tag}.png` });
  console.log('shot', name, tag);
};

// The program as in the sheet since v1.4.0 and the abs history (made-up values, RIR in every set).
const program = { ...programAfterFix(programAfterFix(programNow(), FIX_2026_10_20), FIX_2026_10_30_STEPS), updatedAt: Date.UTC(2026, 9, 30, 17, 0, 0) };
const ws = pressHistory(program);
await p.evaluate(async (data) => window.__trainer.store.applyRemote(data, { queue: false }), {
  program, sessions: ws.map((w) => w.session), sets: ws.flatMap((w) => w.sets),
});
await p.evaluate(() => import('./js/ui/core.js').then(({ app }) => app.ui.go({ tab: 'today', view: null })));
await p.waitForTimeout(300);

// 1. Light week, day 1: the header and the targets, then the press with its «Ориентир» and ⓘ.
await p.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 1, day: 1, date: '2026-11-01' }));
await p.waitForTimeout(300);
await shot('01-light-week-workout');
await p.getByRole('button', { name: /^Пресс в тренажере/ }).click();
await shot('02-light-week-press');
await p.locator('.dock__rec-why').click();
await shot('03-light-week-why');
await p.getByRole('dialog').getByRole('button', { name: 'Понятно' }).click();
await p.waitForTimeout(400);
await p.evaluate(() => { const { store } = window.__trainer; return store.deleteSession(store.liveSessions().find((x) => x.status === 'active').id); });
await p.waitForTimeout(300);

if (!root) {
  // 2. The program editor: an exercise shows the week rules (week 1 — 3 sets, RIR 2–3).
  await p.getByRole('button', { name: 'Настройки' }).click();
  await p.getByRole('button', { name: /Редактировать программу/ }).click();
  const days = p.getByRole('group', { name: 'День' });
  const row = (name) => p.locator('.slot-edit', { hasText: name });
  await days.getByRole('button', { name: 'День 3' }).click();
  await row('Вертикальная тяга к груди').locator('button').first().click();
  const sheet = p.getByRole('dialog', { name: 'Упражнение' });
  await sheet.locator('.sheet__body').evaluate((el) => {
    const label = [...el.querySelectorAll('.sheet__label')].find((x) => x.textContent.startsWith('Особые подходы'));
    el.scrollTo(0, label.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 16);
  });
  await shot('04-editor-week-rules');

  // 3. Rehearsal of the move on this synthetic program (the owner does it on the iPhone after day 4).
  const note = await sheet.getByLabel('Заметка тренера').inputValue();
  await sheet.getByRole('button', { name: 'Удалить' }).click();
  await days.getByRole('button', { name: 'День 4' }).click();
  await row('Жим сидя на плечи').locator('button').first().click();
  const pressNote = await sheet.getByLabel('Заметка тренера').inputValue();
  await sheet.getByRole('button', { name: 'Удалить' }).click();
  const fresh = p.getByRole('dialog', { name: 'Новое упражнение' });
  await p.getByRole('button', { name: 'Добавить упражнение' }).click();
  await fresh.locator('.sheet__section', { hasText: 'Быстрый выбор' }).getByRole('button', { name: 'Вертикальная тяга к груди', exact: true }).click();
  await fresh.getByLabel('Заметка тренера').fill(note);
  await shot('05-editor-add-vertical');
  await fresh.getByRole('button', { name: 'Готово' }).click();
  for (let i = 0; i < 4; i++) await row('Вертикальная тяга к груди').getByRole('button', { name: 'Выше' }).click();
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot('06-editor-day4-after');
  await days.getByRole('button', { name: 'День 3' }).click();
  await p.getByRole('button', { name: 'Добавить упражнение' }).click();
  await fresh.locator('.sheet__section', { hasText: 'Быстрый выбор' }).getByRole('button', { name: 'Жим сидя на плечи', exact: true }).click();
  await fresh.getByLabel('Заметка тренера').fill(pressNote);
  await fresh.getByRole('button', { name: 'Готово' }).click();
  for (let i = 0; i < 2; i++) await row('Жим сидя на плечи').getByRole('button', { name: 'Выше' }).click();
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot('07-editor-day3-after');
}

await browser.close();
web.close();
