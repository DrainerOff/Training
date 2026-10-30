// v1.0.2: long sheets on the iPhone — a pinned header with «Закрыть», the main action pinned at
// the bottom (also above the keyboard), a question before unsaved changes are dropped — and the
// settings of each exercise variant in the program editor, the same records as the workout line.
import { test, expect, devices } from '@playwright/test';
import { startStatic, startFakeGas } from '../helpers/servers.js';
import { ready, connectSync, logButton, seedOwner, pickRir } from './helpers.js';

const HAMMER = 'Наклонный жим: Hammer - наклон';
const DUMBBELLS = 'Наклонный жим: Гантели - наклон';
const SCREENS = [
  { name: 'iPhone SE (1st gen)', width: 320, height: 568 },
  { name: 'iPhone 13', width: 390, height: 844 },
];

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

async function phone(browser, screen = SCREENS[1]) {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: screen.width, height: screen.height }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const page = await context.newPage();
  await page.goto(base);
  await ready(page);
  await seedOwner(page);
  return { context, page };
}

// Settings → «Редактировать программу» → an exercise.
async function editor(page) {
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: /Редактировать программу/ }).click();
  await expect(page.getByRole('heading', { name: 'Программа' })).toBeVisible();
}
// Measure once the sheet has slid in.
const settled = (dialog) => dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
const slot = (page, name) => page.locator('.slot-edit button', { hasText: name }).first();
const exerciseSheet = (page) => page.getByRole('dialog', { name: 'Упражнение' });
const confirmDrop = (page) => page.getByRole('dialog', { name: 'Закрыть без сохранения?' });

for (const screen of SCREENS) {
  test(`${screen.name}: the exercise sheet keeps «Закрыть» and «Готово» in view while scrolling and with the keyboard`, async ({ browser }) => {
    const { context, page } = await phone(browser, screen);
    await editor(page);
    await slot(page, HAMMER).click();
    const sheet = exerciseSheet(page);
    await settled(sheet);
    const close = sheet.getByRole('button', { name: 'Закрыть' });
    const done = sheet.getByRole('button', { name: 'Готово' });
    const inView = async (loc, height = screen.height) => {
      const b = await loc.boundingBox();
      return b.y >= 0 && b.y + b.height <= height + 0.5;
    };
    await expect(close).toBeVisible();
    expect(await inView(close)).toBe(true);
    expect(await inView(done)).toBe(true);
    const closeAt = (await close.boundingBox()).y;

    // The form scrolls; the header and the footer don't.
    const body = sheet.locator('.sheet__body');
    expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(100);
    expect((await close.boundingBox()).y).toBe(closeAt);
    expect(await inView(done)).toBe(true);
    await expect(sheet.getByLabel('Заметка тренера')).toBeVisible();

    // The keyboard: the visible area shrinks; the sheet fits into what is left.
    await sheet.getByLabel('Заметка тренера').focus();
    const kbHeight = screen.height - 300;
    await page.setViewportSize({ width: screen.width, height: kbHeight });
    await page.waitForTimeout(200);
    expect(await inView(close, kbHeight)).toBe(true);
    expect(await inView(done, kbHeight)).toBe(true);
    await page.keyboard.type(' x');
    await page.setViewportSize({ width: screen.width, height: screen.height });
    await page.waitForTimeout(200);
    expect(await inView(done)).toBe(true);
    await context.close();
  });
}

test('unsaved changes: ×, a tap on the backdrop and Escape ask first; without changes they just close', async ({ browser }) => {
  const { context, page } = await phone(browser, SCREENS[0]);
  await editor(page);
  const program = await page.evaluate(() => JSON.stringify(window.__trainer.store.state.program));

  // Nothing changed: closes at once.
  await slot(page, HAMMER).click();
  await exerciseSheet(page).getByRole('button', { name: 'Закрыть' }).click();
  await expect(exerciseSheet(page)).toHaveCount(0);
  await expect(confirmDrop(page)).toHaveCount(0);

  // Changed: × asks; «Продолжить» keeps the edit.
  await slot(page, HAMMER).click();
  await exerciseSheet(page).locator('.sheet__body input').first().fill('Наклонный жим: Hammer - наклон (новый)');
  await exerciseSheet(page).getByRole('button', { name: 'Закрыть' }).click();
  await expect(confirmDrop(page)).toBeVisible();
  await confirmDrop(page).getByRole('button', { name: 'Продолжить' }).click();
  await expect(confirmDrop(page)).toHaveCount(0);
  await expect(exerciseSheet(page).locator('.sheet__body input').first()).toHaveValue('Наклонный жим: Hammer - наклон (новый)');

  // The backdrop asks too; Escape too (and only the question closes, not the form under it).
  await page.mouse.click(160, 5);
  await expect(confirmDrop(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirmDrop(page)).toHaveCount(0);
  await expect(exerciseSheet(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirmDrop(page)).toBeVisible();
  await confirmDrop(page).getByRole('button', { name: 'Не сохранять' }).click();
  await expect(exerciseSheet(page)).toHaveCount(0);

  // Dropped: the program and its draft are as they were; nothing waits to be saved.
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(0);
  await expect(slot(page, HAMMER)).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(window.__trainer.store.state.program))).toBe(program);
  await context.close();
});

