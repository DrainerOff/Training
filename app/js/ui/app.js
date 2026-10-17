// Root component: tabs, routing, sheet stack, toast.

import { html, render, useState, useEffect, useLayoutEffect, useRef, app, Icon } from './core.js';
import { activeSession } from '../lib/planner.js';
import { Home } from './home.js';
import { Workout } from './workout.js';
import { ProgressList, ExerciseDetail } from './progress.js';
import { History } from './history.js';
import { Body } from './body.js';
import { Settings, ProgramEditor, ProgramImport, ResultsImport } from './settings.js';

const TABS = [
  { id: 'today', label: 'Тренировка', icon: 'today' },
  { id: 'progress', label: 'Прогресс', icon: 'progress' },
  { id: 'history', label: 'История', icon: 'history' },
  { id: 'body', label: 'Тело', icon: 'body' },
];

function App() {
  const [, setVersion] = useState(0);
  const [syncStatus, setSyncStatus] = useState({ ...app.sync.status });
  const [route, setRoute] = useState({ tab: 'today', stack: [] });
  const [sheets, setSheets] = useState([]);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const screenRef = useRef(null);

  useEffect(() => app.store.subscribe(() => setVersion((v) => v + 1)), []);
  useEffect(() => app.sync.subscribe((s) => setSyncStatus(s)), []);

  app.ui = {
    open(renderFn) {
      const id = Math.random().toString(36).slice(2);
      setSheets((s) => [...s, { id, renderFn }]);
      return id;
    },
    close(id) {
      setSheets((s) => (id ? s.filter((x) => x.id !== id) : s.slice(0, -1)));
    },
    toast(text, { action = null, ms = 5000 } = {}) {
      clearTimeout(toastTimer.current);
      setToast({ text, action, id: Date.now() });
      toastTimer.current = setTimeout(() => setToast(null), ms);
    },
    go({ tab, view }) {
      setSheets([]);
      setRoute((r) => {
        if (view) return { tab: tab || r.tab, stack: [...r.stack, view] };
        return { tab: tab || r.tab, stack: [] };
      });
    },
    back() {
      setRoute((r) => ({ ...r, stack: r.stack.slice(0, -1) }));
    },
  };

  const view = route.stack[route.stack.length - 1] || null;
  const st = app.store.state;
  const running = activeSession(st.sessions.values());
  let screen;
  // A workout shows the set composer (dock) at the bottom instead of the tab bar: more room for
  // the exercise list and nothing else under the thumb. Other sections: workout menu or Back.
  let workout = false;
  if (view?.type === 'settings') screen = html`<${Settings} syncStatus=${syncStatus} />`;
  else if (view?.type === 'program') screen = html`<${ProgramEditor} />`;
  else if (view?.type === 'program-import') screen = html`<${ProgramImport} />`;
  else if (view?.type === 'results-import') screen = html`<${ResultsImport} />`;
  else if (view?.type === 'exercise') screen = html`<${ExerciseDetail} key=${view.key} seriesKey=${view.key} />`;
  else if (view?.type === 'session') {
    const s = st.sessions.get(view.id);
    workout = !!(s && !s.deleted);
    screen = workout
      ? html`<${Workout} key=${s.id} session=${s} mode=${s.status === 'active' && running?.id === s.id ? 'live' : 'edit'} syncStatus=${syncStatus} />`
      : html`<main class="screen"><div class="empty"><h2>Тренировка удалена</h2></div></main>`;
  } else if (route.tab === 'today') {
    workout = !!running;
    screen = running
      ? html`<${Workout} key=${running.id} session=${running} mode="live" syncStatus=${syncStatus} />`
      : html`<${Home} syncStatus=${syncStatus} />`;
  } else if (route.tab === 'progress') screen = html`<${ProgressList} />`;
  else if (route.tab === 'history') screen = html`<${History} syncStatus=${syncStatus} />`;
  else screen = html`<${Body} />`;

  useEffect(() => {
    document.querySelector('.screen')?.scrollTo?.(0, 0);
  }, [route.tab, view?.type, view?.key, view?.id]);

  // Toasts sit just above the bottom parts (dock or tab bar), whatever their height.
  useLayoutEffect(() => {
    const shell = screenRef.current;
    if (!shell) return undefined;
    const measure = () => {
      const bottom = shell.querySelector(':scope > .dock, :scope > .tabbar');
      const h = bottom ? shell.getBoundingClientRect().bottom - bottom.getBoundingClientRect().top : 0;
      shell.style.setProperty('--chrome-h', `${Math.max(0, Math.round(h))}px`);
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    for (const el of shell.querySelectorAll(':scope > .dock, :scope > .tabbar')) ro?.observe(el);
    ro?.observe(shell);
    return () => ro?.disconnect();
  });

  return html`<div class=${'shell' + (workout ? ' shell--workout' : '')} ref=${screenRef}>
    ${app.temporary
      ? html`<div class="notice notice--caution temp-mode" role="alert">
          <h3>Временный режим: данные не сохраняются на устройстве</h3>
          <p>База на телефоне не открылась. Новые записи живут только до закрытия вкладки, если не успеют уйти в Google Таблицу. Сохранённые раньше тренировки здесь не видны, но не удалены.</p>
          <div class="btn-row"><button type="button" class="btn" onClick=${() => app.leaveTemporary?.()}>Открыть с сохранением</button></div>
        </div>`
      : null}
    ${st.storageError ? html`<div class="notice notice--caution" style="margin:8px 16px 0"><h3>Ошибка сохранения</h3><p>${st.storageError}</p></div>` : null}
    ${screen}
    ${workout
      ? null
      : html`<nav class="tabbar" aria-label="Разделы">
          ${TABS.map(
            (t) => html`<button type="button" aria-current=${route.tab === t.id && !view ? 'page' : null}
              onClick=${() => app.ui.go({ tab: t.id })}>
              <${Icon} name=${t.icon} />${t.id === 'today' && running ? html`<span class="tabbar__dot" aria-hidden="true"></span>` : null}${t.label}
            </button>`,
          )}
        </nav>`}
    ${sheets.map((s) => html`<div key=${s.id}>${s.renderFn(() => app.ui.close(s.id))}</div>`)}
    ${toast
      ? html`<div class="toast" role="status" key=${toast.id}>
          <span>${toast.text}</span>
          ${toast.action
            ? html`<button type="button" onClick=${() => { toast.action.fn(); setToast(null); }}>${toast.action.label}</button>`
            : null}
        </div>`
      : null}
  </div>`;
}

export function mount(el, { store, sync, version, storageKind }) {
  app.store = store;
  app.sync = sync;
  app.version = version;
  app.storageKind = storageKind;
  render(html`<${App} />`, el);
  pinDocument();
}

// iOS, notably in a home-screen app, can leave the document scrolled after the keyboard closes:
// everything shifts up and a gap opens at the bottom. Only .screen ever scrolls here, so put
// the document back whenever no text field is being edited.
function pinDocument() {
  const editing = () => {
    const el = document.activeElement;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  };
  const reset = () => {
    if (!editing() && (window.scrollX || window.scrollY)) window.scrollTo(0, 0);
  };
  window.addEventListener('scroll', reset, { passive: true });
  document.addEventListener('focusout', () => setTimeout(reset, 80));
  window.visualViewport?.addEventListener('resize', () => setTimeout(reset, 80));
}
