import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SAMPLE_PROGRAM = fs.readFileSync(path.join(ROOT, 'tests/fixtures/sample-program.txt'), 'utf8');
export const SAMPLE_HISTORY = fs.readFileSync(path.join(ROOT, 'tests/fixtures/sample-history.txt'), 'utf8');

export async function ready(page) {
  await page.waitForFunction(() => window.__trainer && window.__trainer.store.state.loaded);
}

// Program goes in through the real UI path (paste text → preview → confirm).
export async function importProgramViaUi(page, text = SAMPLE_PROGRAM) {
  await page.getByRole('button', { name: 'Вставить текстом' }).click();
  await page.getByPlaceholder('Вставьте программу').fill(text);
  await page.getByRole('button', { name: 'Заменить программу' }).click();
  await page.getByRole('button', { name: 'Заменить', exact: true }).click();
  await page.getByRole('button', { name: 'Начать тренировку' }).waitFor();
}

export async function seedHistory(page, text = SAMPLE_HISTORY) {
  await page.evaluate(async (t) => {
    const { store } = window.__trainer;
    const { parseResultsText } = await import('./js/lib/textimport.js');
    await store.importParsedSessions(parseResultsText(t, store.state.program).sessions);
  }, text);
}

export function state(page) {
  return page.evaluate(() => {
    const { store, sync } = window.__trainer;
    const sessions = store.liveSessions();
    const active = sessions.find((s) => s.status === 'active') || null;
    return {
      sessions: sessions.length,
      active: active && { id: active.id, cycle: active.cycle, week: active.week, day: active.day, date: active.date },
      activeSets: active ? store.setsOf(active.id).map((s) => ({ w: s.weight, r: s.reps, rir: s.rir, key: s.seriesKey, no: s.setNo, drop: s.drop })) : [],
      allSets: [...store.state.sets.values()].filter((s) => !s.deleted).length,
      outbox: store.state.outbox.size,
      sync: { ...sync.status },
    };
  });
}

export const dock = (page) => page.locator('.dock');
export const logButton = (page) => page.locator('.dock .btn--primary');

export async function logSet(page) {
  await logButton(page).click();
  // wait for the dock to re-mount with the next set number
  await page.waitForTimeout(120);
}

export async function connectSync(page, url, token) {
  await page.evaluate(async ({ url, token }) => {
    await window.__trainer.store.setKV({ sync: { url, token } });
  }, { url, token });
}
