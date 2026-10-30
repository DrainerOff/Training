// Sync engine: pushes the outbox to the Apps Script API and pulls changes back in one
// round-trip. Safe to retry at any point — the server upserts by record id, so a lost
// response followed by a resend never creates a duplicate set.

export const API_VERSION = 6;
const BATCH = 200;
// What an Apps Script that predates the `ack` map per entity understood.
const LEGACY_ENTITIES = ['sessions', 'sets', 'metrics'];
// Entities added after the first release. A device that synced with an older release moved its
// cursor past their rows without keeping them, so each is pulled once from the very start (the
// merge is idempotent); `<entity>Pulled` in kv marks it done.
const CATCH_UP = ['records', 'exercises', 'body', 'sleep', 'phases', 'nutrition', 'nutritionGoals'];
// What waits on the phone while the Apps Script doesn't know the entity yet.
const WAITING_LABEL = {
  records: 'рекорды, добавленные вручную',
  exercises: 'настройки упражнений',
  body: 'замеры тела',
  sleep: 'сон',
  phases: 'режимы набора и сушки',
  nutrition: 'питание по дням',
  nutritionGoals: 'цели по питанию',
};

// Everything a sync carries, in the order the restore check lists it.
export const SYNCED = ['sessions', 'sets', 'metrics', 'records', 'exercises', 'body', 'sleep', 'phases', 'nutrition', 'nutritionGoals'];
export const ENTITY_LABEL = {
  sessions: 'тренировки',
  sets: 'подходы',
  metrics: 'вес и сон за день (записи до v1.1)',
  records: 'рекорды, добавленные вручную',
  exercises: 'настройки упражнений',
  body: 'замеры тела',
  sleep: 'сон',
  phases: 'режимы набора и сушки',
  nutrition: 'питание по дням',
  nutritionGoals: 'цели по питанию',
};

// What a new phone would get from the sheet, compared record by record with this one; read-only on
// both sides. A problem is a record of this phone the sheet doesn't have (or has an older version
// of) while nothing is waiting to be sent — a new phone would not get it.
export function restoreReport(state, res, entities = SYNCED) {
  const known = new Set(res?.ack && typeof res.ack === 'object' ? Object.keys(res.ack) : LEGACY_ENTITIES);
  const queued = new Set(state.outbox?.keys?.() || []);
  const rows = [];
  let problems = 0;
  for (const entity of entities) {
    const local = state[entity] || new Map();
    const liveHere = [...local.values()].filter((r) => !r.deleted).length;
    if (!known.has(entity)) {
      rows.push({ entity, label: ENTITY_LABEL[entity] || entity, unsupported: true, here: liveHere, there: null });
      if (liveHere) problems++;
      continue;
    }
    const server = new Map((res.pull?.[entity] || []).map((r) => [r.id, r]));
    const row = { entity, label: ENTITY_LABEL[entity] || entity, here: liveHere, there: 0, same: 0, pending: 0, missing: 0, older: 0, newer: 0, onlyThere: 0 };
    for (const r of server.values()) if (!r.deleted) row.there++;
    for (const [id, r] of local) {
      const s = server.get(id);
      const waiting = queued.has(`${entity}:${id}`);
      if (!s) {
        if (r.deleted) continue;
        if (waiting) row.pending++;
        else row.missing++;
      } else if (Number(s.updatedAt) === Number(r.updatedAt)) row.same++;
      else if (Number(s.updatedAt) < Number(r.updatedAt)) {
        if (waiting) row.pending++;
        else row.older++;
      } else row.newer++;
    }
    for (const [id, s] of server) if (!local.has(id) && !s.deleted) row.onlyThere++;
    problems += row.missing + row.older;
    rows.push(row);
  }
  const sp = res?.pull?.program || null;
  const here = state.program?.updatedAt || 0;
  const program = { here, there: sp ? Number(sp.updatedAt) || 0 : 0, pending: queued.has('program:main') };
  program.ok = !here || program.there >= here || program.pending;
  if (!program.ok) problems++;
  return { ok: problems === 0, problems, rows, program, api: res?.api ?? null };
}

export class SyncError extends Error {
  constructor(code, detail = '') {
    super(detail || code);
    this.code = code;
  }
}

export async function fetchTransport(url, payload, { timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // text/plain keeps this a "simple" CORS request: Apps Script cannot answer preflights.
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new SyncError('http', String(res.status));
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new SyncError('bad_response', text.slice(0, 160));
    }
  } catch (err) {
    if (err instanceof SyncError) throw err;
    throw new SyncError('network', err?.name === 'AbortError' ? 'timeout' : String(err?.message || err));
  } finally {
    clearTimeout(timer);
  }
}

