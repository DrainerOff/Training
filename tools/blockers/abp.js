import fs from 'node:fs';
import path from 'node:path';

// A small matcher for Adblock Plus / AdGuard / uBlock filter syntax — the lists that Safari
// content blockers (AdGuard, 1Blocker, Wipr, AdBlock Pro, …) compile into WebKit rules.
// It answers one question for this app: would a filter rule block one of our own files, or
// hide one of our own elements? Only what can apply to a first-party request on our host is
// evaluated; everything else is skipped.

// Options that never block a request by themselves.
const NON_BLOCKING = new Set([
  'removeparam', 'queryprune', 'csp', 'cookie', 'header', 'removeheader', 'permissions', 'replace',
  'jsonprune', 'xmlprune', 'hls', 'urltransform', 'stealth', 'referrerpolicy', 'popup', 'popunder',
  'elemhide', 'ehide', 'specifichide', 'shide', 'generichide', 'ghide', 'genericblock', 'jsinject',
  'content', 'extension', 'urlblock', 'network', 'redirect-rule', 'badfilter', 'inline-script',
  'inline-font', 'cname', 'ipaddress', 'reason',
]);
const TYPES = {
  script: 'script', stylesheet: 'stylesheet', css: 'stylesheet', image: 'image', font: 'font',
  xmlhttprequest: 'xhr', xhr: 'xhr', document: 'document', doc: 'document', subdocument: 'subdocument',
  frame: 'subdocument', media: 'media', object: 'object', 'object-subrequest': 'object', other: 'other',
  ping: 'ping', beacon: 'ping', websocket: 'websocket', webrtc: 'webrtc', all: '*',
};

function hostMatches(host, domain) {
  domain = domain.toLowerCase();
  if (domain.endsWith('.*')) {
    // AdGuard/uBO entity: "example.*" = example.<any tld>
    const base = domain.slice(0, -2);
    return host === base || host.startsWith(`${base}.`) || host.includes(`.${base}.`);
  }
  return host === domain || host.endsWith(`.${domain}`);
}

// true / false / null (no domain restriction)
function domainListApplies(list, host) {
  const parts = list.split(/[|,]/).map((d) => d.trim()).filter(Boolean);
  const positive = parts.filter((d) => !d.startsWith('~'));
  const negative = parts.filter((d) => d.startsWith('~')).map((d) => d.slice(1));
  if (negative.some((d) => hostMatches(host, d))) return false;
  if (positive.length) return positive.some((d) => hostMatches(host, d));
  return true;
}

function escapeRe(s) {
  return s.replace(/[.+?${}()|[\]\\/]/g, '\\$&');
}

export function patternToRegExp(pattern, matchCase = false) {
  let re = '';
  let body = pattern;
  if (body.startsWith('||')) {
    re = '^[a-z][a-z0-9+.-]*:\\/\\/(?:[^\\/?#]*\\.)?';
    body = body.slice(2);
  } else if (body.startsWith('|')) {
    re = '^';
    body = body.slice(1);
  }
  let end = '';
  if (body.endsWith('|')) {
    end = '$';
    body = body.slice(0, -1);
  }
  for (const ch of body) {
    if (ch === '*') re += '.*';
    else if (ch === '^') re += '(?:[^\\w\\-.%]|$)';
    else re += escapeRe(ch);
  }
  return new RegExp(re + end, matchCase ? '' : 'i');
}

