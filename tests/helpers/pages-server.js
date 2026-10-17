// A stand-in for GitHub Pages in update tests: serves one release at /Training/ (project-site
// path, max-age=600 like Pages), stamps __BUILD__ like CI, and can switch to another release
// or break single files while a browser keeps its service worker, caches and IndexedDB.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const APP = path.join(ROOT, 'app');
export const RELEASES = path.join(ROOT, 'tests/fixtures/releases');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const STAMPED = new Set(['sw.js', 'boot.js', 'js/main.js']);

export async function startPages({ base = '/Training/' } = {}) {
  const release = { root: APP, build: 'dev' };
  const overrides = new Map(); // relative path -> { body, status } | { hang: true }
  const requests = [];
  const hanging = new Set();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push({ path: url.pathname, mode: req.headers['sec-fetch-mode'] || '', dest: req.headers['sec-fetch-dest'] || '' });
    if (url.pathname === base.slice(0, -1)) {
      res.writeHead(301, { Location: base }).end();
      return;
    }
    if (!url.pathname.startsWith(base)) {
      res.writeHead(404).end('not found');
      return;
    }
    const rel = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
    const type = MIME[path.extname(rel)] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': 'max-age=600' };
    const override = overrides.get(rel);
    if (override?.hang) {
      hanging.add(res);
      return; // never answers
    }
    if (override) {
      res.writeHead(override.status || 200, headers).end(override.body);
      return;
    }
    // Files the release fixture leaves out (fonts, icons) come from the current app.
    let file = null;
    for (const dir of [release.root, APP]) {
      const candidate = path.normalize(path.join(dir, rel));
      if (candidate.startsWith(dir) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        file = candidate;
        break;
      }
    }
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/html' }).end('<h1>404</h1>');
      return;
    }
    let body = fs.readFileSync(file);
    if (STAMPED.has(rel)) body = body.toString('utf8').replaceAll('__BUILD__', release.build);
    res.writeHead(200, headers).end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}${base}`,
    requests,
    // Pages for the app itself (navigations), e.g. to count reloads.
    navigations: () => requests.filter((r) => r.mode === 'navigate').length,
    publish(root, build) {
      release.root = root;
      release.build = build;
    },
    override(rel, value) {
      if (value === null) overrides.delete(rel);
      else overrides.set(rel, typeof value === 'string' ? { body: value } : value);
    },
    close() {
      for (const res of hanging) res.destroy();
      server.closeAllConnections?.();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