const MESSAGES = {
  network: 'Нет связи с Google. Всё сохранено на телефоне и отправится, когда появится интернет.',
  unauthorized: 'Ключ доступа не подходит. Скопируйте его заново: таблица → меню «Тренировки» → «Показать ключ доступа».',
  bad_response: 'Адрес отвечает не как API тренировок. Проверьте ссылку на веб-приложение и доступ «Все».',
  http: 'Сервер Google вернул ошибку. Попробуем ещё раз позже.',
  server_error: 'Ошибка в Apps Script.',
  busy: 'Таблица занята другой синхронизацией. Повторим автоматически.',
  storage: 'Связь с таблицей есть, но телефон не сохранил полученное. Синхронизация повторится сама.',
};

// A failed write to the phone's storage during a sync is not a network problem.
function codeOf(err) {
  return err?.name === 'StorageError' ? 'storage' : err?.code || 'network';
}

// The owner pastes these on the phone; catch the usual mix-ups before saving.
export function checkApiUrl(url) {
  const u = String(url || '').trim();
  if (/^https:\/\/script\.google\.com\/(?:a\/macros\/[^/]+|macros)\/s\/[\w-]+\/exec$/.test(u)) return null;
  if (/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/\S*$/.test(u)) return null; // local test backend
  if (/\/dev$/.test(u)) return 'Это адрес тестового развертывания (/dev) — он работает только при входе в Google. Нужен URL веб-приложения, который оканчивается на /exec.';
  if (/docs\.google\.com\/spreadsheets/.test(u)) return 'Это адрес самой таблицы. Нужен URL веб-приложения Apps Script: «Начать развертывание → Управление развертываниями», оканчивается на /exec.';
  if (/script\.google\.com\/(?:home|d\/)/.test(u)) return 'Это адрес редактора скрипта. Нужен URL веб-приложения: «Начать развертывание → Управление развертываниями», оканчивается на /exec.';
  return 'Адрес должен выглядеть так: https://script.google.com/macros/s/…/exec';
}

export function checkToken(token) {
  return /^[0-9a-f]{64}$/i.test(String(token || '').trim())
    ? null
    : 'Ключ — это 64 символа (цифры и буквы a–f). Скопируйте его целиком: таблица → меню «Тренировки» → «Показать ключ доступа».';
}

export function describeError(err) {
  const code = codeOf(err);
  const base = MESSAGES[code] || MESSAGES.server_error;
  return (code === 'server_error' || code === 'storage') && err.message ? `${base} ${err.message}` : base;
}

