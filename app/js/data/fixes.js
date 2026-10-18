// One-time corrections of recorded data, confirmed by the owner in the app (a card on Home).
// Each names the exact records it changes — ids read from the sheet — and is offered only while
// those records are still as recorded. So it is idempotent and safe on every device: a device that
// already got the correction through sync shows nothing, and a record changed since is left alone.

// 18.10.2026 (cycle 1, week 2, day 2): three exercises were done on other machines than the program
// named. Weights, reps, RIR, dates and ids stay; the sets move to the series of what was done.
export const FIX_2026_10_18 = {
  id: 'fix-2026-10-18',
  sessionId: 'ssmve7dlgnd8b059146ff3fc37',
  date: '2026-10-18',
  day: 2,
  moves: [
    {
      slotId: 'D2-03',
      from: 'giperekstenziya-s-vesom',
      to: { key: 'giperekstenziya-v-trenazhere', name: 'Гиперэкстензия в тренажере' },
      setIds: ['stmve9o1wc35a3b3b5c46c5835', 'stmve9raxac5302fe65bdeb01a', 'stmve9u2p62ea30a89347e6b08'],
    },
    {
      slotId: 'D2-05',
      from: 'krossover-na-zadnyuyu-deltu',
      to: { key: 'obratnaya-babochka-dvumya-rukami', name: 'Обратная бабочка двумя руками' },
      setIds: ['stmvea8fz256a2da97325e375d', 'stmveacbe6e16740ebcc0ff870', 'stmveahgqk68e5cceb874d4018'],
    },
    {
      slotId: 'D2-06',
      from: 'podem-ez-grifa-pered-soboy',
      to: { key: 'tyaga-shtangi-k-podborodku-v-smite', name: 'Тяга штанги к подбородку в Смите' },
      setIds: ['stmveanu245dde3f0c12785702', 'stmveasoz8942fa1b483bd3bb8', 'stmveaxrcd4c79d4ff275ae06b'],
    },
  ],
  // Day 2 slots after the fix, main variant first; a slot is found by a key it already has.
  // Options the slot has beyond these stay, after them.
  program: [
    {
      has: 'giperekstenziya-s-vesom',
      options: [
        { key: 'giperekstenziya-v-trenazhere', name: 'Гиперэкстензия в тренажере' },
        { key: 'giperekstenziya-s-vesom', name: 'Гиперэкстензия с весом' },
      ],
    },
    {
      has: 'krossover-na-zadnyuyu-deltu',
      options: [
        { key: 'krossover-na-zadnyuyu-deltu', name: 'Кроссовер на заднюю дельту' },
        { key: 'obratnaya-babochka-dvumya-rukami', name: 'Обратная бабочка двумя руками' },
        { key: 'obratnaya-babochka-odnoy-rukoy', name: 'Обратная бабочка одной рукой' },
      ],
    },
    {
      has: 'podem-ez-grifa-pered-soboy',
      options: [
        { key: 'tyaga-shtangi-k-podborodku-v-smite', name: 'Тяга штанги к подбородку в Смите' },
        { key: 'podem-ez-grifa-pered-soboy', name: 'Подъем EZ-грифа перед собой' },
      ],
    },
  ],
};

export const FIXES = [FIX_2026_10_18];

const sameIds = (a, b) => a.length === b.length && a.every((id) => b.includes(id));

// What `fix` would change on this device now: { moves: [{…move, item, sets}], skipped, program }.
// `program` is the new program, or null when it already has these variants.
export function planFix(state, fix) {
  const session = state.sessions.get(fix.sessionId);
  const out = { moves: [], skipped: [], program: null };
  if (!session || session.deleted) return out;
  for (const m of fix.moves) {
    const item = session.items.find((i) => i.slotId === m.slotId);
    if (!item || item.seriesKey !== m.from) continue; // already moved (here or on another device)
    const sets = [...state.sets.values()]
      .filter((x) => !x.deleted && x.sessionId === fix.sessionId && x.slotId === m.slotId && x.seriesKey === m.from)
      .sort((a, b) => a.setNo - b.setNo);
    // Exactly the recorded sets, or nothing: no guessing by name.
    if (sameIds(sets.map((x) => x.id), m.setIds)) out.moves.push({ ...m, item, sets });
    else out.skipped.push({ ...m, item, sets });
  }
  out.program = programAfterFix(state.program, fix);
  return out;
}

export function programAfterFix(program, fix) {
  if (!program) return null;
  const next = structuredClone(program);
  let changed = false;
  const day = next.days.find((d) => d.day === fix.day);
  for (const spec of fix.program) {
    const slot = day?.slots.find((s) => s.options.some((o) => o.key === spec.has));
    if (!slot) continue;
    const wanted = spec.options.map((o) => slot.options.find((x) => x.key === o.key) || { ...o });
    const options = [...wanted, ...slot.options.filter((o) => !wanted.some((w) => w.key === o.key))];
    if (options.map((o) => o.key).join('|') !== slot.options.map((o) => o.key).join('|')) {
      slot.options = options;
      changed = true;
    }
  }
  return changed ? next : null;
}

// Offered while something of it can still be applied here and the owner hasn't applied it here.
export function pendingFix(state, fix = FIX_2026_10_18) {
  if (state.kv.fixes?.[fix.id]?.appliedAt) return null;
  const plan = planFix(state, fix);
  return plan.moves.length ? plan : null;
}

// Program first (the new variants get their category from it), then each exercise in one
// transaction with its backup (kv `corrections`). If something fails half-way, what is left stays
// offered and applying again finishes it.
export async function applyFix(store, fix = FIX_2026_10_18) {
  const plan = planFix(store.state, fix);
  if (!plan.moves.length) return null;
  const programBefore = plan.program ? store.state.program : null;
  if (plan.program) await store.saveProgram(plan.program);
  const moved = [];
  for (const m of plan.moves) {
    const r = await store.reassignVariant(fix.sessionId, m.slotId, m.to, { reason: fix.id });
    moved.push({ slotId: m.slotId, from: { key: m.item.seriesKey, name: m.item.name }, to: m.to, sets: r?.moved || 0, backup: r?.backup?.id || null });
  }
  const result = { appliedAt: Date.now(), moved, programBefore };
  await store.setKV({ fixes: { ...(store.state.kv.fixes || {}), [fix.id]: result } });
  return result;
}

// Puts the exercises back under what was recorded and the program as it was; the fix is offered again.
export async function revertFix(store, fix = FIX_2026_10_18) {
  const result = store.state.kv.fixes?.[fix.id];
  if (!result) return false;
  for (const m of result.moved) await store.reassignVariant(fix.sessionId, m.slotId, m.from, { reason: `${fix.id}:undo` });
  if (result.programBefore) await store.saveProgram(result.programBefore);
  const fixes = { ...(store.state.kv.fixes || {}) };
  delete fixes[fix.id];
  await store.setKV({ fixes });
  return true;
}
