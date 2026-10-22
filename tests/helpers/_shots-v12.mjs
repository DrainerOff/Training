// Screenshots of every main screen with synthetic data, for comparing a design change before and
// after. Not a test. Usage: node tests/helpers/_shots-v12.mjs <out dir> [light|dark] [width] [height]
// Synthetic data only: the sample program and history fixtures, 90 days of made-up weigh-ins
// (a cut, then a bulk), waist and girths, 30 nights of sleep, two phases, recovery marks.
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
import { startStatic } from './servers.js';

const out = process.argv[2];
const scheme = process.argv[3] || 'light';
const width = Number(process.argv[4] || 390);
const height = Number(process.argv[5] || 844);
const tag = width === 390 ? scheme : `${scheme}-${width}`;
fs.mkdirSync(out, { recursive: true });

const web = await startStatic({ port: 0 });
const base = `http://127.0.0.1:${web.address().port}/`;
const browser = await chromium.launch();
const c = await browser.newContext({ ...devices['iPhone 13'], viewport: { width, height }, colorScheme: scheme, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
await c.addInitScript(([top, bottom]) => document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.style.setProperty('--safe-top', `${top}px`);
  document.documentElement.style.setProperty('--safe-bottom', `${bottom}px`);
}), height >= 812 ? [47, 34] : [20, 0]);
const p = await c.newPage();
await p.goto(base);
await p.waitForFunction(() => window.__trainer?.store.state.loaded);
await p.getByRole('button', { name: 'Понятно' }).click();

