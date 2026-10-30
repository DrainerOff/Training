// Exercise lookup for «Заменить» and «Добавить упражнение»: one entry per strength series — every
// variant of the program and every exercise with recorded sets — so a machine done before is
// found by name and keeps its history instead of starting a new series under a new key.
// Synonyms and a single typo only help to find an entry; they never link two series.

import { normName, slugify } from './util.js';
import { allOptions } from './program.js';

// `series`: seriesKey -> exposures (lib/plateau.js buildExposures), oldest first.
// `aliases`: [{ name, key, fromKey }] — a name the owner confirmed as the same exercise as `key`
// (a one-time fix with `sameExercise`); ignored while `fromKey` still has sets of its own.
export function exerciseIndex({ program = null, series = new Map(), sessions = [], aliases = [] } = {}) {
  const map = new Map();
  const entry = (key, name) => {
    let e = map.get(key);
    if (!e) {
      e = { key, name, names: [], category: null, step: null, where: [], last: null, count: 0 };
      map.set(key, e);
    }
    return e;
  };
  const addName = (e, name) => {
    const n = String(name || '').trim();
    if (n && !e.names.some((x) => normName(x) === normName(n))) e.names.push(n);
  };
  // Program first: its names, categories and weight steps win. A main variant beats an alternative.
  const opts = allOptions(program).sort((a, b) => (a.slot.options[0].key === a.key ? 0 : 1) - (b.slot.options[0].key === b.key ? 0 : 1));
  for (const o of opts) {
    const e = entry(o.key, o.name);
    const main = o.slot.options[0].key === o.key;
    if (!e.where.length) {
      e.name = o.name;
      e.category = o.slot.category;
      e.step = o.slot.step;
    }
    e.where.push({ day: o.day, slotId: o.slot.id, main });
    addName(e, o.name);
  }
  const sById = new Map(sessions.map((s) => [s.id, s]));
  for (const [key, list] of series) {
    const live = list.filter((x) => x.sets.length);
    if (!live.length) continue;
    const last = live[live.length - 1];
    const e = entry(key, last.name);
    for (const x of live) addName(e, x.name);
    e.count = live.length;
    e.last = { date: last.date, weight: Math.max(...last.sets.map((s) => s.weight ?? 0)), sessionId: last.sessionId };
    if (e.where.length) continue;
    // Not in the program: category and step as in the last workout that had it.
    const item = sById.get(last.sessionId)?.items?.find((i) => i.seriesKey === key || i.options?.some((o) => o.key === key));
    e.category = item?.category || last.category || 'iso';
    e.step = Number(item?.step) > 0 ? Number(item.step) : 2.5;
  }
  for (const a of aliases) {
    if (a.fromKey && map.has(a.fromKey)) continue;
    const e = map.get(a.key);
    if (e) addName(e, a.name);
  }
  for (const e of map.values()) {
    if (!e.category) e.category = 'iso';
    if (!e.step) e.step = 2.5;
    e.inProgram = e.where.length > 0;
  }
  return [...map.values()];
}

// The index entry a typed name already belongs to: the same name (ignoring case, «ё», quotes) or
// the same series key it would get. Such a name is never offered as a new exercise.
export function findExact(index, name) {
  const n = normName(name);
  if (!n) return null;
  const key = slugify(name);
  return index.find((e) => e.names.some((x) => normName(x) === n)) || index.find((e) => e.key === key) || null;
}

// Stems that mean the same muscle or movement. Used only for ranking search results.
const SYNONYMS = [
  ['пресс', 'скруч', 'молитв'],
  ['бицепс', 'сгибан'],
  ['трицепс', 'разгибан', 'френч'],
  ['дельт', 'плеч', 'развед', 'мах'],
  ['груд', 'жим', 'бабочк', 'сведен'],
  ['спин', 'тяг', 'подтяг'],
  ['ног', 'присед', 'выпад'],
  ['ягодиц', 'гиперэкст'],
  ['икр', 'носк'],
  ['hammer', 'хаммер', 'хамер'],
];

