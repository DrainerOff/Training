import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetFor, parseProgramText, programToText, starterProgram, normalizeProgram, findOptionByName, phaseSummary, fmtTarget } from '../../app/js/lib/program.js';

test('light week: 3 sets for everything, RIR 2–3', () => {
  for (const category of ['base', 'hammer', 'pullup', 'iso', 'calves']) {
    const t = targetFor({ category }, 1);
    assert.equal(t.sets, 3, category);
    assert.deepEqual(t.rir, [2, 3]);
    assert.equal(t.drop, 0);
  }
  // Calves keep their own reps on week 1, the RIR comes from the week.
  assert.equal(fmtTarget(targetFor({ category: 'calves', overrides: { 1: { sets: 3, reps: [10, 12] } } }, 1)), '3 × 10–\u206012, RIR\u00a02–\u20603');
});

test('light week reps by category (v1.6.0): base and Hammer 10–12, isolation 12–15, pull-ups 6', () => {
  const reps = (category) => targetFor({ category }, 1).reps;
  assert.deepEqual(['base', 'hammer', 'iso', 'calves', 'pullup'].map(reps), [[10, 12], [10, 12], [12, 15], [12, 15], [6, 6]]);
  assert.equal(fmtTarget(targetFor({ category: 'base' }, 1)), '3 × 10–\u206012, RIR\u00a02–\u20603');
  assert.equal(fmtTarget(targetFor({ category: 'iso' }, 1)), '3 × 12–\u206015, RIR\u00a02–\u20603');
  assert.equal(fmtTarget(targetFor({ category: 'pullup' }, 1)), '3 × 6, RIR\u00a02–\u20603');
  // An unknown category is isolation; the week's own sets/reps still win.
  assert.deepEqual(targetFor({ category: 'nope' }, 1).reps, [12, 15]);
  assert.deepEqual(targetFor({ category: 'iso', overrides: { 1: { sets: 2, reps: [8, 10] } } }, 1), { sets: 2, reps: [8, 10], rir: [2, 3], drop: 0 });
  assert.equal(phaseSummary(1), '3 подхода, базовые 10–\u206012, изоляция 12–\u206015, RIR\u00a02–\u20603');
  // Heavy weeks are unchanged.
  assert.deepEqual([2, 3].map((w) => targetFor({ category: 'iso' }, w).reps), [[8, 10], [6, 8]]);
  assert.equal(phaseSummary(2), '8–\u206010 повторений, RIR\u00a01–\u20602');
});

test('the number of sets in rows does not change: base 4 on heavy weeks, pull-ups 3×6', () => {
  for (const w of [2, 3]) {
    assert.equal(targetFor({ category: 'base' }, w).sets, 4);
    assert.deepEqual([targetFor({ category: 'pullup' }, w).sets, targetFor({ category: 'pullup' }, w).reps], [3, [6, 6]]);
  }
  assert.equal(targetFor({ category: 'iso' }, 2).sets, 3);
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

test('v1.6.3: a step of 0,5 kg (small add-on weights on a cable stack) is read and written back', () => {
  const { program, warnings } = parseProgramText('День 1\n- Разводка на блоке [iso] шаг=0,5\n- Сгибания на блоке [iso] шаг=0.5\n');
  assert.deepEqual(warnings, []);
  assert.deepEqual(program.days[0].slots.map((s) => s.step), [0.5, 0.5]);
  const again = parseProgramText(programToText(program)).program;
  assert.deepEqual(again.days[0].slots.map((s) => s.step), [0.5, 0.5]);
});
