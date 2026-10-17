import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas } from '../helpers/fake-gas.js';
import { slugify } from '../../app/js/lib/util.js';

const LEGACY = {
  'Журнал': [
    ['Дата', 'Неделя', 'День', 'Упражнение', 'Вес 1', 'Повт 1', 'Вес 2', 'Повт 2'],
    ['16.10.2026', 1, 1, 'Жим штанги под наклоном', 60, 10, 60, 10],
  ],
  'Прогресс': [['=A1*2', 'формула']],
};

function boot() {
  const gas = createGas({ legacy: LEGACY });
  const token = gas.call('setup');
  return { gas, token };
}

const set = (id, extra = {}) => ({
  id,
  sessionId: 'ss1',
  slotId: 'sl1',
  seriesKey: 'zhim-shtangi-pod-naklonom',
  exercise: 'Жим штанги под наклоном',
  date: '2026-10-16',
  cycle: 1,
  week: 1,
  day: 1,
  setNo: 1,
  weight: 60,
  reps: 10,
  rir: 4,
  drop: false,
  pain: false,
  technique: false,
  note: '',
  createdAt: 1000,
  updatedAt: 1000,
  deleted: false,
  ...extra,
});

test('setup creates only App_* sheets and leaves the old tabs untouched', () => {
  const { gas, token } = boot();
  assert.match(token, /^[0-9a-f]{64}$/);
  const names = gas.spreadsheet.getSheets().map((s) => s.getName());
  assert.deepEqual(names.slice(0, 2), ['Журнал', 'Прогресс']);
  for (const n of ['App_Sets', 'App_Sessions', 'App_Metrics', 'App_Program']) assert.ok(names.includes(n), n);
  assert.deepEqual(gas.sheet('Журнал').rows(), LEGACY['Журнал']);
  assert.deepEqual(gas.sheet('Прогресс').rows(), LEGACY['Прогресс']);
});

test('requests without the right token are refused', () => {
  const { gas } = boot();
  assert.equal(gas.post({ action: 'ping', token: 'nope' }).error, 'unauthorized');
  assert.equal(gas.post('not json').error, 'bad_request');
  assert.equal(gas.get().ok, true);
});

test('access key: wrong type, wrong length and an old rotated key are all refused', () => {
  const { gas, token } = boot();
  assert.equal(gas.post({ action: 'ping', token }).ok, true);
  assert.equal(gas.post({ action: 'ping', token: { toString: () => token } }).error, 'unauthorized');
  assert.equal(gas.post({ action: 'ping', token: token.slice(0, -1) }).error, 'unauthorized');
  assert.equal(gas.post({ action: 'ping' }).error, 'unauthorized');
  const fresh = gas.call('rotateToken');
  assert.notEqual(fresh, token);
  assert.equal(gas.post({ action: 'ping', token }).error, 'unauthorized', 'old key stops working at once');
  assert.equal(gas.post({ action: 'ping', token: fresh }).ok, true);
});

test('unauthorized requests write nothing', () => {
  const { gas } = boot();
  const r = gas.post({ action: 'sync', token: 'x'.repeat(64), push: { sets: [set('a')] } });
  assert.equal(r.error, 'unauthorized');
  assert.equal(r.pull, undefined, 'and read nothing');
  assert.equal(gas.sheet('App_Sets').getLastRow(), 1);
});

test('oversized requests are refused before parsing', () => {
  const { gas, token } = boot();
  const r = gas.post(JSON.stringify({ action: 'ping', token, pad: 'x'.repeat(5 * 1024 * 1024) }));
  assert.equal(r.error, 'bad_request');
});

test('web app without an "active" spreadsheet works through the id saved by setup', () => {
  const { gas, token } = boot();
  gas.setActiveAvailable(false);
  const r = gas.post({ action: 'sync', token, push: { sets: [set('a')] } });
  assert.equal(r.ok, true);
  assert.equal(gas.sheet('App_Sets').getLastRow(), 2);
});

test('without setup the API explains what to do instead of failing obscurely', () => {
  const gas = createGas();
  gas.props.set('API_TOKEN', 't'.repeat(64));
  gas.setActiveAvailable(false);
  const r = gas.post({ action: 'ping', token: 't'.repeat(64) });
  assert.equal(r.error, 'server_error');
  assert.match(r.message, /Подготовить листы и ключ/);
});

