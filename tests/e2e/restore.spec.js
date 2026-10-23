// A new phone starts empty — the public build carries no personal data — and gets everything back
// from the sheet once it is connected: program, workouts, records, settings of the exercises,
// body measurements, sleep and phases, with the same ids and versions. Synthetic data only.
import { test, expect, devices } from '@playwright/test';
import { startStatic, startFakeGas } from '../helpers/servers.js';
import { ready, state, connectSync, seedOwner } from './helpers.js';

const WEIGHT = [
  'local_datetime,weight_kg,source',
  '2026-10-10 07:10:05 +0300,80.10,Zepp Life',
  '2026-10-12 07:12:40 +0300,80.35,Zepp Life',
  '2026-10-15 07:05:00 +0300,80.60,Zepp Life',
].join('\n');
const SLEEP = [
  'wake_date,sleep_start_local,sleep_end_local,sleep_hours,core_hours,deep_hours,rem_hours,unspecified_hours,segments,method',
  '2026-10-14,2026-10-13 23:30:00 +0300,2026-10-14 07:00:00 +0300,7.2,4.5,1.2,1.5,0,3,stages',
].join('\n');
const ENTITIES = ['sessions', 'sets', 'metrics', 'records', 'exercises', 'body', 'sleep', 'phases'];

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

// Every record on the device: [id, version, deleted] per entity, and the program.
const everything = (page) =>
  page.evaluate((entities) => {
    const { store } = window.__trainer;
    const out = {};
    for (const e of entities) out[e] = [...store.state[e].values()].map((r) => `${r.id}|${r.updatedAt}|${!!r.deleted}`).sort();
    const p = store.state.program;
    out.program = { updatedAt: p.updatedAt, draft: !!p.draft, days: p.days.map((d) => d.slots.map((s) => s.options.map((o) => o.key).join('/'))) };
    return out;
  }, ENTITIES);

async function fill(page) {
  await page.evaluate(async ({ weight, sleep }) => {
    const { store } = window.__trainer;
    const { parseFile, planImport } = await import('./js/lib/bodydata.js');
    for (const [name, text] of [['weight.csv', weight], ['sleep.csv', sleep]]) {
      const plan = planImport(parseFile(text, name), { body: store.state.body, sleep: store.state.sleep });
      await store.importBody(plan, { batch: name === 'weight.csv' ? 'iw1' : 'is1', file: name });
    }
    await store.savePhase({ mode: 'bulk', start: '2026-08-01', targetPct: 0.25 });
    await store.saveRecord({ seriesKey: 'zhim-shtangi-lezha-shtanga-gorizont', exercise: 'Жим штанги лежа: Штанга - горизонт', category: 'base', date: '2026-09-20', weight: 72.5, reps: 6 });
    await store.saveSetup('naklonnyy-zhim-hammer-naklon', 'Наклонный жим: Hammer - наклон', 'Сиденье: 3');
    const s = await store.startSession({ cycle: 1, week: 2, day: 2 });
    await store.logSet(s.id, s.items[0].slotId, { weight: 22.5, reps: 6, rir: 1 });
    await store.finishSession(s.id);
  }, { weight: WEIGHT, sleep: SLEEP });
}

