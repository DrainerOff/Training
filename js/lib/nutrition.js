// Daily calories and macros: totals per accounting day, never foods or meals. Pure functions — no
// storage, no DOM. One record per accounting date (id `n:YYYY-MM-DD`), entered by hand, pasted from
// ChatGPT, imported, or written by ChatGPT into App_NutritionInbox and taken from there by Apps
// Script (apps-script/Code.gs repeats normalizeEntry / entryRev / applyExternal line for line).
//
// Honest numbers: only final days («итог подтверждён») go into averages; drafts are counted and
// named, never averaged; a range stays a range (its middle is used in an average marked «≈»);
// coverage is always said (5 из 7 дней), so 3 days never read as a week.

import { isoDate, fmtNum, plural } from './util.js';
import { addDays, phaseOn } from './phase.js';

export const FIELDS = ['kcal', 'protein', 'fat', 'carbs'];
export const LABEL = { kcal: 'Калории', protein: 'Белки', fat: 'Жиры', carbs: 'Углеводы' };
export const SHORT = { kcal: 'ккал', protein: 'Б', fat: 'Ж', carbs: 'У' };
export const UNIT = { kcal: 'ккал', protein: 'г', fat: 'г', carbs: 'г' };
export const LIMITS = { kcal: 15000, protein: 1000, fat: 1000, carbs: 2000 };
export const STATUS = { final: 'итог подтверждён', draft: 'черновик' };
export const SOURCE = { manual: 'вручную', chatgpt: 'ChatGPT', import: 'импорт' };
// Before this hour the accounting day is still yesterday (the owner may stay up until 4–7 a.m.).
export const DAY_START_HOUR = 7;
export const FIRST_DATE = '2015-01-01';

export const nutritionId = (date) => `n:${date}`;

export function accountingDate(now = new Date(), startHour = DAY_START_HOUR) {
  const d = new Date(now);
  if (d.getHours() < startHour) d.setDate(d.getDate() - 1);
  return isoDate(d);
}

// «3200», «3 200», «3200,5», «~3200» (approximate), «2800-3000» / «2800–3000» (a range).
// → null (empty) | { value } | { range: [lo, hi] } with `approx` | { error }.
export function parseAmount(raw, field) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? check({ value: raw }, field) : { error: 'не число' };
  let s = String(raw).trim().toLowerCase().replace(/ /g, ' ');
  if (!s || s === '-' || s === '—' || s === '–') return null;
  let approx = false;
  if (/^(~|≈|около|примерно|прибл\.?)\s*/.test(s)) {
    approx = true;
    s = s.replace(/^(~|≈|около|примерно|прибл\.?)\s*/, '');
  }
  s = s.replace(/\s*(ккал|kcal|кал|г|g|гр)\.?$/, '').trim();
  const num = (t) => {
    const x = t.replace(/\s+/g, '').replace(',', '.');
    return /^\d+(\.\d+)?$/.test(x) ? Number(x) : NaN;
  };
  const m = s.match(/^([\d\s.,]+?)\s*(?:-|–|—|до)\s*([\d\s.,]+)$/);
  if (m) {
    const lo = num(m[1]);
    const hi = num(m[2]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { error: 'не число' };
    if (lo > hi) return { error: 'начало диапазона больше конца' };
    return lo === hi ? check({ value: lo, approx }, field) : check({ range: [lo, hi], approx: true }, field);
  }
  const v = num(s);
  if (!Number.isFinite(v)) return { error: 'не число' };
  return check({ value: v, approx }, field);
}

function check(x, field) {
  const max = LIMITS[field] ?? 100000;
  const vals = x.range || [x.value];
  if (vals.some((v) => v < 0 || v > max)) return { error: `вне диапазона 0–${max}` };
  return x;
}

export function parseStatus(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^(итог|final|закрыт|подтвержд|готов)/.test(s)) return 'final';
  if (/^(черновик|draft|не\s*закрыт|предвар)/.test(s)) return 'draft';
  return undefined;
}

export function parseYes(raw) {
  if (raw === true || raw === false) return raw;
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return false;
  return /^(да|yes|true|1|приблиз|≈|~)/.test(s);
}

