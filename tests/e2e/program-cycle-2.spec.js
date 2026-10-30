// The program for cycle 2, done in the program editor exactly as the owner will do it on the iPhone:
// «Вертикальная тяга к груди» moves from day 3 (slot 6) to day 4 (place 4), «Жим сидя на плечи» from
// day 4 (slot 7) to day 3 (place 5). The moved exercises come back through «Добавить упражнение» →
// «Быстрый выбор», so they keep their series keys; the coach note is copied from the deleted slot
// into the new one. Everything else in the program stays as it was. Synthetic sets only.
import { test, expect } from '@playwright/test';
import { startStatic, startFakeGas } from '../helpers/servers.js';
import { programNow } from '../helpers/workout-2026-10-20.js';
import { FIX_2026_10_20, FIX_2026_10_30_STEPS, programAfterFix } from '../../app/js/data/fixes.js';
import { itemsForDay } from '../../app/js/lib/planner.js';
import { ready, connectSync, dock } from './helpers.js';

const VERT = { key: 'vertikalnaya-tyaga-k-grudi', name: 'Вертикальная тяга к груди' };
const PRESS = { key: 'zhim-sidya-na-plechi', name: 'Жим сидя на плечи' };

// The program as in the sheet since v1.4.0: the 18.10, 20.10 and 22.10 corrections and the dumbbell steps.
function programV14() {
  return { ...programAfterFix(programAfterFix(programNow(), FIX_2026_10_20), FIX_2026_10_30_STEPS), updatedAt: Date.UTC(2026, 9, 30, 17, 0, 0) };
}

// The target program, main name first, alternatives after « / », in order.
const WANT = {
  1: ['Подтягивания прямым хватом', 'Наклонный жим: Hammer - наклон / Наклонный жим: Гантели - наклон', 'Горизонтальная тяга блока',
    'Жим штанги лежа: Штанга - наклон / Жим штанги лежа: Штанга - горизонт', 'Сгибание рук на нижнем блоке', 'Разгибание рук из-за головы на блоке', 'Пресс в тренажере'],
  2: ['Подтягивания обратным хватом', 'Маятниковый присед', 'Гиперэкстензия в тренажере / Гиперэкстензия с весом', 'Разведения гантелей в стороны',
    'Кроссовер на заднюю дельту / Обратная бабочка двумя руками / Обратная бабочка одной рукой', 'Тяга штанги к подбородку в Смите / Подъем EZ-грифа перед собой', 'Икры в жиме ногами'],
  3: ['Подтягивания прямым хватом', 'Концентрированное сгибание на бицепс', 'Разгибание рук из-за головы на блоке', 'Горизонтальная тяга в тренажере',
    'Жим сидя на плечи', 'Сведение рук в тренажере (бабочка)', 'Пресс в тренажере / Скручивание на блоке («молитва»)'],
  4: ['Подтягивания нейтральным хватом', 'Разгибание ног в тренажере', 'Сгибание ног лежа', 'Вертикальная тяга к груди', 'Гиперэкстензия (медленный негатив)',
    'Тяга штанги к подбородку в Смите / Тяга штанги к подбородку', 'Разведения гантелей на заднюю дельту', 'Икры в жиме ногами'],
};
// Sets per workout: heavy week, light week.
const SETS = { 1: [23, 21], 2: [22, 21], 3: [22, 21], 4: [25, 24] };

// Cycle 1, weeks 2 and 3 of days 3 and 4 from the old program; synthetic sets of the two moved exercises.
function history(program) {
  const sessions = [];
  const sets = [];
  const add = (id, date, week, day, slotId, rows) => {
    const start = Date.parse(`${date}T12:00:00Z`);
    const items = itemsForDay(program, day);
    const item = items.find((i) => i.slotId === slotId);
    rows.forEach(([weight, reps, rir], i) => sets.push({
      id: `${id}-${i}`, sessionId: id, slotId, seriesKey: item.seriesKey, exercise: item.name, setNo: i + 1, weight, reps, rir,
      date, cycle: 1, week, day, drop: false, pain: false, technique: false, note: '', deleted: false, createdAt: start + i * 180000, updatedAt: start + i * 180000,
    }));
    sessions.push({ id, date, cycle: 1, week, day, status: 'done', note: '', startedAt: start, finishedAt: start + 3600000, items, updatedAt: start + 3600000, deleted: false });
  };
  add('ss-d3w2', '2026-10-20', 2, 3, 'D3-06', [[50, 10, 2], [50, 10, 2], [50, 10, 1], [50, 10, 1]]);
  add('ss-d4w2', '2026-10-22', 2, 4, 'D4-07', [[30, 10, 2], [30, 9, 2], [30, 9, 1]]);
  add('ss-d3w3', '2026-10-29', 3, 3, 'D3-06', [[55, 8, 1], [55, 7, 1], [55, 7, 1], [55, 7, 0]]);
  add('ss-d4w3', '2026-10-31', 3, 4, 'D4-07', [[32.5, 8, 1], [32.5, 7, 1], [32.5, 7, 0]]);
  return { sessions, sets };
}

