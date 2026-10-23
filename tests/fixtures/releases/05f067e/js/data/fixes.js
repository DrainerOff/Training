// One-time corrections of recorded data, confirmed by the owner in the app (a card on Home).
// Each names the exact records it changes — ids read from the sheet — and is offered while any of
// them is not yet as corrected, so it is idempotent and safe on every device: a device that already
// got the correction through sync shows nothing. If an edit made on another device before it synced
// puts part of it back (a whole record wins by its newer version), the card offers what is left.

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
      from: { key: 'giperekstenziya-s-vesom', name: 'Гиперэкстензия с весом' },
      to: { key: 'giperekstenziya-v-trenazhere', name: 'Гиперэкстензия в тренажере' },
      setIds: ['stmve9o1wc35a3b3b5c46c5835', 'stmve9raxac5302fe65bdeb01a', 'stmve9u2p62ea30a89347e6b08'],
    },
    {
      slotId: 'D2-05',
      from: { key: 'krossover-na-zadnyuyu-deltu', name: 'Кроссовер на заднюю дельту' },
      to: { key: 'obratnaya-babochka-dvumya-rukami', name: 'Обратная бабочка двумя руками' },
      setIds: ['stmvea8fz256a2da97325e375d', 'stmveacbe6e16740ebcc0ff870', 'stmveahgqk68e5cceb874d4018'],
    },
    {
      slotId: 'D2-06',
      from: { key: 'podem-ez-grifa-pered-soboy', name: 'Подъем EZ-грифа перед собой' },
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

// What `fix` would change on this device now:
//   moves:   [{ …move, item, sets }] — `sets` are the listed sets still on `from` (the item may
//            already be on `to`, or the sets may be and only the item is not);
//   skipped: exercises where this slot has sets on `from` that are not the recorded ones;
//   program: the new program, or null.
// The program part is offered with a move, or when the program has lost the variants the moved
// sets now belong to — not when the owner later changed day 2 in some other way.
export function planFix(state, fix) {
  const session = state.sessions.get(fix.sessionId);
  const out = { moves: [], skipped: [], program: null };
  if (!session || session.deleted) return out;
  for (const m of fix.moves) {
    const item = session.items.find((i) => i.slotId === m.slotId);
    if (!item) continue;
    const listed = m.setIds.map((id) => state.sets.get(id)).filter((x) => x && !x.deleted && x.sessionId === fix.sessionId && x.slotId === m.slotId);
    const sets = listed.filter((x) => x.seriesKey === m.from.key).sort((a, b) => a.setNo - b.setNo);
    // Sets on `from` in this exercise that are not the recorded ones: don't guess, leave it alone.
    const others = [...state.sets.values()].some((x) => !x.deleted && x.sessionId === fix.sessionId && x.slotId === m.slotId && x.seriesKey === m.from.key && !m.setIds.includes(x.id));
    if (!sets.length && item.seriesKey !== m.from.key) continue; // done (here or through sync)
    if (others) out.skipped.push({ ...m, item, sets });
    else out.moves.push({ ...m, item, sets });
  }
  const movedKeys = fix.moves.filter((m) => state.sets.get(m.setIds[0])?.seriesKey === m.to.key).map((m) => m.to.key);
  const known = new Set((state.program?.days || []).flatMap((d) => d.slots.flatMap((s) => s.options.map((o) => o.key))));
  if (out.moves.length || movedKeys.some((k) => !known.has(k))) out.program = programAfterFix(state.program, fix);
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

export function pendingFix(state, fix = FIX_2026_10_18) {
  const plan = planFix(state, fix);
  return plan.moves.length || plan.program ? plan : null;
}

// Apply and undo of one fix run one after another, never interleaved; a second tap on
// «Исправить» while it is still writing gets the same result instead of a second run.
const running = new Map(); // fix id -> { kind, promise }
function enqueue(id, kind, fn) {
  const before = running.get(id)?.promise || Promise.resolve();
  const promise = before.catch(() => {}).then(fn).finally(() => {
    if (running.get(id)?.promise === promise) running.delete(id);
  });
  running.set(id, { kind, promise });
  return promise;
}

export function applyFix(store, fix = FIX_2026_10_18) {
  const cur = running.get(fix.id);
  if (cur?.kind === 'apply') return cur.promise;
  return enqueue(fix.id, 'apply', () => run(store, fix));
}

// The program as it was is saved before anything changes; then the program, then each exercise
// in one transaction with its backup (kv `corrections`). If something fails half-way, what is left
// stays offered, and applying again finishes it into the same record.
async function run(store, fix) {
  const plan = planFix(store.state, fix);
  if (!plan.moves.length && !plan.program) return null;
  const prev = store.state.kv.fixes?.[fix.id] || {};
  const record = {
    moved: [...(prev.moved || [])],
    programBefore: prev.programBefore || (plan.program ? store.state.program : null),
    startedAt: prev.startedAt || Date.now(),
    appliedAt: null,
  };
  const keep = () => store.setKV({ fixes: { ...(store.state.kv.fixes || {}), [fix.id]: { ...record } } });
  await keep();
  if (plan.program) await store.saveProgram(plan.program);
  let sets = 0;
  for (const m of plan.moves) {
    const r = await store.reassignVariant(fix.sessionId, m.slotId, m.to, { setIds: m.setIds, reason: fix.id });
    sets += r?.moved || 0;
    if (!record.moved.includes(m.slotId)) record.moved.push(m.slotId);
    await keep();
  }
  record.appliedAt = Date.now();
  await keep();
  return { sets, program: !!plan.program, record };
}

// Puts the listed sets and the items back under what was recorded and the program as it was;
// the fix is offered again. Meant right after applying («Отменить»).
export function revertFix(store, fix = FIX_2026_10_18) {
  return enqueue(fix.id, 'revert', () => undo(store, fix));
}

async function undo(store, fix) {
  const record = store.state.kv.fixes?.[fix.id];
  if (!record) return false;
  for (const m of fix.moves.filter((x) => record.moved.includes(x.slotId))) {
    await store.reassignVariant(fix.sessionId, m.slotId, m.from, { setIds: m.setIds, reason: `${fix.id}:undo` });
  }
  if (record.programBefore) await store.saveProgram(record.programBefore);
  const fixes = { ...(store.state.kv.fixes || {}) };
  delete fixes[fix.id];
  await store.setKV({ fixes });
  return true;
}
