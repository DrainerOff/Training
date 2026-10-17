// Client store + sync engine against the real Code.gs (in-process). Covers the
// offline-first guarantees: nothing lost offline, no duplicates after lost responses,
// edits during a request are not dropped, second device converges.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas } from '../helpers/fake-gas.js';
import { createStore } from '../../app/js/data/store.js';
import { memoryAdapter } from '../../app/js/data/db.js';
import { createSync, SyncError } from '../../app/js/data/sync.js';
import { parseProgramText } from '../../app/js/lib/program.js';

const PROGRAM = parseProgramText(`День 1
- Подтягивания прямым хватом [pullup]
- Жим штанги под наклоном [base] / Горизонтальный жим штанги
День 2
- Маятниковый присед [base]`).program;

function network(gas) {
  const net = { online: true, dropResponses: 0, calls: 0 };
  net.transport = async (url, payload) => {
    net.calls++;
    if (!net.online) throw new SyncError('network', 'offline');
    const res = gas.post(JSON.parse(JSON.stringify(payload)));
    if (net.dropResponses > 0) {
      net.dropResponses--;
      throw new SyncError('network', 'response lost');
    }
    return res;
  };
  return net;
}

let clock = 1_760_000_000_000;
const now = () => (clock += 7);

async function device(gas, token, net) {
  const adapter = memoryAdapter();
  const store = createStore(adapter, { now });
  await store.load();
  await store.setKV({ sync: { url: 'https://example/exec', token } });
  const sync = createSync(store, { transport: net.transport, now });
  return { adapter, store, sync };
}

async function reload(adapter) {
  const store = createStore(adapter, { now });
  await store.load();
  return store;
}

test('offline workout is kept locally, survives a restart and syncs once online', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(gas, token, net);
  await a.store.saveProgram(PROGRAM);
  net.online = false;
  const s = await a.store.startSession({ cycle: 1, week: 2, day: 1 });
  const press = s.items[1].slotId;
  await a.store.logSet(s.id, press, { weight: 80, reps: 10, rir: 2 });
  clock += 5000;
  await a.store.logSet(s.id, press, { weight: 80, reps: 9, rir: 1 });
  const st = await a.sync.syncNow();
  assert.equal(st.state, 'offline');
  assert.equal(st.pending, 4, 'program + session + 2 sets queued');

  // "Close the app": a fresh store over the same storage sees everything incl. the outbox.
  const store2 = await reload(a.adapter);
  assert.equal(store2.setsOf(s.id).length, 2);
  assert.equal(store2.state.outbox.size, 4);

  net.online = true;
  const sync2 = createSync(store2, { transport: net.transport, now });
  const st2 = await sync2.syncNow();
  assert.equal(st2.state, 'idle');
  assert.equal(st2.pending, 0);
  assert.equal(gas.sheet('App_Sets').getLastRow(), 3);
});

test('lost responses and retries never duplicate sets', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(gas, token, net);
  await a.store.saveProgram(PROGRAM);
  const s = await a.store.startSession({ cycle: 1, week: 1, day: 1 });
  for (let i = 0; i < 3; i++) {
    clock += 3000;
    await a.store.logSet(s.id, s.items[0].slotId, { weight: 0, reps: 6 });
  }
  net.dropResponses = 2; // server writes, phone never hears back — twice
  assert.equal((await a.sync.syncNow()).state, 'offline');
  assert.equal((await a.sync.syncNow()).state, 'offline');
  assert.equal((await a.sync.syncNow()).state, 'idle');
  await a.sync.syncNow();
  assert.equal(gas.sheet('App_Sets').getLastRow(), 4, 'header + exactly 3 sets');
  assert.equal(gas.sheet('App_Sessions').getLastRow(), 2);
});

test('double tap within 1.5 s records one set', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const a = await device(gas, token, network(gas));
  await a.store.saveProgram(PROGRAM);
  const s = await a.store.startSession({ cycle: 1, week: 2, day: 1 });
  const r1 = await a.store.logSet(s.id, s.items[1].slotId, { weight: 80, reps: 10 });
  const r2 = await a.store.logSet(s.id, s.items[1].slotId, { weight: 80, reps: 10 });
  assert.equal(r2.duplicate, true);
  assert.equal(r2.set.id, r1.set.id);
  clock += 60_000;
  const r3 = await a.store.logSet(s.id, s.items[1].slotId, { weight: 80, reps: 10 });
  assert.equal(r3.duplicate, false, 'the same numbers a minute later are a real set');
  assert.equal(a.store.setsOf(s.id).length, 2);
});

test('double tap after choosing RIR still records one set', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const a = await device(gas, token, network(gas));
  await a.store.saveProgram(PROGRAM);
  const s = await a.store.startSession({ cycle: 1, week: 2, day: 1 });
  await a.store.logSet(s.id, s.items[1].slotId, { weight: 80, reps: 10, rir: 2 });
  const second = await a.store.logSet(s.id, s.items[1].slotId, { weight: 80, reps: 10, rir: null });
  assert.equal(second.duplicate, true);
  assert.equal(a.store.setsOf(s.id).length, 1);
});

