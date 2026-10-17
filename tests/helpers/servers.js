// Local servers for development and E2E tests:
//  * static server for ./app (what GitHub Pages would serve);
//  * fake Apps Script endpoint running the real apps-script/Code.gs on in-memory sheets,
//    with CORS headers like the real googleusercontent.com redirect target.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas } from './fake-gas.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function startStatic({ port = 5173, root = path.join(ROOT, 'app') } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

export function startFakeGas({ port = 5174, legacy } = {}) {
  const gas = createGas({ legacy });
  const token = gas.call('setup');
  const control = { dropResponses: 0, down: false, requests: 0 };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') {
      // The real Apps Script cannot answer preflights; the client must not need one.
      res.writeHead(405).end();
      return;
    }
    if (url.pathname === '/__state') {
      const dump = {};
      for (const sh of gas.spreadsheet.getSheets()) dump[sh.getName()] = sh.rows();
      res.writeHead(200, cors).end(JSON.stringify(dump));
      return;
    }
    if (url.pathname !== '/exec') {
      res.writeHead(404).end();
      return;
    }
    if (req.method === 'GET') {
      res.writeHead(200, cors).end(JSON.stringify(gas.get()));
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      control.requests++;
      if (control.down) {
        req.socket.destroy();
        return;
      }
      if (req.headers['content-type'] && !req.headers['content-type'].startsWith('text/plain')) {
        res.writeHead(415, cors).end(JSON.stringify({ ok: false, error: 'expected text/plain' }));
        return;
      }
      const out = gas.post(body);
      if (control.dropResponses > 0) {
        control.dropResponses--;
        req.socket.destroy(); // written on the server, response lost on the way back
        return;
      }
      res.writeHead(200, cors).end(JSON.stringify(out));
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, gas, token, control, url: `http://127.0.0.1:${port}/exec` })));
}