test('program editor: «Сохранить» stays at the top while there are changes; leaving without saving asks', async ({ browser }) => {
  const { context, page } = await phone(browser, SCREENS[0]);
  await editor(page);
  await slot(page, HAMMER).click();
  await exerciseSheet(page).getByLabel('Заметка тренера').fill('Варианты считаются отдельно. Пауза внизу.');
  await exerciseSheet(page).getByRole('button', { name: 'Готово' }).click();
  const top = page.locator('.topbar').getByRole('button', { name: 'Сохранить' });
  await expect(top).toBeVisible();

  await page.getByRole('button', { name: 'Назад' }).click();
  const ask = page.getByRole('dialog', { name: 'Выйти без сохранения программы?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Остаться' }).click();
  await expect(page.getByRole('heading', { name: 'Программа' })).toBeVisible();

  await top.click();
  await expect(page.getByText('Программа сохранена')).toBeVisible();
  expect(await page.evaluate(() => window.__trainer.store.state.program.days[0].slots[1].note)).toBe('Варианты считаются отдельно. Пауза внизу.');
  await context.close();
});

test('variant settings in the program editor: one per variant, the same as in the workout, synced; the trainer note apart', async ({ browser }) => {
  const gas = await startFakeGas({ port: 0 });
  const exec = `http://127.0.0.1:${gas.server.address().port}/exec`;
  try {
    const { context, page } = await phone(browser, SCREENS[0]);
    await connectSync(page, exec, gas.token);
    const program = await page.evaluate(() => JSON.stringify(window.__trainer.store.state.program));
    await editor(page);
    await slot(page, HAMMER).click();
    const sheet = exerciseSheet(page);
    await expect(sheet.getByRole('group', { name: 'Настройки тренажёра по вариантам' })).toBeVisible();
    await sheet.getByLabel(`Настройки: ${HAMMER}`).fill('сиденье 5, ручки 3');
    await sheet.getByLabel(`Настройки: ${DUMBBELLS}`).fill('скамья 30°');
    // The trainer's note is a separate field, common to the exercise.
    await expect(sheet.getByLabel('Заметка тренера')).toHaveValue(/Варианты считаются отдельно/);
    await sheet.getByRole('button', { name: 'Готово' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(slot(page, HAMMER)).toContainText('Настройки: 2 из 2 вариантов');
    // Settings are not the program: nothing to save there, the program is untouched.
    await expect(page.locator('.topbar').getByRole('button', { name: 'Сохранить' })).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify(window.__trainer.store.state.program))).toBe(program);

    // The workout shows them over the sets, per variant; editing there changes the same record.
    await page.getByRole('button', { name: 'Назад' }).click();
    await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 2, day: 1 }));
    await page.evaluate(() => import('./js/ui/core.js').then(({ app }) => app.ui.go({ tab: 'today', view: null })));
    await page.locator('.ex__row', { hasText: HAMMER }).click();
    const panel = page.locator('.panel');
    await expect(panel.locator('.setup')).toHaveText('Настройки: сиденье 5, ручки 3');
    await panel.getByRole('button', { name: 'Заменить' }).click();
    const swap = page.getByRole('dialog', { name: 'Заменить упражнение' });
    await swap.getByRole('button', { name: new RegExp(DUMBBELLS) }).click();
    await expect(swap).toHaveCount(0);
    await expect(panel.locator('.setup')).toHaveText('Настройки: скамья 30°');
    await page.waitForTimeout(500); // a new tap, not the second tap of the choice above
    await panel.locator('.setup').click();
    const quick = page.getByRole('dialog', { name: `Настройки: ${DUMBBELLS}` });
    await quick.getByLabel('Настройки тренажёра').fill('скамья 45°');
    await quick.getByRole('button', { name: 'Сохранить' }).click();
    await expect(quick).toHaveCount(0);
    expect(await page.evaluate(() => window.__trainer.store.state.exercises.size)).toBe(2);

    // Synced: one row per variant; the other device sees them in its program editor.
    expect((await page.evaluate(() => window.__trainer.sync.syncNow())).pending).toBe(0);
    const dump = await (await fetch(`http://127.0.0.1:${gas.server.address().port}/__state`)).json();
    expect(dump.App_Exercises.slice(1).map((r) => r.slice(0, 2)).sort()).toEqual([[HAMMER, 'сиденье 5, ручки 3'], [DUMBBELLS, 'скамья 45°']].sort());
    const other = await phone(browser, SCREENS[1]);
    await connectSync(other.page, exec, gas.token);
    await other.page.evaluate(() => window.__trainer.sync.syncNow());
    await other.page.evaluate(() => import('./js/ui/core.js').then(({ app }) => app.ui.go({ view: { type: 'program' } })));
    await slot(other.page, HAMMER).click();
    await expect(exerciseSheet(other.page).getByLabel(`Настройки: ${DUMBBELLS}`)).toHaveValue('скамья 45°');
    await expect(exerciseSheet(other.page).getByLabel(`Настройки: ${HAMMER}`)).toHaveValue('сиденье 5, ручки 3');
    await other.context.close();
    await context.close();
  } finally {
    gas.server.close();
  }
});

