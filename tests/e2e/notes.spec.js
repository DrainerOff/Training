// v1.0.1 notes and corrections in the gym: settings of an exercise variant (seat, handles…), a
// note on a set, this workout's comment, moving sets recorded under the wrong variant, and the
// double tap on the last set of an exercise.
import { test, expect, devices } from '@playwright/test';
import { startStatic, startFakeGas } from '../helpers/servers.js';
import { ready, connectSync, logButton } from './helpers.js';

const HAMMER = 'Наклонный жим: Hammer - наклон';
const DUMBBELLS = 'Наклонный жим: Гантели - наклон';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

// The owner's program (bundled import) and a day-1 workout in progress, cycle 2 week 2: every
// exercise has a "last time" from 16.10.
async function gym(page, { cycle = 2 } = {}) {
  await page.goto(base);
  await ready(page);
  await page.getByRole('button', { name: 'Понятно' }).click();
  await page.evaluate((c) => window.__trainer.store.startSession({ cycle: c, week: 2, day: 1 }), cycle);
  await expect(page.locator('.panel')).toBeVisible();
}
// The open exercise is remembered across a relaunch: tap its row only if it is not open yet.
async function openExercise(page, name) {
  const row = page.locator('.ex__row', { hasText: name });
  await expect(page.locator('.panel')).toBeVisible();
  if ((await page.locator('.panel .panel__title').textContent()) !== name) await row.click();
  await expect(page.locator('.panel .panel__title')).toHaveText(name);
}
const execUrl = (gas) => `http://127.0.0.1:${gas.server.address().port}/exec`;
const activeSets = (page) =>
  page.evaluate(() => {
    const { store } = window.__trainer;
    const s = store.liveSessions().find((x) => x.status === 'active');
    return store.setsOf(s.id).map((x) => `${x.exercise}|${x.weight}x${x.reps}`);
  });

test('settings of a variant: shown when it opens, its own per variant, kept offline and after relaunch, synced to the other device', async ({ page, context, browser }) => {
  const gas = await startFakeGas({ port: 0 });
  try {
    await gym(page);
    await connectSync(page, execUrl(gas), gas.token);
    await openExercise(page, HAMMER);
    const panel = page.locator('.panel');
    await panel.getByRole('button', { name: 'Настройки тренажёра' }).click();
    const sheet = page.getByRole('dialog', { name: `Настройки: ${HAMMER}` });
    await sheet.getByLabel('Настройки тренажёра').fill('сиденье 5, ручки 3');
    await sheet.getByRole('button', { name: 'Сохранить' }).click();
    await expect(panel.locator('.setup')).toHaveText('Настройки: сиденье 5, ручки 3');

    // Another variant of the same exercise has its own settings (none yet).
    await panel.getByRole('button', { name: 'Заменить' }).click();
    await page.getByRole('dialog', { name: 'Заменить упражнение' }).getByRole('button', { name: new RegExp(DUMBBELLS) }).click();
    await expect(panel.locator('.panel__title')).toHaveText(DUMBBELLS);
    await expect(panel.locator('.setup')).toHaveText('Настройки тренажёра');
    await panel.getByRole('button', { name: 'Заменить' }).click();
    await page.getByRole('dialog', { name: 'Заменить упражнение' }).getByRole('button', { name: new RegExp(HAMMER) }).click();
    await expect(panel.locator('.setup')).toHaveText('Настройки: сиденье 5, ручки 3');

    // Airplane mode: change them, close and reopen — still there; online again — in the sheet once.
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
    await ready(page);
    await openExercise(page, HAMMER);
    await expect(panel.locator('.setup')).toHaveText('Настройки: сиденье 5, ручки 3');
    await panel.locator('.setup').click();
    await page.getByRole('dialog', { name: `Настройки: ${HAMMER}` }).getByLabel('Настройки тренажёра').fill('сиденье 6, ручки 3');
    await page.getByRole('dialog', { name: `Настройки: ${HAMMER}` }).getByRole('button', { name: 'Сохранить' }).click();
    await page.reload();
    await ready(page);
    await openExercise(page, HAMMER);
    await expect(panel.locator('.setup')).toHaveText('Настройки: сиденье 6, ручки 3');
    await context.setOffline(false);
    expect((await page.evaluate(() => window.__trainer.sync.syncNow())).pending).toBe(0);
    const dump = await (await fetch(`http://127.0.0.1:${gas.server.address().port}/__state`)).json();
    expect(dump.App_Exercises.slice(1).map((r) => r.slice(0, 3))).toEqual([[HAMMER, 'сиденье 6, ручки 3', 'naklonnyy-zhim-hammer-naklon']]);

    // The other device: same settings in its own workout.
    const other = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
    const p2 = await other.newPage();
    await p2.goto(base);
    await ready(p2);
    await connectSync(p2, execUrl(gas), gas.token);
    await p2.evaluate(() => window.__trainer.sync.syncNow());
    await openExercise(p2, HAMMER); // the running workout came along
    await expect(p2.locator('.panel .setup')).toHaveText('Настройки: сиденье 6, ручки 3');
    await other.close();
  } finally {
    gas.server.close();
  }
});