// «2026-10-22» or «22.10.2026». Not before 2015, not after tomorrow.
export function parseDate(raw, today = isoDate()) {
  const s = String(raw ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let iso = null;
  if (m) iso = s;
  else if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  if (iso < FIRST_DATE || iso > addDays(today, 1)) return null;
  return iso;
}

// An entry from outside (an inbox row, a pasted block, an import line) → the values of a record, or
// errors. { date, kcal, protein, fat, carbs, status, approx, comment } in any of the accepted forms.
export function normalizeEntry(input, { today = isoDate() } = {}) {
  const errors = [];
  const date = parseDate(input.date, today);
  if (!date) errors.push('дата: нужна ГГГГ-ММ-ДД, не позже завтрашнего дня');
  const out = { date, ranges: null, approx: parseYes(input.approx), status: 'draft', comment: String(input.comment ?? '').trim().slice(0, 300) };
  let any = false;
  for (const f of FIELDS) {
    const a = parseAmount(input[f], f);
    out[f] = null;
    if (!a) continue;
    if (a.error) {
      errors.push(`${LABEL[f].toLowerCase()}: ${a.error}`);
      continue;
    }
    any = true;
    if (a.range) out.ranges = { ...(out.ranges || {}), [f]: a.range };
    else out[f] = a.value;
    if (a.approx) out.approx = true;
  }
  if (!any && !errors.length) errors.push('нет ни одного значения');
  const st = parseStatus(input.status);
  if (st === undefined) errors.push('статус: «итог» или «черновик»');
  else if (st) out.status = st;
  return errors.length ? { ok: false, errors } : { ok: true, entry: out, rev: entryRev(out), statusGiven: !!st };
}

// FNV-1a, 32 bit, hex: the same numbers resent («Закрыть день» twice) give the same revision.
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function entryRev(e) {
  const r = e.ranges || {};
  const parts = [e.date, ...FIELDS.map((f) => (r[f] ? `${r[f][0]}-${r[f][1]}` : e[f] ?? '')), e.status, e.approx ? 1 : 0, e.comment || ''];
  return 'r' + fnv1a(parts.join('|'));
}

const VALUE_KEYS = [...FIELDS, 'ranges', 'approx', 'status', 'comment', 'source'];
const norm = (k, v) => (k === 'comment' ? v || '' : k === 'approx' ? !!v : v ?? null);
export function sameValues(a, b) {
  return VALUE_KEYS.every((k) => JSON.stringify(norm(k, a?.[k])) === JSON.stringify(norm(k, b?.[k])));
}
const valuesOf = (r) => Object.fromEntries([...VALUE_KEYS, 'updatedAt'].map((k) => [k, r[k] ?? null]));

// The rules for a write from outside (ChatGPT through the inbox or a paste; an import line the owner
// chose to apply), against the record of that date:
//  1. one record per date — it is updated, never duplicated;
//  2. the same revision again changes nothing (a repeated «Закрыть день»), even after a delete;
//  3. a draft never replaces a final day;
//  4. otherwise the later action wins; values entered by hand that it replaces are kept in `prev`
//     and can be put back («Вернуть»);
//  5. a deleted day comes back only with a new revision.
// → { action: 'create' | 'update' | 'same' | 'deleted' | 'draft', rec | null }
export function applyExternal(existing, entry, { rev, source = 'chatgpt', at }) {
  if (existing && existing.extRev === rev) return { action: existing.deleted ? 'deleted' : 'same', rec: null };
  if (existing && !existing.deleted && existing.status === 'final' && entry.status === 'draft') return { action: 'draft', rec: null };
  const rec = {
    id: nutritionId(entry.date),
    date: entry.date,
    ...Object.fromEntries(FIELDS.map((f) => [f, entry[f] ?? null])),
    ranges: entry.ranges || null,
    approx: !!entry.approx,
    status: entry.status,
    source,
    comment: entry.comment || '',
    extRev: rev,
    prev: existing && !existing.deleted && existing.source === 'manual' && !sameValues(existing, { ...entry, source: 'manual' }) ? valuesOf(existing) : existing?.deleted ? null : existing?.prev || null,
    updatedAt: Math.max(at, (existing?.updatedAt || 0) + 1),
    deleted: false,
  };
  return { action: existing ? 'update' : 'create', rec };
}

export const ACTION_TEXT = {
  create: 'создан',
  update: 'обновлён',
  same: 'без изменений',
  deleted: 'без изменений: день удалён в приложении',
  draft: 'пропущен: черновик не заменяет итог',
};

// A block pasted from ChatGPT. One day per block; blocks are separated by an empty line or a new
// «Дата». Keys in Russian or English, «:» or «=»; «КБЖУ» lines are allowed as a header:
//   Дата: 2026-10-22
//   Ккал: 3250 · Белки: 160 · Жиры: 90 · Углеводы: 420
//   Статус: итог · Приблизительно: да · Комментарий: …
const KEYS = [
  [/^(дата|date|день)$/, 'date'],
  [/^(ккал|калори[ия]|kcal|calories|энергия)$/, 'kcal'],
  [/^(б|белки?|белок|protein|p)$/, 'protein'],
  [/^(ж|жиры?|fat|f)$/, 'fat'],
  [/^(у|углеводы?|carbs?|c)$/, 'carbs'],
  [/^(статус|status)$/, 'status'],
  [/^(приблизительно|примерно|оценка|approx)$/, 'approx'],
  [/^(комментарий|коммент|заметка|comment|note)$/, 'comment'],
];
const keyOf = (k) => {
  const s = k.trim().toLowerCase().replace(/[,.]$/, '').replace(/\s*\(.*\)$/, '').replace(/,\s*(г|ккал)$/, '');
  return KEYS.find(([re]) => re.test(s))?.[1] || null;
};

export function parseNutritionText(text, { today = isoDate() } = {}) {
  const blocks = [];
  let cur = null;
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  lines.forEach((line, i) => {
    const raw = line.trim();
    if (!raw) {
      cur = null;
      return;
    }
    // «Ккал: 3250 · Белки: 160 · Жиры: 90» — several pairs on one line.
    const pairs = raw.split(/\s*(?:[·•;|]|,\s+(?=[А-ЯA-Za-zа-яё]+\s*[:=]))\s*/).map((p) => p.match(/^([^:=]+?)\s*[:=]\s*(.*)$/)).filter(Boolean);
    for (const m of pairs) {
      const key = keyOf(m[1]);
      if (!key) continue;
      if (key === 'date' || !cur) {
        if (key === 'date' && cur && cur.fields.date == null && Object.keys(cur.fields).length) cur.fields.date = m[2];
        else {
          cur = { line: i + 1, fields: {} };
          blocks.push(cur);
        }
      }
      if (key === 'comment') cur.fields.comment = m[2];
      else cur.fields[key] = m[2].trim();
    }
  });
  const entries = [];
  const errors = [];
  for (const b of blocks) {
    const n = normalizeEntry(b.fields, { today });
    if (n.ok) entries.push({ line: b.line, ...n });
    else errors.push({ line: b.line, errors: n.errors });
  }
  return { entries, errors };
}

// A table of old days (CSV from the sheet or a list from ChatGPT): a header row with any of the keys
// above; «,», «;» or tab between cells.
export function parseNutritionCsv(text, { today = isoDate() } = {}) {
  const lines = String(text || '').replace(/^﻿/, '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return { entries: [], errors: [{ line: 1, errors: ['файл пустой'] }] };
  const sep = ['\t', ';', ','].find((c) => lines[0].includes(c)) || ',';
  const split = (l) => {
    const out = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') {
        if (q && l[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = !q;
      } else if (ch === sep && !q) {
        out.push(cell);
        cell = '';
      } else cell += ch;
    }
    out.push(cell);
    return out.map((c) => c.trim());
  };
  const head = split(lines[0]).map((h) => keyOf(h.replace(/_g$|_kcal$/i, '').replace(/_/g, ' ')) || keyOf(h));
  if (!head.includes('date')) return { entries: [], errors: [{ line: 1, errors: ['в первой строке нет столбца с датой'] }] };
  const entries = [];
  const errors = [];
  lines.slice(1).forEach((l, i) => {
    const cells = split(l);
    const fields = {};
    head.forEach((k, j) => {
      if (k) fields[k] = cells[j] ?? '';
    });
    const n = normalizeEntry(fields, { today });
    if (n.ok) entries.push({ line: i + 2, ...n });
    else errors.push({ line: i + 2, errors: n.errors });
  });
  return { entries, errors };
}

// Old days against what is already there: new / the same / different (a conflict the owner decides).
// One entry per date: a second line of the same date in the file is an error, never a sum.
export function planNutritionImport(parsed, existing = new Map()) {
  const add = [];
  const same = [];
  const conflicts = [];
  const errors = [...parsed.errors];
  const seen = new Set();
  for (const e of parsed.entries) {
    const d = e.entry.date;
    if (seen.has(d)) {
      errors.push({ line: e.line, errors: [`дата ${d} уже есть выше в этом файле — дни не складываются`] });
      continue;
    }
    seen.add(d);
    const cur = existing.get(nutritionId(d));
    if (!cur || cur.deleted) add.push(e);
    else if (cur.extRev === e.rev || sameValues(cur, { ...e.entry, source: cur.source })) same.push(e);
    else conflicts.push({ ...e, current: cur });
  }
  return { add, same, conflicts, errors };
}

// ---------------------------------------------------------------- reading a day

// The value of one field for averages: { value, approx, range } or null. A range gives its middle,
// marked approximate; it is shown as the range.
export function amountOf(rec, f) {
  if (!rec) return null;
  const r = rec.ranges?.[f];
  if (r) return { value: (r[0] + r[1]) / 2, approx: true, range: r };
  if (rec[f] == null) return null;
  return { value: rec[f], approx: !!rec.approx, range: null };
}

export function fmtAmount(rec, f) {
  const a = amountOf(rec, f);
  if (!a) return '–';
  if (a.range) return `${fmtNum(a.range[0], 0)}–${fmtNum(a.range[1], 0)}`;
  return `${a.approx ? '≈' : ''}${fmtNum(a.value, f === 'kcal' ? 0 : 1)}`;
}

export function dayLine(rec) {
  return FIELDS.map((f) => `${f === 'kcal' ? '' : SHORT[f] + ' '}${fmtAmount(rec, f)}${f === 'kcal' ? ' ккал' : ''}`).join(' · ');
}

// ---------------------------------------------------------------- goals

// Goals per phase with a start date inside it (history: a change starts a new record). For a date:
// the phase running then, its latest goals started on or before the date — or its first goals for
// the days before them (the phase began before the goals were written down).
export function goalsOn(goals, phases, date) {
  const phase = phaseOn(phases, date);
  if (!phase) return null;
  const list = [...goals].filter((g) => !g.deleted && g.phaseId === phase.id).sort((a, b) => a.from.localeCompare(b.from) || a.updatedAt - b.updatedAt);
  if (!list.length) return null;
  let pick = list[0];
  for (const g of list) if (g.from <= date) pick = g;
  return { ...pick, phase };
}

// The latest goals of the latest other phase of the same mode: a starting point for a new phase.
export function goalsFromSameMode(goals, phases, phase) {
  const byId = new Map([...phases].filter((p) => !p.deleted).map((p) => [p.id, p]));
  const list = [...goals].filter((g) => !g.deleted && g.phaseId !== phase.id && byId.get(g.phaseId)?.mode === phase.mode);
  list.sort((a, b) => (byId.get(b.phaseId).start.localeCompare(byId.get(a.phaseId).start)) || b.from.localeCompare(a.from));
  return list[0] || null;
}

// Targets of a goals record as ranges: kcal [lo, hi]; protein [min, max|null]; fat [lo, hi];
// carbs explicit, or the remainder of the kcal goal after protein (4 kcal/g) and fat (9 kcal/g).
export function targets(g) {
  if (!g) return null;
  const pair = (lo, hi) => (lo == null && hi == null ? null : [lo ?? hi, hi ?? lo]);
  const kcal = pair(g.kcalMin, g.kcalMax);
  const protein = g.proteinMin == null && g.proteinMax == null ? null : [g.proteinMin ?? g.proteinMax, g.proteinMax ?? null];
  const fat = pair(g.fatMin, g.fatMax);
  let carbs = null;
  let carbsRest = false;
  if (g.carbsMode === 'rest') {
    carbsRest = true;
    if (kcal && protein && fat) {
      const pHi = protein[1] ?? protein[0];
      const lo = Math.max(0, (kcal[0] - 4 * pHi - 9 * fat[1]) / 4);
      const hi = Math.max(0, (kcal[1] - 4 * protein[0] - 9 * fat[0]) / 4);
      carbs = [Math.round(lo / 5) * 5, Math.round(hi / 5) * 5];
    }
  } else carbs = pair(g.carbsMin, g.carbsMax);
  return { kcal, protein, fat, carbs, carbsRest };
}

// below / within / above against [lo, hi|null] (null hi = a minimum).
export function against(value, t) {
  if (value == null || !t) return null;
  if (value < t[0]) return 'below';
  if (t[1] != null && value > t[1]) return 'above';
  return 'within';
}

export function fmtTarget(t, f) {
  if (!t) return 'не задана';
  const u = UNIT[f];
  if (t[1] == null) return `от ${fmtNum(t[0], 0)} ${u}`;
  if (t[0] === t[1]) return `${fmtNum(t[0], 0)} ${u}`;
  return `${fmtNum(t[0], 0)}–${fmtNum(t[1], 0)} ${u}`;
}

// Fact as % of the goal: of the minimum for a minimum, of the middle for a range.
export function percent(value, t) {
  if (value == null || !t) return null;
  const base = t[1] == null ? t[0] : (t[0] + t[1]) / 2;
  return base > 0 ? Math.round((value / base) * 100) : null;
}

// ---------------------------------------------------------------- a period

// Days from..to (inclusive), only those inside `phase` when given and not after `today`.
export function periodDays(from, to, { phase = null, today = isoDate() } = {}) {
  const out = [];
  for (let d = from; d <= to && d <= today; d = addDays(d, 1)) {
    if (phase && (d < phase.start || (phase.end && d > phase.end))) continue;
    out.push(d);
  }
  return out;
}

// What a period says: final days only; drafts counted; per field the average over the days that
// have it, with n; goals of each day (they may change inside a week).
export function summarize(records, { from, to, phase = null, goals = [], phases = [], today = isoDate() }) {
  const days = periodDays(from, to, { phase, today });
  const set = new Set(days);
  const byDate = new Map();
  for (const r of records) if (!r.deleted && set.has(r.date)) byDate.set(r.date, r);
  const finals = days.map((d) => byDate.get(d)).filter((r) => r && r.status === 'final');
  const drafts = days.map((d) => byDate.get(d)).filter((r) => r && r.status === 'draft');
  const avg = {};
  for (const f of FIELDS) {
    const vals = finals.map((r) => amountOf(r, f)).filter(Boolean);
    avg[f] = vals.length ? { value: vals.reduce((s, x) => s + x.value, 0) / vals.length, n: vals.length, approx: vals.some((x) => x.approx) } : null;
  }
  const check = {};
  for (const f of FIELDS) check[f] = { below: [], within: [], above: [], noGoal: 0 };
  for (const r of finals) {
    const t = targets(goalsOn(goals, phases, r.date));
    for (const f of FIELDS) {
      const a = amountOf(r, f);
      if (!a) continue;
      const res = against(a.value, t?.[f]);
      if (res) check[f][res].push(r.date);
      else check[f].noGoal++;
    }
  }
  return {
    from, to, days: days.length, final: finals.length, drafts: drafts.length,
    approxDays: finals.filter((r) => r.approx || r.ranges).length,
    avg, check, records: finals, draftRecords: drafts,
  };
}

// Monday of the week of `date`.
export function weekStart(date) {
  const d = new Date(date + 'T00:00:00Z');
  return addDays(date, -((d.getUTCDay() + 6) % 7));
}

export function coverageText(s) {
  if (!s.days) return 'нет дней в периоде';
  const base = `записано ${s.final} из ${s.days} ${plural(s.days, 'дня', 'дней', 'дней')}`;
  return s.drafts ? `${base}; ${plural(s.drafts, 'черновик', 'черновики', 'черновики')} (${s.drafts}) не в счёте` : base;
}
