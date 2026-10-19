// Storage adapters. The store talks to an adapter with two methods:
//   getAll(storeName) -> Promise<array>
//   write(ops)        -> Promise<void>, ops = [{ store, value } | { store, delete: key }]
// All ops of one write() land in a single IndexedDB transaction (record + outbox together).

export const STORES = {
  sessions: 'id',
  sets: 'id',
  metrics: 'id',
  records: 'id', // manual personal records (since version 2)
  exercises: 'id', // per-variant settings: seat, handles, stops… (since version 3)
  body: 'id', // body measurements: weight, waist, girths (since version 4)
  sleep: 'id', // main sleep per wake date (since version 4)
  phases: 'id', // bulk / cut / maintenance periods with a target rate (since version 5)
  outbox: 'key',
  kv: 'k',
};
// Bumped when a store is added. The upgrade only creates missing stores — existing data is
// never touched. A database from a newer release is opened as it is (see openOnce).
export const DB_VERSION = 5;

// Every IndexedDB request below has a deadline. WebKit has had bugs where `open()` or a
// transaction never fires success *or* error in a regular (disk-backed) Safari tab while a
// private tab (in-memory backend) works — the app then waited forever on «Загрузка…».
// Now a stalled request becomes a StorageError that names the step, and the boot screen
// shows it instead of hanging.
//   https://bugs.webkit.org/show_bug.cgi?id=226547 (open never resolves)
//   https://bugs.webkit.org/show_bug.cgi?id=197050 (reopen hangs after a process restart)
const OPEN_ATTEMPTS = 2;

// Deadlines are generous: they exist to end a wait that would otherwise never end, not to
// rush a slow phone. A write gets extra time per record (a backup or a first full download).
function limit(kind, records = 0) {
  const override = globalThis.__TRAINER_IDB_TIMEOUT_MS; // tests shorten the deadlines
  if (override) return override;
  if (kind === 'open') return 4000;
  if (kind === 'read') return 15000;
  return 8000 + 5 * records;
}

export class StorageError extends Error {
  constructor(step, message, cause) {
    super(message);
    this.name = 'StorageError';
    this.step = step; // 'open' | 'read' | 'write'
    this.cause = cause;
  }
}

const STEP_TEXT = { open: 'открытие базы', read: 'чтение', write: 'запись' };

function timeoutError(step, ms) {
  const sec = ms < 1000 ? (ms / 1000).toFixed(1) : Math.round(ms / 1000);
  return new StorageError(step, `IndexedDB не ответила за ${sec} с (${STEP_TEXT[step]})`);
}

function wrapError(step, err) {
  if (err instanceof StorageError) return err;
  const text = err?.message || err?.name || String(err || 'неизвестная ошибка');
  return new StorageError(step, `IndexedDB: ${STEP_TEXT[step]} не удалось — ${text}`, err);
}

// Safari 14 workaround: the first request after launch can sit idle until IndexedDB is
// poked; polling databases() wakes it up. Harmless elsewhere, bounded so it never blocks.
function wake(ms) {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    const poke = () => {
      try {
        indexedDB.databases().then(done, done);
      } catch {
        done();
      }
    };
    const interval = setInterval(poke, 100);
    const timer = setTimeout(done, ms);
    function done() {
      clearInterval(interval);
      clearTimeout(timer);
      resolve();
    }
    poke();
  });
}

function openOnce(name, ms) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let blocked = false;
    const finish = (fn, value) => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      fn(value);
      return true;
    };
    const timer = setTimeout(() => {
      const err = timeoutError('open', ms);
      if (blocked) err.message += ': база занята другой вкладкой этого приложения';
      finish(reject, err);
    }, ms);
    let req;
    let downgrade = false;
    const start = (version) => {
      req = version ? indexedDB.open(name, version) : indexedDB.open(name);
      req.onupgradeneeded = upgrade;
      // A connection that arrives after the deadline is closed, so it can't block a retry.
      req.onsuccess = () => {
        if (!finish(resolve, req.result)) req.result.close();
      };
      req.onerror = (event) => {
        // Opened by a newer release (higher version): use the database as it is.
        if (!downgrade && req.error?.name === 'VersionError') {
          event?.preventDefault?.();
          downgrade = true;
          start(null);
          return;
        }
        event?.preventDefault?.();
        finish(reject, wrapError('open', req.error));
      };
      // Only an upgrade can be blocked; it proceeds once the other tab lets go, so keep waiting.
      req.onblocked = () => {
        blocked = true;
      };
    };
    try {
      start(DB_VERSION);
    } catch (err) {
      finish(reject, wrapError('open', err));
    }
  });
}

