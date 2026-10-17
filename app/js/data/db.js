// Storage adapters. The store talks to an adapter with two methods:
//   getAll(storeName) -> Promise<array>
//   write(ops)        -> Promise<void>, ops = [{ store, value } | { store, delete: key }]
// All ops of one write() land in a single IndexedDB transaction (record + outbox together).

export const STORES = {
  sessions: 'id',
  sets: 'id',
  metrics: 'id',
  outbox: 'key',
  kv: 'k',
};

function openRaw(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [store, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('База данных занята другой вкладкой'));
  });
}

export async function idbAdapter(name = 'trainer') {
  let db = await openRaw(name);
  const watch = () => {
    db.onclose = () => {
      db = null;
    };
    db.onversionchange = () => {
      db.close();
      db = null;
    };
  };
  watch();

  // iOS may close an idle connection while the app sits in the background; reopen once.
  async function withDb(fn) {
    if (!db) {
      db = await openRaw(name);
      watch();
    }
    try {
      return await fn(db);
    } catch (err) {
      if (err && (err.name === 'InvalidStateError' || err.name === 'TransactionInactiveError')) {
        db = await openRaw(name);
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
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          }),
      );
    },
    write(ops) {
      if (!ops.length) return Promise.resolve();
      const stores = [...new Set(ops.map((o) => o.store))];
      return withDb(
        (d) =>
          new Promise((resolve, reject) => {
            let tx;
            try {
              tx = d.transaction(stores, 'readwrite', { durability: 'strict' });
            } catch {
              tx = d.transaction(stores, 'readwrite');
            }
            for (const op of ops) {
              const os = tx.objectStore(op.store);
              if ('delete' in op) os.delete(op.delete);
              else os.put(op.value);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('Запись отменена'));
          }),
      );
    },
  };
}

// In-memory adapter for tests (and as a last-resort fallback when IndexedDB is unavailable).
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
