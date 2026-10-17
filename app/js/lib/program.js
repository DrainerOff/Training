// Training program model and periodization rules.
//
// A program is a list of days; each day has slots; each slot has one or more options
// (primary exercise + alternatives). Every option has a stable `key` — that key is the
// "strength series" used by the progress analysis. Alternatives therefore never get mixed up.

import { normName, slugify, uid, plural } from './util.js';

export const CATEGORY = {
  base: { label: 'Базовое', heavySets: 4 },
  hammer: { label: 'Hammer', heavySets: 3 },
  pullup: { label: 'Подтягивания', heavySets: 3, reps: [6, 6] },
  iso: { label: 'Изоляция', heavySets: 3 },
  calves: { label: 'Икры', heavySets: 3, dropOnWeek: 3 },
};
export const CATEGORY_KEYS = Object.keys(CATEGORY);

export const PHASE = {
  1: { title: 'Лёгкая неделя', reps: null, rir: [4, 5] },
  2: { title: 'Тяжёлая неделя', reps: [8, 10], rir: [1, 2] },
  3: { title: 'Тяжёлая неделя', reps: [6, 8], rir: [0, 1] },
};
export const WEEKS = [1, 2, 3];

export function phaseSummary(week) {
  const p = PHASE[week];
  if (!p) return '';
  if (!p.reps) return `3 подхода, RIR\u00a0${fmtRange(p.rir)}`;
  return `${fmtRange(p.reps)} повторений, RIR\u00a0${fmtRange(p.rir)}`;
}

// Target for a slot in a given week of the 3-week cycle.
// Light week: 3 working sets for everything, RIR 4–5.
// Heavy weeks: base lifts 4 sets, Hammer / pull-ups / isolation 3 sets.
// Pull-ups are always 3×6 strict. Calves get one extra drop set on week 3.
export function targetFor(slot, week) {
  const cat = CATEGORY[slot?.category] || CATEGORY.iso;
  const ph = PHASE[week] || PHASE[1];
  const t = {
    sets: week === 1 ? 3 : cat.heavySets,
    reps: cat.reps || ph.reps,
    rir: cat.noRir ? null : ph.rir,
    drop: cat.dropOnWeek === week ? 1 : 0,
  };
  const o = slot?.overrides?.[week];
  if (o) {
    if (o.sets != null) t.sets = o.sets;
    if (o.reps) t.reps = o.reps;
    if (o.rir) t.rir = o.rir;
  }
  return t;
}

export function fmtRange(r) {
  if (!r) return '';
  return r[0] === r[1] ? String(r[0]) : `${r[0]}–\u2060${r[1]}`;
}

export function fmtTarget(t) {
  let s = t.reps ? `${t.sets} × ${fmtRange(t.reps)}` : `${t.sets} ${plural(t.sets, 'подход', 'подхода', 'подходов')}`;
  if (t.rir) s += `, RIR\u00a0${fmtRange(t.rir)}`;
  if (t.drop) s += ', +дроп-сет';
  return s;
}

// --- construction -------------------------------------------------------------

export function makeOption(name, key) {
  return { key: key || slugify(name), name: String(name).trim() };
}

export function makeSlot({ name, category = 'iso', alts = [], step = 2.5, overrides = null, note = '' }) {
  return {
    id: uid('sl'),
    category,
    step,
    options: [makeOption(name), ...alts.map((a) => makeOption(a))],
    overrides: overrides || {},
    note,
  };
}

// Quick-add suggestions: the exercises of the current program, one entry per slot
// (primary name + alternatives), without duplicates.
export function exerciseCatalog(program) {
  const seen = new Set();
  const out = [];
  for (const d of program?.days || []) {
    for (const s of d.slots) {
      const key = s.options[0].key;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: s.options[0].name, category: s.category, alts: s.options.slice(1).map((o) => o.name) });
    }
  }
  return out;
}

