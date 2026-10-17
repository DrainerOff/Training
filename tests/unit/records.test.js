import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performances, buildRecordBook, assess, estimate1rm, describeEvent, repProgress, recentAchievements, fmtLoad } from '../../app/js/lib/records.js';
import { convertSnapshot } from '../../app/js/data/legacy-import.js';
import { SNAPSHOT } from '../../app/js/data/gsheets-snapshot.js';

let n = 0;
function workout(date, week, key, sets, { category = 'base', flags = {} } = {}) {
  const sid = `s${++n}`;
  const slot = `sl-${key}`;
  return {
    session: { id: sid, date, week, cycle: 1, day: 1, status: 'done', items: [{ slotId: slot, seriesKey: key, category, flags }] },
    sets: sets.map((s, i) => ({
      id: `${sid}-${i}`,
      sessionId: sid,
      slotId: slot,
      seriesKey: key,
      exercise: key,
      date,
      weight: s[0],
      reps: s[1],
      rir: s[2] ?? null,
      drop: !!s.drop,
      pain: !!s.pain,
      technique: !!s.technique,
      createdAt: Date.parse(date) + i,
      deleted: false,
    })),
  };
}
function book(workouts, manual = []) {
  const sessions = workouts.map((w) => w.session);
  const sets = workouts.flatMap((w) => w.sets);
  const perf = performances({ sessions, sets, manual });
  return { ...perf, books: buildRecordBook(perf.list) };
}
const rows = (b) => b.table.map((r) => `${r.reps}:${r.best.weight}${r.coveredBy ? `<${r.coveredBy.weight}x${r.coveredBy.reps}` : ''}`);

test('16.10.2026 from the sheet: records per variant and rep count — and no invented 1-rep record', () => {
  const data = convertSnapshot(SNAPSHOT);
  const perf = performances({ sessions: data.sessions, sets: data.sets });
  const books = buildRecordBook(perf.list);
  const hammer = books.get('naklonnyy-zhim-hammer-naklon');
  assert.deepEqual(rows(hammer), ['8:90<90x9', '9:90']);
  assert.deepEqual(hammer.events.map((e) => describeEvent(e)), ['90×9 — первый результат на 9 повторений']);
  const bench = books.get('zhim-shtangi-lezha-shtanga-gorizont');
  assert.deepEqual(rows(bench), ['7:80', '9:75<75x10', '10:75']);
  assert.deepEqual(bench.events.map((e) => `${e.perf.weight}x${e.reps}:${e.kind}`), ['80x7:first', '75x10:first']);
  assert.equal(bench.heaviest.weight, 80);
  assert.equal(bench.heaviest.reps, 7);
  for (const b of books.values()) {
    assert.ok(!b.table.some((r) => r.reps === 1), `${b.key}: no 1-rep record from multi-rep sets`);
    assert.ok(!b.events.some((e) => e.kind === 'record'), `${b.key}: a first workout sets no "new record"`);
  }
  // Variants stay apart: the dumbbell incline press and the incline barbell have no records at all.
  assert.equal(books.has('naklonnyy-zhim-ganteli-naklon'), false);
  assert.equal(books.has('zhim-shtangi-lezha-shtanga-naklon'), false);
  // Today (17.10) the assessment honestly says there is not enough data.
  const a = assess(hammer, { today: '2026-10-17' });
  assert.equal(a.state, 'unknown');
  assert.match(a.reasons[0], /^Недостаточно данных для оценки/);
});

test('drop sets, pain and worse technique never make a record', () => {
  const drop = Object.assign([100, 10], { drop: true });
  const pain = Object.assign([105, 8], { pain: true });
  const tech = Object.assign([110, 8], { technique: true });
  const { books, excluded } = book([
    workout('2026-09-01', 2, 'press', [[90, 8], drop, pain, tech]),
    workout('2026-09-08', 2, 'press', [[120, 8]], { flags: { pain: true } }),
    workout('2026-09-15', 2, 'press', [[125, 8]], { flags: { technique: true } }),
  ]);
  assert.deepEqual(rows(books.get('press')), ['8:90']);
  assert.deepEqual(excluded.map((x) => x.reason).sort(), ['боль', 'боль', 'дроп-сет', 'техника хуже', 'техника хуже']);
});

test('a new record keeps every earlier one in the history', () => {
  const { books } = book([
    workout('2026-08-01', 2, 'row', [[85, 8]]),
    workout('2026-08-22', 2, 'row', [[87.5, 8]]),
    workout('2026-09-12', 2, 'row', [[90, 8], [87.5, 8]]),
  ]);
  const b = books.get('row');
  assert.deepEqual(b.events.map((e) => `${e.date} ${e.perf.weight} ${e.kind} prev=${e.prev?.weight ?? '-'}`), [
    '2026-08-01 85 first prev=-',
    '2026-08-22 87.5 record prev=85',
    '2026-09-12 90 record prev=87.5',
  ]);
  assert.deepEqual(repProgress(b, 8).map((p) => p.weight), [85, 87.5, 90]);
  assert.deepEqual(rows(b), ['8:90']);
});

