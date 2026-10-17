// File names vs. content-blocker filter lists. Release 7705635 didn't start on an iPhone with
// a Safari content blocker: EasyPrivacy's generic rule "/lib/analytics.js" refused
// js/lib/analytics.js. These checks use a snapshot of the real lists
// (tests/fixtures/blocklists, refreshed with `npm run check:blockers -- --update`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseList, mergeLists, blockingRules, appUrlFindings, appPaths, SYNC_URLS } from '../../tools/blockers/abp.js';
import { BASE, HOST } from '../../tools/blockers/lists.js';
import { snapshotRules } from '../helpers/content-blocker.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app');
const rules = snapshotRules();

test('no rule in the snapshot blocks a file of the app or the sync API', () => {
  const findings = appUrlFindings(rules, APP).map((f) => `${f.path} (${f.type}) ← ${f.rules[0].text} [${f.rules[0].where}]`);
  assert.deepEqual(findings, []);
});

test('regression: the snapshot refuses the old js/lib/analytics.js, as EasyPrivacy did on the iPhone', () => {
  const hits = blockingRules(rules, `${BASE}js/lib/analytics.js`, 'script').map((r) => r.text);
  assert.ok(hits.includes('/lib/analytics.js'), hits.join(', '));
  assert.deepEqual(blockingRules(rules, `${BASE}js/lib/plateau.js`, 'script'), []);
});

// Lists change; names with tracker or ad vocabulary are the next ones to be caught.
const RISKY = new Set(
  'analytics analytic tracking tracker track telemetry beacon pixel stats statistics metrics metric counter collect collector ads ad adv advert adverts advertising adserver banner banners sponsor sponsored promo popup popunder ga gtag gtm fingerprint affiliate consent cookie cookies gdpr social share sharing insights'.split(' '),
);
const words = (name) => name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

test('file and folder names avoid tracker and ad vocabulary', () => {
  const bad = appPaths(APP).filter((p) => words(p.split('?')[0]).some((w) => RISKY.has(w)));
  assert.deepEqual(bad, []);
});

test('CSS class names avoid ad and annoyance vocabulary (element hiding)', () => {
  const css = fs.readFileSync(path.join(APP, 'css/app.css'), 'utf8');
  const classes = [...new Set([...css.matchAll(/\.([a-z][a-z0-9_-]*)/gi)].map((m) => m[1]))].filter((c) => !/^(js|woff2|png|css)$/.test(c));
  assert.ok(classes.length > 50);
  const bad = classes.filter((c) => words(c).some((w) => RISKY.has(w)));
  assert.deepEqual(bad, []);
});

// --- the matcher itself ---------------------------------------------------------------------
const one = (text, url, type = 'script', opts) =>
  blockingRules(mergeLists([parseList(text, { host: HOST, requestHosts: ['script.google.com'] })]), url, type, opts).length > 0;
const own = (p) => `${BASE}${p}`;

test('matcher: path rules, anchors and separators', () => {
  assert.ok(one('/lib/analytics.js', own('js/lib/analytics.js')));
  assert.ok(one('-analytics.', own('js/x-analytics.js')));
  assert.ok(!one('/lib/analytics.js', own('js/lib/plateau.js')));
  assert.ok(one('||draineroff.github.io/Training/js/', own('js/main.js')));
  assert.ok(!one('||other.github.io^', own('js/main.js')));
  assert.ok(one('/stats^', own('stats?x=1')));
  assert.ok(!one('/stats^', own('statsx')));
  assert.ok(one('|https://draineroff.', own('a.js')));
  assert.ok(one('/\\/lib\\/[a-z]+\\.js$/', own('js/lib/util.js')));
});

test('matcher: options — party, domain, type, exceptions, native-app rules', () => {
  assert.ok(!one('/main.js$third-party', own('js/main.js')));
  assert.ok(one('/main.js$~third-party', own('js/main.js')));
  assert.ok(!one('/main.js$domain=example.com', own('js/main.js')));
  assert.ok(one('/main.js$domain=github.io', own('js/main.js')));
  assert.ok(!one('/main.js$domain=~draineroff.github.io', own('js/main.js')));
  assert.ok(!one('/main.js$image', own('js/main.js')));
  assert.ok(one('/main.js$script', own('js/main.js')));
  assert.ok(!one('/main.js\n@@/main.js', own('js/main.js')));
  assert.ok(one('/main.js$important\n@@/main.js', own('js/main.js')));
  assert.ok(!one('/main.js$app=com.example', own('js/main.js')));
  assert.ok(!one('/main.js\n/main.js$badfilter', own('js/main.js')));
  assert.ok(!one('$script,domain=draineroff.github.io,jsonprune=\\$..[a\\, "b"]', own('js/main.js')));
  assert.ok(!one('/main.js$csp=script-src none', own('js/main.js')));
});

test('matcher: third-party requests to the sync API', () => {
  const api = SYNC_URLS[0];
  assert.ok(one('||script.google.com^$third-party', api, 'xhr', { thirdParty: true }));
  assert.ok(!one('||script.google.com^$third-party,domain=example.com', api, 'xhr', { thirdParty: true }));
  assert.ok(!one('/macros/s/*/exec$script', api, 'xhr', { thirdParty: true }));
  assert.ok(!one('||script.google.com^$third-party', own('js/main.js')));
});
