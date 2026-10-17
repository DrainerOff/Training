// Content-blocker check for the published app.
//
//   node tools/blockers/check.mjs                  live lists: our URLs + every screen's DOM
//   node tools/blockers/check.mjs --update         …and refresh the snapshot used by the tests
//   node tools/blockers/check.mjs --lists <dir>    use already downloaded list files
//
// Exit code 1 when a filter rule would block one of our files or hide one of our elements.
// The snapshot (tests/fixtures/blocklists/*.txt.gz) keeps only the rules that can apply to a
// first-party request on our host, so the regular tests run offline.

import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseList, mergeLists, appUrlFindings, SYNC_HOSTS } from './abp.js';
import { LISTS, HOST } from './lists.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SNAPSHOT = path.join(ROOT, 'tests/fixtures/blocklists');
const args = process.argv.slice(2);
const update = args.includes('--update');
const listsDir = args.includes('--lists') ? args[args.indexOf('--lists') + 1] : null;

// File extensions are not foreign domains: "analytics.js" is a file, "tracker.com" a host.
const EXT = new Set('js mjs cjs css html htm png svg jpg jpeg gif webp ico avif woff woff2 ttf otf json webmanifest txt map php asp aspx jsp cgi pl xml'.split(' '));
const GTLD = new Set(
  'com net org info biz io co xyz top site online app dev me tv cc ru su us uk de fr it es nl pl eu jp cn in br au ca ch se no fi dk be at cz sk ua by kz ro hu gr pt tr ir il ae sa za mx ar cl vn th id my ph kr tw hk sg nz club live store shop pro win bid icu cloud click link space website tech fun buzz rest work today world life news media network digital agency global cyou monster sbs host page asia mobi name ws gg la lol fm am to ly tk ml ga cf gq pw su'.split(' '),
);
function mentionsForeignHost(text) {
  const body = text.replace(/^@@/, '').replace(/\$[^/]*$/, '').replace(/\\\./g, '.');
  for (const m of body.matchAll(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)) {
    const labels = m[0].toLowerCase().split('.');
    const last = labels[labels.length - 1];
    const site = labels.slice(-2).join('.');
    if (site === 'github.io' || site === 'google.com' || site === 'googleusercontent.com') continue; // our hosts
    if (!EXT.has(last) && (last.length === 2 || GTLD.has(last))) return true;
  }
  return false;
}

async function download() {
  const dir = listsDir || fs.mkdtempSync(path.join(os.tmpdir(), 'blocklists-'));
  const files = [];
  for (const [name, url] of LISTS) {
    const file = path.join(dir, url.replace(/^https:\/\/raw\.githubusercontent\.com\//, '').replace(/\//g, '__'));
    if (!listsDir || !fs.existsSync(file)) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      fs.writeFileSync(file, await res.text());
    }
    files.push({ name, url, file });
  }
  return files;
}

const files = await download();
const parsed = files.map((f) => parseList(fs.readFileSync(f.file, 'utf8'), { host: HOST, requestHosts: SYNC_HOSTS, source: `${f.name} (${path.basename(f.url)})` }));
const rules = mergeLists(parsed);

let problems = 0;
console.log(`Rules that can apply on ${HOST}: ${rules.block.length} block, ${rules.allow.length} exceptions, ${rules.hide.length} element-hiding`);
for (const f of appUrlFindings(rules, path.join(ROOT, 'app'))) {
  problems++;
  console.log(`BLOCKED  ${f.path} (${f.type})\n         ${f.rules.map((r) => `${r.text}   — ${r.where}`).join('\n         ')}`);
}

// Element hiding needs the real DOM: walk the app's screens in Chromium.
const unhidden = new Set(rules.unhide.map((u) => u.selector));
const selectors = new Map();
for (const h of rules.hide) if (!unhidden.has(h.selector) && !selectors.has(h.selector)) selectors.set(h.selector, h);
const { scanScreens } = await import('./scan.mjs');
for (const hit of await scanScreens([...selectors.keys()])) {
  problems++;
  const rule = selectors.get(hit.selector);
  console.log(`HIDDEN   ${hit.element} «${hit.text}» on ${hit.screen}\n         ${rule.text}   — ${rule.where}`);
}
console.log(problems ? `\n${problems} problem(s): rename the file / class, see docs/ARCHITECTURE.md` : 'No filter rule blocks a file or hides an element of the app.');

if (update) {
  fs.mkdirSync(SNAPSHOT, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const header = (what) =>
    [
      `! ${what} that can apply to the app at https://${HOST}/ (first-party, generic), from:`,
      ...[...new Set(LISTS.map(([n]) => n))].map((n) => `!   ${n}`),
      `! Generated ${date} by tools/blockers/check.mjs --update. Do not edit by hand.`,
    ].join('\n');
  const network = [...new Set([...rules.block, ...rules.allow].map((r) => r.text).filter((t) => !mentionsForeignHost(t)))].sort();
  const cosmetic = [...new Set([...selectors.values()].map((h) => `##${h.selector}`))].sort();
  const write = (name, text) => fs.writeFileSync(path.join(SNAPSHOT, name), zlib.gzipSync(text, { level: 9 }));
  write('network.txt.gz', `${header('Network rules')}\n${network.join('\n')}\n`);
  write('cosmetic.txt.gz', `${header('Element-hiding selectors')}\n${cosmetic.join('\n')}\n`);
  console.log(`Snapshot updated: ${network.length} network rules, ${cosmetic.length} selectors`);
}
process.exit(problems ? 1 : 0);