const PROG = fs.readFileSync('tests/fixtures/sample-program.txt', 'utf8');
const HIST = fs.readFileSync('tests/fixtures/sample-history.txt', 'utf8');
await p.evaluate(async ({ prog, hist }) => {
  const { store } = window.__trainer;
  const { parseResultsText } = await import('./js/lib/textimport.js');
  for (const s of store.liveSessions()) await store.deleteSession(s.id);
  for (const m of [...store.state.metrics.values()]) if (!m.deleted) await store.deleteMetric(m.id);
  const pm = await import('./js/lib/program.js');
  const parsed = pm.parseProgramText(prog);
  await store.saveProgram(parsed.program || parsed);
  await store.importParsedSessions(parseResultsText(hist, store.state.program).sessions);
  const day = (i) => {
    const d = new Date(Date.now() - i * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280 - 0.5;
  for (let i = 90; i >= 0; i--) {
    if (i % 7 === 3) continue;
    const w = i > 35 ? 78 + (i - 35) * 0.06 : 78 + (35 - i) * 0.028;
    await store.addBody({ kind: 'weight', value: Math.round((w + rnd() * 0.8) * 100) / 100, measuredAt: `${day(i)}T07:${10 + (i % 40)}`, source: 'Zepp Life' });
  }
  for (const [i, v] of [[84, 84.5], [63, 83.2], [42, 82.4], [28, 82.5], [14, 82.7], [2, 82.8]]) await store.addBody({ kind: 'waist', value: v, measuredAt: `${day(i)}T08:00`, source: 'Fitdays+' });
  for (const [k, v] of [['chest', 104], ['arm_l', 38.5], ['arm_r', 38.9], ['hips', 99]]) {
    await store.addBody({ kind: k, value: v - 0.6, measuredAt: `${day(40)}T08:00`, source: 'Fitdays+' });
    await store.addBody({ kind: k, value: v, measuredAt: `${day(3)}T08:00`, source: 'Fitdays+' });
  }
  const bd = await import('./js/lib/bodydata.js');
  const rows = ['wake_date,sleep_start_local,sleep_end_local,sleep_hours,core_hours,deep_hours,rem_hours,unspecified_hours,segments,method'];
  for (let i = 30; i >= 1; i--) {
    const h = 6.4 + ((i * 37) % 17) / 10;
    rows.push(`${day(i)},${day(i + 1)} 23:40:00 +0300,${day(i)} 07:00:00 +0300,${h.toFixed(1)},${(h * 0.55).toFixed(1)},${(h * 0.17).toFixed(1)},${(h * 0.24).toFixed(1)},0,3,stages`);
  }
  const plan = bd.planImport(bd.parseFile(rows.join('\n')), { body: store.state.body, sleep: store.state.sleep });
  await store.importBody(plan, { batch: 'syn' });
  await store.savePhase({ mode: 'cut', start: day(120), end: day(36), targetPct: -0.5 });
  await store.savePhase({ mode: 'bulk', start: day(35), targetPct: 0.25 });
  for (let i = 6; i >= 1; i--) await store.saveMetric(day(i), { recovery: 3 + (i % 3 === 0 ? 1 : 0) });
}, { prog: PROG, hist: HIST });
await p.goto(base);
await p.waitForFunction(() => window.__trainer?.store.state.loaded);

const shot = async (name, { full = false } = {}) => {
  await p.waitForTimeout(350);
  if (!full) return p.screenshot({ path: `${out}/${name}-${tag}.png` });
  const h = await p.locator('.screen').evaluate((el) => el.scrollHeight);
  await p.setViewportSize({ width, height: Math.min(h + 200, 6000) });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/${name}-full-${tag}.png` });
  await p.setViewportSize({ width, height });
  await p.waitForTimeout(200);
};
const tab = (n) => p.locator('.tabbar').getByRole('button', { name: n }).click();
const tryClick = (loc) => loc.click({ timeout: 1500 }).then(() => true, () => false);
const closeSheet = () => tryClick(p.getByRole('dialog').last().getByRole('button', { name: 'Закрыть' }));

await shot('01-home');
await shot('01-home', { full: true });
await tryClick(p.getByRole('button', { name: 'Другой день или неделя' }));
await shot('02-sheet-start');
await closeSheet();

await tab('Прогресс');
await shot('10-progress');
await tryClick(p.locator('.screen .row').first());
await shot('11-exercise');
await shot('11-exercise', { full: true });
await tryClick(p.getByRole('button', { name: 'Назад' }).first());
await tryClick(p.getByRole('group', { name: 'Раздел' }).getByRole('button', { name: 'Рекорды' }));
await shot('12-records');
await tryClick(p.getByRole('group', { name: 'Раздел' }).getByRole('button', { name: 'Прогресс' }));

await tab('История');
await shot('20-history');
await shot('20-history', { full: true });
await tryClick(p.locator('.screen .row').first());
await shot('21-session');
await tryClick(p.getByRole('button', { name: 'Готово' }));

await tab('Тело');
await shot('30-body');
await shot('30-body', { full: true });
await tryClick(p.locator('.phase').getByRole('button', { name: 'Изменить' }));
await shot('31-sheet-phase');
await closeSheet();
const addMenu = p.getByRole('button', { name: /Добавить: / });
const before = !(await addMenu.count());
if (before) {
  // v1.1: two buttons on the screen.
  if (await tryClick(p.getByRole('button', { name: 'Добавить замер' }))) {
    await shot('32-sheet-addbody');
    await closeSheet();
  }
  if (await tryClick(p.getByRole('button', { name: 'Записать самочувствие' }))) {
    await shot('33-sheet-wellbeing');
    await closeSheet();
  }
} else {
  await addMenu.click();
  await shot('34-add-menu');
  await p.getByRole('dialog').getByRole('button', { name: /Добавить замер/ }).click();
  await shot('32-sheet-addbody');
  await closeSheet();
  await addMenu.click();
  await p.getByRole('dialog').getByRole('button', { name: /Записать самочувствие/ }).click();
  await shot('33-sheet-wellbeing');
  await closeSheet();
  await tryClick(p.locator('.row', { hasText: 'Взвешивания' }));
  await shot('35-sheet-weighins');
  await closeSheet();
  await tryClick(p.locator('.tile', { hasText: 'Силовые' }));
  await shot('36-sheet-strength');
  await closeSheet();
}

await tab('Тренировка');
await tryClick(p.getByRole('button', { name: 'Настройки' }));
await shot('50-settings');
await tryClick(p.getByRole('button', { name: 'Назад' }).first());

await p.getByRole('button', { name: 'Начать тренировку' }).click();
await shot('40-workout');
await p.locator('.dock .btn--primary').click();
await p.waitForTimeout(400);
await p.locator('.dock .btn--primary').click();
await shot('41-workout-logged');
await shot('41-workout', { full: true });
await tryClick(p.locator('.dock .stepper__value').first());
await shot('42-pad');
await closeSheet();

await browser.close();
await web.close();