// Starter program: only what is known for certain (pull-up grips per day).
// `draft: true` makes the app ask the owner to fill in the rest from the original program.
export function starterProgram(now = Date.now()) {
  const grips = ['прямым', 'обратным', 'прямым', 'нейтральным'];
  return {
    id: 'main',
    draft: true,
    updatedAt: now,
    days: grips.map((g, i) => ({
      day: i + 1,
      title: '',
      slots: [makeSlot({ name: `Подтягивания ${g} хватом`, category: 'pullup' })],
    })),
  };
}

export function allOptions(program) {
  const out = [];
  for (const d of program?.days || []) {
    for (const s of d.slots) for (const o of s.options) out.push({ ...o, slot: s, day: d.day });
  }
  return out;
}

export function findOptionByName(program, name) {
  const n = normName(name);
  return allOptions(program).find((o) => normName(o.name) === n) || null;
}

export function categoryForKey(program, key) {
  const o = allOptions(program).find((x) => x.key === key);
  return o ? o.slot.category : null;
}

// Validates a program object received from storage / sync / editor; fills defaults.
export function normalizeProgram(p) {
  if (!p || !Array.isArray(p.days)) return null;
  return {
    id: 'main',
    draft: !!p.draft,
    updatedAt: Number(p.updatedAt) || 0,
    days: p.days
      .map((d, i) => ({
        day: Number(d.day) || i + 1,
        title: String(d.title || ''),
        slots: (d.slots || [])
          .filter((s) => s && Array.isArray(s.options) && s.options.length)
          .map((s) => ({
            id: String(s.id || uid('sl')),
            category: CATEGORY[s.category] ? s.category : 'iso',
            step: Number(s.step) > 0 ? Number(s.step) : 2.5,
            options: s.options
              .filter((o) => o && String(o.name || '').trim())
              .map((o) => ({ key: String(o.key || slugify(o.name)), name: String(o.name).trim() })),
            overrides: s.overrides && typeof s.overrides === 'object' ? s.overrides : {},
            note: String(s.note || ''),
          })),
      }))
      .sort((a, b) => a.day - b.day),
  };
}

// --- text format ----------------------------------------------------------------
//
//   День 1: Верх
//   - Подтягивания прямым хватом [pullup]
//   - Жим штанги под наклоном [base] / Горизонтальный жим штанги
//   - Разгибания на блоке [iso] н2=3x10-12@1-2 шаг=5
//
// Category tags: [base] [hammer] [pullup] [iso] [calves] (Russian aliases accepted).
// Alternatives are separated with " / ". Overrides: н1= н2= н3= SETSxREPS[-REPS][@RIR[-RIR]].

const CAT_ALIASES = {
  base: 'base', база: 'base', базовое: 'base', базовое_упражнение: 'base',
  hammer: 'hammer', хаммер: 'hammer',
  pullup: 'pullup', подтягивания: 'pullup', подтягивание: 'pullup',
  iso: 'iso', изоляция: 'iso', изо: 'iso',
  calves: 'calves', икры: 'calves',
};

const OVERRIDE_RE = /(?:н|w|нед)\s*([123])\s*=\s*(\d+)\s*[xх×]\s*(\d+)(?:\s*[-–]\s*(\d+))?(?:\s*@\s*(\d+)(?:\s*[-–]\s*(\d+))?)?/gi;
const STEP_RE = /шаг\s*=\s*(\d+(?:[.,]\d+)?)/i;
const DAY_RE = /^\s*(?:день|day|тренировка)\s*(\d+)\s*[:.\-–]?\s*(.*)$/i;

