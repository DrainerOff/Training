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

test('a stalled write is aborted at the deadline, so nothing of it is saved', async () => {
  const log = install((req, l) => {
    req.result = fakeDb({ log: l, tx: () => {} }); // transactions never complete
    later(1, () => req.onsuccess?.());
  });
  const adapter = await idbAdapter();
  await assert.rejects(adapter.write([{ store: 'sets', value: { id: 'x' } }]), (err) => err.step === 'write' && /не ответила/.test(err.message));
  assert.equal(log.aborted, 1);
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
