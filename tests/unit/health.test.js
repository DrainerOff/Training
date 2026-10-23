// Is Health data still arriving from «Команды»? (lib/health.js) Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthDelivery, describeDelivery, QUIET_HOURS } from '../../app/js/lib/health.js';

const H = 3600000;
const NOW = Date.UTC(2026, 9, 22, 15, 0, 0);
const weigh = (h, extra = {}) => ({ id: `b${h}`, kind: 'weight', via: 'shortcut', updatedAt: NOW - h * H, deleted: false, ...extra });

test('no automation in use: nothing to warn about', () => {
  const d = healthDelivery({ body: [weigh(100, { via: 'csv' }), weigh(90, { via: 'manual' })], now: NOW });
  assert.deepEqual([d.used, d.quiet], [false, false]);
});

test(`quiet for more than ${QUIET_HOURS} h: a warning that says what came last`, () => {
  const sleep = [{ id: 's:2026-10-20', via: 'shortcut', updatedAt: NOW - 60 * H, deleted: false }];
  const d = healthDelivery({ body: [weigh(62)], sleep, now: NOW });
  assert.equal(d.quiet, true);
  const text = describeDelivery(d, { fmt: (ms) => `${(NOW - ms) / H} ч назад` });
  assert.equal(text, 'Данные из «Здоровья» не приходят 2 дня. Последние: сон — 60 ч назад, вес — 62 ч назад.');
  assert.equal(healthDelivery({ body: [weigh(47)], now: NOW }).quiet, false);
});

test('an edit or a deletion on the phone is not a delivery; the sheet log wins when it is newer', () => {
  const body = [weigh(80), weigh(1, { edited: true }), weigh(2, { deleted: true })];
  assert.equal(healthDelivery({ body, now: NOW }).quiet, true);
  const ingest = { lastAt: NOW - 3 * H, byType: { weight: { at: NOW - 3 * H, lines: 0, added: 0, rejected: 0 } } };
  const d = healthDelivery({ ingest, body, now: NOW });
  assert.deepEqual([d.quiet, d.fromLog, Math.round(d.hours)], [false, true, 3]);
});
