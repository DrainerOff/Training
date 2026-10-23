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
  title: 'Исправить тренировку 18 октября',
  label: 'Исправление тренировки 18 октября',
  why: 'Записано под упражнениями программы, а сделано на других тренажёрах. Подходы перейдут в серии того, что было сделано.',
  programText: 'Программа, день 2: основными станут «Гиперэкстензия в тренажере» и «Тяга штанги к подбородку в Смите», прежние варианты останутся альтернативами. К кроссоверу добавятся «Обратная бабочка двумя руками» и «одной рукой».',
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

// 22.10.2026 (cycle 1, week 2, day 4): the upright row in Smith got two series. The 18.10 fix made
// «Тяга штанги к подбородку в Смите» the day 2 variant, day 4 kept the barbell key it had before,
// and the owner does the exercise in Smith on both days. The day 4 sets join the Smith series, so
// the history, «Прошлый раз», progress and the recommendation see both workouts; the barbell
// variant stays in the program as an alternative with its own (empty) series.
export const FIX_2026_10_22 = {
  id: 'fix-2026-10-22',
  sessionId: 'ssmvjx9qrh499fc25a49abfac2',
  date: '2026-10-22',
  day: 4,
  title: 'Объединить тягу к подбородку',
  label: 'Объединение тяги к подбородку',
  why: '18 и 22 октября — одно и то же упражнение в Смите, но 22 октября подходы записаны в отдельную серию «Тяга штанги к подбородку». Они перейдут в серию «в Смите», и история, «Прошлый раз» и рекомендация будут видеть обе тренировки.',
  programText: 'Программа, день 4: основной станет «Тяга штанги к подбородку в Смите», вариант со штангой останется альтернативой.',
  moves: [
    {
      slotId: 'D4-05',
      from: { key: 'tyaga-shtangi-k-podborodku', name: 'Тяга штанги к подбородку' },
      to: { key: 'tyaga-shtangi-k-podborodku-v-smite', name: 'Тяга штанги к подбородку в Смите' },
      setIds: ['stmvk0gkgi5f5c80cdaec08f9c', 'stmvk0lkvia46d777e1737a414', 'stmvk0s5mq0433835a579add8b'],
      // Day 4 workouts started before the fix from the old program have the same mix-up.
      follow: true,
    },
  ],
  program: [
    {
      has: 'tyaga-shtangi-k-podborodku',
      options: [
        { key: 'tyaga-shtangi-k-podborodku-v-smite', name: 'Тяга штанги к подбородку в Смите' },
        { key: 'tyaga-shtangi-k-podborodku', name: 'Тяга штанги к подбородку' },
      ],
    },
  ],
};

export const FIXES = [FIX_2026_10_18, FIX_2026_10_22];

// What `fix` would change on this device now:
//   moves:   [{ …move, sessionId, date, item, sets }] — `sets` are the listed sets still on `from`
//            (the item may already be on `to`, or the sets may be and only the item is not);
//   skipped: exercises where this slot has sets on `from` that are not the recorded ones;
//   program: the new program, or null.
// A move with `follow` also takes the same slot of later workouts of that day that were started
// from the program as it was before the fix (the item's main variant is still `from`): their sets
// are listed on the card too. A workout where the owner picked `from` as an alternative after the
// fix has `to` as the main variant and is never offered.
// The program part is offered with a move, or when the program has lost the variants the moved
// sets now belong to — not when the owner later changed that day in some other way.
export function planFix(state, fix) {
  const session = state.sessions.get(fix.sessionId);
  const out = { moves: [], skipped: [], program: null };
  if (!session || session.deleted) return out;
  const liveSets = [...state.sets.values()].filter((x) => !x.deleted);
  for (const m of fix.moves) {
    const item = session.items.find((i) => i.slotId === m.slotId);
    if (item) {
      const listed = m.setIds.map((id) => state.sets.get(id)).filter((x) => x && !x.deleted && x.sessionId === fix.sessionId && x.slotId === m.slotId);
      const sets = listed.filter((x) => x.seriesKey === m.from.key).sort((a, b) => a.setNo - b.setNo);
      // Sets on `from` in this exercise that are not the recorded ones: don't guess, leave it alone.
      const others = liveSets.some((x) => x.sessionId === fix.sessionId && x.slotId === m.slotId && x.seriesKey === m.from.key && !m.setIds.includes(x.id));
      const done = !sets.length && item.seriesKey !== m.from.key; // here or through sync
      const move = { ...m, sessionId: fix.sessionId, date: session.date, item, sets };
      if (done) {
        // nothing left in the recorded workout
      } else if (others) out.skipped.push(move);
      else out.moves.push(move);
    }
    if (!m.follow) continue;
    const later = [...state.sessions.values()]
      .filter((s) => !s.deleted && s.id !== fix.sessionId && s.day === fix.day && s.date >= fix.date)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.startedAt || 0) - (b.startedAt || 0)));
    for (const s of later) {
      const it = s.items.find((i) => i.slotId === m.slotId && i.seriesKey === m.from.key && i.options?.[0]?.key === m.from.key);
      if (!it) continue;
      const sets = liveSets.filter((x) => x.sessionId === s.id && x.slotId === m.slotId && x.seriesKey === m.from.key).sort((a, b) => a.setNo - b.setNo);
      out.moves.push({ ...m, sessionId: s.id, date: s.date, item: it, sets, setIds: sets.map((x) => x.id), later: true });
    }
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

// Every fix this device still has to offer, oldest first: [{ fix, plan }].
export function pendingFixes(state) {
  return FIXES.map((fix) => ({ fix, plan: pendingFix(state, fix) })).filter((x) => x.plan);
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
    later: [...(prev.later || [])],
    programBefore: prev.programBefore || (plan.program ? store.state.program : null),
    startedAt: prev.startedAt || Date.now(),
    appliedAt: null,
  };
  const keep = () => store.setKV({ fixes: { ...(store.state.kv.fixes || {}), [fix.id]: { ...record } } });
  await keep();
  if (plan.program) await store.saveProgram(plan.program);
  let sets = 0;
  for (const m of plan.moves) {
    const r = await store.reassignVariant(m.sessionId, m.slotId, m.to, { setIds: m.setIds, reason: fix.id });
    sets += r?.moved || 0;
    if (m.later) record.later = [...record.later.filter((x) => !(x.sessionId === m.sessionId && x.slotId === m.slotId)), { sessionId: m.sessionId, slotId: m.slotId, setIds: m.setIds }];
    else if (!record.moved.includes(m.slotId)) record.moved.push(m.slotId);
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
  for (const l of record.later || []) {
    const m = fix.moves.find((x) => x.slotId === l.slotId);
    if (m) await store.reassignVariant(l.sessionId, l.slotId, m.from, { setIds: l.setIds, reason: `${fix.id}:undo` });
  }
  if (record.programBefore) await store.saveProgram(record.programBefore);
  const fixes = { ...(store.state.kv.fixes || {}) };
  delete fixes[fix.id];
  await store.setKV({ fixes });
  return true;
}
