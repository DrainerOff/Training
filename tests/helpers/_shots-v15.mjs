// v1.5 screenshots for the PR, synthetic data only. Run from the repo root:
//   node tests/helpers/_shots-v15.mjs <out dir> [dark|light] [width]   (PW_CHROMIUM=<path> to use another Chromium)
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
import { startStatic } from './servers.js';
import { history } from './baseline-history.js';

const out = process.argv[2];
const scheme = process.argv[3] || 'dark';
const width = Number(process.argv[4] || 390);
const tag = `${scheme}${width !== 390 ? `-${width}` : ''}`;
fs.mkdirSync(out, { recursive: true });
const web = await startStatic({ port: 0 });
const base = `http://127.0.0.1:${web.address().port}/`;
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

async function phone(data, at) {
  const c = await browser.newContext({ ...devices['iPhone 13'], viewport: { width, height: width === 390 ? 844 : 568 }, colorScheme: scheme, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  await c.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.style.setProperty('--safe-top', '47px');
    document.documentElement.style.setProperty('--safe-bottom', '34px');
  }));
  const p = await c.newPage();
  await p.clock.setFixedTime(new Date(at));
  await p.goto(base);
  await p.waitForFunction(() => window.__trainer?.store.state.loaded);
  await p.evaluate(async (d) => window.__trainer.store.applyRemote(d, { queue: false }), data);
  await p.evaluate(() => import('./js/ui/core.js').then(({ app }) => app.ui.go({ tab: 'today', view: null })));
  await p.waitForTimeout(300);
  return { c, p };
}
const shot = async (p, name, opts = {}) => {
  await p.waitForTimeout(450);
  await p.screenshot({ path: `${out}/${name}-${tag}.png`, ...opts });
  console.log('shot', name);
};
const startRow = async (p, s) => {
  await p.evaluate((x) => window.__trainer.store.startSession({ ...x, day: 3 }), s);
  await p.locator('.dock').waitFor();
  await p.getByRole('button', { name: /^Горизонтальная тяга в тренажере/ }).click();
  await p.waitForTimeout(200);
};

// 1. Week 3 after the mark: «Другая фаза» from week 2, the «Ориентир» pre-filled, the old week 3 for reference.
{
  const { c, p } = await phone(history({ upTo: 'c2w2' }), '2026-11-17T10:00:00+03:00');
  await startRow(p, { cycle: 2, week: 3, date: '2026-11-17' });
  await p.locator('.panel .prev').scrollIntoViewIfNeeded();
  await shot(p, '01-week3-after-mark');
  await c.close();
}
// 2. Week 2 right after a mark on the light week: no weight to start from.
{
  const { c, p } = await phone(history({ upTo: 'c2w1' }), '2026-11-10T10:00:00+03:00');
  await startRow(p, { cycle: 2, week: 2, date: '2026-11-10' });
  await p.locator('.panel .prev').scrollIntoViewIfNeeded();
  await shot(p, '02-week2-after-mark');
  await c.close();
}
// 3–5. No mark, 70 kg against 80: the question in the dock, its ⓘ, then the mark.
{
  const { c, p } = await phone(history({ mark: false, upTo: 'c1w3' }), '2026-11-10T10:00:00+03:00');
  await startRow(p, { cycle: 2, week: 2, date: '2026-11-10' });
  for (let i = 0; i < 4; i++) await p.getByRole('button', { name: 'Уменьшить: Вес' }).click();
  await p.locator('.dock').getByRole('group', { name: 'Фактический RIR' }).getByRole('button', { name: '2', exact: true }).click();
  await p.locator('.dock .btn--primary').click();
  await p.locator('.toast').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
  await shot(p, '03-drop-ask');
  await p.locator('.dock__ask .dock__rec-why').click();
  await shot(p, '04-drop-ask-sheet');
  await p.getByRole('dialog').getByRole('button', { name: 'Отметить точку отсчёта' }).click();
  await p.locator('.panel .item-note').scrollIntoViewIfNeeded();
  await shot(p, '05-marked');
  await c.close();
}
// 6–8. Progress: without the mark a regress; with it «Мало данных», the reason and the dashed line.
{
  const { c, p } = await phone(history({ mark: false, upTo: 'c2w3' }), '2026-11-20T10:00:00+03:00');
  await p.getByRole('button', { name: 'Прогресс' }).click();
  await shot(p, '06-progress-without-mark');
  await p.evaluate(() => window.__trainer.store.updateItem('c2w1', 'D3-04', { flags: { baseline: true } }));
  await shot(p, '07-progress-with-mark');
  await p.locator('.rows li', { hasText: 'Горизонтальная тяга в тренажере' }).getByRole('button').click();
  await shot(p, '08-exercise-chart');
  await c.close();
}
await browser.close();
web.close();
