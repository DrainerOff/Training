// Bulk / cut / maintenance phases (App_Phases, API 5) on the real Code.gs, and on the Apps Script
// the owner runs since 19.10.2026 (API 4): there phases wait on the phone while measurements,
// sleep and «Команды» keep working. Synthetic data only.
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
const API4 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/apps-script/Code.api4.gs'), 'utf8');

let clock = 1_792_500_000_000;
const now = () => (clock += 17);

async function device(gas, token) {
  const store = createStore(memoryAdapter(), { now });
  await store.load();
  await store.setKV({ sync: { url: 'https://example/exec', token } });
  return { store, sync: createSync(store, { transport: async (_u, p) => gas.post(JSON.parse(JSON.stringify(p))), now }) };
}

const rows = (gas, name) => {
  const sh = gas.sheet(name);
  if (!sh) return [];
  const [head, ...data] = sh.rows();
  return data.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
};

test('phases reach App_Phases with a negative target on a cut, and the second phone gets them', async () => {
  const gas = createGas();
  const token = gas.call('setup');
  const a = await device(gas, token);
  await a.store.savePhase({ mode: 'cut', start: '2026-07-01', targetPct: -0.5 });
  await a.store.savePhase({ mode: 'bulk', start: '2026-10-01', targetPct: 0.25, note: 'после сушки' });
  await a.sync.syncNow();
  assert.equal(a.sync.status.state, 'idle');
  const sheet = rows(gas, 'App_Phases').sort((x, y) => x.start.localeCompare(y.start));
  assert.deepEqual(sheet.map((r) => [r.start, r.end, r.mode, r.target_pct_week, r.note]), [
    ['2026-07-01', '2026-09-30', 'cut', -0.5, ''],
    ['2026-10-01', '', 'bulk', 0.25, 'после сушки'],
  ]);
  const b = await device(gas, token);
  await b.sync.syncNow();
  assert.deepEqual([...b.store.state.phases.values()].map((p) => p.targetPct).sort(), [-0.5, 0.25]);
});

test('the sheet refuses a broken phase', () => {
  const gas = createGas();
  const token = gas.call('setup');
  const ok = { id: 'ph1', mode: 'bulk', start: '2026-10-01', end: null, targetPct: 0.25, note: '', updatedAt: 5, deleted: false };
  const res = gas.post({
    action: 'sync', token, since: 0,
    push: { phases: [ok, { ...ok, id: 'ph2', mode: 'diet' }, { ...ok, id: 'ph3', targetPct: 5 }, { ...ok, id: 'ph4', end: '2026-09-01' }, { ...ok, id: 'ph5', start: '1 октября' }] },
  });
  assert.equal(res.api, 5);
  assert.equal(res.ack.phases, 1);
  assert.equal(res.rejected.length, 4);
});

test('Apps Script installed on 19.10 (API 4): phases wait on the phone, the rest syncs, «Команды» work; after the update they arrive', async () => {
  const gas = createGas({ code: API4 });
  const token = gas.call('setup');
  const key = gas.call('showIngestKey');
  const a = await device(gas, token);
  await a.store.savePhase({ mode: 'bulk', start: '2026-10-01', targetPct: 0.25 });
  await a.store.addBody({ kind: 'waist', value: 84.5, measuredAt: '2026-10-19T18:06' });
  await a.sync.syncNow();
  assert.equal(a.sync.status.state, 'idle');
  assert.deepEqual(a.sync.status.waitingBy, { phases: 1 });
  assert.match(a.sync.status.notice, /режимы набора и сушки — 1/);
  assert.equal(rows(gas, 'App_Body').length, 1);
  assert.equal(gas.post({ action: 'ingest', key, type: 'weight', lines: '81.25|2026-10-19T21:36:08+03:00|2026-10-19T21:36:08+03:00|Zepp Life' }).added, 1);

  gas.redeploy();
  await a.sync.syncNow();
  assert.equal(a.sync.status.waiting, 0);
  assert.equal(rows(gas, 'App_Phases').length, 1);
  // The weigh-in from «Команды» reaches the phone too.
  assert.ok([...a.store.state.body.values()].some((r) => r.kind === 'weight' && r.via === 'shortcut'));
});
