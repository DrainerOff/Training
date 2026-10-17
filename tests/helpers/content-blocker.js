// Emulates a Safari content blocker in Chromium with the filter rules from
// tests/fixtures/blocklists (real EasyList / EasyPrivacy / AdGuard rules), as if the app were
// served from draineroff.github.io.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseList, mergeLists, blockingRules, appPaths, typesFor, SYNC_HOSTS } from '../../tools/blockers/abp.js';
import { HOST, BASE } from '../../tools/blockers/lists.js';

const SNAPSHOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/blocklists');
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app');

export function snapshotText(name) {
  return zlib.gunzipSync(fs.readFileSync(path.join(SNAPSHOT, name))).toString('utf8');
}

let cached;
export function snapshotRules(extra = '') {
  if (!extra && cached) return cached;
  const rules = mergeLists([
    parseList(snapshotText('network.txt.gz'), { host: HOST, requestHosts: SYNC_HOSTS, source: 'snapshot' }),
    parseList(extra, { host: HOST, requestHosts: SYNC_HOSTS, source: 'test' }),
  ]);
  if (!extra) cached = rules;
  return rules;
}

export function snapshotSelectors() {
  return snapshotText('cosmetic.txt.gz')
    .split('\n')
    .filter((l) => l.startsWith('##'))
    .map((l) => l.slice(2));
}

// Blocks, in this page, every file of the given release roots that a rule refuses. Uses the
// DevTools protocol rather than request routing: like Safari's content blockers it also
// refuses files the service worker would serve from its cache. Returns the refused requests
// ({ path, rule }) as they happen.
export async function emulateContentBlocker(page, localBase, { roots = [APP], extraRules = '' } = {}) {
  const rules = snapshotRules(extraRules);
  const blocked = new Map();
  for (const root of new Set([...roots, APP])) {
    for (const p of appPaths(root)) {
      for (const type of typesFor(p.split('?')[0])) {
        const hits = blockingRules(rules, BASE + p, type);
        if (hits.length && !blocked.has(p)) blocked.set(p, hits[0].text);
      }
    }
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: [...blocked.keys()].flatMap((p) => [localBase + p, `${localBase + p}?*`]) });
  const refused = [];
  const urls = new Map();
  cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url));
  cdp.on('Network.loadingFailed', (e) => {
    if (!e.blockedReason && !/BLOCKED_BY_CLIENT/.test(e.errorText || '')) return;
    const p = (urls.get(e.requestId) || '').slice(localBase.length).split('?')[0];
    if (!refused.some((r) => r.path === p)) refused.push({ path: p, rule: blocked.get(p) });
  });
  return refused;
}
