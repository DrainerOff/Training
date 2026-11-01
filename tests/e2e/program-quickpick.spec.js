// v1.4.3: the program editor's «Добавить упражнение» → «Быстрый выбор»: the chosen exercise is
// highlighted, and a search over the program and the whole history (like «Заменить» in a workout)
// finds exercises that are not chips — e.g. done once as a one-off. Picking fills the name, category
// and weight step, and a name done before joins its series. Synthetic data.
import { test, expect } from '@playwright/test';
import { startStatic } from '../helpers/servers.js';
import { ready, seedOwner } from './helpers.js';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

const ONE_OFF = 'Шраги с гантелями';

async function editor(page) {
  await page.goto(base);
  await ready(page);
  await seedOwner(page);
  // A one-off exercise from a past workout: in the history, not in the program.
  await page.evaluate(async (name) => {
    const { store } = window.__trainer;
    const s = await store.startSession({ cycle: 2, week: 2, day: 1 });
    const it = await store.addItem(s.id, { name, category: 'iso', step: 2 });
    await store.logSet(s.id, it.slotId, { weight: 30, reps: 12, rir: 2 });
    await store.finishSession(s.id);
  }, ONE_OFF);
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: /Редактировать программу/ }).click();
  await page.getByRole('button', { name: 'Добавить упражнение' }).click();
  return page.getByRole('dialog', { name: 'Новое упражнение' });
}

test('«Быстрый выбор»: the chosen chip is highlighted; search finds program and history; the pick fills name, category, step', async ({ page }) => {
  const sheet = await editor(page);
  const pick = sheet.locator('.quick-pick');
  const name = sheet.getByRole('textbox', { name: 'Название', exact: true });

  // A chip: highlighted (and only it), the name filled in.
  const chip = pick.getByRole('button', { name: 'Горизонтальная тяга блока', exact: true });
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(pick.locator('.seg button[aria-pressed="true"]')).toHaveCount(1);
  await expect(name).toHaveValue('Горизонтальная тяга блока');
  await expect(sheet.getByRole('group', { name: 'Категория' }).getByRole('button', { name: 'Базовое' })).toHaveAttribute('aria-pressed', 'true');
  // Another chip moves the highlight.
  await pick.getByRole('button', { name: 'Пресс в тренажере', exact: true }).click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(pick.getByRole('button', { name: 'Пресс в тренажере', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Search: a one-off from the history, with where/when; picking it highlights it and joins its series.
  const search = pick.getByRole('searchbox', { name: 'Найти упражнение' });
  await search.fill('шраги');
  const found = pick.locator('.choice', { hasText: ONE_OFF });
  await expect(found).toContainText('Изоляция');
  await expect(found).toContainText('30 кг');
  await expect(found).toHaveAttribute('aria-pressed', 'false');
  await found.click();
  await expect(found).toHaveAttribute('aria-pressed', 'true');
  await expect(found.getByRole('img', { name: 'Выбрано' })).toBeVisible();
  await expect(name).toHaveValue(ONE_OFF);
  await expect(sheet.getByRole('group', { name: 'Шаг веса' }).getByRole('button', { name: '2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet).toContainText(`«${ONE_OFF}» уже есть (1 тренировка`);

  // Search also finds program exercises by part of a word.
  await search.fill('подтяг нейтр');
  await expect(pick.locator('.choice').first()).toContainText('Подтягивания нейтральным хватом');
  await expect(pick.locator('.choice').first()).toContainText('день 4');

  // Nothing found: say so; a typed name is a new exercise.
  await search.fill('скакалка');
  await expect(pick).toContainText('В программе и истории такого нет — впишите название ниже');
  await name.fill('Скакалка');
  await expect(pick.locator('[aria-pressed="true"]')).toHaveCount(0);

  // Typing another name below takes the highlight away from a chip.
  await search.fill('');
  await pick.getByRole('button', { name: 'Пресс в тренажере', exact: true }).click();
  await name.fill('Пресс в тренажере с паузой');
  await expect(pick.locator('.seg button[aria-pressed="true"]')).toHaveCount(0);

  // «Готово» adds it as before.
  await pick.getByRole('button', { name: 'Пресс в тренажере', exact: true }).click();
  await sheet.getByRole('button', { name: 'Готово' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.slot-edit', { hasText: 'Пресс в тренажере' }).last()).toBeVisible();
});