function upgrade(event) {
  const db = event.target.result;
  for (const [store, keyPath] of Object.entries(STORES)) {
    if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath });
  }
}

async function openDb(name) {
  if (typeof indexedDB === 'undefined' || !indexedDB) {
    throw new StorageError('open', 'IndexedDB недоступна в этом браузере');
  }
  let lastErr;
  for (let attempt = 1; attempt <= OPEN_ATTEMPTS; attempt++) {
    await wake(Math.min(1500, limit('open')));
    try {
      return await openOnce(name, limit('open'));
    } catch (err) {
      lastErr = err;
    }
  }
  if (OPEN_ATTEMPTS > 1) lastErr.message += ` (попыток: ${OPEN_ATTEMPTS})`;
  throw lastErr;
}

export async function idbAdapter(name = 'trainer') {
  let db = await openDb(name);
  const watch = () => {
    const current = db;
    current.onclose = () => {
      if (db === current) db = null;
    };
    current.onversionchange = () => {
      current.close();
      if (db === current) db = null;
    };
  };
  watch();

  // iOS may close an idle connection while the app sits in the background; reopen once.
  async function withDb(fn) {
    if (!db) {
      db = await openDb(name);
      watch();
    }
    try {
      return await fn(db);
    } catch (err) {
      if (err && (err.name === 'InvalidStateError' || err.name === 'TransactionInactiveError')) {
        db = await openDb(name);
        watch();
        return fn(db);
      }
      throw err;
    }
  }

  return {
    kind: 'indexeddb',
    getAll(store) {
      return withDb(
        (d) =>
          new Promise((resolve, reject) => {
            const req = d.transaction(store, 'readonly').objectStore(store).getAll();
            const ms = limit('read');
            const timer = setTimeout(() => reject(timeoutError('read', ms)), ms);
            req.onsuccess = () => {
              clearTimeout(timer);
              resolve(req.result);
            };
            req.onerror = () => {
              clearTimeout(timer);
              reject(wrapError('read', req.error));
            };
          }),
      );
    },
    // Resolves only after the transaction has committed. A transaction that stalls is
    // aborted at the deadline, so the outcome is definite: nothing of it was saved.
    write(ops) {
      if (!ops.length) return Promise.resolve();
      const stores = [...new Set(ops.map((o) => o.store))];
      return withDb(
        (d) =>
          new Promise((resolve, reject) => {
            const tx = d.transaction(stores, 'readwrite');
            const ms = limit('write', ops.length);
            let settled = false;
            const finish = (fn, value) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              fn(value);
            };
            let timer = setTimeout(() => {
              try {
                tx.abort();
              } catch {
                // Already committing: give oncomplete one more period, then stop waiting.
                timer = setTimeout(() => finish(reject, timeoutError('write', 2 * ms)), ms);
                return;
              }
              finish(reject, timeoutError('write', ms));
            }, ms);
            for (const op of ops) {
              const os = tx.objectStore(op.store);
              if ('delete' in op) os.delete(op.delete);
              else os.put(op.value);
            }
            tx.oncomplete = () => finish(resolve);
            tx.onerror = () => finish(reject, wrapError('write', tx.error));
            tx.onabort = () => finish(reject, wrapError('write', tx.error || new Error('запись отменена')));
          }),
      );
    },
  };
}

// In-memory adapter: tests, and the temporary mode the user can choose explicitly on the
// boot screen when IndexedDB does not work (data is lost when the tab closes).
export function memoryAdapter(seed = {}) {
  const data = {};
  for (const s of Object.keys(STORES)) data[s] = new Map();
  for (const [s, rows] of Object.entries(seed)) for (const r of rows) data[s].set(r[STORES[s]], structuredClone(r));
  return {
    kind: 'memory',
    data,
    async getAll(store) {
      return [...data[store].values()].map((v) => structuredClone(v));
    },
    async write(ops) {
      for (const op of ops) {
        if ('delete' in op) data[op.store].delete(op.delete);
        else data[op.store].set(op.value[STORES[op.store]], structuredClone(op.value));
      }
    },
  };
}
