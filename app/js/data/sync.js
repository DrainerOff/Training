// Sync engine: pushes the outbox to the Apps Script API and pulls changes back in one
// round-trip. Safe to retry at any point — the server upserts by record id, so a lost
// response followed by a resend never creates a duplicate set.

export const API_VERSION = 2;
const BATCH = 200;
// What an Apps Script that predates the `ack` map per entity understood.
const LEGACY_ENTITIES = ['sessions', 'sets', 'metrics'];

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
  const code = err?.code || 'network';
  const base = MESSAGES[code] || MESSAGES.server_error;
  return code === 'server_error' && err.message ? `${base} ${err.message}` : base;
}

export function createSync(store, { transport = fetchTransport, now = () => Date.now() } = {}) {
  const status = { state: 'off', lastSyncAt: null, error: null, notice: null, pending: 0 };
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
    const push = { sessions: [], sets: [], metrics: [], records: [] };
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
    const res = await transport(cfg.url, {
      action: 'sync',
      token: cfg.token,
      api: API_VERSION,
      since: store.state.kv.cursor || 0,
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
    const waiting = sent.filter((s) => s.entity !== 'program' && !known.has(s.entity)).length;
    await store.ack(accepted);
    await store.applyRemote(res.pull || {});
    await store.setKV({
      cursor: Math.max(store.state.kv.cursor || 0, Number(res.cursor) || 0),
      programSince: Math.max(store.state.kv.programSince || 0, Number(res.programUpdatedAt) || 0),
    });
    return { more: entries.length === BATCH && accepted.length > 0, refused: refused.size, waiting };
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
      let waiting = 0;
      for (let i = 0; more && i < 20; i++) {
        const r = await round(cfg);
        more = r.more;
        refused = r.refused;
        waiting = r.waiting;
      }
      const notice = waiting
        ? `Рекорды, добавленные вручную (${waiting}), сохранены на телефоне. В таблицу они попадут после обновления Apps Script (Code.gs) — инструкция в docs/SETUP.md.`
        : null;
      if (refused) {
        update({ state: 'error', lastSyncAt: now(), errorCode: 'rejected', notice, error: `Таблица не приняла записей: ${refused}. Они сохранены на телефоне и будут отправляться повторно. Обновите Code.gs до версии из репозитория.` });
      } else {
        update({ state: 'idle', lastSyncAt: now(), error: null, errorCode: null, notice });
      }
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
