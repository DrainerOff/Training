// Walks the real app through its screens in a browser and tests element-hiding selectors
// against the DOM of each screen. Used by the live check (tools/blockers/check.mjs) and the
// snapshot test (tests/e2e/blockers.spec.js).

import { session1018, sets1018 } from '../../tests/helpers/workout-2026-10-18.js';
import { convertSnapshot } from '../../tests/helpers/legacy-import.js';

// Runs in the page: which selectors match at least one element right now.
export function matchSelectors(page, selectors) {
  return page.evaluate((list) => {
    const hits = [];
    for (const sel of list) {
      let found;
      try {
        found = document.querySelectorAll(sel);
      } catch {
        continue; // extended syntax (:has-text, :-abp-contains, …) that plain CSS can't parse
      }
      if (found.length) {
        const el = found[0];
        const what = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.classList.length ? `.${[...el.classList].join('.')}` : ''}`;
        hits.push({ selector: sel, element: what, text: (el.textContent || '').trim().slice(0, 60) });
      }
    }
    return hits;
  }, selectors);
}

// Visits every main screen; calls `visit(name)` on each so the caller can scan the DOM.
export async function walkScreens(page, url, visit) {
  await page.goto(url);
  await page.waitForFunction(() => window.__trainer?.store.state.loaded && !document.getElementById('boot'));
  await page.getByText('Перенесите программу').waitFor();
  await visit('home (first launch)');
  // A phone like the owner's (synthetic values): the program, the 16.10 workout and the
  // 18.10.2026 workout as recorded — the one-time correction card appears.
  const owner = convertSnapshot();
  await page.evaluate(({ program, sessions, sets }) => window.__trainer.store.applyRemote({ program, sessions, sets }), { program: owner.program, sessions: [...owner.sessions, session1018()], sets: [...owner.sets, ...sets1018()] });
  await page.getByText('Исправить тренировку 18 октября').waitFor();
  await visit('home (correction card)');
  await page.getByRole('button', { name: 'Позже' }).click();

  await page.getByRole('button', { name: 'Начать тренировку' }).click();
  await page.locator('.dock').waitFor();
  await visit('workout');
  await page.locator('.dock .btn--primary').click();
  await page.waitForTimeout(300);
  await visit('workout after a set (undo toast)');
  await page.locator('.panel .setup').click();
  await page.getByRole('dialog').getByLabel('Настройки тренажёра').fill('сиденье 5, ручки 3');
  await visit('variant settings sheet');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await visit('workout with settings and a set note icon');
  await page.getByRole('button', { name: 'Заменить' }).first().click();
  await page.getByRole('dialog').waitFor();
  await visit('swap sheet');
  await page.getByRole('dialog').getByPlaceholder('Название').fill('Жим в Смите');
  await page.getByRole('dialog').getByRole('button', { name: 'Заменить на «Жим в Смите»' }).click();
  await page.getByText('Записал не то упражнение').waitFor();
  await visit('swap: move the recorded sets?');
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);

  // During a workout the tab bar is hidden; the workout menu leads to the other sections.
  await page.getByRole('button', { name: 'Меню тренировки' }).click();
  await visit('workout menu');
  await page.getByRole('group', { name: 'Разделы' }).getByRole('button', { name: 'Прогресс' }).click();
  await page.waitForTimeout(200);
  await visit('tab Прогресс');
  await page.getByRole('group', { name: 'Раздел' }).getByRole('button', { name: 'Рекорды' }).click();
  await page.waitForTimeout(200);
  await visit('records');
  await page.locator('.rows .row').last().click();
  await page.waitForTimeout(200);
  await visit('records: one exercise');
  await page.getByRole('button', { name: 'Добавить рекорд вручную' }).click();
  await page.getByRole('dialog').waitFor();
  await visit('records: entry sheet');
  await page.getByRole('button', { name: /^Упражнение:/ }).click();
  await page.waitForTimeout(200);
  await visit('records: exercise picker');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('group', { name: 'Раздел' }).getByRole('button', { name: 'Прогресс' }).click();
  for (const tab of ['История', 'Тело']) {
    await page.locator('.tabbar').getByRole('button', { name: tab }).click();
    await page.waitForTimeout(200);
    await visit(`tab ${tab}`);
  }
  await page.locator('.tabbar').getByRole('button', { name: 'История' }).click();
  await page.locator('.rows .row').last().click();
  await page.waitForTimeout(200);
  await visit('history: a past workout');
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.locator('.tabbar').getByRole('button', { name: 'Прогресс' }).click();
  await page.locator('.rows .row').first().click();
  await page.waitForTimeout(200);
  await visit('progress: one exercise');
  await page.evaluate(() => window.__trainer && import('./js/ui/core.js').then(({ app }) => app.ui.go({ view: { type: 'settings' } })));
  await page.getByText('Google Таблица').first().waitFor();
  await visit('settings');
}

// The screens boot.js draws: the diagnostic screen (IndexedDB made to hang) and the app in
// temporary mode with its warning banner.
export async function walkBootScreens(page, url, visit) {
  await page.addInitScript(() => {
    window.__TRAINER_IDB_TIMEOUT_MS = 200;
    indexedDB.open = () => ({});
  });
  await page.goto(url);
  await page.locator('.diag h1').waitFor();
  await page.waitForTimeout(300); // the report fills in
  await visit('boot diagnostic screen');
  await page.getByRole('button', { name: 'Продолжить без сохранения' }).click();
  await page.locator('.temp-mode').waitFor();
  await visit('temporary-mode banner');
}