test('records by rep count are separate: 90×6 and 85×10 both stand; heavier+more reps covers a row', () => {
  let { books } = book([workout('2026-09-01', 3, 'p', [[90, 6]]), workout('2026-09-08', 2, 'p', [[85, 10]])]);
  assert.deepEqual(rows(books.get('p')), ['6:90', '10:85']);
  assert.equal(books.get('p').heaviest.weight, 90);

  ({ books } = book([workout('2026-09-01', 2, 'q', [[80, 8]]), workout('2026-09-08', 2, 'q', [[85, 10]])]));
  const q = books.get('q');
  assert.deepEqual(rows(q), ['8:80<85x10', '10:85']);
  assert.equal(q.events[1].kind, 'record');
  assert.equal(describeEvent(q.events[1], { thisYear: 2026 }), '85×10 — больше веса и повторений, чем 80×8 (1 сентября)');
  assert.equal(describeEvent(q.events[1], { thisYear: 2027 }), '85×10 — больше веса и повторений, чем 80×8 (1 сентября 2026)');
});

test('an outdone result is named by the strongest earlier set; same weight is said as such', () => {
  const { books } = book([
    workout('2026-09-01', 2, 'h', [[85, 9], [85, 8]]),
    workout('2026-09-08', 3, 'h', [[90, 7], [87.5, 6]]),
    workout('2026-09-15', 2, 'h', [[87.5, 10]]),
    workout('2026-09-22', 2, 'h', [[87.5, 11]]),
  ]);
  const ev = books.get('h').events.map((e) => describeEvent(e, { thisYear: 2026 }));
  assert.equal(ev[2], '87,5×10 — больше веса и повторений, чем 85×9 (1 сентября)');
  assert.equal(ev[3], '87,5×11 — больше повторений с тем же весом, чем 87,5×10 (15 сентября)');
});

test('within one workout only the best set is an achievement', () => {
  const { books } = book([workout('2026-09-01', 2, 'x', [[80, 8], [82.5, 8], [82.5, 8], [80, 9]])]);
  assert.deepEqual(books.get('x').events.map((e) => `${e.perf.weight}x${e.reps}`), ['82.5x8', '80x9']);
});

test('manual records: any date, labelled, merged into the history; a repeat of a logged set counts once', () => {
  const manual = [
    { id: 'pr1', seriesKey: 'bench', exercise: 'Жим', category: 'base', date: '2025-05-01', weight: 100, reps: 3, rir: null, createdAt: 1, updatedAt: 1, deleted: false },
    { id: 'pr2', seriesKey: 'bench', exercise: 'Жим', category: 'base', date: '2026-09-01', weight: 90, reps: 8, rir: 1, createdAt: 2, updatedAt: 2, deleted: false },
    { id: 'pr3', seriesKey: 'bench', exercise: 'Жим', category: 'base', date: '2026-08-01', weight: 120, reps: 1, createdAt: 3, updatedAt: 3, deleted: true },
  ];
  const { books, duplicates } = book([workout('2026-09-01', 2, 'bench', [[90, 8, 1]])], manual);
  const b = books.get('bench');
  assert.deepEqual(rows(b), ['3:100', '8:90']); // the deleted 120×1 is gone, nothing else is
  assert.deepEqual([duplicates.get('pr2')?.source, duplicates.get('pr2')?.date], ['workout', '2026-09-01']);
  assert.deepEqual(b.perfs.map((p) => p.source), ['manual', 'workout']);
  assert.equal(b.events[0].perf.source, 'manual');
});

test('pull-ups: added weight is compared, bodyweight never mixed in; estimates only with a recorded bodyweight', () => {
  const { books } = book(
    [workout('2026-09-01', 2, 'pull', [[0, 10], [10, 6]], { category: 'pullup' }), workout('2026-09-10', 2, 'pull', [[12.5, 6]], { category: 'pullup' })],
  );
  const b = books.get('pull');
  assert.deepEqual(rows(b), ['6:12.5', '10:0']);
  assert.equal(fmtLoad(0, 'pullup'), 'СВ');
  assert.equal(fmtLoad(12.5, 'pullup'), '+12,5 кг');
  const set = b.table[0].best;
  assert.equal(estimate1rm(set), null); // no bodyweight → no estimate
  assert.equal(Math.round(estimate1rm(set, { bodyweight: 80 })), Math.round(92.5 * 1.2));
});

