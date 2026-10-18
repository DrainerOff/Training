// The v1.0.1 correction card on a copy of the owner's real 18.10.2026 rows: what it shows, that
// nothing changes before «Исправить», the result in the app and in the sheet, the second device,
// «Отменить», and the smallest iPhone.
import { test, expect, devices } from '@playwright/test';
import { startStatic, startFakeGas } from '../helpers/servers.js';
import { realSession, realSets } from '../helpers/real-data.js';
import { ready, connectSync } from './helpers.js';

const SID = 'ssmve7dlgnd8b059146ff3fc37';
const MOVED_TO = ['giperekstenziya-v-trenazhere', 'obratnaya-babochka-dvumya-rukami', 'tyaga-shtangi-k-podborodku-v-smite'];

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

// The iPhone today: bundled import, the 18.10 workout, everything synced.
async function phone(page, gas) {
  await page.goto(base);
  await ready(page);
  await page.getByRole('button', { name: 'Понятно' }).click();
  if (gas) await connectSync(page, execUrl(gas), gas.token);
  await page.evaluate(async ({ s, sets }) => {
    const { store, sync } = window.__trainer;
    await store.applyRemote({ sessions: [s], sets }, { queue: true });
    await sync.syncNow();
  }, { s: realSession(), sets: realSets() });
}

const execUrl = (gas) => `http://127.0.0.1:${gas.server.address().port}/exec`;
const card = (page) => page.getByLabel('Исправление тренировки 18 октября');
const workout = (page) =>
  page.evaluate((id) => {
    const { store } = window.__trainer;
    return {
      items: store.state.sessions.get(id).items.map((i) => i.name),
      sets: store.setsOf(id).map((x) => `${x.id}|${x.seriesKey}|${x.weight}x${x.reps}@${x.rir}|${x.setNo}|${x.createdAt}`),
    };
  }, SID);
const sheet = async (gas) => {
  const dump = await (await fetch(`http://127.0.0.1:${gas.server.address().port}/__state`)).json();
  const table = (name) => {
    const [head, ...rows] = dump[name];
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  };
  return { sets: table('App_Sets'), sessions: table('App_Sessions'), program: table('App_Program') };
};