export function parseProgramText(text) {
  const days = [];
  const warnings = [];
  let cur = null;
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const dm = line.match(DAY_RE);
    if (dm) {
      cur = { day: Number(dm[1]), title: dm[2].trim(), slots: [] };
      days.push(cur);
      return;
    }
    if (!cur) {
      warnings.push(`Строка ${idx + 1}: упражнение до заголовка «День N» — пропущено`);
      return;
    }
    let body = line.replace(/^[-•*–\d.)\s]+/, '').trim();
    const overrides = {};
    body = body.replace(OVERRIDE_RE, (_, w, sets, r1, r2, i1, i2) => {
      const o = { sets: Number(sets), reps: [Number(r1), Number(r2 || r1)] };
      if (i1 != null) o.rir = [Number(i1), Number(i2 ?? i1)];
      overrides[Number(w)] = o;
      return ' ';
    });
    let step = 2.5;
    body = body.replace(STEP_RE, (_, v) => {
      step = Number(v.replace(',', '.'));
      return ' ';
    });
    let category = null;
    body = body.replace(/\[([^\]]+)\]/g, (_, tag) => {
      const c = CAT_ALIASES[normName(tag).replace(/\s+/g, '_')];
      if (c) category = c;
      else warnings.push(`Строка ${idx + 1}: неизвестная категория [${tag}]`);
      return ' ';
    });
    const names = body
      .split(/\s+\/\s+|\s*\|\s*/)
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (!names.length) return;
    if (!category) {
      category = guessCategory(names[0]);
      warnings.push(`«${names[0]}»: категория не указана, выбрано «${CATEGORY[category].label}» — проверьте`);
    }
    cur.slots.push(makeSlot({ name: names[0], alts: names.slice(1), category, step, overrides }));
  });
  if (!days.length) warnings.push('Не найдено ни одного дня. Начните с «День 1».');
  return { program: { id: 'main', draft: false, updatedAt: Date.now(), days }, warnings };
}

function guessCategory(name) {
  const n = normName(name);
  if (n.includes('подтяг')) return 'pullup';
  if (n.includes('икр')) return 'calves';
  if (n.includes('hammer') || n.includes('хаммер')) return 'hammer';
  return 'iso';
}

// "3x10-12@1-2" <-> { sets: 3, reps: [10, 12], rir: [1, 2] }
export function parseOverride(s) {
  const m = String(s || '').match(/(\d+)\s*[xх×]\s*(\d+)(?:\s*[-–]\s*(\d+))?(?:\s*@\s*(\d+)(?:\s*[-–]\s*(\d+))?)?/i);
  if (!m) return null;
  const o = { sets: Number(m[1]), reps: [Number(m[2]), Number(m[3] || m[2])] };
  if (m[4] != null) o.rir = [Number(m[4]), Number(m[5] ?? m[4])];
  return o;
}

export function fmtOverride(o) {
  if (!o || o.sets == null) return '';
  const plain = (r) => (r[0] === r[1] ? String(r[0]) : `${r[0]}-${r[1]}`);
  let s = `${o.sets}x${o.reps ? plain(o.reps) : ''}`;
  if (o.rir) s += `@${plain(o.rir)}`;
  return s;
}

// Keeps series keys stable when a program is re-imported or edited: an option whose name
// matches an existing option reuses that key, so history stays linked.
export function reuseKeys(program, previous) {
  const known = new Map(allOptions(previous).map((o) => [normName(o.name), o.key]));
  for (const d of program.days) for (const s of d.slots) for (const o of s.options) {
    const k = known.get(normName(o.name));
    if (k) o.key = k;
  }
  return program;
}

export function programToText(program) {
  const rows = [];
  for (const d of program?.days || []) {
    rows.push(`День ${d.day}${d.title ? ': ' + d.title : ''}`);
    for (const s of d.slots) {
      let line = `- ${s.options.map((o) => o.name).join(' / ')} [${s.category}]`;
      for (const w of WEEKS) {
        const o = s.overrides?.[w];
        if (!o) continue;
        const def = targetFor({ category: s.category }, w);
        const reps = o.reps || def.reps || [0, 0];
        let tok = ` н${w}=${o.sets ?? def.sets}x${reps[0]}${reps[1] !== reps[0] ? '-' + reps[1] : ''}`;
        if (o.rir) tok += `@${o.rir[0]}${o.rir[1] !== o.rir[0] ? '-' + o.rir[1] : ''}`;
        line += tok;
      }
      if (s.step && s.step !== 2.5) line += ` шаг=${s.step}`;
      rows.push(line);
    }
    rows.push('');
  }
  return rows.join('\n').trim() + '\n';
}
