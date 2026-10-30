// Exercise search for «Заменить» / «Добавить упражнение» and the permanent swap in the program:
// a known exercise is found with its own series key, so its history continues; nothing is ever
// joined by similarity alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exerciseIndex, searchExercises, findExact, knownKeys, setMainOption } from '../../app/js/lib/exercises.js';
import { parseProgramText, optionsFromNames, reuseKeys } from '../../app/js/lib/program.js';
import { buildExposures } from '../../app/js/lib/plateau.js';
import { createStore } from '../../app/js/data/store.js';
import { memoryAdapter } from '../../app/js/data/db.js';

const PROGRAM = parseProgramText(`День 1
- Подтягивания прямым хватом [pullup]
- Пресс в тренажере [iso]
День 2
- Разведения гантелей в стороны [iso] шаг=1
- Гиперэкстензия в тренажере [iso] / Гиперэкстензия с весом
День 3
- Концентрированное сгибание на бицепс [iso] шаг=2
- Скручивание на блоке («молитва») [iso]`).program;
const slot = (p, name) => p.days.flatMap((d) => d.slots).find((s) => s.options[0].name === name);

// Workouts as the store keeps them: one item per exercise, sets under the item's series key.
function history(entries) {
  const sessions = [];
  const sets = [];
  entries.forEach(([date, key, name, weights, item = {}], i) => {
    const id = `s${i}`;
    sessions.push({ id, date, week: 2, day: 1, status: 'done', startedAt: i, items: [{ slotId: `x${i}`, seriesKey: key, name, category: 'iso', step: 2.5, options: [{ key, name }], ...item }] });
    weights.forEach((w, j) => sets.push({ id: `${id}-${j}`, sessionId: id, slotId: `x${i}`, seriesKey: key, exercise: name, setNo: j + 1, weight: w, reps: 10, rir: 2, drop: false, deleted: false }));
  });
  return { sessions, series: buildExposures(sessions, sets) };
}

function index(entries = [], aliases = []) {
  const { sessions, series } = history(entries);
  return exerciseIndex({ program: PROGRAM, series, sessions, aliases });
}

test('index: every program variant and every exercise with sets, one entry per series; program name, category and step win', () => {
  const idx = index([
    ['2026-10-16', 'press-v-trenazhere', 'Пресс в тренажере', [40, 42.5]],
    ['2026-10-29', 'press-v-trenazhere', 'Пресс в тренажере', [45, 47.5, 47.5]],
    ['2026-09-01', 'zhim-gantelej-sidya', 'Жим гантелей сидя', [24, 24], { category: 'base', step: 2 }],
  ]);
  assert.equal(new Set(idx.map((e) => e.key)).size, idx.length);
  const press = idx.find((e) => e.key === 'press-v-trenazhere');
  assert.deepEqual([press.name, press.category, press.step, press.count, press.last.date, press.last.weight, press.inProgram], ['Пресс в тренажере', 'iso', 2.5, 2, '2026-10-29', 47.5, true]);
  assert.deepEqual(press.where.map((w) => [w.day, w.main]), [[1, true]]);
  // Done before but not in the program: found with the category and step of its last workout.
  const old = idx.find((e) => e.key === 'zhim-gantelej-sidya');
  assert.deepEqual([old.name, old.category, old.step, old.inProgram, old.where], ['Жим гантелей сидя', 'base', 2, false, []]);
  // Alternatives are their own entries; never done yet = no last workout.
  const alt = idx.find((e) => e.key === 'giperekstenziya-s-vesom');
  assert.deepEqual([alt.where.map((w) => w.main), alt.last, alt.count], [[false], null, 0]);
  assert.equal(idx.find((e) => e.key === 'razvedeniya-ganteley-v-storony').step, 1);
});

