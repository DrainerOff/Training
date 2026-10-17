// The offline cache must hold every file the app loads: a file missing from SHELL works online
// and breaks only in airplane mode, and boot.js must run before the app modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app');
const sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
const SHELL = JSON.parse(
  sw
    .match(/const SHELL = (\[[\s\S]*?\]);/)[1]
    .replace(/'/g, '"')
    .replace(/,\s*\]/, ']'),
);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [path.relative(APP, p).split(path.sep).join('/')];
  });
}

test('the service worker caches every app file, and only existing ones', () => {
  const files = walk(APP).filter((f) => f !== 'sw.js' && !/^fonts\/LICENSE/.test(f));
  const cached = SHELL.filter((u) => u !== './').map((u) => u.replace(/^\.\//, ''));
  assert.deepEqual([...cached].sort(), [...files].sort());
  assert.ok(SHELL.includes('./'));
});

test('boot.js loads as a classic script before the app module', () => {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const boot = html.indexOf('<script src="./boot.js"></script>');
  const main = html.indexOf('<script type="module" src="./js/main.js"></script>');
  assert.ok(boot > 0 && main > boot);
  assert.match(html, /id="boot"/);
});

test('every release stamp placeholder is in a file CI stamps', () => {
  const ci = fs.readFileSync(path.join(APP, '../.github/workflows/ci.yml'), 'utf8');
  const stamped = ci.match(/sed -i "s\/__BUILD__\/\$\{GITHUB_SHA::7\}\/" (.*)/)[1].split(/\s+/).map((f) => f.replace('_site/', ''));
  const withPlaceholder = walk(APP).filter((f) => /\.(js|html)$/.test(f) && fs.readFileSync(path.join(APP, f), 'utf8').includes('__BUILD__'));
  assert.deepEqual(withPlaceholder.sort(), stamped.sort());
});
