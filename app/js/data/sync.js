// Sync engine: pushes the outbox to the Apps Script API and pulls changes back in one
// round-trip. Safe to retry at any point — the server upserts by record id, so a lost
// response followed by a resend never creates a duplicate set.

export const API_VERSION = 1;
const BATCH = 200;

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
};

export function describeError(err) {
  const code = err?.code || 'network';
  const base = MESSAGES[code] || MESSAGES.server_error;
  return code === 'server_error' && err.message ? `${base} ${err.message}` : base;
}

export function createSync(store, { transport = fetchTransport, now = () => Date.now() } = {}) {
  const status = { state: 'off', lastSyncAt: null, error: null, pending: 0 };
  const listeners = new Set();
  let running = null;
  let again = false;
  let timer = null;

  function update(patch) {
    Object.assign(status, patch, { pending: store.state.outbox.size });
    for (const fn of listeners) fn({ ...status });
  }

  function config() {
    const c = store.state.kv.sync;
    return c && c.url && c.token ? c : null;
  }

  async function round(cfg) {
    const entries = [...store.state.outbox.values()].sort((a, b) => a.updatedAt - b.updatedAt).slice(0, BATCH);
    const push = { sessions: [], sets: [], metrics: [] };
    const sent = [];
    for (const e of entries) {
      if (e.entity === 'program') {
        if (store.state.program?.updatedAt) {
          push.program = store.state.program;
          sent.push({ key: e.key, updatedAt: store.state.program.updatedAt });
        }
        continue;
      }
      const rec = store.state[e.entity]?.get(e.id);
      if (!rec) continue;
      push[e.entity].push(rec);
      sent.push({ key: e.key, updatedAt: rec.updatedAt });
    }
    const res = await transport(cfg.url, {
      action: 'sync',
      token: cfg.token,
      api: API_VERSION,
      since: store.state.kv.cursor || 0,
      programSince: store.state.kv.programSince || 0,
      push,
    });
    if (!res || res.ok !== true) throw new SyncError(res?.error || 'bad_response', res?.message || '');
    await store.ack(sent);
    await store.applyRemote(res.pull || {});
    await store.setKV({
      cursor: Math.max(store.state.kv.cursor || 0, Number(res.cursor) || 0),
      programSince: Math.max(store.state.kv.programSince || 0, Number(res.programUpdatedAt) || 0),
    });
    return entries.length === BATCH;
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
      for (let i = 0; more && i < 20; i++) more = await round(cfg);
      update({ state: 'idle', lastSyncAt: now(), error: null });
    } catch (err) {
      const code = err?.code || 'network';
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
    refresh: () => update({}),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