test('three levels of notes stay apart: a note on a set (icon), a comment for this workout, the variant settings', async ({ page }) => {
  await gym(page);
  await openExercise(page, HAMMER);
  const panel = page.locator('.panel');
  await logButton(page).click();
  await expect(panel.locator('.set__nums')).toHaveCount(1);

  // Each set has a small note icon; it opens the set's editor.
  await panel.getByRole('button', { name: 'Добавить заметку к подходу 1' }).click();
  const edit = page.getByRole('dialog', { name: `Подход 1: ${HAMMER}` });
  await edit.getByLabel('Заметка к подходу').fill('плечо тянуло');
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  const icon = panel.getByRole('button', { name: 'Заметка к подходу 1: плечо тянуло. Изменить' });
  await expect(icon).toHaveClass(/set__note--on/);

  // This workout's comment on the exercise.
  await panel.getByRole('button', { name: 'Отметки и комментарий' }).click();
  await page.getByLabel('Комментарий к упражнению в этой тренировке').fill('опустил сиденье на одно деление');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(panel.locator('.item-note')).toContainText('опустил сиденье на одно деление');

  // The variant settings are separate and still empty.
  await expect(panel.locator('.setup')).toHaveText('Настройки тренажёра');

  await page.reload();
  await ready(page);
  await openExercise(page, HAMMER);
  await expect(panel.getByRole('button', { name: 'Заметка к подходу 1: плечо тянуло. Изменить' })).toBeVisible();
  await expect(panel.locator('.item-note')).toContainText('опустил сиденье на одно деление');
  const stored = await page.evaluate(() => {
    const { store } = window.__trainer;
    const s = store.liveSessions().find((x) => x.status === 'active');
    return { set: store.setsOf(s.id)[0].note, item: s.items[1].note, setup: store.setupOf(s.items[1].seriesKey) };
  });
  expect(stored).toEqual({ set: 'плечо тянуло', item: 'опустил сиденье на одно деление', setup: '' });
});

test('wrong variant recorded: «Заменить» can move the recorded sets, or keep them where they were done', async ({ page }) => {
  await gym(page);
  await openExercise(page, HAMMER);
  const panel = page.locator('.panel');
  await logButton(page).click();
  await page.waitForTimeout(1600); // a real second set, not a double tap
  await logButton(page).click();
  await expect(panel.locator('.set__nums')).toHaveCount(2);
  const numbers = await activeSets(page);

  // Moved: they were done on dumbbells after all.
  await panel.getByRole('button', { name: 'Заменить' }).click();
  await page.getByRole('dialog', { name: 'Заменить упражнение' }).getByRole('button', { name: new RegExp(DUMBBELLS) }).click();
  const ask = page.getByRole('dialog', { name: `«${DUMBBELLS}»` });
  await expect(ask).toContainText('Уже записано 2 подхода');
  await ask.getByRole('button', { name: /Записал не то упражнение — перенести их/ }).click();
  await expect(page.getByText(`2 подхода перенесены в «${DUMBBELLS}»`)).toBeVisible();
  expect(await activeSets(page)).toEqual(numbers.map((r) => r.replace(HAMMER, DUMBBELLS)));

  // Kept: switching back to Hammer for the next sets leaves the dumbbell sets as dumbbells.
  await panel.getByRole('button', { name: 'Заменить' }).click();
  await page.getByRole('dialog', { name: 'Заменить упражнение' }).getByRole('button', { name: new RegExp(HAMMER) }).click();
  await page.getByRole('dialog', { name: `«${HAMMER}»` }).getByRole('button', { name: new RegExp(`Дальше делаю «${HAMMER}»`) }).click();
  await expect(panel.locator('.panel__title')).toHaveText(HAMMER);
  expect(await activeSets(page)).toEqual(numbers.map((r) => r.replace(HAMMER, DUMBBELLS)));
  await expect(panel.locator('.set__tags .tag', { hasText: DUMBBELLS })).toHaveCount(2);
});

test('double tap on the last set of an exercise: the next exercise gets no set', async ({ page }) => {
  await gym(page);
  const panel = page.locator('.panel');
  for (let i = 0; i < 2; i++) {
    await logButton(page).click();
    await page.waitForTimeout(1600);
  }
  await expect(page.locator('.dock')).toContainText('Подход 3 из 3');
  const box = await logButton(page).boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await page.waitForTimeout(150);
  await page.mouse.click(x, y);
  await page.waitForTimeout(600);
  const sets = await activeSets(page);
  expect(sets.filter((r) => r.startsWith('Подтягивания'))).toHaveLength(3);
  expect(sets.filter((r) => !r.startsWith('Подтягивания'))).toEqual([]);
  await expect(panel.locator('.panel__title')).toHaveText(HAMMER); // moved on, nothing recorded there
});

test('smallest iPhone: settings line, set tags and note icons fit in the row', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 568 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const page = await context.newPage();
  await gym(page);
  await page.evaluate(async () => {
    const { store } = window.__trainer;
    const s = store.liveSessions().find((x) => x.status === 'active');
    const slot = s.items[1].slotId;
    await store.saveSetup(s.items[1].seriesKey, s.items[1].name, 'сиденье 5, ручки 3, упор на втором отверстии, спинка на 4, ограничители на 7');
    const a = await store.logSet(s.id, slot, { weight: 92.5, reps: 9, rir: 1 });
    await store.updateSet(a.set.id, { pain: true, technique: true, note: 'длинная заметка к подходу, чтобы проверить перенос' });
  });
  await openExercise(page, HAMMER);
  const panel = page.locator('.panel');
  const pb = await panel.boundingBox();
  for (const sel of ['.setup', '.set__note', '.set__tags']) {
    const b = await panel.locator(sel).first().boundingBox();
    expect(b.x).toBeGreaterThanOrEqual(pb.x - 0.5);
    expect(b.x + b.width).toBeLessThanOrEqual(pb.x + pb.width + 0.5);
  }
  expect(await page.evaluate(() => document.querySelector('.screen').scrollWidth)).toBeLessThanOrEqual(320);
  await context.close();
});
