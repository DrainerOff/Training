// Local-first store. Every change is written to the device first (IndexedDB) together
// with an outbox entry in the same transaction; the sync engine later pushes the outbox
// to Google Sheets. Records are never hard-deleted — deletions are a `deleted` flag so
// they propagate through sync. Conflicts resolve by `updatedAt` (last writer wins).

import { uid, isoDate } from '../lib/util.js';
import { normalizeProgram, starterProgram, makeOption, CATEGORY } from '../lib/program.js';
import { itemsForDay } from '../lib/planner.js';

export const ENTITIES = ['sessions', 'sets', 'metrics', 'records', 'exercises'];
const DOUBLE_TAP_MS = 1500;
const MAX_CORRECTIONS = 50;
export const SETUP_MAX = 300;

export function createStore(adapter, { now = () => Date.now() } = {}) {
  const state = {
    loaded: false,
    program: null,
    sessions: new Map(),
    sets: new Map(),
    metrics: new Map(),
    records: new Map(), // manual personal records; automatic ones are derived from sets
    exercises: new Map(), // per-variant settings, id `x:<seriesKey>`
    outbox: new Map(),
    kv: {},
    version: 0,
    storageError: null,
  };
  const listeners = new Set();
  let onLocalChange = null;
  // sessionId -> Map(setId -> set); keeps per-workout lookups independent of total history size.
  const bySession = new Map();
  function putRecord(entity, r) {
    const prev = state[entity].get(r.id);
    state[entity].set(r.id, r);
    if (entity === 'sets') {
      if (prev && prev.sessionId !== r.sessionId) bySession.get(prev.sessionId)?.delete(r.id);
      if (!bySession.has(r.sessionId)) bySession.set(r.sessionId, new Map());
      bySession.get(r.sessionId).set(r.id, r);
    }
  }

  function dropRecord(entity, id) {
    const prev = state[entity].get(id);
    state[entity].delete(id);
    if (entity === 'sets' && prev) bySession.get(prev.sessionId)?.delete(id);
  }

  function emit() {
    state.version++;
    for (const fn of listeners) fn(state);
  }

  function stamp(prev) {
    return Math.max(now(), (prev?.updatedAt || 0) + 1);
  }

  // A failed write leaves no trace in memory: queued outbox entries are taken back here and
  // the callers restore their records, so nothing reaches the sheet that the phone hasn't kept.
  async function persist(ops, outboxEntries = []) {
    const before = [];
    for (const e of outboxEntries) {
      const entry = { key: `${e.entity}:${e.id}`, entity: e.entity, id: e.id, updatedAt: e.updatedAt };
      before.push([entry.key, state.outbox.get(entry.key)]);
      state.outbox.set(entry.key, entry);
      ops.push({ store: 'outbox', value: entry });
    }
    try {
      await adapter.write(ops);
      if (state.storageError) {
        state.storageError = null;
        emit();
      }
    } catch (err) {
      for (const [key, prev] of before.reverse()) {
        if (prev) state.outbox.set(key, prev);
        else state.outbox.delete(key);
      }
      state.storageError = `Не удалось сохранить на устройстве: ${err?.message || err}`;
      emit();
      throw err;
    }
  }

  // Memory first (instant UI), then disk + outbox in one transaction. Several entities (and kv)
  // can go in one call: all of it is saved, or none of it.
  async function saveAll(groups, kvPatch = null) {
    const ops = [];
    const outbox = [];
    const undo = [];
    for (const [entity, records] of groups) {
      for (const r of records) {
        undo.push([entity, r.id, state[entity].get(r.id)]);
        putRecord(entity, r);
        ops.push({ store: entity, value: r });
        outbox.push({ entity, id: r.id, updatedAt: r.updatedAt });
      }
    }
    const kvBefore = kvPatch ? Object.fromEntries(Object.keys(kvPatch).map((k) => [k, state.kv[k]])) : null;
    if (kvPatch) {
      Object.assign(state.kv, kvPatch);
      for (const [k, v] of Object.entries(kvPatch)) ops.push({ store: 'kv', value: { k, v } });
    }
    if (!ops.length) return;
    emit();
    try {
      await persist(ops, outbox);
    } catch (err) {
      for (const [entity, id, prev] of undo.reverse()) {
        if (prev) putRecord(entity, prev);
        else dropRecord(entity, id);
      }
      if (kvBefore) Object.assign(state.kv, kvBefore);
      emit();
      throw err;
    }
    if (outbox.length) onLocalChange?.();
  }

  function save(entity, records) {
    return saveAll([[entity, records]]);
  }

  function setKV(patch) {
    return saveAll([], patch);
  }

  async function load() {
    const [sessions, sets, metrics, records, exercises, outbox, kv] = await Promise.all(
      ['sessions', 'sets', 'metrics', 'records', 'exercises', 'outbox', 'kv'].map((s) => adapter.getAll(s)),
    );
    for (const r of sessions) state.sessions.set(r.id, r);
    for (const r of sets) putRecord('sets', r);
    for (const r of metrics) state.metrics.set(r.id, r);
    for (const r of records) state.records.set(r.id, r);
    for (const r of exercises) state.exercises.set(r.id, r);
    for (const r of outbox) state.outbox.set(r.key, r);
    for (const r of kv) state.kv[r.k] = r.v;
    // The starter program has updatedAt 0 and is never pushed: a fresh device must not
    // overwrite the real program stored in the sheet.
    state.program = normalizeProgram(state.kv.program) || starterProgram(0);
    state.loaded = true;
    emit();
  }

  // --- queries ---------------------------------------------------------------------

  function liveSessions() {
    return [...state.sessions.values()].filter((s) => !s.deleted);
  }

  function setsOf(sessionId, slotId = null) {
    const out = [];
    for (const s of bySession.get(sessionId)?.values() || []) {
      if (s.deleted) continue;
      if (slotId && s.slotId !== slotId) continue;
      out.push(s);
    }
    return out.sort((a, b) => a.setNo - b.setNo || a.createdAt - b.createdAt);
  }

  // --- sessions ----------------------------------------------------------------------

  async function startSession({ cycle, week, day, date = null, status = 'active' }) {
    const t = now();
    const s = {
      id: uid('ss'),
      date: date || isoDate(new Date(t)),
      cycle,
      week,
      day,
      status,
      startedAt: t,
      finishedAt: status === 'done' ? t : null,
      note: '',
      items: itemsForDay(state.program, day),
      updatedAt: t,
      deleted: false,
    };
    await save('sessions', [s]);
    return s;
  }

  async function updateSession(id, patch) {
    const s = state.sessions.get(id);
    if (!s) return null;
    const next = { ...s, ...patch, updatedAt: stamp(s) };
    const denorm = ['date', 'cycle', 'week', 'day'].some((k) => k in patch && patch[k] !== s[k]);
    await save('sessions', [next]);
    if (denorm) {
      const sets = setsOf(id).map((x) => ({ ...x, date: next.date, cycle: next.cycle, week: next.week, day: next.day, updatedAt: stamp(x) }));
      await save('sets', sets);
    }
    return next;
  }

  async function finishSession(id) {
    const s = state.sessions.get(id);
    if (!s) return null;
    const sets = setsOf(id);
    const lastAt = sets.length ? Math.max(...sets.map((x) => x.createdAt)) : now();
    return updateSession(id, { status: 'done', finishedAt: s.finishedAt || lastAt });
  }

  async function deleteSession(id) {
    const s = state.sessions.get(id);
    if (!s) return;
    const sets = setsOf(id).map((x) => ({ ...x, deleted: true, updatedAt: stamp(x) }));
    await save('sets', sets);
    await save('sessions', [{ ...s, deleted: true, updatedAt: stamp(s) }]);
  }

  async function updateItem(sessionId, slotId, patch) {
    const s = state.sessions.get(sessionId);
    if (!s) return;
    const items = s.items.map((it) => (it.slotId === slotId ? { ...it, ...patch, flags: { ...it.flags, ...(patch.flags || {}) } } : it));
    await save('sessions', [{ ...s, items, updatedAt: stamp(s) }]);
  }

  // Swap to an alternative (or a one-off exercise). Already logged sets keep their own
  // series key — they were done on the other machine and stay comparable to it.
  async function swapVariant(sessionId, slotId, option) {
    const s = state.sessions.get(sessionId);
    const it = s?.items.find((i) => i.slotId === slotId);
    if (!it) return;
    const opt = option.key ? option : makeOption(option.name);
    const options = it.options.some((o) => o.key === opt.key) ? it.options : [...it.options, { key: opt.key, name: opt.name }];
    await updateItem(sessionId, slotId, { seriesKey: opt.key, name: opt.name, options });
  }

  // A correction, not a swap: the exercise was recorded under the wrong variant. The item and
  // its sets recorded under the current variant (or exactly `setIds` of this slot) move to
  // `option`; weights, reps, RIR, dates and ids stay, so the sheet updates the same rows and every
  // device takes the change by `updatedAt`. Sets of this slot recorded under another variant (a
  // swap mid-exercise) stay where they are. The previous values are kept in kv `corrections`.
  async function reassignVariant(sessionId, slotId, option, { reason = '', setIds = null } = {}) {
    const s = state.sessions.get(sessionId);
    const it = s?.items.find((i) => i.slotId === slotId);
    if (!it) return null;
    const opt = option.key ? { key: option.key, name: option.name } : makeOption(option.name);
    const sets = setsOf(sessionId, slotId).filter((x) => (setIds ? setIds.includes(x.id) && x.seriesKey !== opt.key : x.seriesKey === it.seriesKey));
    const itemMoves = opt.key !== it.seriesKey || opt.name !== it.name;
    if (!itemMoves && !sets.length) return { moved: 0 };
    const options = it.options.some((o) => o.key === opt.key) ? it.options : [...it.options, opt];
    const items = itemMoves ? s.items.map((x) => (x.slotId === slotId ? { ...x, seriesKey: opt.key, name: opt.name, options } : x)) : s.items;
    const backup = {
      id: uid('cr'),
      at: now(),
      reason,
      sessionId,
      slotId,
      date: s.date,
      from: { key: it.seriesKey, name: it.name },
      to: opt,
      sets: sets.map((x) => ({ id: x.id, seriesKey: x.seriesKey, exercise: x.exercise, weight: x.weight, reps: x.reps, rir: x.rir, updatedAt: x.updatedAt })),
    };
    await saveAll(
      [
        ['sessions', itemMoves ? [{ ...s, items, updatedAt: stamp(s) }] : []],
        ['sets', sets.map((x) => ({ ...x, seriesKey: opt.key, exercise: opt.name, updatedAt: stamp(x) }))],
      ],
      { corrections: [...(state.kv.corrections || []), backup].slice(-MAX_CORRECTIONS) },
    );
    return { moved: sets.length, backup };
  }

  async function addItem(sessionId, { name, category = 'iso' }) {
    const s = state.sessions.get(sessionId);
    if (!s) return null;
    const opt = makeOption(name);
    const item = {
      slotId: uid('sl'),
      category: CATEGORY[category] ? category : 'iso',
      step: 2.5,
      options: [opt],
      overrides: {},
      seriesKey: opt.key,
      name: opt.name,
      note: '',
      flags: { pain: false, technique: false, baseline: false },
      adhoc: true,
    };
    await save('sessions', [{ ...s, items: [...s.items, item], updatedAt: stamp(s) }]);
    return item;
  }

  // --- sets ------------------------------------------------------------------------------

  async function logSet(sessionId, slotId, v) {
    const s = state.sessions.get(sessionId);
    const it = s?.items.find((i) => i.slotId === slotId);
    if (!it) throw new Error('Упражнение не найдено в тренировке');
    const existing = setsOf(sessionId, slotId);
    const last = existing[existing.length - 1];
    const t = now();
    // Store-level double-tap guard: the same weight × reps within 1.5 s is the same tap
    // (RIR is ignored: the composer resets it after each set, so a second tap would differ only there).
    const justNow = (x) => t - x.createdAt >= 0 && t - x.createdAt < DOUBLE_TAP_MS; // not a set from a clock ahead
    if (last && justNow(last) && last.weight === v.weight && last.reps === v.reps && !!last.drop === !!v.drop) {
      return { set: last, duplicate: true };
    }
    // The last set of an exercise opens the next one under the same finger: a second tap there
    // is the same double tap, not a first set of the next exercise.
    const latest = setsOf(sessionId).reduce((a, x) => (!a || x.createdAt > a.createdAt ? x : a), null);
    if (latest && latest.slotId !== slotId && justNow(latest)) {
      return { set: latest, duplicate: true };
    }
    const rec = {
      id: uid('st'),
      sessionId,
      slotId,
      seriesKey: it.seriesKey,
      exercise: it.name,
      date: s.date,
      cycle: s.cycle,
      week: s.week,
      day: s.day,
      setNo: existing.length + 1,
      weight: v.weight,
      reps: v.reps,
      rir: v.rir ?? null,
      drop: !!v.drop,
      pain: !!v.pain,
      technique: !!v.technique,
      note: v.note || '',
      createdAt: t,
      updatedAt: t,
      deleted: false,
    };
    await save('sets', [rec]);
    return { set: rec, duplicate: false };
  }

  async function updateSet(id, patch) {
    const x = state.sets.get(id);
    if (!x) return null;
    const next = { ...x, ...patch, updatedAt: stamp(x) };
    await save('sets', [next]);
    return next;
  }

  async function renumber(sessionId, slotId) {
    const changed = [];
    setsOf(sessionId, slotId).forEach((x, i) => {
      if (x.setNo !== i + 1) changed.push({ ...x, setNo: i + 1, updatedAt: stamp(x) });
    });
    await save('sets', changed);
  }

  async function deleteSet(id) {
    const x = state.sets.get(id);
    if (!x) return;
    await save('sets', [{ ...x, deleted: true, updatedAt: stamp(x) }]);
    await renumber(x.sessionId, x.slotId);
  }

  async function restoreSet(id) {
    const x = state.sets.get(id);
    if (!x) return;
    await save('sets', [{ ...x, deleted: false, updatedAt: stamp(x) }]);
    await renumber(x.sessionId, x.slotId);
  }

  // --- body metrics (one record per date, deterministic id → no duplicates across devices)

  async function saveMetric(date, patch) {
    const id = `m${date}`;
    const prev = state.metrics.get(id);
    const rec = {
      id,
      date,
      bodyweight: null,
      sleep: null,
      recovery: null,
      note: '',
      ...(prev && !prev.deleted ? prev : {}), // a deleted entry is not resurrected field by field
      ...patch,
      deleted: false,
      updatedAt: stamp(prev),
    };
    await save('metrics', [rec]);
    return rec;
  }

  async function deleteMetric(id) {
    const prev = state.metrics.get(id);
    if (!prev) return;
    await save('metrics', [{ ...prev, deleted: true, updatedAt: stamp(prev) }]);
  }

  // --- manual personal records ---------------------------------------------------------------
  // Stable id per entry; edits keep the id, deletion is a flag (it syncs and can be undone).

  async function saveRecord(fields) {
    const prev = fields.id ? state.records.get(fields.id) : null;
    const t = now();
    const rec = {
      id: prev?.id || uid('pr'),
      seriesKey: fields.seriesKey,
      exercise: fields.exercise,
      category: fields.category || null,
      date: fields.date,
      weight: fields.weight,
      reps: fields.reps,
      rir: fields.rir ?? null,
      bodyweight: fields.bodyweight ?? null,
      note: fields.note || '',
      createdAt: prev?.createdAt || t,
      updatedAt: stamp(prev),
      deleted: false,
    };
    await save('records', [rec]);
    return rec;
  }

  async function deleteRecord(id) {
    const prev = state.records.get(id);
    if (!prev || prev.deleted) return;
    await save('records', [{ ...prev, deleted: true, updatedAt: stamp(prev) }]);
  }

  async function restoreRecord(id) {
    const prev = state.records.get(id);
    if (!prev || !prev.deleted) return;
    await save('records', [{ ...prev, deleted: false, updatedAt: stamp(prev) }]);
  }

  // --- per-variant settings (seat, handles, stops…) ---------------------------------------------
  // One record per series key, deterministic id → two devices edit the same row, never two rows.

  function setupOf(seriesKey) {
    const r = state.exercises.get(`x:${seriesKey}`);
    return r && !r.deleted ? r.setup || '' : '';
  }

  async function saveSetup(seriesKey, exercise, text) {
    const id = `x:${seriesKey}`;
    const prev = state.exercises.get(id);
    const setup = String(text || '').trim().slice(0, SETUP_MAX);
    if (prev && !prev.deleted && (prev.setup || '') === setup) return prev;
    const rec = { id, seriesKey, exercise, setup, updatedAt: stamp(prev), deleted: false };
    await save('exercises', [rec]);
    return rec;
  }

  // --- program -------------------------------------------------------------------------

  async function saveProgram(program) {
    const p = normalizeProgram({ ...program, draft: false });
    p.updatedAt = Math.max(now(), (state.program?.updatedAt || 0) + 1);
    const before = state.program;
    state.program = p;
    emit();
    try {
      await persist([{ store: 'kv', value: { k: 'program', v: p } }], [{ entity: 'program', id: 'main', updatedAt: p.updatedAt }]);
    } catch (err) {
      state.program = before;
      emit();
      throw err;
    }
    onLocalChange?.();
    return p;
  }

  // --- import (text or backup) -----------------------------------------------------------

  async function importParsedSessions(parsed) {
    const created = [];
    for (const ps of parsed) {
      const t = now();
      const items = [];
      const sets = [];
      const sid = uid('ss');
      for (const pi of ps.items) {
        const dayItem = itemsForDay(state.program, ps.day).find((i) => i.options.some((o) => o.key === pi.key));
        const item = dayItem
          ? { ...dayItem, seriesKey: pi.key, name: pi.name }
          : {
              slotId: pi.slotId || uid('sl'),
              category: pi.category || 'iso',
              step: 2.5,
              options: [{ key: pi.key, name: pi.name }],
              overrides: {},
              seriesKey: pi.key,
              name: pi.name,
              note: '',
              flags: { pain: false, technique: false, baseline: false },
              adhoc: true,
            };
        items.push(item);
        pi.sets.forEach((v, i) => {
          sets.push({
            id: uid('st'),
            sessionId: sid,
            slotId: item.slotId,
            seriesKey: pi.key,
            exercise: pi.name,
            date: ps.date,
            cycle: ps.cycle,
            week: ps.week,
            day: ps.day,
            setNo: i + 1,
            weight: v.weight,
            reps: v.reps,
            rir: v.rir ?? null,
            drop: !!v.drop,
            pain: false,
            technique: false,
            note: '',
            createdAt: t + i,
            updatedAt: t + i,
            deleted: false,
          });
        });
      }
      const session = {
        id: sid,
        date: ps.date,
        cycle: ps.cycle,
        week: ps.week,
        day: ps.day,
        status: 'done',
        startedAt: t,
        finishedAt: t,
        note: 'Импортировано из текста',
        items,
        updatedAt: t,
        deleted: false,
      };
      await save('sessions', [session]);
      await save('sets', sets);
      created.push(session);
    }
    return created;
  }

  function exportAll() {
    return {
      format: 'trainer-backup',
      version: 1,
      exportedAt: new Date(now()).toISOString(),
      program: state.program,
      sessions: [...state.sessions.values()],
      sets: [...state.sets.values()],
      metrics: [...state.metrics.values()],
      records: [...state.records.values()],
      exercises: [...state.exercises.values()],
    };
  }

  async function importBackup(obj) {
    if (!obj || obj.format !== 'trainer-backup') throw new Error('Это не резервная копия трекера');
    const result = await applyRemote(obj, { queue: true });
    return result;
  }

  // --- sync hooks ---------------------------------------------------------------------------

  // Merge records coming from the server (or a backup). Local pending edits that are
  // newer win; otherwise the newer `updatedAt` wins. With queue:true accepted records are
  // also put into the outbox (used for backups so they reach the sheet).
  async function applyRemote(data, { queue = false } = {}) {
    const ops = [];
    const outboxEntries = [];
    // If the write fails, memory goes back too: the next pull then brings these records again
    // (the cursor only moves after a successful apply) instead of finding them already "known".
    const undo = [];
    const dropOutbox = (key) => {
      undo.push(['outbox', key, state.outbox.get(key)]);
      state.outbox.delete(key);
      ops.push({ store: 'outbox', delete: key });
    };
    let changed = 0;
    for (const entity of ENTITIES) {
      for (const r of data?.[entity] || []) {
        if (!r || !r.id) continue;
        const local = state[entity].get(r.id);
        if (local && (local.updatedAt || 0) >= (r.updatedAt || 0)) continue;
        undo.push([entity, r.id, local]);
        putRecord(entity, r);
        ops.push({ store: entity, value: r });
        const key = `${entity}:${r.id}`;
        if (queue) outboxEntries.push({ entity, id: r.id, updatedAt: r.updatedAt });
        else if (state.outbox.has(key)) dropOutbox(key);
        changed++;
      }
    }
    const rp = normalizeProgram(data?.program);
    const programBefore = state.program;
    if (rp && rp.updatedAt > (state.program?.updatedAt || 0)) {
      state.program = rp;
      ops.push({ store: 'kv', value: { k: 'program', v: rp } });
      if (queue) outboxEntries.push({ entity: 'program', id: 'main', updatedAt: rp.updatedAt });
      else if (state.outbox.has('program:main')) dropOutbox('program:main');
      changed++;
    }
    if (ops.length) {
      emit();
      try {
        await persist(ops, outboxEntries);
      } catch (err) {
        for (const [what, id, prev] of undo.reverse()) {
          if (what === 'outbox') state.outbox.set(id, prev);
          else if (prev) putRecord(what, prev);
          else dropRecord(what, id);
        }
        state.program = programBefore;
        emit();
        throw err;
      }
    }
    return { changed };
  }

  // Remove outbox entries the server acknowledged — but only if the record was not
  // edited again while the request was in flight.
  async function ack(sent) {
    const ops = [];
    for (const { key, updatedAt } of sent) {
      const cur = state.outbox.get(key);
      if (cur && cur.updatedAt <= updatedAt) {
        state.outbox.delete(key);
        ops.push({ store: 'outbox', delete: key });
      }
    }
    if (ops.length) {
      await persist(ops);
      emit();
    }
  }

  return {
    state,
    load,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set onLocalChange(fn) {
      onLocalChange = fn;
    },
    setKV,
    liveSessions,
    setsOf,
    startSession,
    updateSession,
    finishSession,
    deleteSession,
    updateItem,
    swapVariant,
    reassignVariant,
    addItem,
    logSet,
    updateSet,
    deleteSet,
    restoreSet,
    saveMetric,
    deleteMetric,
    saveRecord,
    deleteRecord,
    restoreRecord,
    setupOf,
    saveSetup,
    saveProgram,
    importParsedSessions,
    exportAll,
    importBackup,
    applyRemote,
    ack,
  };
}
