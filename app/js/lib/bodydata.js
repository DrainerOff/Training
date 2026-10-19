// Body measurements and sleep: kinds, file formats, record ids, import plans and the daily
// series the screens draw. Pure functions — no DOM, no storage — so Node tests cover them.
//
// One record = one real measurement of one quantity (entity `body`, sheet App_Body) or one main
// sleep per wake date (entity `sleep`, sheet App_Sleep). Ids are deterministic, so the same
// measurement arriving twice (a re-import, a second device, another route) is the same row.

import { median, sum } from './util.js';

// Order = order on screen. `fitdays` = column header in the Fitdays+ export.
export const KINDS = {
  weight: { label: 'Вес', unit: 'кг', min: 20, max: 300 },
  fat: { label: 'Жир (оценка весов)', unit: '%', min: 2, max: 70 },
  waist: { label: 'Талия', unit: 'см', min: 10, max: 250, fitdays: 'Талия' },
  chest: { label: 'Грудь', unit: 'см', min: 10, max: 250, fitdays: 'Грудь' },
  shoulders: { label: 'Плечи', unit: 'см', min: 10, max: 250, fitdays: 'Плечо' },
  neck: { label: 'Шея', unit: 'см', min: 10, max: 250, fitdays: 'Шея' },
  arm_l: { label: 'Рука левая', unit: 'см', min: 10, max: 250, fitdays: 'Л Рука' },
  arm_r: { label: 'Рука правая', unit: 'см', min: 10, max: 250, fitdays: 'П Рука' },
  hips: { label: 'Бёдра', unit: 'см', min: 10, max: 250, fitdays: 'Бедро' },
  thigh_l: { label: 'Бедро левое', unit: 'см', min: 10, max: 250, fitdays: 'L-бедро' },
  thigh_r: { label: 'Бедро правое', unit: 'см', min: 10, max: 250, fitdays: 'R бедра' },
  calf_l: { label: 'Голень левая', unit: 'см', min: 10, max: 250, fitdays: 'Л Голень' },
  calf_r: { label: 'Голень правая', unit: 'см', min: 10, max: 250, fitdays: 'П Голень' },
  head: { label: 'Голова', unit: 'см', min: 10, max: 250, fitdays: 'Голова' },
};
export const GIRTHS = Object.keys(KINDS).filter((k) => KINDS[k].unit === 'см');
// Fitdays+ columns that are derived, not measured: never stored.
const FITDAYS_DERIVED = ['Соотношение талии и бедер'];