export function createSync(store, { transport = fetchTransport, now = () => Date.now() } = {}) {
  const status = { state: 'off', lastSyncAt: null, error: null, notice: null, pending: 0, waiting: 0, waitingBy: {} };
  const listeners = new Set();
  let running = null;
  let again = false;
  let timer = null;
  // Entities the connected Apps Script doesn't know yet (records before API 2, exercise settings
  // before API 3, body and sleep before API 4): they wait on the phone. They are not "pending" — nothing to retry until
  // Code.gs is updated.
  const unknown = new Set();

  function update(patch) {
    const counts = new Map();
    if (unknown.size) {
      for (const e of store.state.outbox.values()) if (unknown.has(e.entity)) counts.set(e.entity, (counts.get(e.entity) || 0) + 1);
    }
    const waiting = [...counts.values()].reduce((a, n) => a + n, 0);
    const what = [...counts].map(([entity, n]) => `${WAITING_LABEL[entity] || entity} — ${n}`).join('; ');
    const notice = waiting
      ? `Сохранены на телефоне и попадут в таблицу после обновления Apps Script (Code.gs): ${what}. Инструкция — в docs/SETUP.md.`
      : null;
    const waitingBy = Object.fromEntries(counts);
    Object.assign(status, patch, { pending: store.state.outbox.size - waiting, waiting, waitingBy, notice });
    for (const fn of listeners) fn({ ...status });
  }

  function config() {
    const c = store.state.kv.sync;
    return c && c.url && c.token ? c : null;
  }

  async function round(cfg) {
    const entries = [...store.state.outbox.values()].sort((a, b) => a.updatedAt - b.updatedAt).slice(0, BATCH);
    const push = Object.fromEntries(SYNCED.map((e) => [e, []]));
    const sent = [];
    for (const e of entries) {
      if (e.entity === 'program') {
        if (store.state.program?.updatedAt) {
          push.program = store.state.program;
          sent.push({ key: e.key, entity: 'program', updatedAt: store.state.program.updatedAt });
        }
        continue;
      }
      const rec = store.state[e.entity]?.get(e.id);
      if (!rec || !push[e.entity]) continue;
      push[e.entity].push(rec);
      sent.push({ key: e.key, entity: e.entity, updatedAt: rec.updatedAt });
    }
    const behind = CATCH_UP.filter((entity) => !store.state.kv[`${entity}Pulled`]);
    const catchUp = behind.length ? Object.fromEntries(behind.map((entity) => [entity, 0])) : undefined;
    const res = await transport(cfg.url, {
      action: 'sync',
      token: cfg.token,
      api: API_VERSION,
      since: store.state.kv.cursor || 0,
      entitySince: catchUp,
      programSince: store.state.kv.programSince || 0,
      push,
    });
    if (!res || res.ok !== true) throw new SyncError(res?.error || 'bad_response', res?.message || '');
    // Records the sheet refused stay queued (and visible as an error) — never silently dropped.
    const refused = new Set((res.rejected || []).map((r) => `${r.entity}:${r.id}`));
    // Only what the server says it handled is acknowledged: an Apps Script from before manual
    // records ignores them, so they stay queued on the phone until Code.gs is updated.
    const known = new Set(res.ack && typeof res.ack === 'object' ? Object.keys(res.ack) : LEGACY_ENTITIES);
    const accepted = sent.filter((s) => !refused.has(s.key) && (s.entity === 'program' || known.has(s.entity)));
    for (const entity of Object.keys(push)) {
      if (entity === 'program') continue;
      if (known.has(entity)) unknown.delete(entity);
      else unknown.add(entity);
    }
    await store.ack(accepted);
    await store.applyRemote(res.pull || {});
    await store.setKV({
      cursor: Math.max(store.state.kv.cursor || 0, Number(res.cursor) || 0),
      programSince: Math.max(store.state.kv.programSince || 0, Number(res.programUpdatedAt) || 0),
      // API 6: when «Команды» last delivered Health data (times and counts from App_HealthLog).
      ...(res.ingest && typeof res.ingest === 'object' ? { ingest: res.ingest } : {}),
      ...Object.fromEntries(behind.filter((entity) => known.has(entity)).map((entity) => [`${entity}Pulled`, true])),
    });
    return { more: entries.length === BATCH && accepted.length > 0, refused: refused.size };
  }

  async function run() {
    const cfg = config();
    if (!cfg) {
      update({ state: 'off', error: null });
      return status;
    }
    update({ state: 'syncing', error: null });
    try {
      let more = true;
      let refused = 0;
      for (let i = 0; more && i < 20; i++) {
        const r = await round(cfg);
        more = r.more;
        refused = r.refused;
      }
      if (refused) {
        update({ state: 'error', lastSyncAt: now(), errorCode: 'rejected', error: `Таблица не приняла записей: ${refused}. Они сохранены на телефоне и будут отправляться повторно. Проверьте значения в них или обновите Code.gs до версии из репозитория.` });
      } else {
        update({ state: 'idle', lastSyncAt: now(), error: null, errorCode: null });
      }
    } catch (err) {
      const code = codeOf(err);
      update({ state: code === 'network' ? 'offline' : 'error', error: describeError(err), errorCode: code });
    }
    return status;
  }

  function syncNow() {
    clearTimeout(timer);
    if (running) {
      again = true;
      return running;
    }
    running = run().finally(() => {
      running = null;
      if (again) {
        again = false;
        syncNow();
      }
    });
    return running;
  }

  function schedule(ms = 2500) {
    clearTimeout(timer);
    timer = setTimeout(syncNow, ms);
  }

  // Asks the sheet for everything, as a new phone would, and changes nothing on either side: no
  // records are sent and nothing received is applied.
  async function verify() {
    const cfg = config();
    if (!cfg) throw new SyncError('unauthorized', 'Синхронизация не подключена');
    const all = Object.fromEntries(SYNCED.map((e) => [e, 0]));
    const res = await transport(cfg.url, { action: 'sync', token: cfg.token, api: API_VERSION, since: 0, entitySince: all, programSince: 0, push: {} }, { timeoutMs: 90000 });
    if (!res || res.ok !== true) throw new SyncError(res?.error || 'bad_response', res?.message || '');
    return restoreReport(store.state, res);
  }

  async function ping(cfg) {
    const res = await transport(cfg.url, { action: 'ping', token: cfg.token, api: API_VERSION });
    if (!res || res.ok !== true) throw new SyncError(res?.error || 'bad_response', res?.message || '');
    return res;
  }

  return {
    status,
    syncNow,
    schedule,
    ping,
    verify,
    refresh: () => update({}),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