const COSMETIC = /^(.*?)(#@?\$?\??#|#@?%#|\$\$|\$@\$)(.*)$/;

// Parses list text into the rules that could apply to requests from a page on `host` to
// `host` itself or to one of `requestHosts` (third-party: the Apps Script API).
export function parseList(text, { host, requestHosts = [], source = '' } = {}) {
  const targets = [host, ...requestHosts];
  const out = { block: [], allow: [], hide: [], unhide: [], badfilters: new Set() };
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim();
    if (!line || line.startsWith('!') || line.startsWith('[') || line.startsWith('# ') || line === '#') continue;
    const where = `${source}:${n + 1}`;

    const cos = line.match(COSMETIC);
    if (cos && !line.startsWith('/') && !/^@@/.test(line)) {
      const [, domains, sep, body] = cos;
      if (sep.includes('%') || sep.includes('$$') || sep === '$@$') continue; // scriptlets / HTML filtering
      if (domains && domainListApplies(domains, host) === false) continue;
      if (/^\+js\(|^\/\/scriptlet\(/.test(body)) continue;
      let selector = body;
      if (sep.includes('$')) {
        // CSS injection: "selector { style }" — counts when it hides
        const m = body.match(/^(.*?)\s*\{([^}]*)\}\s*$/);
        if (!m || !/display\s*:\s*none|visibility\s*:\s*hidden|height\s*:\s*0|opacity\s*:\s*0/i.test(m[2])) continue;
        selector = m[1];
      }
      const rule = { selector, generic: !domains || domains.split(',').every((d) => d.trim().startsWith('~')), text: line, where };
      (sep.includes('@') ? out.unhide : out.hide).push(rule);
      continue;
    }

    let rule = line;
    let allow = false;
    if (rule.startsWith('@@')) {
      allow = true;
      rule = rule.slice(2);
    }
    let pattern = rule;
    let optionText = '';
    let isRegex = false;
    if (rule.startsWith('/')) {
      const m = rule.match(/^\/(.+)\/(?:\$([^/]*))?$/);
      if (m) {
        isRegex = true;
        pattern = m[1];
        optionText = m[2] || '';
      }
    }
    if (!isRegex) {
      // The options start at the last "$" that isn't escaped (AdGuard writes "\$" in values).
      let i = rule.length;
      do i = rule.lastIndexOf('$', i - 1);
      while (i > 0 && rule[i - 1] === '\\');
      if (i >= 0 && /^[~a-z0-9_-]+(?:[=,]|$)/i.test(rule.slice(i + 1))) {
        pattern = rule.slice(0, i);
        optionText = rule.slice(i + 1);
      }
    }
    const opts = {};
    for (const raw of optionText ? optionText.split(/,(?=~?[a-z0-9_-]+(?:=|,|$))/i) : []) {
      const [k, ...v] = raw.split('=');
      opts[k.trim().toLowerCase()] = v.length ? v.join('=') : true;
    }
    if (opts.badfilter) {
      const { badfilter, ...rest } = opts;
      out.badfilters.add(`${allow ? '@@' : ''}${pattern}|${Object.keys(rest).sort().join(',')}`);
      continue;
    }
    if (!allow && Object.keys(opts).some((k) => NON_BLOCKING.has(k.replace(/^~/, '')) && k !== 'redirect')) continue;
    // Rules for native apps (AdGuard for Android/Windows) never run in Safari.
    if (opts.app) continue;
    const party = opts['third-party'] || opts['3p'] || opts['~first-party'] || opts['~1p'] || opts.strict3p ? 'third'
      : opts['~third-party'] || opts['~3p'] || opts['first-party'] || opts['1p'] || opts.strict1p ? 'first' : 'any';
    const scope = opts.domain ?? opts.from; // the page's domain
    if (scope && domainListApplies(scope, host) === false) continue;
    const to = opts.to ?? null; // the request's domain
    if (to && !targets.some((t) => domainListApplies(to, t))) continue;
    const denyallow = opts.denyallow ? String(opts.denyallow).split('|') : null;
    if (opts.method) {
      const methods = String(opts.method).toLowerCase().split('|');
      const pos = methods.filter((m) => !m.startsWith('~'));
      if (methods.includes('~get') || (pos.length && !pos.includes('get'))) continue;
    }
    // Cheap pre-filter: a "||domain" rule only matters for the hosts we request.
    if (!isRegex && pattern.startsWith('||')) {
      const d = pattern.slice(2).split(/[/^*|:?]/)[0];
      if (d && !d.includes('*') && !targets.some((t) => hostMatches(t, d))) continue;
    }
    const types = new Set();
    const notTypes = new Set();
    for (const k of Object.keys(opts)) {
      const neg = k.startsWith('~');
      const t = TYPES[neg ? k.slice(1) : k];
      if (t) (neg ? notTypes : types).add(t);
    }
    if (!pattern || pattern === '*') {
      // "Everything" rules only make sense with a domain or type restriction we already applied.
      if (!scope && !types.size) continue;
      pattern = '*';
    }
    let re;
    try {
      re = isRegex ? new RegExp(pattern, opts['match-case'] ? '' : 'i') : patternToRegExp(pattern, !!opts['match-case']);
    } catch {
      continue;
    }
    const entry = { re, types, notTypes, party, to, denyallow, important: !!opts.important, text: line, where, key: `${allow ? '@@' : ''}${pattern}|${Object.keys(opts).sort().join(',')}` };
    (allow ? out.allow : out.block).push(entry);
  }
  return out;
}

export function mergeLists(parsed) {
  const all = { block: [], allow: [], hide: [], unhide: [], badfilters: new Set() };
  for (const p of parsed) {
    for (const k of ['block', 'allow', 'hide', 'unhide']) for (const r of p[k]) all[k].push(r);
    for (const b of p.badfilters) all.badfilters.add(b);
  }
  all.block = all.block.filter((r) => !all.badfilters.has(r.key));
  all.allow = all.allow.filter((r) => !all.badfilters.has(r.key));
  return all;
}

function applies(rule, url, type, thirdParty) {
  if (rule.notTypes.has(type)) return false;
  if (rule.types.size ? !(rule.types.has(type) || rule.types.has('*')) : type === 'document' || type === 'subdocument') return false;
  if (rule.party === 'third' && !thirdParty) return false;
  if (rule.party === 'first' && thirdParty) return false;
  const requestHost = new URL(url).hostname;
  if (rule.to && !domainListApplies(rule.to, requestHost)) return false;
  if (rule.denyallow && rule.denyallow.some((d) => hostMatches(requestHost, d))) return false;
  return rule.re.test(url);
}

// Returns the rules that block `url` for a request of `type`, after exceptions.
export function blockingRules(rules, url, type, { thirdParty = false } = {}) {
  const hits = rules.block.filter((r) => applies(r, url, type, thirdParty));
  if (!hits.length) return [];
  const exceptions = rules.allow.filter((r) => applies(r, url, type, thirdParty));
  if (!exceptions.length) return hits;
  const importantExceptions = exceptions.some((e) => e.important);
  return importantExceptions ? [] : hits.filter((h) => h.important);
}

// The resource types a browser may use when loading one of our files.
export function typesFor(path) {
  if (path === '' || path.endsWith('/') || path.endsWith('.html')) return ['document'];
  if (path.endsWith('.js') || path.endsWith('.mjs')) return ['script', 'xhr', 'other'];
  if (path.endsWith('.css')) return ['stylesheet', 'other'];
  if (path.endsWith('.woff2') || path.endsWith('.woff')) return ['font', 'other'];
  if (/\.(png|svg|jpe?g|webp|gif|ico)$/.test(path)) return ['image', 'other'];
  return ['other', 'xhr'];
}

// Every URL the app loads: its files, plus the page and the boot.js probes.
export function appPaths(appDir) {
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : [path.relative(appDir, p).split(path.sep).join('/')];
    });
  return ['', 'index.html', '?heal=1', 'sw.js?probe=1', ...walk(appDir)];
}

// The sync API as the app calls it: POST to the deployment URL, which Google answers with a
// redirect to googleusercontent.com (both third-party for the page).
export const SYNC_URLS = [
  'https://script.google.com/macros/s/AKfycbxDEPLOYMENTIDDEPLOYMENTIDDEPLOYMENTIDxyz/exec',
  'https://script.googleusercontent.com/macros/echo?user_content_key=KEYKEYKEYKEY&lib=LIBLIBLIB',
];
export const SYNC_HOSTS = ['script.google.com', 'script.googleusercontent.com'];

// [{ path, type, rules }] for every app URL (and the sync API) that a rule would block.
export function appUrlFindings(rules, appDir, base = 'https://draineroff.github.io/Training/') {
  const out = [];
  for (const p of appPaths(appDir)) {
    for (const type of typesFor(p.split('?')[0])) {
      const hits = blockingRules(rules, base + p, type);
      if (hits.length) out.push({ path: p, type, rules: hits });
    }
  }
  for (const url of SYNC_URLS) {
    const hits = blockingRules(rules, url, 'xhr', { thirdParty: true });
    if (hits.length) out.push({ path: url, type: 'xhr', rules: hits });
  }
  return out;
}