test('a record the sheet refuses stays queued and the status says so', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const a = await device(gas, token, network(gas));
  await a.store.saveProgram(PROGRAM);
  const s = await a.store.startSession({ cycle: 1, week: 2, day: 1 });
  clock += 5000;
  const { set } = await a.store.logSet(s.id, s.items[1].slotId, { weight: 80, reps: 10 });
  clock += 5000;
  const { set: bad } = await a.store.logSet(s.id, s.items[1].slotId, { weight: 200000, reps: 10 });
  const st = await a.sync.syncNow();
  assert.equal(st.state, 'error');
  assert.match(st.error, /не приняла записей: 1/);
  assert.equal(a.store.state.outbox.has(`sets:${bad.id}`), true, 'refused record is kept');
  assert.equal(a.store.state.outbox.has(`sets:${set.id}`), false, 'accepted record is acknowledged');
  await a.store.updateSet(bad.id, { weight: 85 });
  assert.equal((await a.sync.syncNow()).state, 'idle', 'once fixed it goes through');
  assert.equal(a.store.state.outbox.size, 0);
});

test('a deleted body-metric entry is not resurrected by a later quick save', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const a = await device(gas, token, network(gas));
  const m = await a.store.saveMetric('2026-10-17', { bodyweight: 81.2, sleep: 7 });
  await a.store.deleteMetric(m.id);
  const again = await a.store.saveMetric('2026-10-17', { recovery: 4 });
  assert.deepEqual([again.bodyweight, again.sleep, again.recovery], [null, null, 4]);
});

test('an edit made while a sync request is in flight is not lost', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(gas, token, net);
  await a.store.saveProgram(PROGRAM);
  const s = await a.store.startSession({ cycle: 1, week: 2, day: 1 });
  const { set } = await a.store.logSet(s.id, s.items[1].slotId, { weight: 80, reps: 10 });
  const slow = net.transport;
  let edited = false;
  const sync = createSync(a.store, {
    now,
    transport: async (url, payload) => {
      const res = await slow(url, payload);
      if (!edited) {
        edited = true;
        await a.store.updateSet(set.id, { weight: 82.5 }); // user edits mid-request
      }
      return res;
    },
  });
  await sync.syncNow();
  assert.equal(a.store.state.outbox.has(`sets:${set.id}`), true, 'newer edit still queued');
  await sync.syncNow();
  const rows = gas.post({ action: 'sync', token, since: 0 }).pull.sets;
  assert.equal(rows.find((r) => r.id === set.id).weight, 82.5);
});

test('second device pulls history and program; deletions propagate', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const net = network(gas);
  const a = await device(gas, token, net);
  await a.store.saveProgram(PROGRAM);
  const s = await a.store.startSession({ cycle: 1, week: 2, day: 1 });
  const { set: s1 } = await a.store.logSet(s.id, s.items[1].slotId, { weight: 80, reps: 10 });
  clock += 5000;
  await a.store.logSet(s.id, s.items[1].slotId, { weight: 80, reps: 9 });
  await a.store.finishSession(s.id);
  await a.sync.syncNow();

  const b = await device(gas, token, net);
  assert.equal(b.store.state.program.draft, true, 'fresh device starts with the starter program');
  await b.sync.syncNow();
  assert.equal(b.store.state.program.days.length, 2, 'real program pulled, starter not pushed over it');
  assert.equal(b.store.setsOf(s.id).length, 2);
  assert.equal(b.store.state.sessions.get(s.id).status, 'done');

  await b.store.deleteSet(s1.id);
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.equal(a.store.setsOf(s.id).length, 1);
  assert.equal(a.store.setsOf(s.id)[0].setNo, 1, 'renumbered after delete');
});

test('wrong token surfaces a clear error and keeps data queued', async () => {
  const gas = createGas();
  gas.call('setup');
  const net = network(gas);
  const a = await device(gas, 'wrong-token', net);
  await a.store.saveMetric('2026-10-17', { bodyweight: 81.2 });
  const st = await a.sync.syncNow();
  assert.equal(st.state, 'error');
  assert.match(st.error, /Ключ доступа/);
  assert.equal(a.store.state.outbox.size, 1);
});

test('body metrics: one record per date, re-saving the same day updates it', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const a = await device(gas, token, network(gas));
  await a.store.saveMetric('2026-10-17', { bodyweight: 81.2 });
  await a.store.saveMetric('2026-10-17', { sleep: 7.5, recovery: 4 });
  await a.sync.syncNow();
  const rows = gas.post({ action: 'sync', token, since: 0 }).pull.metrics;
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].bodyweight, rows[0].sleep, rows[0].recovery], [81.2, 7.5, 4]);
});

test('text import creates done sessions that sync like any other', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const a = await device(gas, token, network(gas));
  await a.store.saveProgram(PROGRAM);
  const created = await a.store.importParsedSessions([
    { date: '2026-10-16', cycle: 1, week: 1, day: 1, items: [{ name: 'Жим штанги под наклоном', key: PROGRAM.days[0].slots[1].options[0].key, sets: [{ weight: 60, reps: 10, rir: 4 }, { weight: 60, reps: 10, rir: 4 }] }] },
  ]);
  assert.equal(created.length, 1);
  assert.equal(created[0].items[0].slotId, PROGRAM.days[0].slots[1].id);
  await a.sync.syncNow();
  assert.equal(gas.sheet('App_Sets').getLastRow(), 3);
});
