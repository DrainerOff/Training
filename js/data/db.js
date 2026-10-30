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
  nutrition: 'id', // calories and macros per accounting day (since version 6)
  nutritionGoals: 'id', // nutrition goals per phase (since version 6)
  outbox: 'key',
  kv: 'k',
};
// Bumped when a store is added. The upgrade only creates missing stores — existing data is
// never touched. A database from a newer release is opened as it is (see openOnce).
export const DB_VERSION = 6;

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
// The first attempt is shorter: a request that stalls is usually stuck on a dead connection
// (see idbAdapter), and the retry on a fresh one gets the full time.
function limit(kind, records = 0, attempt = 1) {
  const override = globalThis.__TRAINER_IDB_TIMEOUT_MS; // tests shorten the deadlines
  if (override) return override;
  if (kind === 'open') return 4000;
  if (kind === 'read') return attempt > 1 ? 8000 : 6000;
  return (attempt > 1 ? 8000 : 3000) + 5 * records;
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

// Failures of the connection rather than of the request: «Connection to Indexed Database server
// lost» (UnknownError), a connection iOS already closed (InvalidStateError), a transaction
// aborted when the connection went away (AbortError). Nothing of such a request was saved, so
// it is safe to make it again.
const CONNECTION_ERRORS = new Set(['InvalidStateError', 'TransactionInactiveError', 'UnknownError', 'AbortError']);

function retryable(err) {
  if (err?.retry) return true;
  return CONNECTION_ERRORS.has(err?.name) || CONNECTION_ERRORS.has(err?.cause?.name);
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

// iOS can leave the app with a connection that no longer answers: after the app sat in the
// background, or after the IndexedDB process was restarted, transactions on it neither complete
// nor fail. Reopening the database fixes it, the old connection never recovers. So a request
// that stalls or fails with a connection error drops its connection and is made once more on a
// fresh one; only a second failure reaches the caller.
export async function idbAdapter(name = 'trainer') {
  let db = await openDb(name);
  let opening = null;
  const watch = (current) => {
    current.onclose = () => {
      if (db === current) db = null;
    };
    current.onversionchange = () => {
      current.close();
      if (db === current) db = null;
    };
  };
  watch(db);

  // Requests made while the database is being reopened share the one open.
  async function connection() {
    if (db) return db;
    if (!opening) {
      opening = openDb(name).then(
        (fresh) => {
          opening = null;
          db = fresh;
          watch(fresh);
          return fresh;
        },
        (err) => {
          opening = null;
          throw err;
        },
      );
    }
    return opening;
  }

  function drop(current) {
    if (db === current) db = null;
    try {
      current.close();
    } catch {
      // Already closed.
    }
  }

  async function withDb(fn) {
    for (let attempt = 1; ; attempt++) {
      const current = await connection();
      try {
        return await fn(current, attempt);
      } catch (err) {
        if (attempt > 1 || !retryable(err)) {
          if (attempt > 1 && err instanceof StorageError) err.message += ' (попыток: 2)';
          throw err;
        }
        drop(current);
      }
    }
  }

  // Writes run one after another, so a write made again on a fresh connection can never land
  // after a newer one and bring back an old value.
  let queue = Promise.resolve();

  return {
    kind: 'indexeddb',
    getAll(store) {
      return withDb(
        (d, attempt) =>
          new Promise((resolve, reject) => {
            const req = d.transaction(store, 'readonly').objectStore(store).getAll();
            const ms = limit('read', 0, attempt);
            const timer = setTimeout(() => reject(Object.assign(timeoutError('read', ms), { retry: true })), ms);
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
    // aborted at the deadline, so the outcome is definite: nothing of it was saved, and it is
    // made once more on a fresh connection.
    write(ops) {
      if (!ops.length) return Promise.resolve();
      const stores = [...new Set(ops.map((o) => o.store))];
      const run = queue.then(() =>
        withDb(
          (d, attempt) =>
            new Promise((resolve, reject) => {
              const tx = d.transaction(stores, 'readwrite');
              const ms = limit('write', ops.length, attempt);
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
                  // Already committing: give oncomplete one more period, then stop waiting. The
                  // outcome is unknown here, so this one is not made again.
                  timer = setTimeout(() => finish(reject, timeoutError('write', 2 * ms)), ms);
                  return;
                }
                finish(reject, Object.assign(timeoutError('write', ms), { retry: true }));
              }, ms);
              try {
                for (const op of ops) {
                  const os = tx.objectStore(op.store);
                  if ('delete' in op) os.delete(op.delete);
                  else os.put(op.value);
                }
              } catch (err) {
                // A record IndexedDB refuses (no key, can't be cloned): none of the write is kept.
                try {
                  tx.abort();
                } catch {
                  // Not started yet.
                }
                finish(reject, wrapError('write', err));
                return;
              }
              tx.oncomplete = () => finish(resolve);
              tx.onerror = () => finish(reject, wrapError('write', tx.error));
              tx.onabort = () => finish(reject, wrapError('write', tx.error || new Error('запись отменена')));
            }),
        ),
      );
      queue = run.catch(() => {});
      return run;
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
