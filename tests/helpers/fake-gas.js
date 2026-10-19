// Minimal in-memory emulation of the Apps Script services used by apps-script/Code.gs.
// Lets the real backend code run in Node for tests and as a local server for E2E runs.
// It mimics the Sheets behaviours that matter for correctness:
//  * range bounds are enforced (writing past max rows throws, like in Sheets);
//  * a leading apostrophe forces text and is not stored;
//  * "YYYY-MM-DD" strings become Date objects unless the cell is formatted as text "@";
//  * strings starting with "=" become formulas unless forced to text.

import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CODE = fs.readFileSync(path.join(ROOT, 'apps-script/Code.gs'), 'utf8');

// `code`: another Code.gs, e.g. tests/fixtures/apps-script/Code.api1.gs (the deployed version
// before manual records) to test that a newer app never loses data against an older server.
export function createGas({ legacy = {}, timeZone = 'Europe/Moscow', code = CODE } = {}) {
  const ctx = vm.createContext({ console });
  const CtxDate = vm.runInContext('Date', ctx);

  class Sheet {
    constructor(name, rows = [], maxRows = 1000, maxCols = 26) {
      this.name = name;
      this.maxRows = Math.max(maxRows, rows.length);
      this.maxCols = Math.max(maxCols, ...rows.map((r) => r.length), 1);
      this.data = rows.map((r) => r.slice());
      this.formats = new Map();
      this.formulas = [];
    }
    getName() { return this.name; }
    getMaxRows() { return this.maxRows; }
    getMaxColumns() { return this.maxCols; }
    getLastRow() {
      for (let r = this.data.length - 1; r >= 0; r--) if ((this.data[r] || []).some((v) => v !== '' && v != null)) return r + 1;
      return 0;
    }
    getLastColumn() {
      let m = 0;
      for (const row of this.data) for (let c = (row || []).length - 1; c >= 0; c--) if (row[c] !== '' && row[c] != null) { m = Math.max(m, c + 1); break; }
      return m;
    }
    insertRowsAfter(after, n) {
      this.maxRows += n;
      this.data.splice(after, 0, ...Array.from({ length: Math.max(0, Math.min(n, this.data.length - after)) }, () => []));
    }
    insertColumnsAfter(after, n) { this.maxCols += n; }
    setFrozenRows() {}
    clearContents() { this.data = []; }
    getRange(row, col, nr = 1, nc = 1) {
      if (row < 1 || col < 1 || row + nr - 1 > this.maxRows || col + nc - 1 > this.maxCols || nr < 1 || nc < 1) {
        throw new Error(`Range out of bounds: ${this.name}!R${row}C${col}:${nr}x${nc} (max ${this.maxRows}x${this.maxCols})`);
      }
      return new Range(this, row, col, nr, nc);
    }
    cell(r, c) {
      return (this.data[r - 1] || [])[c - 1] ?? '';
    }
    put(r, c, v) {
      while (this.data.length < r) this.data.push([]);
      const row = this.data[r - 1];
      while (row.length < c) row.push('');
      const fmt = this.formats.get(`${r},${c}`);
      if (typeof v === 'string') {
        if (v.startsWith("'")) v = v.slice(1);
        else if (fmt !== '@' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
          const [y, m, d] = v.split('-').map(Number);
          v = new CtxDate(Date.UTC(y, m - 1, d));
        } else if (fmt !== '@' && v.startsWith('=')) {
          this.formulas.push(v);
          v = '#FORMULA';
        }
      }
      row[c - 1] = v;
    }
    rows() {
      const last = this.getLastRow();
      const w = this.getLastColumn();
      return Array.from({ length: last }, (_, r) => Array.from({ length: w }, (_, c) => this.cell(r + 1, c + 1)));
    }
  }

  class Range {
    constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
    getSheet() { return this.sheet; }
    getRow() { return this.row; }
    getColumn() { return this.col; }
    getNumRows() { return this.nr; }
    getValues() {
      return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => this.sheet.cell(this.row + i, this.col + j)));
    }
    getDisplayValues() {
      return this.getValues().map((r) => r.map((v) => (v instanceof CtxDate ? v.toISOString().slice(0, 10) : String(v))));
    }
    setValues(values) {
      if (values.length !== this.nr || values.some((r) => r.length !== this.nc)) {
        throw new Error(`setValues dimension mismatch: got ${values.length}x${values[0]?.length}, range ${this.nr}x${this.nc}`);
      }
      values.forEach((r, i) => r.forEach((v, j) => this.sheet.put(this.row + i, this.col + j, v)));
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
    setNumberFormat(fmt) {
      for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.formats.set(`${this.row + i},${this.col + j}`, fmt);
      return this;
    }
    clearContent() {
      for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) {
        const row = this.sheet.data[this.row + i - 1];
        if (row && row.length >= this.col + j) row[this.col + j - 1] = '';
      }
      return this;
    }
  }

  const sheets = Object.entries(legacy).map(([name, rows]) => new Sheet(name, rows));
  const spreadsheet = {
    getName: () => 'Тренировки (тест)',
    getId: () => 'test-spreadsheet-id',
    getSpreadsheetTimeZone: () => timeZone,
    getSheets: () => sheets.slice(),
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet(name, index = sheets.length) {
      if (sheets.some((s) => s.name === name)) throw new Error(`Sheet ${name} exists`);
      const sh = new Sheet(name);
      sheets.splice(index, 0, sh);
      return sh;
    },
    copies: [],
    copy(name) {
      const snapshot = sheets.map((sh) => ({ name: sh.name, rows: sh.rows().map((r) => r.slice()) }));
      const id = `copy-${spreadsheet.copies.length + 1}`;
      spreadsheet.copies.push({ name, id, sheets: snapshot });
      return { getName: () => name, getId: () => id, getUrl: () => `https://docs.google.com/spreadsheets/d/${id}` };
    },
  };

  const props = new Map();
  const logs = [];
  // A web-app execution may have no "active" spreadsheet; tests can switch that off.
  let activeAvailable = true;
  const globals = {
    SpreadsheetApp: {
      getActive: () => (activeAvailable ? spreadsheet : null),
      openById: (id) => {
        if (id !== spreadsheet.getId()) throw new Error(`No access to spreadsheet ${id}`);
        return spreadsheet;
      },
      flush() {},
      getUi() { throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v)),
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'JSON', TEXT: 'TEXT' },
      createTextOutput(content) {
        return { content, setMimeType() { return this; }, getContent() { return this.content; } };
      },
    },
    Utilities: {
      DigestAlgorithm: { MD5: 'md5' },
      Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, text) => [...crypto.createHash(alg).update(String(text), 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
      base64Encode: (bytes) => Buffer.from(bytes.map((b) => (b + 256) % 256)).toString('base64'),
      formatDate: (d) => new Date(d.getTime()).toISOString().slice(0, 10),
    },
    Logger: { log: (m) => logs.push(String(m)) },
  };
  Object.assign(ctx, globals);
  vm.runInContext(code, ctx, { filename: 'Code.gs' });

  return {
    ctx,
    spreadsheet,
    props,
    logs,
    sheet: (name) => spreadsheet.getSheetByName(name),
    setActiveAvailable(v) {
      activeAvailable = v;
    },
    post(req) {
      const out = ctx.doPost({ postData: { contents: typeof req === 'string' ? req : JSON.stringify(req) } });
      return JSON.parse(out.getContent());
    },
    get() {
      return JSON.parse(ctx.doGet({}).getContent());
    },
    call(fn, ...args) {
      return ctx[fn](...args);
    },
    // The owner pastes a new Code.gs and deploys a new version: same sheet, same key, same URL.
    redeploy(newCode = CODE) {
      vm.runInContext(newCode, ctx, { filename: 'Code.gs' });
    },
    edit(sheetName, row, col, value) {
      const sh = spreadsheet.getSheetByName(sheetName);
      sh.getRange(row, col).setValue(value);
      ctx.onEdit({ range: sh.getRange(row, col) });
    },
  };
}