test('a new phone: empty until connected, then everything from the sheet, same ids and versions; nothing doubled', async ({ page, browser }) => {
  const gas = await startFakeGas({ port: 0 });
  const gasUrl = `http://127.0.0.1:${gas.server.address().port}/exec`;
  const sheet = async () => (await fetch(`http://127.0.0.1:${gas.server.address().port}/__state`)).json();
  const cspViolations = [];
  try {
    // The phone in use: program, workouts, measurements, all in the sheet.
    await page.goto(base);
    await ready(page);
    await seedOwner(page);
    await fill(page);
    await connectSync(page, gasUrl, gas.token);
    await page.evaluate(() => window.__trainer.sync.syncNow());
    await expect.poll(async () => (await state(page)).outbox).toBe(0);
    const original = await everything(page);
    for (const e of ENTITIES) expect(original[e].length, e).toBeGreaterThan(0);
    const rowsBefore = await sheet();

    // The new phone, before it is connected: nothing of the owner's — no program, no workouts.
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
    const p2 = await ctx.newPage();
    p2.on('console', (m) => /Content Security Policy/i.test(m.text()) && cspViolations.push(m.text()));
    await p2.goto(base);
    await ready(p2);
    const empty = await everything(p2);
    for (const e of ENTITIES) expect(empty[e], e).toEqual([]);
    expect(empty.program.draft).toBe(true);
    await expect(p2.locator('.notice', { hasText: 'Перенесите программу' })).toContainText('подключите синхронизацию');

    // Connect through Settings, the way the owner does on the phone.
    await p2.locator('.notice').getByRole('button', { name: 'Синхронизация' }).click();
    await p2.locator('#sync-url').fill('https://docs.google.com/spreadsheets/d/10jl/edit');
    await p2.locator('#sync-token').fill(gas.token);
    await p2.getByRole('button', { name: 'Сохранить и проверить связь' }).click();
    await expect(p2.getByText('Это адрес самой таблицы')).toBeVisible();
    expect((await state(p2)).sync.state).toBe('off'); // nothing saved
    await p2.locator('#sync-url').fill(gasUrl);
    await p2.locator('#sync-token').fill(` ${gas.token}\n`); // pasted with stray whitespace
    await p2.getByRole('button', { name: 'Сохранить и проверить связь' }).click();
    await expect(p2.getByText('Подключено к таблице «Тренировки (тест)»')).toBeVisible();
    await expect.poll(async () => (await everything(p2)).sets.length).toBe(original.sets.length);
    await expect.poll(async () => (await state(p2)).outbox).toBe(0);

    // Everything is back, record for record, version for version.
    expect(await everything(p2)).toEqual(original);
    // …and the sheet got nothing new from the restore.
    const rowsAfter = await sheet();
    for (const name of ['App_Sessions', 'App_Sets', 'App_Metrics', 'App_Records', 'App_Exercises', 'App_Body', 'App_Sleep', 'App_Phases', 'App_Program']) {
      expect(rowsAfter[name].length, name).toBe(rowsBefore[name].length);
    }

    // The app on the new phone is the one in use: next workout and «last time» from the sheet.
    await p2.goto(base);
    await ready(p2);
    await expect(p2.locator('.next__title')).toHaveText('День 3');
    await expect(p2.locator('.next__meta')).toContainText('Цикл 1. Тяжёлая неделя');

    // CSP: the page cannot send anything (e.g. the access key) to other hosts.
    const external = await p2.evaluate(() => fetch('https://example.com/collect', { method: 'POST', body: 'x' }).then(() => 'sent', () => 'blocked'));
    expect(external).toBe('blocked');
    expect(cspViolations.filter((t) => !t.includes('example.com'))).toEqual([]);
    await ctx.close();
  } finally {
    gas.server.close();
  }
});

test('variants stay separate after a restore: the incline barbell has no history, the horizontal one has 16.10', async ({ page }) => {
  await page.goto(base);
  await ready(page);
  await seedOwner(page);
  await page.getByRole('button', { name: 'Другой день или неделя' }).click();
  await page.getByRole('group', { name: 'Неделя цикла' }).getByRole('button').nth(2).click();
  await page.getByRole('group', { name: 'День' }).getByRole('button', { name: '1', exact: true }).click();
  await page.getByRole('button', { name: 'Выбрать' }).click();
  await page.getByRole('button', { name: 'Начать тренировку' }).click();
  await page.getByRole('button', { name: /Жим штанги лежа: Штанга - наклон/ }).click();
  await expect(page.locator('.prev__label')).toContainText('ещё не выполнялось');
  await page.getByRole('button', { name: 'Заменить' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Штанга - горизонт/ }).click();
  await expect(page.locator('.prev__label')).toHaveText('Последний раз — неделя 2 (другая фаза), 16 октября');
  await expect(page.locator('.ghost')).toHaveText(['70×8', '70×9', '67,5×10', '67,5×10']);
  await expect(page.locator('.dock__prev')).toHaveAttribute('aria-label', 'Другая фаза, неделя 2, 16 октября: 70×8, 70×9, 67,5×10, 67,5×10');
  expect((await state(page)).activeSets).toEqual([]);
});