test('push is idempotent: resending the same sets never duplicates rows', () => {
  const { gas, token } = boot();
  const req = { action: 'sync', token, since: 0, push: { sets: [set('a'), set('b', { setNo: 2 })] } };
  const r1 = gas.post(req);
  assert.equal(r1.ok, true);
  assert.equal(r1.ack.sets, 2);
  const r2 = gas.post(req);
  const r3 = gas.post(req);
  assert.equal(r3.ok, true);
  assert.equal(gas.sheet('App_Sets').getLastRow(), 3, 'header + 2 rows');
  assert.ok(r2.cursor >= r1.cursor);
});

test('last writer wins by updatedAt; an older version never overwrites a newer one', () => {
  const { gas, token } = boot();
  gas.post({ action: 'sync', token, push: { sets: [set('a', { weight: 60, updatedAt: 2000 })] } });
  gas.post({ action: 'sync', token, push: { sets: [set('a', { weight: 55, updatedAt: 1500 })] } });
  let pulled = gas.post({ action: 'sync', token, since: 0 }).pull.sets;
  assert.equal(pulled[0].weight, 60);
  gas.post({ action: 'sync', token, push: { sets: [set('a', { weight: 62.5, updatedAt: 3000 })] } });
  pulled = gas.post({ action: 'sync', token, since: 0 }).pull.sets;
  assert.equal(pulled.length, 1);
  assert.equal(pulled[0].weight, 62.5);
});

test('pull is incremental and skips what the same request just pushed', () => {
  const { gas, token } = boot();
  const r1 = gas.post({ action: 'sync', token, since: 0, push: { sets: [set('a')] } });
  assert.equal(r1.pull.sets.length, 0, 'the pusher already has it');
  const other = gas.post({ action: 'sync', token, since: 0 });
  assert.equal(other.pull.sets.length, 1, 'another device gets it');
  const again = gas.post({ action: 'sync', token, since: other.cursor });
  assert.equal(again.pull.sets.length, 0);
});

test('round-trip keeps types: dates stay text, nulls stay null, booleans stay booleans', () => {
  const { gas, token } = boot();
  gas.post({ action: 'sync', token, push: { sets: [set('a', { rir: null, pain: true, note: 'ок' })] } });
  const [x] = gas.post({ action: 'sync', token, since: 0 }).pull.sets;
  assert.equal(x.date, '2026-10-16');
  assert.equal(x.rir, null);
  assert.equal(x.pain, true);
  assert.equal(x.drop, false);
  assert.equal(x.note, 'ок');
  assert.equal(x.weight, 60);
});

test('user text is never turned into a formula', () => {
  const { gas, token } = boot();
  gas.post({ action: 'sync', token, push: { sets: [set('a', { note: '=IMPORTXML("http://x","//a")' }), set('b', { note: '-5 кг на последнем' })] } });
  const sh = gas.sheet('App_Sets');
  assert.deepEqual(sh.formulas, []);
  const pulled = gas.post({ action: 'sync', token, since: 0 }).pull.sets;
  assert.equal(pulled.find((s) => s.id === 'a').note, '=IMPORTXML("http://x","//a")');
  assert.equal(pulled.find((s) => s.id === 'b').note, '-5 кг на последнем');
});

test('invalid records are rejected, valid ones in the same batch still land', () => {
  const { gas, token } = boot();
  const r = gas.post({ action: 'sync', token, push: { sets: [set('ok'), set('bad id!'), set('neg', { weight: -5 }), { id: 'x' }] } });
  assert.equal(r.ack.sets, 1);
  assert.equal(r.rejected.length, 3);
});

test('sheet grows past its initial size without errors', () => {
  const { gas, token } = boot();
  const many = Array.from({ length: 1200 }, (_, i) => set(`s${i}`, { setNo: (i % 4) + 1, updatedAt: 1000 + i }));
  const r = gas.post({ action: 'sync', token, push: { sets: many.slice(0, 1000) } });
  assert.equal(r.ack.sets, 1000);
  gas.post({ action: 'sync', token, push: { sets: many.slice(1000) } });
  assert.equal(gas.sheet('App_Sets').getLastRow(), 1201);
});

test('manual edit in App_Sets bumps the version so the app pulls the fix', () => {
  const { gas, token } = boot();
  const r1 = gas.post({ action: 'sync', token, push: { sets: [set('a')] } });
  const sh = gas.sheet('App_Sets');
  const header = sh.rows()[0];
  gas.edit('App_Sets', 2, header.indexOf('weight_kg') + 1, 65);
  const r2 = gas.post({ action: 'sync', token, since: r1.cursor });
  assert.equal(r2.pull.sets.length, 1);
  assert.equal(r2.pull.sets[0].weight, 65);
  assert.ok(r2.pull.sets[0].updatedAt > 1000);
});

