// v1.4: RIR is part of every set. «Записать» with no RIR shows one short notice «Не указан RIR» and
// records nothing; the typed weight and reps stay; no dialog, no «save anyway». RIR 0 is a value.
// Old sets recorded without RIR still read as before. Synthetic data (the owner-like 16.10 workout).
import { test, expect } from '@playwright/test';
import { startStatic } from '../helpers/servers.js';
import { ready, dock, logButton, seedOwner } from './helpers.js';

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

async function gym(page) {
  await page.goto(base);
  await ready(page);
  await seedOwner(page);
  await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 2, day: 1 }));
  await dock(page).waitFor();
}
const rirGroup = (page) => dock(page).getByRole('group', { name: 'Фактический RIR' });
const toast = (page) => page.locator('.toast');
const activeSets = (page) =>
  page.evaluate(() => {
    const { store } = window.__trainer;
    const s = store.liveSessions().find((x) => x.status === 'active');
    return store.setsOf(s.id).map((x) => [x.weight, x.reps, x.rir]);
  });

test('empty RIR: «Не указан RIR», nothing recorded, weight and reps kept; a second tap changes nothing; no dialog', async ({ page }) => {
  await gym(page);
  // Old sets without RIR read as before: «Прошлый раз» from 16.10.
  await expect(page.locator('.dock__prev')).toHaveAttribute('aria-label', 'Прошлый раз, 16 октября: 20×6, 20×6, 20×6');
  await page.getByRole('button', { name: 'Увеличить: Вес' }).click();
  await page.getByRole('button', { name: 'Уменьшить: Повторения' }).click();
  await expect(logButton(page)).toContainText('22,5 × 5');

  await logButton(page).click();
  await expect(toast(page)).toHaveText('Не указан RIR');
  await expect(rirGroup(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /без RIR|Подтвердить/ })).toHaveCount(0);
  expect(await activeSets(page)).toEqual([]);
  await expect(logButton(page)).toContainText('22,5 × 5'); // typed values stay

  await logButton(page).click(); // pressed again
  await logButton(page).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await activeSets(page)).toEqual([]);
  await expect(logButton(page)).toContainText('22,5 × 5');
  await expect(dock(page)).toContainText('Подход 1 из 3');

  // Picking a RIR clears the mark; the set is recorded with exactly the typed values.
  await rirGroup(page).getByRole('button', { name: '1', exact: true }).click();
  await expect(rirGroup(page)).not.toHaveAttribute('aria-invalid', 'true');
  await logButton(page).click();
  await expect.poll(() => activeSets(page)).toEqual([[22.5, 5, 1]]);
  await expect(dock(page)).toContainText('Подход 1 записан');
  // The next set starts without a RIR again: it is chosen for every set.
  await expect(rirGroup(page).locator('button[aria-pressed="true"]')).toHaveCount(0);
});

test('RIR 0 is a value: recorded as 0, not as missing; a normal set records as before', async ({ page }) => {
  await gym(page);
  await rirGroup(page).getByRole('button', { name: '0', exact: true }).click();
  await logButton(page).click();
  await expect.poll(() => activeSets(page)).toEqual([[20, 6, 0]]);
  await expect(toast(page).filter({ hasText: 'Не указан RIR' })).toHaveCount(0);
  await page.waitForTimeout(1600); // a real second set, not a double tap
  await rirGroup(page).getByRole('button', { name: '2', exact: true }).click();
  await logButton(page).click();
  await expect.poll(() => activeSets(page)).toEqual([[20, 6, 0], [20, 6, 2]]);
  // Shown in the list with its RIR, 0 included.
  await expect(page.locator('.panel .set__nums').first()).toContainText('0');
});

test('the RIR notice also guards a drafted set after a relaunch: the draft keeps weight and reps, still no set', async ({ page }) => {
  await gym(page);
  await page.getByRole('button', { name: 'Увеличить: Вес' }).click();
  await page.reload();
  await ready(page);
  await dock(page).waitFor();
  await expect(logButton(page)).toContainText('22,5 × 6');
  await logButton(page).click();
  await expect(toast(page)).toHaveText('Не указан RIR');
  expect(await activeSets(page)).toEqual([]);
});
