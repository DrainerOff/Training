import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkApiUrl, checkToken } from '../../app/js/data/sync.js';

test('accepts the web app /exec URL (personal and Workspace accounts)', () => {
  assert.equal(checkApiUrl('https://script.google.com/macros/s/AKfycbx_abc-123/exec'), null);
  assert.equal(checkApiUrl('  https://script.google.com/a/macros/example.com/s/AKfy-123/exec '), null);
  assert.equal(checkApiUrl('http://127.0.0.1:5174/exec'), null);
});

test('explains the usual wrong URLs', () => {
  assert.match(checkApiUrl('https://script.google.com/macros/s/AKfy/dev'), /\/dev/);
  assert.match(checkApiUrl('https://docs.google.com/spreadsheets/d/10jl/edit'), /адрес самой таблицы/);
  assert.match(checkApiUrl('https://script.google.com/home/projects/1abc/edit'), /редактора скрипта/);
  assert.match(checkApiUrl('http://script.google.com/macros/s/AKfy/exec'), /должен выглядеть/);
  assert.match(checkApiUrl(''), /должен выглядеть/);
});

test('the access key must be the full 64-character key', () => {
  assert.equal(checkToken('a'.repeat(64)), null);
  assert.match(checkToken('a'.repeat(63)), /64 символа/);
  assert.match(checkToken('z'.repeat(64)), /64 символа/);
});
