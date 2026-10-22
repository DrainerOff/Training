// Bootstrap: open local storage, load, mount UI, start sync triggers, register the service worker.
// Each startup stage is reported to boot.js, which shows a diagnostic screen naming the stage
// if it fails or takes too long — the app never waits on «Загрузка…» forever.

import { idbAdapter, memoryAdapter } from './data/db.js';
import { createStore } from './data/store.js';
import { createSync } from './data/sync.js';
import { mount } from './ui/app.js';
import { app } from './ui/core.js';
import { applyTheme } from './ui/settings.js';
import { applyLegacyImport } from './data/legacy-import.js';

export const VERSION = '1.2.0';
// Replaced with the commit hash on deploy (same as in sw.js) — shown in Settings.
export const BUILD = '__BUILD__';

// boot.js is missing only if an old cached index.html is served; keep the basics working then.
const boot = window.__boot || {
  stage() {},
  done() {
    document.getElementById('boot')?.remove();
  },
  fail(err) {
    const el = document.getElementById('boot');
    if (el) el.textContent = `Не удалось запустить: ${err?.message || err}`;
  },
  tempMode: () => false,
  leaveTempMode: () => location.reload(),
};

async function start() {
  // Temporary in-memory mode only when the user chose it on the diagnostic screen; it is
  // never a silent fallback for a broken IndexedDB.
  const temporary = boot.tempMode();
  let adapter;
  if (temporary) {
    adapter = memoryAdapter();
  } else {
    boot.stage('storage-open');
    adapter = await idbAdapter();
  }
  const store = createStore(adapter);
  boot.stage('storage-read');
  await store.load();
  if (!temporary) {
    // Prove that this device can save before any set is logged.
    boot.stage('storage-write');
    await adapter.write([{ store: 'kv', value: { k: 'lastLaunchAt', v: Date.now() } }]);
  }
  applyTheme(store.state.kv.theme);
  // First launch only; every write has a deadline, and a failed import is retried next time.
  boot.stage('import');
  const importError = await importBundled(store);

  boot.stage('ui');
  const sync = createSync(store);
  store.onLocalChange = () => sync.schedule(2500);
  app.build = BUILD;
  app.temporary = temporary;
  app.leaveTemporary = () => boot.leaveTempMode();
  const storageKind = temporary ? 'временное, только в памяти: данные пропадут при закрытии' : 'IndexedDB';
  mount(document.getElementById('app'), { store, sync, version: VERSION, storageKind });
  boot.done();

  // Debug/test handle; harmless in production.
  window.__trainer = { store, sync, build: BUILD };

  if (importError) {
    app.ui?.toast(`Перенос из Google Таблицы не выполнен: ${importError}. Повторю при следующем запуске.`, { ms: 8000 });
  }

  window.addEventListener('online', () => sync.syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync.syncNow();
  });
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    const stale = Date.now() - (sync.status.lastSyncAt || 0) > 5 * 60 * 1000;
    // Records waiting for an Apps Script update are not retried every minute.
    if (store.state.outbox.size - (sync.status.waiting || 0) > 0 || stale) sync.syncNow();
  }, 60 * 1000);
  sync.syncNow();

  // Ask the browser not to evict our data under storage pressure.
  try {
    app.persisted = (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false;
  } catch {
    app.persisted = false;
  }

  setupServiceWorker();
}

// One-time import of the program and the 16.10.2026 workout from the old Google Sheet.
// Idempotent; skipped when `trainer.skipBundledImport` is set (used by tests). Runs before
// the first sync, so a fresh device never pushes a half-imported state. Returns an error text.
async function importBundled(store) {
  let skip = false;
  try {
    skip = localStorage.getItem('trainer.skipBundledImport') === '1';
  } catch {
    skip = false;
  }
  if (skip) return null;
  try {
    await applyLegacyImport(store);
    return null;
  } catch (err) {
    console.error('Bundled import failed', err);
    return err?.message || String(err);
  }
}

function setupServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const sw = navigator.serviceWorker;
  const hadController = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (hadController) {
      app.ui?.toast('Загружена новая версия приложения', { action: { label: 'Перезапустить', fn: () => location.reload() }, ms: 20000 });
    }
  });
  // This page has loaded and linked all of its code by now, so a downloaded release can take
  // over without one page ever mixing files of two releases.
  const handOver = (worker) => {
    if (!worker) return;
    if (worker.state === 'installed') worker.postMessage({ type: 'skip-waiting' });
    else worker.addEventListener('statechange', () => worker.state === 'installed' && worker.postMessage({ type: 'skip-waiting' }));
  };
  sw.register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      handOver(reg.waiting);
      handOver(reg.installing); // an update found by this very navigation
      reg.addEventListener('updatefound', () => handOver(reg.installing));
      // An app on the home screen is resumed rather than reopened, so look for releases on return.
      let checkedAt = Date.now();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || Date.now() - checkedAt < 30 * 60 * 1000) return;
        checkedAt = Date.now();
        reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}

start().catch((err) => {
  console.error(err);
  boot.fail(err);
});