// Where a value came from, reduced to a stable family: the same measurement written by Fitdays+
// into Health and exported by Fitdays+ as CSV is one family, so it is one record.
export function sourceFamily(name) {
  const s = String(name || '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (s === 'manual' || s === 'вручную') return 'manual';
  if (/zepp|mi fit|mifit/.test(s)) return 'zepp';
  if (/fitdays/.test(s)) return 'fitdays';
  if (/watch/.test(s)) return 'watch';
  if (s === 'здоровье' || s === 'health' || s === 'apple health') return 'health';
  const slug = s.replace(/[^a-z0-9а-яё]+/g, '-').replace(/^-+|-+$/g, '');
  return /^[a-z0-9-]+$/.test(slug) && slug ? slug.slice(0, 24) : 'other';
}

// --- CSV ---------------------------------------------------------------------------------------

// RFC 4180-ish: quotes, doubled quotes, CRLF, BOM; the delimiter is guessed from the header
// (Excel with a Russian locale saves ";").
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delim = [';', '\t', ','].reduce((best, d) => (count(firstLine, d) > count(firstLine, best) ? d : best), ',');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function count(s, ch) {
  return s.split(ch).length - 1;
}

// "84.5 cm", "84,5", "79.85" → number; "--", "" → null; anything else → NaN (a row error).
export function parseValue(raw) {
  const s = String(raw ?? '').trim();
  if (!s || /^-+$/.test(s)) return null;
  const m = s.replace(/\s+/g, ' ').match(/^(-?\d+(?:[.,]\d+)?)\s*(cm|см|kg|кг|%)?$/i);
  return m ? Number(m[1].replace(',', '.')) : NaN;
}

// --- time ----------------------------------------------------------------------------------------

const pad = (n, w = 2) => String(n).padStart(w, '0');

function fmtOffset(min) {
  const sign = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  return `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

// The device's own offset at that wall-clock moment (an export without a zone was written on it).
export function deviceOffset(y, mo, d, h, mi) {
  return -new Date(y, mo - 1, d, h, mi).getTimezoneOffset();
}

// Accepts the formats of the attached exports:
//   2021-07-25 16:38:10 +0300 · 2023-11-26T08:18:00+03:00 · 19/10/2026 18:06 (no zone)
// Returns the instant, the wall clock as written and how precise it is.
export function parseTime(raw, { offset = deviceOffset } = {}) {
  const s = String(raw || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  let y, mo, d, h, mi, sec, zone;
  if (m) [, y, mo, d, h, mi, sec, zone] = m;
  else {
    m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    [, d, mo, y, h, mi, sec] = m;
  }
  [y, mo, d, h, mi] = [y, mo, d, h, mi].map(Number);
  const seconds = sec != null ? Number(sec) : null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || (seconds != null && seconds > 59)) return null;
  let off;
  if (zone === 'Z') off = 0;
  else if (zone) {
    const z = zone.replace(':', '');
    off = (z[0] === '-' ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5)));
  } else off = offset(y, mo, d, h, mi);
  const utc = Date.UTC(y, mo - 1, d, h, mi, seconds || 0) - off * 60000;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null; // 31.02
  const local = `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}${seconds != null ? ':' + pad(seconds) : ''}${fmtOffset(off)}`;
  return { utc, local, date: local.slice(0, 10), precision: seconds != null ? 's' : 'm', zoned: !!zone };
}

function utcStamp(utc, precision) {
  const t = new Date(utc).toISOString(); // 2026-10-19T15:06:00.000Z
  const base = t.slice(0, 4) + t.slice(5, 7) + t.slice(8, 10) + 'T' + t.slice(11, 13) + t.slice(14, 16);
  return precision === 's' ? base + t.slice(17, 19) : base;
}

// --- ids -----------------------------------------------------------------------------------------

const valueKey = (v) => Math.round(Number(v) * 100);

// A stable id of the source (a HealthKit sample UUID) wins. Otherwise: quantity, source family,
// UTC time as precise as the route knows it, the value as measured. `ordinal` separates identical
// rows of one minute-precision file (two real measurements that read the same), so a re-import of
// the same file yields the same ids.
export function bodyId({ kind, family, utc, precision, value, srcId = null }, ordinal = 1) {
  if (srcId) return `b:${kind}:u:${String(srcId).replace(/[^A-Za-z0-9-]/g, '').slice(0, 40)}`;
  return `b:${kind}:${family}:${utcStamp(utc, precision)}:${valueKey(value)}${ordinal > 1 ? ':' + ordinal : ''}`;
}

// Same measurement from routes of different precision (CSV to the minute, Health to the second).
function matchKey(kind, family, utc, value) {
  return `${kind}|${family}|${utcStamp(utc, 'm')}|${valueKey(value)}`;
}

export const sleepId = (wakeDate) => `s:${wakeDate}`;

// --- formats -------------------------------------------------------------------------------------

const norm = (h) => String(h || '').trim().toLowerCase();

export function detectFormat(header) {
  const h = header.map(norm);
  if (h.includes('local_datetime') && h.includes('weight_kg')) return 'weight';
  if (h.includes('wake_date') && h.includes('sleep_hours')) return 'sleep';
  if (h[0] === 'время' && h.some((x) => x === 'талия')) return 'fitdays';
  return null;
}

export const FORMAT_LABEL = {
  weight: 'Вес из «Здоровья» (Zepp Life)',
  sleep: 'Сон Apple Watch (основной сон по датам)',
  fitdays: 'Замеры Fitdays+',
};

// File text → candidate records + per-line problems. Nothing here looks at what is already stored.
export function parseFile(text, opts = {}) {
  const rows = parseCsv(text);
  if (!rows.length) return { format: null, items: [], errors: [{ line: 0, reason: 'Файл пустой' }], ignored: [] };
  const [header, ...data] = rows;
  const format = detectFormat(header);
  if (!format) return { format: null, items: [], errors: [{ line: 1, reason: 'Неизвестный формат: нет нужных столбцов' }], ignored: [] };
  const col = (name) => header.findIndex((h) => norm(h) === norm(name));
  const items = [];
  const errors = [];
  const ignored = [];
  const err = (i, reason) => errors.push({ line: i + 2, reason });

  if (format === 'weight') {
    const [ct, cv, cs] = [col('local_datetime'), col('weight_kg'), col('source')];
    data.forEach((r, i) => {
      const t = parseTime(r[ct], opts);
      const v = parseValue(r[cv]);
      if (!t) return err(i, 'не распознаны дата и время');
      if (!(v >= KINDS.weight.min && v <= KINDS.weight.max)) return err(i, 'вес вне диапазона 20–300 кг');
      const source = (cs >= 0 && r[cs]?.trim()) || 'Здоровье';
      items.push({ type: 'body', kind: 'weight', value: v, time: t, source, family: sourceFamily(source) });
    });
  } else if (format === 'sleep') {
    const c = Object.fromEntries(['wake_date', 'sleep_start_local', 'sleep_end_local', 'sleep_hours', 'core_hours', 'deep_hours', 'rem_hours', 'unspecified_hours', 'segments'].map((k) => [k, col(k)]));
    data.forEach((r, i) => {
      const wake = String(r[c.wake_date] || '').trim();
      const start = parseTime(r[c.sleep_start_local], opts);
      const end = parseTime(r[c.sleep_end_local], opts);
      const hours = parseValue(r[c.sleep_hours]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(wake) || !start || !end) return err(i, 'не распознаны даты сна');
      if (!(hours > 0 && hours <= 24) || end.utc <= start.utc) return err(i, 'длительность сна вне 0–24 ч');
      const num = (k) => {
        const v = c[k] >= 0 ? parseValue(r[c[k]]) : null;
        return Number.isFinite(v) ? v : null;
      };
      items.push({
        type: 'sleep',
        wakeDate: wake,
        start: start.local,
        end: end.local,
        hours,
        core: num('core_hours'),
        deep: num('deep_hours'),
        rem: num('rem_hours'),
        unspec: num('unspecified_hours'),
        segments: num('segments'),
        source: 'Apple Watch',
      });
    });
  } else {
    const kinds = header.map((h) => Object.keys(KINDS).find((k) => KINDS[k].fitdays && norm(KINDS[k].fitdays) === norm(h)) || null);
    header.forEach((h, j) => {
      if (j > 0 && h.trim() && !kinds[j] && !FITDAYS_DERIVED.some((d) => norm(d) === norm(h))) ignored.push(h.trim());
    });
    data.forEach((r, i) => {
      const t = parseTime(r[0], opts);
      if (!t) return err(i, 'не распознаны дата и время');
      let any = false;
      kinds.forEach((kind, j) => {
        if (!kind) return;
        const v = parseValue(r[j]);
        if (v == null) return;
        if (!(v >= KINDS[kind].min && v <= KINDS[kind].max)) return err(i, `${KINDS[kind].label}: значение вне диапазона`);
        any = true;
        items.push({ type: 'body', kind, value: v, time: t, source: 'Fitdays+', family: 'fitdays' });
      });
      if (!any) err(i, 'в строке нет ни одного замера');
    });
  }
  return { format, items, errors, ignored };
}

// --- import plan ---------------------------------------------------------------------------------

// What an import would do, against what the device already has (deleted rows included: a row the
// owner deleted is not brought back by a re-import). Nothing is written here.
export function planImport(parsed, { body = new Map(), sleep = new Map() } = {}, { batch = 'imp', now = Date.now() } = {}) {
  const plan = { format: parsed.format, add: [], same: 0, deleted: 0, kept: 0, repeated: 0, near: [], errors: parsed.errors, ignored: parsed.ignored, kinds: {} };
  const byMatch = new Map();
  for (const r of body.values()) {
    if (!r.measuredAt) continue;
    const t = parseTime(r.measuredAt);
    if (t) byMatch.set(matchKey(r.kind, r.family || sourceFamily(r.source), t.utc, r.origValue ?? r.value), r);
  }
  const live = [...body.values()].filter((r) => !r.deleted);
  const seen = new Map(); // id base → count, within this file
  const fresh = new Map();

  // Rows of an import the owner undid come back on the next import; rows deleted one by one don't.
  const revivable = (prev) => prev.deleted && prev.via === 'undone';
  const known = (prev) => {
    if (prev.deleted) plan.deleted++;
    else if (prev.edited) plan.kept++;
    else plan.same++;
  };

  for (const it of parsed.items) {
    if (it.type === 'sleep') {
      const id = sleepId(it.wakeDate);
      if (seen.has(id)) {
        plan.repeated++;
        continue;
      }
      seen.set(id, 1);
      const prev = sleep.get(id);
      if (prev && !revivable(prev)) {
        known(prev);
        continue;
      }
      const rec = {
        id,
        wakeDate: it.wakeDate,
        start: it.start,
        end: it.end,
        hours: it.hours,
        core: it.core,
        deep: it.deep,
        rem: it.rem,
        unspec: it.unspec,
        segments: it.segments,
        source: it.source,
        via: 'csv',
        batch,
        edited: false,
        note: '',
        updatedAt: now,
        deleted: false,
      };
      fresh.set(id, rec);
      plan.add.push(rec);
      continue;
    }
    const base = bodyId({ kind: it.kind, family: it.family, utc: it.time.utc, precision: it.time.precision, value: it.value });
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    // To the second, an identical row is the same sample listed twice; to the minute, it may be
    // a second real measurement, so it gets its own ordinal.
    if (n > 1 && it.time.precision === 's') {
      plan.repeated++;
      continue;
    }
    const id = bodyId({ kind: it.kind, family: it.family, utc: it.time.utc, precision: it.time.precision, value: it.value }, n);
    const prev = body.get(id) || (n === 1 ? byMatch.get(matchKey(it.kind, it.family, it.time.utc, it.value)) : null);
    if (prev && !revivable(prev)) {
      known(prev);
      continue;
    }
    // Same quantity within 3 minutes, a value within 0.1, but not provably the same measurement
    // (another source, or a slightly different reading): left out unless the owner includes it.
    const near = prev ? null : live.find((r) => {
      if (r.kind !== it.kind || Math.abs(r.value - it.value) > 0.1 + 1e-9) return false;
      const t = parseTime(r.measuredAt);
      return t && Math.abs(t.utc - it.time.utc) <= 3 * 60000;
    });
    const rec = {
      id: prev ? prev.id : id,
      kind: it.kind,
      value: it.value,
      origValue: it.value,
      unit: KINDS[it.kind].unit,
      measuredAt: it.time.local,
      date: it.time.date,
      source: it.source,
      family: it.family,
      via: 'csv',
      srcId: '',
      batch,
      excluded: null,
      edited: false,
      note: '',
      updatedAt: now,
      deleted: false,
    };
    if (near) {
      plan.near.push({ rec, existing: near });
      continue;
    }
    plan.add.push(rec);
    plan.kinds[it.kind] = (plan.kinds[it.kind] || 0) + 1;
  }
  plan.sleepAdded = plan.add.filter((r) => r.wakeDate).length;
  return plan;
}

// --- series for the screens --------------------------------------------------------------------

const dayNum = (iso) => Date.parse(iso + 'T00:00:00Z') / 86400000;

// Weigh-ins that disagree with the weigh-ins around them by more than 3 kg (or 4 %): likely
// someone else on the scale, or clothes. Flagged with the reason, never deleted; the owner's own
// choice (`excluded` true/false) always wins over this guess.
export function weightSuspects(records) {
  const pts = records.filter((r) => r.kind === 'weight' && !r.deleted).map((r) => ({ r, t: dayNum(r.date) }));
  const out = new Map();
  for (const p of pts) {
    const around = pts.filter((q) => q !== p && Math.abs(q.t - p.t) <= 7).map((q) => q.r.value);
    if (around.length < 3) continue;
    const m = median(around);
    const diff = p.r.value - m;
    if (Math.abs(diff) > Math.max(3, m * 0.04)) out.set(p.r.id, { median: m, diff });
  }
  return out;
}

export function isCounted(r, suspects) {
  if (r.deleted) return false;
  if (r.excluded === true) return false;
  if (r.excluded === false) return true;
  return !suspects?.has(r.id);
}

// One value per day for trends. Device or manual rows of App_Body win for their day (median of
// that day's measurements); a v1.0 weight in App_Metrics fills only days without one, so the same
// weigh-in is never counted twice. `shadowed` lists the App_Metrics ids left out.
export function dailyWeights(body, metrics) {
  const list = [...body].filter((r) => r.kind === 'weight' && !r.deleted);
  const suspects = weightSuspects(list);
  const byDay = new Map();
  for (const r of list) {
    if (!isCounted(r, suspects)) continue;
    if (!byDay.has(r.date)) byDay.set(r.date, []);
    byDay.get(r.date).push(r);
  }
  const days = [...byDay].map(([date, rs]) => ({ date, bodyweight: median(rs.map((r) => r.value)), n: rs.length, from: 'body', records: rs }));
  const shadowed = new Set();
  for (const m of metrics) {
    if (m.deleted || !(m.bodyweight > 0)) continue;
    if (byDay.has(m.date)) shadowed.add(m.id);
    else days.push({ date: m.date, bodyweight: m.bodyweight, n: 1, from: 'metrics', records: [] });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { days, suspects, shadowed };
}

// Main sleep per wake date: App_Sleep wins over a manual v1.0 "сон, ч" of the same date.
export function sleepNights(sleep, metrics) {
  const nights = new Map();
  for (const s of sleep) if (!s.deleted && s.hours > 0) nights.set(s.wakeDate, { date: s.wakeDate, hours: s.hours, from: 'sleep', rec: s });
  const shadowed = new Set();
  for (const m of metrics) {
    if (m.deleted || !(m.sleep > 0)) continue;
    if (nights.has(m.date)) shadowed.add(m.id);
    else nights.set(m.date, { date: m.date, hours: m.sleep, from: 'metrics', rec: m });
  }
  return { nights: [...nights.values()].sort((a, b) => a.date.localeCompare(b.date)), shadowed };
}

// Average over the nights that have data in the last `days` days (today included). Days without
// data are not zero sleep: the answer says how many nights it is based on.
export function sleepAverage(nights, today, days) {
  const end = dayNum(today);
  const win = nights.filter((n) => dayNum(n.date) > end - days && dayNum(n.date) <= end);
  return { avg: win.length ? sum(win.map((n) => n.hours)) / win.length : null, nights: win.length, days };
}

// Latest value and its change against the latest value at least `weeks` weeks older.
export function latestOf(body, kind, { weeks = 4 } = {}) {
  const rs = [...body].filter((r) => r.kind === kind && !r.deleted && r.excluded !== true).sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : 1));
  if (!rs.length) return null;
  const last = rs[rs.length - 1];
  const limit = dayNum(last.date) - weeks * 7;
  const older = rs.filter((r) => dayNum(r.date) <= limit);
  const ref = older[older.length - 1] || null;
  return { last, ref, change: ref ? last.value - ref.value : null, count: rs.length };
}