test('the card shows the exact records; nothing changes until «Исправить»; then app, sheet and the second device agree', async ({ page, browser }) => {
  const gas = await startFakeGas({ port: 0 });
  try {
    await phone(page, gas);
    const before = await workout(page);
    const sheetBefore = await sheet(gas);
    expect(sheetBefore.sets.filter((r) => r.session_id === SID)).toHaveLength(22);

    await expect(card(page)).toBeVisible();
    const items = card(page).locator('.fix__list li');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText('Гиперэкстензия с весом → Гиперэкстензия в тренажере');
    await expect(items.nth(0)).toContainText('50×10, 55×10, 60×10');
    await expect(items.nth(1)).toContainText('Кроссовер на заднюю дельту → Обратная бабочка двумя руками');
    await expect(items.nth(1)).toContainText('30×8, 30×8, 30×8');
    await expect(items.nth(2)).toContainText('Подъем EZ-грифа перед собой → Тяга штанги к подбородку в Смите');
    await expect(items.nth(2)).toContainText('55×10, 65×10, 65×10');
    await expect(card(page)).toContainText('Веса, повторения, RIR и дата не меняются');
    await page.reload();
    await ready(page);
    expect(await workout(page)).toEqual(before); // showing the card changed nothing

    await card(page).getByRole('button', { name: 'Исправить' }).click();
    await expect(page.getByText('Исправлено: 9 подходов, программа дня 2')).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    const after = await workout(page);
    expect(after.items).toEqual([
      'Подтягивания обратным хватом', 'Маятниковый присед', 'Гиперэкстензия в тренажере', 'Разведения гантелей в стороны',
      'Обратная бабочка двумя руками', 'Тяга штанги к подбородку в Смите', 'Икры в жиме ногами',
    ]);
    // Same sets, same numbers, same order and times; only the series of the nine changed.
    const strip = (rows) => rows.map((r) => r.split('|').filter((_, i) => i !== 1).join('|'));
    expect(strip(after.sets)).toEqual(strip(before.sets));
    expect(after.sets.filter((r) => MOVED_TO.some((k) => r.includes(`|${k}|`)))).toHaveLength(9);

    // In the workout itself: the corrected exercise, its sets, and the next day-2 workout offers the new main variants.
    await page.evaluate((id) => import('./js/ui/core.js').then(({ app }) => app.ui.go({ view: { type: 'session', id } })), SID);
    await page.getByRole('button', { name: /^Тяга штанги к подбородку в Смите: 3 из/ }).click();
    await expect(page.locator('.panel .set')).toHaveCount(3); // the exercise is complete: just its three sets
    await expect(page.locator('.panel .set__nums').first()).toContainText('55');
    const day2 = await page.evaluate(() => window.__trainer.store.state.program.days.find((d) => d.day === 2).slots.map((s) => s.options.map((o) => o.name).join(' / ')));
    expect(day2[2]).toBe('Гиперэкстензия в тренажере / Гиперэкстензия с весом');
    expect(day2[4]).toBe('Кроссовер на заднюю дельту / Обратная бабочка двумя руками / Обратная бабочка одной рукой');
    expect(day2[5]).toBe('Тяга штанги к подбородку в Смите / Подъем EZ-грифа перед собой');

    // Relaunch: kept, not offered again.
    await page.goto(base);
    await ready(page);
    await expect(card(page)).toHaveCount(0);
    expect(await workout(page)).toEqual(after);

    // The sheet: the same rows updated in place.
    expect((await page.evaluate(() => window.__trainer.sync.syncNow())).pending).toBe(0);
    const s = await sheet(gas);
    expect(s.sets).toHaveLength(sheetBefore.sets.length);
    expect(new Set(s.sets.map((r) => r.id)).size).toBe(s.sets.length);
    expect(s.sets.filter((r) => MOVED_TO.includes(r.series_key)).map((r) => `${r.exercise} ${r.weight_kg}×${r.reps}`)).toEqual([
      'Гиперэкстензия в тренажере 50×10', 'Гиперэкстензия в тренажере 55×10', 'Гиперэкстензия в тренажере 60×10',
      'Обратная бабочка двумя руками 30×8', 'Обратная бабочка двумя руками 30×8', 'Обратная бабочка двумя руками 30×8',
      'Тяга штанги к подбородку в Смите 55×10', 'Тяга штанги к подбородку в Смите 65×10', 'Тяга штанги к подбородку в Смите 65×10',
    ]);
    expect(s.sessions.filter((r) => r.id === SID)).toHaveLength(1);
    expect(s.program.find((r) => r.slot_id === 'D2-06').keys).toBe('tyaga-shtangi-k-podborodku-v-smite / podem-ez-grifa-pered-soboy');

    // A second device: gets the corrected workout, no card.
    const other = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
    const p2 = await other.newPage();
    await p2.goto(base);
    await ready(p2);
    await connectSync(p2, execUrl(gas), gas.token);
    await p2.evaluate(() => window.__trainer.sync.syncNow());
    expect((await workout(p2)).items).toEqual(after.items);
    await expect(card(p2)).toHaveCount(0);
    await other.close();
  } finally {
    gas.server.close();
  }
});

test('«Отменить» right after: the workout and the program are back as recorded, and the card is offered again', async ({ page }) => {
  await phone(page, null);
  const before = await workout(page);
  const program = await page.evaluate(() => JSON.stringify(window.__trainer.store.state.program.days));
  await card(page).getByRole('button', { name: 'Исправить' }).click();
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(card(page)).toBeVisible();
  const back = await workout(page);
  expect(back.items).toEqual(before.items);
  expect(back.sets.map((r) => r.split('|').slice(0, 3).join('|'))).toEqual(before.sets.map((r) => r.split('|').slice(0, 3).join('|')));
  expect(await page.evaluate(() => JSON.stringify(window.__trainer.store.state.program.days))).toBe(program);
});

test('«Позже» hides the card until the next launch and changes nothing', async ({ page }) => {
  await phone(page, null);
  const before = await workout(page);
  await card(page).getByRole('button', { name: 'Позже' }).click();
  await expect(card(page)).toHaveCount(0);
  expect(await workout(page)).toEqual(before);
  await page.reload();
  await ready(page);
  await expect(card(page)).toBeVisible();
});

test('smallest iPhone: the card fits, nothing runs off the screen', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 568 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const page = await context.newPage();
  await phone(page, null);
  await expect(card(page)).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('.screen').scrollWidth)).toBeLessThanOrEqual(320);
  const box = await card(page).boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  await card(page).getByRole('button', { name: 'Исправить' }).scrollIntoViewIfNeeded();
  const btn = await card(page).getByRole('button', { name: 'Исправить' }).boundingBox();
  const start = await page.getByRole('button', { name: 'Начать тренировку' }).boundingBox();
  expect(btn.y + btn.height <= start.y || btn.y >= start.y + start.height).toBe(true);
  await context.close();
});