let web;
let base;
test.beforeAll(async () => {
  web = await startStatic({ port: 0 });
  base = `http://127.0.0.1:${web.address().port}/`;
});
test.afterAll(() => web?.close());

const execUrl = (gas) => `http://127.0.0.1:${gas.server.address().port}/exec`;
const sheetProgram = async (gas) => {
  const dump = await (await fetch(`http://127.0.0.1:${gas.server.address().port}/__state`)).json();
  const [head, ...rows] = dump.App_Program;
  return rows.filter((r) => String(r[3]).trim()).map((r) => Object.fromEntries(head.map((h, i) => [h, String(r[i])])));
};
const appProgram = (page) => page.evaluate(() => structuredClone(window.__trainer.store.state.program));
const keysOf = (p) => p.days.flatMap((d) => d.slots.flatMap((s) => s.options.map((o) => o.key))).sort();
const slotOf = (p, key) => p.days.flatMap((d) => d.slots.map((s) => ({ ...s, day: d.day }))).find((s) => s.options[0].key === key);
const editorRow = (page, name) => page.locator('.slot-edit', { hasText: name });

test('moving the two exercises in the program editor keeps keys, notes, steps and history; the sheet gets the same program', async ({ page }) => {
  const gas = await startFakeGas({ port: 0 });
  try {
    await page.clock.setFixedTime(new Date('2026-11-01T10:00:00+03:00'));
    await page.goto(base);
    await ready(page);
    const start = programV14();
    await connectSync(page, execUrl(gas), gas.token);
    await page.evaluate(async (data) => {
      const { store, sync } = window.__trainer;
      await store.applyRemote(data, { queue: true });
      await sync.syncNow();
    }, { program: start, ...history(start) });
    const before = await appProgram(page);
    const notes = { vert: slotOf(before, VERT.key).note, press: slotOf(before, PRESS.key).note };
    expect(notes.vert).not.toBe('');
    expect(notes.press).not.toBe('');

    // Настройки → «Редактировать программу».
    await page.getByRole('button', { name: 'Настройки' }).click();
    await page.getByRole('button', { name: /Редактировать программу/ }).click();
    const days = page.getByRole('group', { name: 'День' });
    const sheet = page.getByRole('dialog', { name: 'Упражнение' });
    const fresh = page.getByRole('dialog', { name: 'Новое упражнение' });

    // 1. День 4: «Жим сидя на плечи» → copy the note → «Удалить».
    await days.getByRole('button', { name: 'День 4' }).click();
    await editorRow(page, PRESS.name).locator('button').first().click();
    expect(await sheet.getByLabel('Заметка тренера').inputValue()).toBe(notes.press);
    await sheet.getByRole('button', { name: 'Удалить' }).click();
    await expect(editorRow(page, PRESS.name)).toHaveCount(0);

    // 2. День 3: «Добавить упражнение» → «Быстрый выбор» → «Жим сидя на плечи», paste the note → «Готово».
    await days.getByRole('button', { name: 'День 3' }).click();
    await page.getByRole('button', { name: 'Добавить упражнение' }).click();
    await fresh.locator('.sheet__section', { hasText: 'Быстрый выбор' }).getByRole('button', { name: PRESS.name, exact: true }).click();
    await expect(fresh).toContainText(`«${PRESS.name}» уже есть (2 тренировки`);
    await expect(fresh.getByRole('group', { name: 'Категория' }).getByRole('button', { name: 'Изоляция' })).toHaveAttribute('aria-pressed', 'true');
    await expect(fresh.getByRole('group', { name: 'Шаг веса' }).getByRole('button', { name: '2,5' })).toHaveAttribute('aria-pressed', 'true');
    await fresh.getByLabel('Заметка тренера').fill(notes.press);
    await fresh.getByRole('button', { name: 'Готово' }).click();

    // 3. День 3: «Вертикальная тяга к груди» → copy the note → «Удалить»; then «Выше» twice on the press.
    await editorRow(page, VERT.name).locator('button').first().click();
    expect(await sheet.getByLabel('Заметка тренера').inputValue()).toBe(notes.vert);
    await sheet.getByRole('button', { name: 'Удалить' }).click();
    for (let i = 0; i < 2; i++) await editorRow(page, PRESS.name).getByRole('button', { name: 'Выше' }).click();
    await expect(page.locator('.slot-edit').nth(4)).toContainText(PRESS.name);

    // 4. День 4: «Добавить упражнение» → «Вертикальная тяга к груди», paste the note → «Готово»; «Выше» four times.
    await days.getByRole('button', { name: 'День 4' }).click();
    await page.getByRole('button', { name: 'Добавить упражнение' }).click();
    await fresh.locator('.sheet__section', { hasText: 'Быстрый выбор' }).getByRole('button', { name: VERT.name, exact: true }).click();
    await expect(fresh).toContainText(`«${VERT.name}» уже есть (2 тренировки`);
    await expect(fresh.getByRole('group', { name: 'Категория' }).getByRole('button', { name: 'Базовое' })).toHaveAttribute('aria-pressed', 'true');
    await fresh.getByLabel('Заметка тренера').fill(notes.vert);
    await fresh.getByRole('button', { name: 'Готово' }).click();
    for (let i = 0; i < 4; i++) await editorRow(page, VERT.name).getByRole('button', { name: 'Выше' }).click();
    await expect(page.locator('.slot-edit').nth(3)).toContainText(VERT.name);

    // 5. «Сохранить программу».
    await page.getByRole('button', { name: 'Сохранить программу' }).click();
    await expect(page.getByText('Программа сохранена')).toBeVisible();
    await page.evaluate(() => window.__trainer.sync.syncNow());
    const after = await appProgram(page);

    // The order of all four days is the target one.
    for (const d of after.days) expect(d.slots.map((s) => s.options.map((o) => o.name).join(' / '))).toEqual(WANT[d.day]);
    // Same series keys, none new; the two moved ones keep theirs.
    expect(keysOf(after)).toEqual(keysOf(before));
    expect(slotOf(after, VERT.key)).toMatchObject({ day: 4, category: 'base', step: 2.5, overrides: {}, note: notes.vert, options: [VERT] });
    expect(slotOf(after, PRESS.key)).toMatchObject({ day: 3, category: 'iso', step: 2.5, overrides: {}, note: notes.press, options: [PRESS] });
    // Every other slot is untouched: id, category, step, overrides, note, options.
    const others = (p) => p.days.flatMap((d) => d.slots).filter((s) => ![VERT.key, PRESS.key].includes(s.options[0].key))
      .map((s) => JSON.stringify(s)).sort();
    expect(others(after)).toEqual(others(before));
    // Sets per workout on heavy and light weeks.
    const totals = await page.evaluate(async () => {
      const { targetFor } = await import('./js/lib/program.js');
      const p = window.__trainer.store.state.program;
      return Object.fromEntries(p.days.map((d) => [d.day, [3, 1].map((w) => d.slots.reduce((t, s) => t + targetFor(s, w).sets, 0))]));
    });
    expect(totals).toEqual(SETS);

    // App_Program is the program of the app, row by row.
    const rows = await sheetProgram(gas);
    const expected = after.days.flatMap((d) => d.slots.map((s, i) => ({
      day: String(d.day), order: String(i + 1), exercise: s.options[0].name, alternatives: s.options.slice(1).map((o) => o.name).join(' / '),
      category: s.category, step: String(s.step), note: s.note, slot_id: s.id, keys: s.options.map((o) => o.key).join(' / '),
    })));
    expect(rows.map((r) => ({ day: r.day, order: r.order, exercise: r.exercise, alternatives: r.alternatives, category: r.category, step: r.step, note: r.note, slot_id: r.slot_id, keys: r.keys })))
      .toEqual(expected);
    expect(rows.find((r) => r.exercise === 'Икры в жиме ногами' && r.day === '4')).toMatchObject({ w1: '3x10-12', w2: '3x10-12', w3: '3x10-12' });

    // Cycle 2, week 2, day 4: the vertical row has its day 3 history and a same-week recommendation; 4 sets.
    await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Тренировка' }).click();
    await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 2, day: 4, date: '2026-11-05' }));
    await page.getByRole('button', { name: /^Вертикальная тяга к груди/ }).click();
    await expect(page.locator('.dock__prev')).toHaveAttribute('aria-label', /^Прошлый раз, 20 октября: 50×10/);
    await expect(page.locator('.dock__rec')).toHaveAttribute('data-kind', 'up');
    await expect(dock(page)).toContainText('Подход 1 из 4');
    await page.evaluate(async () => {
      const { store } = window.__trainer;
      await store.deleteSession(store.liveSessions().find((s) => s.status === 'active').id);
    });

    // Cycle 2, week 1, day 3: the seated press is at place 5 with its day 4 history, light week «3 подхода, RIR 2–3».
    await page.evaluate(() => window.__trainer.store.startSession({ cycle: 2, week: 1, day: 3, date: '2026-11-03' }));
    await expect(page.locator('.wk-sub')).toHaveText('Цикл 2, лёгкая неделя 1: 3 подхода, RIR 2–⁠3');
    await page.getByRole('button', { name: /^Жим сидя на плечи/ }).click();
    await expect(page.locator('.dock__prev')).toHaveAttribute('aria-label', /31 октября: 32,5×8/);
    await expect(page.locator('.dock__rec')).toHaveAttribute('data-kind', 'estimate');
    await expect(dock(page)).toContainText('Подход 1 из 3');
  } finally {
    gas.server.close();
  }
});