test('manual edit never lowers the version (phone clock ahead of Google)', () => {
  const { gas, token } = boot();
  const future = Date.now() + 10 * 60 * 1000;
  gas.post({ action: 'sync', token, push: { sets: [set('a', { updatedAt: future })] } });
  const header = gas.sheet('App_Sets').rows()[0];
  gas.edit('App_Sets', 2, header.indexOf('reps') + 1, 11);
  const [x] = gas.post({ action: 'sync', token, since: 0 }).pull.sets;
  assert.equal(x.reps, 11);
  assert.ok(x.updatedAt > future, 'hand edit is newer than the phone version');
});

test('program: pushed program is written as readable rows and keeps series keys', () => {
  const { gas, token } = boot();
  const program = {
    id: 'main',
    updatedAt: 5000,
    days: [
      {
        day: 1,
        title: 'Верх',
        slots: [
          { id: 'p1', category: 'base', step: 2.5, options: [{ key: 'press-incline', name: 'Жим штанги под наклоном' }, { key: 'press-flat', name: 'Горизонтальный жим штанги' }], overrides: { 2: { sets: 4, reps: [8, 10], rir: [1, 2] } }, note: '' },
          { id: 'p2', category: 'pullup', step: 2.5, options: [{ key: 'pull-pronated', name: 'Подтягивания прямым хватом' }], overrides: {}, note: '' },
        ],
      },
    ],
  };
  const r = gas.post({ action: 'sync', token, push: { program } });
  assert.equal(r.programUpdatedAt, 5000);
  const rows = gas.sheet('App_Program').rows();
  assert.deepEqual(rows[1].slice(0, 8), ['1', 'Верх', '1', 'Жим штанги под наклоном', 'Горизонтальный жим штанги', 'base', '2.5', '']);
  assert.equal(rows[1][8], '4x8-10@1-2');
  const back = gas.post({ action: 'sync', token, programSince: 0 }).pull.program;
  assert.deepEqual(back.days[0].slots[0].options, program.days[0].slots[0].options);
  assert.deepEqual(back.days[0].slots[0].overrides, { 2: { sets: 4, reps: [8, 10], rir: [1, 2] } });
});

test('program: a hand edit of App_Program wins over an older program from the phone', () => {
  const { gas, token } = boot();
  const program = { id: 'main', updatedAt: 5000, days: [{ day: 1, slots: [{ id: 'p1', category: 'iso', options: [{ key: 'curl', name: 'Сгибания' }] }] }] };
  gas.post({ action: 'sync', token, push: { program } });
  gas.sheet('App_Program').getRange(2, 4).setValue('Сгибания на скамье Скотта');
  const r = gas.post({ action: 'sync', token, programSince: 5000, push: { program: { ...program, updatedAt: 6000 } } });
  assert.equal(r.pull.program.days[0].slots[0].options[0].name, 'Сгибания на скамье Скотта');
  assert.equal(r.pull.program.days[0].slots[0].options[0].key, 'curl', 'key column keeps history linked after rename');
  assert.ok(r.programUpdatedAt > 6000);
});

test('summary sheet is a readable digest', () => {
  const { gas, token } = boot();
  const session = { id: 'ss1', date: '2026-10-16', cycle: 1, week: 1, day: 1, status: 'done', startedAt: 1, finishedAt: 2, note: '', items: [], updatedAt: 1000, deleted: false };
  gas.post({ action: 'sync', token, push: { sessions: [session], sets: [set('a'), set('b', { setNo: 2, weight: 62.5, reps: 9, rir: 3 })] } });
  const rows = gas.sheet('App_Summary').rows();
  assert.equal(rows[1][4], 'Жим штанги под наклоном');
  assert.equal(rows[1][5], '60×10 @4, 62,5×9 @3');
});

test('legacy inspector only reads old tabs', () => {
  const { gas } = boot();
  gas.call('describeLegacySheets');
  const inspect = gas.sheet('App_Inspect').rows();
  assert.equal(inspect[0][0], '### Журнал');
  assert.equal(inspect.find((r) => r[0] === 'r2')[4], 'Жим штанги под наклоном');
  assert.deepEqual(gas.sheet('Журнал').rows(), LEGACY['Журнал']);
});

test('server and client derive identical series keys', () => {
  const { gas } = boot();
  for (const name of ['Жим штанги под наклоном', 'Наклонный Hammer', 'Сгибание ног лёжа', 'Икры в жиме ногами', 'Подтягивания «нейтральным» хватом']) {
    assert.equal(gas.call('slugify_', name), slugify(name), name);
  }
});