const tokens = (s) => normName(s).split(/[\s\-–—:;,.()/]+/).filter(Boolean);

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

// The same word with another ending: «скручивания» / «скручивание», «гантелей» / «гантели».
function sameWord(q, t) {
  if (q.length < 4) return false;
  let i = 0;
  while (i < q.length && q[i] === t[i]) i++;
  return i >= 3 && i >= q.length - (q.length >= 6 ? 2 : 1) && i >= t.length - 3;
}
const wordOf = (q, t) => t.startsWith(q) || sameWord(q, t);
const synonymOf = (q, t) => SYNONYMS.some((g) => g.some((s) => q.startsWith(s)) && g.some((s) => t.startsWith(s)));
// One wrong, missing or extra letter in a word of 5+ letters, also in a word typed only in part.
const typoOf = (q, t) => q.length >= 5 && [t, t.slice(0, q.length - 1), t.slice(0, q.length), t.slice(0, q.length + 1)].some((x) => lev(q, x) <= 1);

function scoreName(query, name) {
  const q = normName(query);
  const n = normName(name);
  if (!q || !n) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  const qt = tokens(q);
  const nt = tokens(n);
  if (!qt.length) return 0;
  if (qt.every((a) => nt.some((b) => wordOf(a, b)))) return 60;
  if (n.includes(q)) return 40;
  const by = (test) => qt.every((a) => nt.some((b) => wordOf(a, b) || test(a, b)));
  if (by(synonymOf)) return 30;
  if (by((a, b) => typoOf(a, b) || synonymOf(a, b))) return 20;
  return 0;
}

// Entries matching `query`, best first: [{ ...entry, score, matched }] — `matched` is the name
// that matched when it is not the entry's own. Ties: in the program first, then done most recently.
export function searchExercises(index, query, { exclude = [], limit = 8 } = {}) {
  if (!normName(query)) return [];
  const skip = new Set(exclude);
  const out = [];
  for (const e of index) {
    if (skip.has(e.key)) continue;
    let best = 0;
    let matched = null;
    for (const n of e.names.length ? e.names : [e.name]) {
      const s = scoreName(query, n);
      if (s > best) {
        best = s;
        matched = n;
      }
    }
    if (best) out.push({ ...e, score: best, matched: normName(matched) === normName(e.name) ? null : matched });
  }
  out.sort((a, b) => b.score - a.score || Number(b.inProgram) - Number(a.inProgram) || (b.last?.date || '').localeCompare(a.last?.date || '') || a.name.localeCompare(b.name, 'ru'));
  return out.slice(0, limit);
}

// Name -> series key for every known name, for the program editor: a variant typed with the name
// of an exercise done elsewhere joins that series instead of starting a new one.
export function knownKeys(index) {
  const m = new Map();
  for (const e of index) for (const n of e.names.length ? e.names : [e.name]) if (!m.has(normName(n))) m.set(normName(n), e.key);
  return m;
}

// The program with `option` as the main variant of slot `slotId`, or null if the slot is gone.
// The previous main variant stays as an alternative when `keepOld`; other alternatives stay.
// `category` / `step` (when given) become the slot's: the weight step belongs to the slot.
export function setMainOption(program, slotId, option, { keepOld = true, category = null, step = null } = {}) {
  if (!program) return null;
  const next = structuredClone(program);
  const slot = next.days.flatMap((d) => d.slots).find((s) => s.id === slotId);
  if (!slot) return null;
  const opt = { key: option.key || slugify(option.name), name: String(option.name).trim() };
  const old = slot.options[0];
  const rest = slot.options.slice(1).filter((o) => o.key !== opt.key);
  slot.options = [opt, ...(keepOld && old.key !== opt.key ? [old] : []), ...rest];
  if (category) slot.category = category;
  if (Number(step) > 0) slot.step = Number(step);
  return next;
}