test('search: exact, then start of the name, then all words, then part of a word; ties — in the program first, then the most recent', () => {
  const idx = index([
    ['2026-10-01', 'giperekstenziya-staraya', 'Гиперэкстензия старая', [20]],
    ['2026-10-20', 'giperekstenziya-v-trenazhere', 'Гиперэкстензия в тренажере', [50]],
  ]);
  assert.equal(searchExercises(idx, 'гиперэкстензия в тренажере')[0].score, 100);
  const g = searchExercises(idx, 'гипер');
  assert.deepEqual(g.map((e) => e.key), ['giperekstenziya-v-trenazhere', 'giperekstenziya-s-vesom', 'giperekstenziya-staraya']);
  assert.ok(g.every((e) => e.score === 80));
  // Words in any order, each as the start of a word, other endings too.
  assert.equal(searchExercises(idx, 'тренаж гипер')[0].key, 'giperekstenziya-v-trenazhere');
  assert.equal(searchExercises(idx, 'разведение гантели')[0].key, 'razvedeniya-ganteley-v-storony');
  assert.equal(searchExercises(idx, 'скручивания')[0].key, 'skruchivanie-na-bloke-molitva');
  // Case, «ё» and quotes do not matter.
  assert.equal(searchExercises(idx, 'СКРУЧИВАНИЕ НА БЛОКЕ (МОЛИТВА)')[0].score, 100);
  // Nothing typed — nothing found; `exclude` hides the current exercise.
  assert.deepEqual(searchExercises(idx, '  '), []);
  assert.equal(searchExercises(idx, 'пресс', { exclude: ['press-v-trenazhere'] }).some((e) => e.key === 'press-v-trenazhere'), false);
});

test('search: one typo and synonyms only rank results; they rank below real matches', () => {
  const idx = index();
  const typo = searchExercises(idx, 'гипрэкстензия');
  assert.ok(typo.length >= 2 && typo.every((e) => e.key.startsWith('giperekstenziya') && e.score === 20));
  // A wrong ending is the same word: ranked with the real matches.
  assert.equal(searchExercises(idx, 'гиперэкстензя')[0].score, 60);
  assert.equal(searchExercises(idx, 'концентрированое')[0].key, 'koncentrirovannoe-sgibanie-na-biceps');
  // «бицепс» finds the curl by its name; «пресс» finds the crunch only as a synonym, below the press.
  assert.equal(searchExercises(idx, 'бицепс')[0].key, 'koncentrirovannoe-sgibanie-na-biceps');
  const abs = searchExercises(idx, 'пресс');
  assert.deepEqual(abs.map((e) => [e.key, e.score]), [['press-v-trenazhere', 80], ['skruchivanie-na-bloke-molitva', 30]]);
  // Short words are not «corrected»: no match for an unrelated name.
  assert.deepEqual(searchExercises(idx, 'жимм'), []);
});

test('exact name: case, «ё», quotes and the series key it would get count as the same exercise — never a new one', () => {
  const idx = index();
  assert.equal(findExact(idx, '  пресс в  ТРЕНАЖЁРЕ ').key, 'press-v-trenazhere');
  assert.equal(findExact(idx, 'Скручивание на блоке "молитва"').key, 'skruchivanie-na-bloke-molitva');
  assert.equal(findExact(idx, 'Пресс в тренажере!').key, 'press-v-trenazhere', 'the same series key');
  assert.equal(findExact(idx, 'Пресс на фитболе'), null);
  assert.equal(findExact(idx, ''), null);
});

test('a name confirmed as the same exercise finds that series — only once its own sets are gone', () => {
  const alias = [{ name: 'Скручивания в тренажере', key: 'press-v-trenazhere', fromKey: 'skruchivaniya-v-trenazhere' }];
  const before = index([['2026-10-20', 'skruchivaniya-v-trenazhere', 'Скручивания в тренажере', [40]]], alias);
  assert.equal(findExact(before, 'Скручивания в тренажере').key, 'skruchivaniya-v-trenazhere');
  assert.deepEqual(before.find((e) => e.key === 'press-v-trenazhere').names, ['Пресс в тренажере']);
  const after = index([['2026-10-20', 'press-v-trenazhere', 'Пресс в тренажере', [40]]], alias);
  assert.equal(findExact(after, 'Скручивания в тренажере').key, 'press-v-trenazhere');
  const [hit] = searchExercises(after, 'скручивания в тренажере');
  assert.deepEqual([hit.key, hit.score, hit.matched], ['press-v-trenazhere', 100, 'Скручивания в тренажере']);
  assert.equal(knownKeys(after).get('скручивания в тренажере'), 'press-v-trenazhere');
});

