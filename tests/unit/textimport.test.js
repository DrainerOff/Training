import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResultsText, PROGRAM_PROMPT, resultsPrompt } from '../../app/js/lib/textimport.js';
import { parseProgramText, programToText, starterProgram } from '../../app/js/lib/program.js';

const { program } = parseProgramText(`День 1
- Подтягивания прямым хватом [pullup]
- Жим штанги под наклоном [base] / Горизонтальный жим штанги
- Икры в жиме ногами [calves]`);

test('parses a workout with repeats, RIR, bodyweight and drop sets', () => {
  const { sessions, errors } = parseResultsText(
    `16.10.2026 цикл 1 неделя 1 день 1
Подтягивания прямым хватом: св x6 x3
Жим штанги под наклоном: 60x10@4, 60x10@4, 62,5x9@3
Икры в жиме ногами: 100x12, дроп 70x10
# комментарий`,
    program,
  );
  assert.deepEqual(errors, []);
  assert.equal(sessions.length, 1);
  const s = sessions[0];
  assert.deepEqual([s.date, s.cycle, s.week, s.day], ['2026-10-16', 1, 1, 1]);
  assert.equal(s.items[0].sets.length, 3);
  assert.deepEqual(s.items[0].sets[0], { weight: 0, reps: 6, rir: null, drop: false });
  assert.deepEqual(s.items[1].sets[2], { weight: 62.5, reps: 9, rir: 3, drop: false });
  assert.equal(s.items[2].sets[1].drop, true);
  assert.ok(s.items.every((i) => i.known));
});

test('alternative names map to their own series key', () => {
  const { sessions } = parseResultsText('2026-10-16 ц1 н1 д1\nГоризонтальный жим штанги: 70x8', program);
  const item = sessions[0].items[0];
  const opts = program.days[0].slots[1].options;
  assert.equal(item.key, opts[1].key);
  assert.notEqual(item.key, opts[0].key);
});

test('unknown exercise is kept but flagged; bad tokens are reported with line numbers', () => {
  const { sessions, errors } = parseResultsText('16.10.2026 цикл 1 неделя 1 день 1\nМахи гантелями: 10x15, десять', program);
  assert.equal(sessions[0].items[0].known, false);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 2);
});

test('header without cycle/week/day is an error', () => {
  const { errors } = parseResultsText('16.10.2026\nЖим штанги под наклоном: 60x10', program);
  assert.match(errors[0].msg, /цикл/);
});

test('ChatGPT requests name no spreadsheet and their example parses', () => {
  const text = resultsPrompt(program);
  for (const p of [PROGRAM_PROMPT, text]) {
    assert.doesNotMatch(p, /docs\.google\.com|spreadsheets\/d\//);
    assert.match(p, /приложу/);
  }
  // The example block of the results request is valid input for the importer.
  const example = text.slice(text.indexOf('16.10.2026'), text.indexOf('\n\nПравила'));
  const { sessions, errors } = parseResultsText(example, program);
  assert.deepEqual(errors, []);
  assert.equal(sessions.length, 1);
  assert.ok(sessions[0].items.every((i) => i.known));
  assert.deepEqual(sessions[0].items[0].sets.map((x) => x.weight), [0, 5, 5]);
});

test('the results request carries this phone\'s program, but not the starter draft', () => {
  const text = resultsPrompt(program);
  assert.ok(text.endsWith(programToText(program)));
  assert.match(text, /2 — 8–10 повторений, 3 — 6–8/);
  const draft = resultsPrompt(starterProgram(0));
  assert.doesNotMatch(draft, /День 1/);
  assert.match(draft, /как в записях/);
  assert.match(resultsPrompt(null), /как в записях/);
});