test('the same pinned header and footer in the other long sheets (320 px), with the question before dropping edits', async ({ browser }) => {
  const { context, page } = await phone(browser, SCREENS[0]);
  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 2, day: 1 }));
  await pickRir(page);
  await logButton(page).click();
  const pinned = async (dialog, action) => {
    await settled(dialog);
    const close = await dialog.getByRole('button', { name: 'Закрыть' }).boundingBox();
    const main = await dialog.locator('.sheet__foot').getByRole('button', { name: action }).boundingBox();
    expect(close.y).toBeGreaterThanOrEqual(0);
    expect(main.y + main.height).toBeLessThanOrEqual(568.5);
  };

  // A set: edit, ×, the question, drop — the set is as it was.
  await page.locator('.panel').getByRole('button', { name: /^Подход 1: .* Изменить$/ }).click();
  const edit = page.getByRole('dialog', { name: /^Подход 1:/ });
  await pinned(edit, 'Сохранить');
  await edit.getByRole('button', { name: 'Увеличить: Повторения' }).click();
  await edit.getByRole('button', { name: 'Закрыть' }).click();
  await confirmDrop(page).getByRole('button', { name: 'Не сохранять' }).click();
  await expect(edit).toHaveCount(0);
  expect(await page.evaluate(() => {
    const { store } = window.__trainer;
    const s = store.liveSessions().find((x) => x.status === 'active');
    return store.setsOf(s.id).map((x) => x.reps);
  })).toEqual([6]);

  // This workout's comment, the end of the workout, a new record.
  await page.locator('.panel').getByRole('button', { name: 'Отметки и комментарий' }).click();
  await pinned(page.getByRole('dialog', { name: 'Подтягивания прямым хватом' }), 'Сохранить');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Завершить тренировку' }).click();
  await pinned(page.getByRole('dialog', { name: 'Итог тренировки' }), 'Завершить');
  await page.getByRole('dialog', { name: 'Итог тренировки' }).getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('button', { name: 'Меню тренировки' }).click();
  await page.getByRole('group', { name: 'Разделы' }).getByRole('button', { name: 'Прогресс' }).click();
  await page.getByRole('group', { name: 'Раздел' }).getByRole('button', { name: 'Рекорды' }).click();
  await page.getByRole('button', { name: 'Добавить рекорд' }).click();
  await pinned(page.getByRole('dialog', { name: 'Новый рекорд' }), 'Выберите упражнение');
  await context.close();
});