test('permanent swap: the choice becomes the main variant, the old one stays an alternative (or goes); nothing else changes', () => {
  const p = structuredClone(PROGRAM);
  const id = slot(p, 'Скручивание на блоке («молитва»)').id;
  const press = { key: 'press-v-trenazhere', name: 'Пресс в тренажере' };
  const next = setMainOption(p, id, press);
  assert.deepEqual(next.days[2].slots.find((s) => s.id === id).options.map((o) => o.key), ['press-v-trenazhere', 'skruchivanie-na-bloke-molitva']);
  assert.deepEqual(p, PROGRAM, 'the input is not changed');
  const others = (x) => x.days.flatMap((d) => d.slots).filter((s) => s.id !== id);
  assert.deepEqual(others(next), others(p));
  // Without the old one: it leaves the program (its history stays — it is in the sets).
  const only = setMainOption(p, id, press, { keepOld: false });
  assert.deepEqual(only.days[2].slots.find((s) => s.id === id).options, [press]);
  // An alternative of the slot becomes the main one, the old main its alternative; no duplicate keys.
  const hid = slot(p, 'Гиперэкстензия в тренажере').id;
  const swapped = setMainOption(p, hid, { key: 'giperekstenziya-s-vesom', name: 'Гиперэкстензия с весом' });
  assert.deepEqual(swapped.days[1].slots.find((s) => s.id === hid).options.map((o) => o.key), ['giperekstenziya-s-vesom', 'giperekstenziya-v-trenazhere']);
  // A found exercise brings its category and weight step to the slot.
  const curl = slot(p, 'Концентрированное сгибание на бицепс').id;
  const cable = setMainOption(p, curl, { key: 'sgibanie-ruk-na-nizhnem-bloke', name: 'Сгибание рук на нижнем блоке' }, { category: 'iso', step: 2.5 });
  assert.deepEqual([cable.days[2].slots.find((s) => s.id === curl).step], [2.5]);
  assert.equal(setMainOption(p, 'nope', press), null);
});

test('program editor: a variant typed with the name of an exercise done elsewhere joins that series instead of keeping the old key', () => {
  const old = [{ key: 'skruchivanie-na-bloke-molitva', name: 'Скручивание на блоке («молитва»)' }];
  // Before v1.4 renaming the main variant kept its key: the press history did not show up.
  assert.deepEqual(optionsFromNames(['Пресс в тренажере'], old), [{ key: 'skruchivanie-na-bloke-molitva', name: 'Пресс в тренажере' }]);
  const known = knownKeys(index([['2026-10-16', 'press-v-trenazhere', 'Пресс в тренажере', [40]]]));
  assert.deepEqual(optionsFromNames(['Пресс в тренажере', 'Скручивание на блоке («молитва»)'], old, known), [
    { key: 'press-v-trenazhere', name: 'Пресс в тренажере' },
    { key: 'skruchivanie-na-bloke-molitva', name: 'Скручивание на блоке («молитва»)' },
  ]);
  // A plain rename to an unknown name still keeps the history; the slot's own names come first.
  assert.deepEqual(optionsFromNames(['Скручивание на верхнем блоке'], old, known), [{ key: 'skruchivanie-na-bloke-molitva', name: 'Скручивание на верхнем блоке' }]);
  assert.deepEqual(optionsFromNames(['Скручивание на блоке («молитва»)'], old, new Map([['скручивание на блоке (молитва)', 'other']])), old);
  // Program text import: the same rule.
  const text = parseProgramText('День 3\n- Скручивания в тренажере [iso]').program;
  const kept = reuseKeys(text, PROGRAM, new Map([['скручивания в тренажере', 'press-v-trenazhere']]));
  assert.equal(kept.days[0].slots[0].options[0].key, 'press-v-trenazhere');
});

test('«Добавить упражнение»: a found exercise keeps its series key and weight step', async () => {
  const store = createStore(memoryAdapter(), { now: () => 1_793_400_000_000 });
  await store.load();
  await store.saveProgram(PROGRAM);
  const s = await store.startSession({ cycle: 2, week: 2, day: 1, date: '2026-11-01' });
  const found = await store.addItem(s.id, { name: 'Разведения гантелей в стороны', key: 'razvedeniya-ganteley-v-storony', category: 'iso', step: 1 });
  assert.deepEqual([found.seriesKey, found.step, found.adhoc], ['razvedeniya-ganteley-v-storony', 1, true]);
  const fresh = await store.addItem(s.id, { name: 'Пресс на фитболе', category: 'iso' });
  assert.deepEqual([fresh.seriesKey, fresh.step], ['press-na-fitbole', 2.5]);
});