const ago = (days) => new Date(Date.UTC(2026, 9, 17) - days * 86400000).toISOString().slice(0, 10);
const TODAY = '2026-10-17';

test('assessment: a new record is green and says what changed', () => {
  const { books } = book([workout(ago(40), 2, 'b', [[85, 8]]), workout(ago(5), 2, 'b', [[87.5, 8]])]);
  const a = assess(books.get('b'), { today: TODAY });
  assert.equal(a.state, 'new');
  assert.match(a.reasons[0], /87,5×8 — рекорд на 8 повторений \(было 85 кг/);
});

test('assessment: two recent workouts above the record level → "можно обновить", with a reason and a target', () => {
  const manual = [{ id: 'm', seriesKey: 'b', exercise: 'b', category: 'base', date: ago(120), weight: 100, reps: 5, createdAt: 1, updatedAt: 1, deleted: false }];
  const { books } = book([workout(ago(30), 2, 'b', [[92.5, 8, 2]]), workout(ago(23), 2, 'b', [[92.5, 8, 2]])], manual);
  const a = assess(books.get('b'), { today: TODAY });
  assert.equal(a.state, 'improvable');
  // 92.5×8 is the 8-rep record itself — done twice with 2 reps in reserve: there is room above it.
  assert.match(a.reasons.join(' '), /расчётный 1ПМ ≈ 123,3 кг — выше, чем дают текущие рекорды \(≈ 117,2 кг\)\. Это ориентир, а не рекорд\./);
  assert.match(a.reasons.join(' '), /Можно попробовать 95 кг на 8 повторений в тяжёлую неделю \(рекорд — 92,5 кг\)/);
});

test('assessment: one strong workout is not enough; a light week without RIR says nothing', () => {
  const manual = [{ id: 'm', seriesKey: 'b', exercise: 'b', category: 'base', date: ago(120), weight: 100, reps: 5, createdAt: 1, updatedAt: 1, deleted: false }];
  let { books } = book([workout(ago(30), 2, 'b', [[92.5, 8, 2]]), workout(ago(23), 3, 'b', [[80, 6]])], manual);
  assert.equal(assess(books.get('b'), { today: TODAY }).state, 'steady');

  ({ books } = book([workout(ago(30), 1, 'b', [[95, 10]]), workout(ago(23), 1, 'b', [[95, 10]])], manual));
  const a = assess(books.get('b'), { today: TODAY });
  assert.equal(a.state, 'steady'); // 95×10 would beat the record level — but light-week sets without RIR are not max efforts
  assert.match(a.reasons[0], /не превышают рекордов/);
});

test('assessment: lower recent results are not called a regress', () => {
  const manual = [{ id: 'm', seriesKey: 'b', exercise: 'b', category: 'base', date: ago(300), weight: 120, reps: 5, createdAt: 1, updatedAt: 1, deleted: false }];
  const { books } = book([workout(ago(30), 2, 'b', [[90, 8, 1]]), workout(ago(23), 2, 'b', [[90, 8, 1]])], manual);
  const a = assess(books.get('b'), { today: TODAY });
  assert.equal(a.state, 'steady');
  const text = a.reasons.join(' ');
  assert.match(text, /ниже рекордных — так бывает/);
  assert.match(text, /больше полугода/);
  assert.doesNotMatch(text, /регресс|ошибк/i);
});

test('assessment: a recent set that outdid a record row is a fact, stated plainly', () => {
  const manual = [{ id: 'm', seriesKey: 'b', exercise: 'b', category: 'base', date: ago(100), weight: 85, reps: 6, createdAt: 1, updatedAt: 1, deleted: false }];
  const { books } = book([workout(ago(30), 2, 'b', [[87.5, 8]]), workout(ago(25), 3, 'b', [[80, 6]])], manual);
  const a = assess(books.get('b'), { today: TODAY });
  assert.equal(a.state, 'improvable');
  assert.match(a.reasons[0], /Рекорд на 6 повторений — 85 кг .*было 87,5×8: больше веса на большее число повторений/);
});

test('latest achievements across exercises, newest first', () => {
  const { books } = book([
    workout(ago(50), 2, 'a', [[50, 8]]),
    workout(ago(20), 2, 'a', [[55, 8]]),
    workout(ago(40), 2, 'c', [[30, 10]]),
    workout(ago(10), 2, 'c', [[32.5, 10]]),
  ]);
  assert.deepEqual(recentAchievements(books, { today: TODAY }).map((x) => `${x.book.key}:${x.event.perf.weight}`), ['c:32.5', 'a:55']);
});
