// IndexedDB deadlines: a request that fires neither success nor error (the WebKit failure
// behind the endless «Загрузка…») must turn into a StorageError naming the step.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { idbAdapter, StorageError } from '../../app/js/data/db.js';

const T = 40;
let saved;
beforeEach(() => {
  saved = { idb: globalThis.indexedDB, t: globalThis.__TRAINER_IDB_TIMEOUT_MS };
  globalThis.__TRAINER_IDB_TIMEOUT_MS = T;
});
afterEach(() => {
  globalThis.indexedDB = saved.idb;
  globalThis.__TRAINER_IDB_TIMEOUT_MS = saved.t;
});

const later = (ms, fn) => setTimeout(fn, ms);

// A database whose transactions behave as `tx(tx)` decides.
function fakeDb({ tx = (t) => later(1, () => t.oncomplete?.()), log }) {
  return {
    objectStoreNames: { contains: () => true },
    close() {
      log.closed++;
    },
    transaction(stores, mode) {
      const t = {
        mode,
        objectStore: () => ({ put() {}, delete() {}, getAll: () => ({}) }),
        abort() {
          log.aborted++;
          if (t.abortThrows) throw Object.assign(new Error('committing'), { name: 'InvalidStateError' });
          later(1, () => t.onabort?.());
        },
      };
      tx(t);
      return t;
    },
  };
}

function install(openFn) {
  const log = { open: 0, closed: 0, aborted: 0, poked: 0 };
  globalThis.indexedDB = {
    databases() {
      log.poked++;
      return Promise.resolve([]);
    },
    open() {
      log.open++;
      const req = {};
      openFn(req, log);
      return req;
    },
  };
  return log;
}

test('an open request that never answers fails with the step named, after a retry', async () => {
  const log = install(() => {});
  const started = Date.now();
  await assert.rejects(idbAdapter(), (err) => {
    assert.ok(err instanceof StorageError);
    assert.equal(err.step, 'open');
    assert.match(err.message, /IndexedDB не ответила за 0\.0 с \(открытие базы\) \(попыток: 2\)/);
    return true;
  });
  assert.equal(log.open, 2);
  assert.ok(log.poked >= 2, 'IndexedDB is poked before each attempt');
  assert.ok(Date.now() - started < 2000);
});

test('a connection that arrives after the deadline is closed; the retry is used', async () => {
  const log = install((req, l) => {
    const db = fakeDb({ log: l });
    const delay = l.open === 1 ? 3 * T : 1;
    later(delay, () => {
      req.result = db;
      req.onsuccess?.();
    });
  });
  const adapter = await idbAdapter();
  await adapter.write([{ store: 'kv', value: { k: 'a', v: 1 } }]);
  await new Promise((r) => setTimeout(r, 4 * T));
  assert.equal(log.open, 2);
  assert.equal(log.closed, 1, 'the late first connection is closed');
});

test('an open error is reported as a StorageError, not swallowed', async () => {
  install((req) =>
    later(1, () => {
      req.error = Object.assign(new Error('Connection to Indexed Database server lost'), { name: 'UnknownError' });
      req.onerror?.({ preventDefault() {} });
    }),
  );
  await assert.rejects(idbAdapter(), /IndexedDB: открытие базы не удалось — Connection to Indexed Database server lost/);
});

test('a stalled write is aborted at the deadline, so nothing of it is saved; it fails after a retry on a fresh connection', async () => {
  const log = install((req, l) => {
    req.result = fakeDb({ log: l, tx: () => {} }); // transactions never complete
    later(1, () => req.onsuccess?.());
  });
  const adapter = await idbAdapter();
  await assert.rejects(adapter.write([{ store: 'sets', value: { id: 'x' } }]), (err) => err.step === 'write' && /не ответила.*\(попыток: 2\)/.test(err.message));
  assert.equal(log.aborted, 2);
  assert.equal(log.open, 2, 'the database is reopened once');
  assert.equal(log.closed, 1, 'the stalled connection is closed');
});

// The iPhone case: back from the background, the old connection answers nothing, a new one works.
function deadThenFresh(extra = {}) {
  return install((req, l) => {
    const n = l.open;
    req.result = fakeDb({ log: l, tx: n === 1 ? extra.first || (() => {}) : (t) => later(1, () => t.oncomplete?.()) });
    later(1, () => req.onsuccess?.());
  });
}

