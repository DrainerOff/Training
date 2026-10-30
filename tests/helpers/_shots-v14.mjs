// v1.4 screenshots for the PR, synthetic data only. Run from the repo root:
//   node tests/helpers/_shots-v14.mjs <out dir> [dark|light]   (PW_CHROMIUM=<path> to use another Chromium)
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
import { startStatic } from './servers.js';
import { programNow, pressHistory } from './workout-2026-10-20.js';

const out = process.argv[2];
const scheme = process.argv[3] || 'dark';
fs.mkdirSync(out, { recursive: true });
const web = await startStatic({ port: 0 });
const base = `http://127.0.0.1:${web.address().port}/`;
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const c = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, colorScheme: scheme, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
await c.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.style.setProperty('--safe-top', '47px');
  document.documentElement.style.setProperty('--safe-bottom', '34px');
}));
const p = await c.newPage();
await p.clock.setFixedTime(new Date('2026-10-31T10:00:00+03:00'));
await p.goto(base);
await p.waitForFunction(() => window.__trainer?.store.state.loaded);
const shot = async (name) => {
  await p.waitForTimeout(450);
  await p.screenshot({ path: `${out}/${name}-${scheme}.png` });
  console.log('shot', name);
};

// Program and the abs history, plus day 2 of week 2 with the lateral raise (made-up values, RIR in every set).
const program = programNow();
const ws = pressHistory(program);
const lat = program.days[1].slots.find((s) => s.id === 'D2-04');
const t0 = Date.parse('2026-10-18T13:00:00Z');
const d2session = { id: 'ss-1018', date: '2026-10-18', cycle: 1, week: 2, day: 2, status: 'done', note: '', startedAt: t0, finishedAt: t0 + 3600000, items: [{ slotId: 'D2-04', category: 'iso', step: 2.5, options: lat.options, overrides: {}, seriesKey: lat.options[0].key, name: lat.options[0].name, note: '', flags: { pain: false, technique: false, baseline: false } }], updatedAt: t0 + 3600000, deleted: false };
const d2sets = [[14, 10, 2], [14, 10, 1], [14, 9, 1]].map(([weight, reps, rir], i) => ({ id: `ss-1018-l${i}`, sessionId: 'ss-1018', slotId: 'D2-04', seriesKey: lat.options[0].key, exercise: lat.options[0].name, date: '2026-10-18', cycle: 1, week: 2, day: 2, setNo: i + 1, weight, reps, rir, drop: false, pain: false, technique: false, note: '', createdAt: t0 + i * 120000, updatedAt: t0 + i * 120000, deleted: false }));
await p.evaluate(async (data) => window.__trainer.store.applyRemote(data, { queue: false }), {
  program,
  sessions: [...ws.map((w) => w.session), d2session],
  sets: [...ws.flatMap((w) => w.sets), ...d2sets],
});
await p.evaluate(() => import('./js/ui/core.js').then(({ app }) => app.ui.go({ tab: 'today', view: null })));
await p.waitForTimeout(300);

// 1. Home: the two one-time cards.
await p.getByLabel('Объединение пресса').scrollIntoViewIfNeeded();
await p.evaluate(() => window.scrollTo(0, 0));
await shot('01-home-cards');
await p.getByLabel('Объединение пресса').scrollIntoViewIfNeeded();
await shot('02-home-press-card');
await p.getByLabel('Объединение пресса').getByRole('button', { name: 'Исправить' }).click();
await p.waitForTimeout(300);
await shot('03-press-fixed-toast');
await p.getByLabel('Шаг веса для гантелей').getByRole('button', { name: 'Исправить' }).click();
await p.locator('.toast').waitFor({ state: 'detached', timeout: 20000 });

// 2. Light week, day 1: the press with an approximate hint and its range, pre-filled.
await p.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 1, day: 1, date: '2026-10-31' }));
await p.getByRole('button', { name: /^Пресс в тренажере/ }).click();
await shot('04-light-week-estimate');
await p.locator('.dock__rec-why').click();
await shot('05-estimate-why-light');
await p.getByRole('dialog').getByRole('button', { name: 'Понятно' }).click();
await p.waitForTimeout(400);
// 3. «Записать» without RIR.
await p.locator('.dock__log .btn').click();
await p.waitForTimeout(100);
await shot('06-rir-missing');
await p.locator('.toast').waitFor({ state: 'detached', timeout: 10000 });
await p.evaluate(() => { const { store } = window.__trainer; return store.deleteSession(store.liveSessions().find((x) => x.status === 'active').id); });
await p.waitForTimeout(300);

// 4. Week 3, day 2: the lateral raise was only done on week 2 — «Ориентир», step 1 kg.
await p.evaluate(() => window.__trainer.store.startSession({ cycle: 1, week: 3, day: 2, date: '2026-10-31' }));
await p.getByRole('button', { name: /^Разведения гантелей в стороны/ }).click();
await shot('07-heavy-week-estimate');
await p.locator('.dock__rec-why').click();
await shot('08-estimate-why-heavy');
await p.getByRole('dialog').getByRole('button', { name: 'Понятно' }).click();

// 5. «Заменить»: search, «Изменить программу на будущее».
await p.locator('.panel').getByRole('button', { name: 'Заменить' }).click();
const sheet = p.getByRole('dialog', { name: 'Заменить упражнение' });
await sheet.getByRole('button', { name: /Изменить программу на будущее/ }).click();
await sheet.getByRole('searchbox', { name: 'Найти упражнение' }).fill('разведения');
await sheet.getByRole('searchbox').blur();
await shot('09-swap-search-forever');
await sheet.getByRole('searchbox', { name: 'Найти упражнение' }).fill('Махи гантелями стоя');
await sheet.getByRole('searchbox').blur();
await sheet.locator('.ex-search__new').scrollIntoViewIfNeeded();
await shot('10-swap-new');
await sheet.getByRole('button', { name: 'Закрыть' }).click();
await p.waitForTimeout(300);

// 6. «Добавить упражнение»: the old name of the press finds the press.
await p.getByRole('button', { name: 'Добавить упражнение' }).click();
const add = p.getByRole('dialog', { name: 'Добавить упражнение' });
await add.getByRole('searchbox', { name: 'Найти упражнение' }).fill('скручивания в тренажере');
await add.getByRole('searchbox').blur();
await shot('11-add-search-alias');
await add.getByRole('button', { name: 'Закрыть' }).click();
await p.evaluate(() => { const { store } = window.__trainer; return store.deleteSession(store.liveSessions().find((x) => x.status === 'active').id); });

// 7. Progress: the press with every workout of days 1 and 3.
await p.evaluate(() => import('./js/ui/core.js').then(({ app }) => app.ui.go({ tab: 'progress', view: { type: 'exercise', key: 'press-v-trenazhere' } })));
await p.waitForTimeout(400);
await p.locator('.section-title', { hasText: 'Все тренировки' }).scrollIntoViewIfNeeded();
await shot('12-press-one-history');

// 8. «Тело» without the recovery tile.
await p.evaluate(() => import('./js/ui/core.js').then(({ app }) => app.ui.go({ tab: 'body', view: null })));
await p.waitForTimeout(400);
await shot('13-body');

await browser.close();
web.close();
