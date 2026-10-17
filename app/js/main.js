// Bootstrap: open local storage, load, mount UI, start sync triggers, register the service worker.

import { idbAdapter, memoryAdapter } from './data/db.js';
import { createStore } from './data/store.js';
import { createSync } from './data/sync.js';
import { mount } from './ui/app.js';
import { app } from './ui/core.js';
import { applyTheme } from './ui/settings.js';
import { applyLegacyImport } from './data/legacy-import.js';

export const VERSION = '1.0.0';

async function boot() {
  let adapter;
  let storageKind = 'IndexedDB';
  try {
    adapter = await idbAdapter();
  } catch (err) {
    adapter = memoryAdapter();
    storageKind = 'только память (данные не сохранятся!)';
  }
  const store = createStore(adapter);
  await store.load();
  applyTheme(store.state.kv.theme);
  // One-time import of the program and the 16.10.2026 workout from the old Google Sheet.
  // Idempotent; skipped when `trainer.skipBundledImport` is set (used by tests).
  let skipImport = false;
  try {
    skipImport = localStorage.getItem('trainer.skipBundledImport') === '1';
  } catch {
    skipImport = false;
  }
  if (!skipImport) {
    try {
      await applyLegacyImport(store);
    } catch (err) {
      console.error('Bundled import failed', err);
    }
  }

  const sync = createSync(store);
  store.onLocalChange = () => sync.schedule(2500);

  mount(document.getElementById('app'), { store, sync, version: VERSION, storageKind });
  document.getElementById('boot')?.remove();

  window.addEventListener('online', () => sync.syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync.syncNow();
  });
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    const stale = Date.now() - (sync.status.lastSyncAt || 0) > 5 * 60 * 1000;
    if (store.state.outbox.size > 0 || stale) sync.syncNow();
  }, 60 * 1000);
  sync.syncNow();

  // Ask the browser not to evict our data under storage pressure.
  try {
    app.persisted = (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false;
  } catch {
    app.persisted = false;
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Debug/test handle; harmless in production.
  window.__trainer = { store, sync };
}

boot().catch((err) => {
  const el = document.getElementById('boot');
  if (el) el.textContent = `Не удалось запустить: ${err?.message || err}`;
  console.error(err);
});
