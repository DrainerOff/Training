// The send queue never blocks new workouts. A sync sends the outbox oldest first, 200 records per
// request; records the Apps Script cannot take (an entity an older Code.gs doesn't know, a record it
// refuses) stay queued — and must not fill every request, or a set logged after them never reaches
// the sheet while the status says all is well. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas } from '../helpers/fake-gas.js';
import { createStore } from '../../app/js/data/store.js';
import { memoryAdapter } from '../../app/js/data/db.js';
import { createSync } from '../../app/js/data/sync.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API3 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/apps-script/Code.api3.gs'), 'utf8');

let clock = 1_793_100_000_000;
const now = () => (clock += 17);

async function device(token, transport) {
  const store = createStore(memoryAdapter(), { now });
  await store.load();
  await store.setKV({ sync: { url: 'https://example/exec', token } });
  return { store, sync: createSync(store, { transport, now }) };
}

function rows(gas, name) {
  const sh = gas.sheet(name);
  if (!sh) return [];
  const [head, ...data] = sh.rows();
  return data.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// 250 synthetic weigh-ins: more than one request (200) can carry.
async function manyWeighIns(store, n = 250) {
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    await store.addBody({ kind: 'weight', value: 70 + (i % 10) / 10, measuredAt: `${d}T07:30` });
  }
}

test('Apps Script of v1.0.2 (API 3) and 250 measurements waiting: a new set still reaches App_Sets', async () => {
  const gas = createGas({ code: API3 });
  const token = gas.call('setup');
  let requests = 0;
  const a = await device(token, async (_u, p) => {
    requests++;
    return gas.post(JSON.parse(JSON.stringify(p)));
  });
  await manyWeighIns(a.store);
  const s = await a.store.startSession({ cycle: 1, week: 2, day: 1 });
  clock += 5000;
  const { set } = await a.store.logSet(s.id, s.items[0].slotId, { weight: 60, reps: 8, rir: 2 });
  await a.sync.syncNow();

  assert.ok(rows(gas, 'App_Sessions').some((r) => r.id === s.id), 'the workout is in the sheet');
  assert.ok(rows(gas, 'App_Sets').some((r) => r.id === set.id), 'the set is in the sheet');
  const st = a.sync.status;
  assert.equal(st.pending, 0);
  assert.equal(st.waiting, 250);
  assert.deepEqual(st.waitingBy, { body: 250 });
  // Once the phone knows this script can't take them, the waiting ones are not sent again.
  requests = 0;
  await a.store.logSet(s.id, s.items[0].slotId, { weight: 60, reps: 7, rir: 1 });
  await a.sync.syncNow();
  assert.equal(requests, 1);
  assert.equal(rows(gas, 'App_Sets').length, 2);

  // After the Code.gs update everything waiting arrives, in as many requests as it takes.
  gas.redeploy();
  await a.sync.syncNow();
  assert.equal(a.sync.status.waiting, 0);
  assert.equal(a.store.state.outbox.size, 0);
  assert.equal(rows(gas, 'App_Body').length, 250);
});

test('250 records the sheet refuses: a new set still reaches App_Sets, the refusals stay queued and are counted', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  let requests = 0;
  // The real Code.gs, but every measurement reported as refused (as sanitize_ does for a bad value).
  const transport = async (_u, p) => {
    requests++;
    const sent = JSON.parse(JSON.stringify(p));
    const body = sent.push?.body || [];
    if (sent.push) sent.push.body = [];
    const res = gas.post(sent);
    if (res.ok) res.rejected = [...(res.rejected || []), ...body.map((r) => ({ entity: 'body', id: r.id }))];
    return res;
  };
  const a = await device(token, transport);
  await manyWeighIns(a.store);
  const s = await a.store.startSession({ cycle: 1, week: 2, day: 1 });
  clock += 5000;
  const { set } = await a.store.logSet(s.id, s.items[0].slotId, { weight: 60, reps: 8, rir: 2 });
  await a.sync.syncNow();

  assert.ok(rows(gas, 'App_Sets').some((r) => r.id === set.id), 'the set is in the sheet');
  const st = a.sync.status;
  assert.equal(st.state, 'error');
  assert.equal(st.errorCode, 'rejected');
  assert.match(st.error, /не приняла записей: 250\./);
  assert.equal(a.store.state.outbox.size, 250);
  assert.ok(requests <= 3, `a bounded number of requests, got ${requests}`);

  // The next sync (every minute while something is queued) is one request, not one per 200 refused.
  requests = 0;
  await a.sync.syncNow();
  assert.equal(requests, 1);
  assert.match(a.sync.status.error, /не приняла записей: 250\./);
});

test('4100 refused records: from the second sync on, a new set goes first', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const transport = async (_u, p) => {
    const sent = JSON.parse(JSON.stringify(p));
    const body = sent.push?.body || [];
    if (sent.push) sent.push.body = [];
    const res = gas.post(sent);
    if (res.ok) res.rejected = [...(res.rejected || []), ...body.map((r) => ({ entity: 'body', id: r.id }))];
    return res;
  };
  const a = await device(token, transport);
  await manyWeighIns(a.store, 4100);
  await a.sync.syncNow(); // 20 requests of 200: the phone learns which ones the sheet refuses
  const s = await a.store.startSession({ cycle: 1, week: 2, day: 1 });
  clock += 5000;
  const { set } = await a.store.logSet(s.id, s.items[0].slotId, { weight: 60, reps: 8, rir: 2 });
  await a.sync.syncNow();
  assert.ok(rows(gas, 'App_Sets').some((r) => r.id === set.id), 'the set is in the sheet');
  await a.sync.syncNow();
  assert.match(a.sync.status.error, /не приняла записей: 4100\./);
});