test('double taps: «Готово» adds a new exercise once and stays in the editor; «Сохранить» on a set does not log another set', async ({ browser }) => {
  const { context, page } = await phone(browser, SCREENS[0]);
  await editor(page);
  await expect(page.locator('.tabbar')).toHaveCount(0); // the editor is left only by «Назад»
  const before = await page.locator('.slot-edit').count();
  await page.getByRole('button', { name: 'Добавить упражнение' }).click();
  const sheet = page.getByRole('dialog', { name: 'Новое упражнение' });
  await settled(sheet);
  await sheet.locator('.sheet__body input').first().fill('Жим в Смите');
  await sheet.getByLabel('Настройки: Жим в Смите').fill('скамья 3');
  const done = await sheet.getByRole('button', { name: 'Готово' }).boundingBox();
  await page.mouse.click(done.x + done.width / 2, done.y + done.height / 2);
  await page.waitForTimeout(80);
  await page.mouse.click(done.x + done.width / 2, done.y + done.height / 2);
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.slot-edit')).toHaveCount(before + 1);
  await expect(page.getByRole('heading', { name: 'Программа' })).toBeVisible();

  // In a workout: the second tap of «Сохранить» would land on «Записать».
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('dialog', { name: 'Выйти без сохранения программы?' }).getByRole('button', { name: 'Выйти' }).click();
  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 2, day: 1 }));
  await page.evaluate(() => import('./js/ui/core.js').then(({ app }) => app.ui.go({ tab: 'today', view: null })));
  await pickRir(page);
  await logButton(page).click();
  await page.locator('.panel').getByRole('button', { name: /^Подход 1: .* Изменить$/ }).click();
  const edit = page.getByRole('dialog', { name: /^Подход 1:/ });
  await settled(edit);
  await edit.getByRole('button', { name: 'Увеличить: Повторения' }).click();
  const save = await edit.locator('.sheet__foot').getByRole('button', { name: 'Сохранить' }).boundingBox();
  await page.mouse.click(save.x + save.width / 2, save.y + save.height / 2);
  await page.waitForTimeout(120);
  await page.mouse.click(save.x + save.width / 2, save.y + save.height / 2);
  await page.waitForTimeout(600);
  const sets = await page.evaluate(() => {
    const { store } = window.__trainer;
    const s = store.liveSessions().find((x) => x.status === 'active');
    return store.setsOf(s.id).map((x) => x.reps);
  });
  expect(sets).toEqual([7]);
  // A tap elsewhere right after is not swallowed.
  await page.waitForTimeout(500);
  await pickRir(page);
  await logButton(page).click();
  await expect.poll(() => page.evaluate(() => {
    const { store } = window.__trainer;
    return store.setsOf(store.liveSessions().find((x) => x.status === 'active').id).length;
  })).toBe(2);
  await context.close();
});

test('settings typed for a variant follow it when it is renamed; text fields are 16 px (no iOS zoom)', async ({ browser }) => {
  const { context, page } = await phone(browser, SCREENS[0]);
  await editor(page);
  await slot(page, HAMMER).click();
  const sheet = exerciseSheet(page);
  await sheet.getByLabel(`Настройки: ${DUMBBELLS}`).fill('скамья 30°');
  const alts = sheet.locator('.sheet__body textarea').first();
  await alts.fill('Наклонный жим: Гантели - наклон 30°');
  await expect(sheet.getByLabel('Настройки: Наклонный жим: Гантели - наклон 30°')).toHaveValue('скамья 30°');
  for (const f of await sheet.locator('textarea, input').all()) {
    expect(parseFloat(await f.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  }
  await context.close();
});

test('«Вес и сон за день» (Тело): × with changes asks; «Сохранить» is pinned at the bottom', async ({ browser }) => {
  const { context, page } = await phone(browser, SCREENS[0]);
  await page.locator('.tabbar').getByRole('button', { name: 'Тело' }).click();
  await page.getByRole('button', { name: 'Добавить: вес и сон за день, замер или файл' }).click();
  await page.getByRole('dialog', { name: 'Добавить' }).getByRole('button', { name: /Записать вес и сон/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Вес и сон за день' });
  await settled(sheet);
  await expect(sheet.locator('.sheet__foot').getByRole('button', { name: 'Сохранить' })).toBeVisible();
  await sheet.getByLabel('Заметка').fill('устал');
  await sheet.getByRole('button', { name: 'Закрыть' }).click();
  await expect(confirmDrop(page)).toBeVisible();
  await page.keyboard.press('Escape'); // right after it appears: closes only the question
  await expect(confirmDrop(page)).toHaveCount(0);
  await expect(sheet.getByLabel('Заметка')).toHaveValue('устал');
  await context.close();
});