test('a write stalled on a dead connection is made again on a fresh one and succeeds', async () => {
  const log = deadThenFresh();
  const adapter = await idbAdapter();
  await adapter.write([{ store: 'kv', value: { k: 'cursor', v: 5 } }]);
  assert.deepEqual([log.open, log.aborted, log.closed], [2, 1, 1]);
  // Later writes use the fresh connection right away.
  await adapter.write([{ store: 'kv', value: { k: 'cursor', v: 6 } }]);
  assert.equal(log.open, 2);
});

test('a lost connection («Connection to Indexed Database server lost») is reopened and the write made again', async () => {
  const lost = (t) =>
    later(1, () => {
      t.error = Object.assign(new Error('Connection to Indexed Database server lost. Refresh the page to try again'), { name: 'UnknownError' });
      t.onerror?.();
    });
  const log = deadThenFresh({ first: lost });
  const adapter = await idbAdapter();
  await adapter.write([{ store: 'sets', value: { id: 'x' } }]);
  assert.deepEqual([log.open, log.closed], [2, 1]);
});

test('a refused write (not a connection problem) is reported at once, without a retry', async () => {
  const log = install((req, l) => {
    req.result = fakeDb({
      log: l,
      tx: (t) =>
        later(1, () => {
          t.error = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
          t.onerror?.();
        }),
    });
    later(1, () => req.onsuccess?.());
  });
  const adapter = await idbAdapter();
  await assert.rejects(adapter.write([{ store: 'sets', value: { id: 'x' } }]), /запись не удалось — quota/);
  assert.equal(log.open, 1);
});

test('writes keep their order: one made again after a stall still lands before a later one', async () => {
  const order = [];
  // On the dead connection the first write stalls and the second fails at once with a connection
  // error: run side by side, the second would be made again (and land) first.
  let made = 0;
  const dead = (t) => {
    if (++made === 1) return;
    later(1, () => {
      t.error = Object.assign(new Error('lost'), { name: 'UnknownError' });
      t.onerror?.();
    });
  };
  install((req, l) => {
    const n = l.open;
    const db = fakeDb({ log: l, tx: n === 1 ? dead : (t) => later(1, () => t.oncomplete?.()) });
    const make = db.transaction;
    db.transaction = (stores, mode) => {
      const t = make(stores, mode);
      const store = t.objectStore;
      t.objectStore = () => ({ ...store(), put: (v) => n > 1 && order.push(v.v) });
      return t;
    };
    req.result = db;
    later(1, () => req.onsuccess?.());
  });
  const adapter = await idbAdapter();
  await Promise.all([adapter.write([{ store: 'kv', value: { k: 'cursor', v: 1 } }]), adapter.write([{ store: 'kv', value: { k: 'cursor', v: 2 } }])]);
  assert.deepEqual(order, [1, 2]);
});

test('a write that is already committing at the deadline still reports its success', async () => {
  install((req, l) => {
    req.result = fakeDb({
      log: l,
      tx: (t) => {
        t.abortThrows = true;
        later(T * 1.5, () => t.oncomplete?.());
      },
    });
    later(1, () => req.onsuccess?.());
  });
  const adapter = await idbAdapter();
  await adapter.write([{ store: 'sets', value: { id: 'x' } }]);
});

test('a read that never answers fails with the step named', async () => {
  install((req, l) => {
    req.result = fakeDb({ log: l, tx: () => {} });
    later(1, () => req.onsuccess?.());
  });
  const adapter = await idbAdapter();
  await assert.rejects(adapter.getAll('sets'), (err) => err.step === 'read');
});

test('reads stalled on a dead connection share one reopen and succeed on it', async () => {
  const log = install((req, l) => {
    const n = l.open;
    const db = fakeDb({ log: l });
    db.transaction = () => ({
      objectStore: () => ({
        getAll() {
          const r = {};
          if (n > 1) later(1, () => ((r.result = [{ id: 'a' }]), r.onsuccess?.()));
          return r;
        },
      }),
    });
    req.result = db;
    later(1, () => req.onsuccess?.());
  });
  const adapter = await idbAdapter();
  const all = await Promise.all(['sets', 'sessions', 'kv'].map((s) => adapter.getAll(s)));
  assert.deepEqual(all, [[{ id: 'a' }], [{ id: 'a' }], [{ id: 'a' }]]);
  assert.equal(log.open, 2, 'one reopen for all three');
});
