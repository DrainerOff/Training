import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetFor, parseProgramText, programToText, starterProgram, normalizeProgram, findOptionByName } from '../../app/js/lib/program.js';

test('light week: 3 sets for everything, RIR 4–5', () => {
  for (const category of ['base', 'hammer', 'iso', 'calves']) {
    const t = targetFor({ category }, 1);
    assert.equal(t.sets, 3, category);
    assert.deepEqual(t.rir, [4, 5]);
    assert.equal(t.drop, 0);
  }
});

test('heavy weeks: base 4 sets, hammer/pull-ups/isolation 3 sets', () => {
  assert.equal(targetFor({ category: 'base' }, 2).sets, 4);
  assert.equal(targetFor({ category: 'base' }, 3).sets, 4);
  assert.equal(targetFor({ category: 'hammer' }, 2).sets, 3);
  assert.equal(targetFor({ category: 'iso' }, 3).sets, 3);
  assert.equal(targetFor({ category: 'pullup' }, 3).sets, 3);
  assert.deepEqual(targetFor({ category: 'base' }, 2).reps, [8, 10]);
  assert.deepEqual(targetFor({ category: 'base' }, 2).rir, [1, 2]);
  assert.deepEqual(targetFor({ category: 'base' }, 3).reps, [6, 8]);
  assert.deepEqual(targetFor({ category: 'base' }, 3).rir, [0, 1]);
});

test('pull-ups are always 3×6; calves get a drop set only on week 3', () => {
  for (const w of [1, 2, 3]) {
    const t = targetFor({ category: 'pullup' }, w);
    assert.equal(t.sets, 3);
    assert.deepEqual(t.reps, [6, 6]);
  }
  assert.equal(targetFor({ category: 'calves' }, 2).drop, 0);
  assert.equal(targetFor({ category: 'calves' }, 3).drop, 1);
  assert.equal(targetFor({ category: 'base' }, 3).drop, 0);
});

test('per-slot overrides win over category defaults', () => {
  const t = targetFor({ category: 'iso', overrides: { 2: { sets: 3, reps: [10, 12] } } }, 2);
  assert.deepEqual(t.reps, [10, 12]);
  assert.deepEqual(t.rir, [1, 2]);
});

test('program text round-trip keeps alternatives as separate series', () => {
  const text = `День 1: Верх
- Подтягивания прямым хватом [pullup]
- Жим штанги под наклоном [base] / Горизонтальный жим штанги
- Наклонный Hammer [hammer] / Наклонный жим гантелей
- Разгибания на блоке [iso] н2=3x10-12@1-2 шаг=5

День 2
- Маятниковый присед [база]
- Икры в жиме ногами [икры]
`;
  const { program, warnings } = parseProgramText(text);
  assert.deepEqual(warnings, []);
  assert.equal(program.days.length, 2);
  assert.equal(program.days[0].title, 'Верх');
  const press = program.days[0].slots[1];
  assert.equal(press.category, 'base');
  assert.equal(press.options.length, 2);
  assert.notEqual(press.options[0].key, press.options[1].key);
  const ext = program.days[0].slots[3];
  assert.deepEqual(ext.overrides[2], { sets: 3, reps: [10, 12], rir: [1, 2] });
  assert.equal(ext.step, 5);
  assert.equal(program.days[1].slots[1].category, 'calves');

  const again = parseProgramText(programToText(program)).program;
  assert.deepEqual(
    again.days.map((d) => d.slots.map((s) => [s.category, s.options.map((o) => o.key), s.overrides, s.step])),
    program.days.map((d) => d.slots.map((s) => [s.category, s.options.map((o) => o.key), s.overrides, s.step])),
  );
});

test('missing category is flagged, not silently assumed', () => {
  const { warnings, program } = parseProgramText('День 1\n- Подъём на бицепс');
  assert.equal(program.days[0].slots[0].category, 'iso');
  assert.match(warnings[0], /категория не указана/);
});

test('starter program contains only the pull-up grips and is marked draft', () => {
  const p = starterProgram(1);
  assert.equal(p.draft, true);
  assert.deepEqual(
    p.days.map((d) => d.slots[0].options[0].name),
    ['Подтягивания прямым хватом', 'Подтягивания обратным хватом', 'Подтягивания прямым хватом', 'Подтягивания нейтральным хватом'],
  );
  // Same grip on days 1 and 3 is the same strength series.
  assert.equal(p.days[0].slots[0].options[0].key, p.days[2].slots[0].options[0].key);
});

test('normalizeProgram rejects garbage and fills defaults', () => {
  assert.equal(normalizeProgram(null), null);
  const p = normalizeProgram({ days: [{ day: 1, slots: [{ options: [{ name: 'Жим' }], category: 'nope' }] }] });
  assert.equal(p.days[0].slots[0].category, 'iso');
  assert.equal(p.days[0].slots[0].step, 2.5);
  assert.ok(p.days[0].slots[0].options[0].key);
});

test('findOptionByName ignores case and ё', () => {
  const { program } = parseProgramText('День 1\n- Сгибание ног лёжа [iso]');
  assert.ok(findOptionByName(program, 'сгибание ног лежа'));
});
