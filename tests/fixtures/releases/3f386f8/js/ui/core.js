// Shared UI plumbing: Preact/htm re-exports, the app singleton, sheets, toasts, icons.

import { html, render, useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from '../vendor/preact-htm.js';
import { fmtNum } from '../lib/util.js';

export { html, render, useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect };

// Filled in by mount(): { store, sync, ui: { open, close, toast, go, back } }
export const app = { store: null, sync: null, ui: null };

export function useNow(intervalMs = 1000, active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, active]);
  return now;
}

export const local = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode / quota — drafts are a convenience only */
    }
  },
};

// ---------------------------------------------------------------- icons (24px stroke)

const ICONS = {
  today: 'M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11',
  progress: 'M4 19h16M6 15l4-4 3 3 5-6',
  history: 'M4 6h16M4 12h16M4 18h10',
  body: 'M5 20h14a1 1 0 0 0 1-1V8a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v11a1 1 0 0 0 1 1zM9 9l3 3 2-4',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.2L14.8 21h-4l-.3-2.4a7 7 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.4L4.6 9.9l2-3.4 1.9.7a7 7 0 0 1 2-1.2L10.8 3h4l.3 2.4a7 7 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.4z',
  back: 'M15 5l-7 7 7 7',
  swap: 'M7 7h12l-3-3M17 17H5l3 3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z',
  flag: 'M5 21V4h11l-2 4 2 4H5',
};

export function Icon({ name, label = null }) {
  const d = ICONS[name] || '';
  return html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${name === 'more' ? 3.2 : 2}
    stroke-linecap="round" stroke-linejoin="round" aria-hidden=${label ? null : 'true'} role=${label ? 'img' : null}
    aria-label=${label}><path d=${d} /></svg>`;
}

// ---------------------------------------------------------------- small components

export function Plate({ week, size = 'chip' }) {
  const label = `Неделя ${week}`;
  return html`<span class=${`plate plate--${size} plate--w${week}`} role="img" aria-label=${label}><span>${week}</span></span>`;
}

export function fmtWeight(w, category) {
  if (category === 'pullup' && (!w || w === 0)) return 'СВ';
  return fmtNum(w);
}

export function SetText({ set, category, showRir = true }) {
  return html`<span>${set.drop ? 'дроп ' : ''}${fmtWeight(set.weight, category)}×${set.reps}${showRir && set.rir != null ? html`<sup>${fmtNum(set.rir)}</sup>` : ''}</span>`;
}

export function Seg({ options, value, onChange, fill = false, label }) {
  return html`<div class=${'seg' + (fill ? ' seg--fill' : '')} role="group" aria-label=${label}>
    ${options.map(
      (o) => html`<button type="button" aria-pressed=${String(o.value === value)} onClick=${() => onChange(o.value)}>${o.label}</button>`,
    )}
  </div>`;
}

export function Toggle({ on, onChange, children, tone = '' }) {
  return html`<button type="button" class=${'toggle' + (tone ? ' toggle--' + tone : '')} aria-pressed=${String(!!on)} onClick=${() => onChange(!on)}>${children}</button>`;
}

const SYNC_LABEL = {
  off: 'Локально',
  idle: 'Сохранено',
  syncing: 'Отправка',
  offline: 'Офлайн',
  error: 'Ошибка',
};
const SYNC_TITLE = {
  off: 'Синхронизация не подключена: данные только на этом телефоне',
  idle: 'Всё сохранено в Google Таблице',
  syncing: 'Идёт отправка в Google Таблицу',
  offline: 'Нет связи: данные сохранены на телефоне',
  error: 'Ошибка синхронизации',
};

export function SyncBadge({ status, onClick }) {
  let cls = status.state;
  let text = SYNC_LABEL[status.state] || '';
  if (status.pending > 0 && (status.state === 'idle' || status.state === 'offline' || status.state === 'error')) {
    if (status.state === 'idle') cls = 'pending';
    text = `${text}, ${status.pending} в очереди`;
    if (status.state === 'idle') text = `${status.pending} в очереди`;
  }
  const title = `${SYNC_TITLE[status.state] || ''}${status.pending ? `. Не отправлено изменений: ${status.pending}` : ''}`;
  return html`<button type="button" class=${'sync sync--' + cls} onClick=${onClick} title=${title} aria-label=${'Синхронизация: ' + title}>
    <span class="sync__dot"></span>${text}
  </button>`;
}

// ---------------------------------------------------------------- sheet & number pad

export function Sheet({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return html`<div class="backdrop" onClick=${onClose}></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label=${title} tabindex="-1" ref=${ref}>
      <div class="sheet__grip"></div>
      ${title ? html`<h2 class="sheet__title">${title}</h2>` : null}
      ${children}
    </div>`;
}

export function openSheet(renderFn) {
  return app.ui.open(renderFn);
}

// Big-button keypad for weight / reps. Avoids the iOS keyboard jumping the layout.
export function NumberPad({ title, value, decimals = true, step = 2.5, unit = '', onDone, onClose }) {
  const [text, setText] = useState(value == null ? '' : fmtNum(value));
  const [fresh, setFresh] = useState(true);
  const num = () => {
    const n = Number(text.replace(',', '.'));
    return text === '' || !Number.isFinite(n) ? null : n;
  };
  const press = (k) => {
    let t = fresh ? '' : text;
    if (k === '⌫') t = t.slice(0, -1);
    else if (k === ',') {
      if (!decimals || t.includes(',')) return;
      t = (t || '0') + ',';
    } else if (t.replace(',', '').length < 5) t = t === '0' ? k : t + k;
    setFresh(false);
    setText(t);
  };
  const bump = (d) => {
    const n = Math.max(0, Math.round(((num() ?? 0) + d) * 100) / 100);
    setFresh(false);
    setText(fmtNum(n));
  };
  const quick = decimals ? [-2 * step, -step, step, 2 * step] : [-2, -1, 1, 2];
  return html`<${Sheet} title=${title} onClose=${onClose}>
    <div class="pad__display" aria-live="polite">${text || '0'}<small>${unit}</small></div>
    <div class="pad__quick">
      ${quick.map((d) => html`<button type="button" onClick=${() => bump(d)}>${d > 0 ? '+' : '−'}${fmtNum(Math.abs(d))}</button>`)}
    </div>
    <div class="pad__keys">
      ${['1', '2', '3', '4', '5', '6', '7', '8', '9', decimals ? ',' : '', '0', '⌫'].map((k) =>
        k ? html`<button type="button" aria-label=${k === '⌫' ? 'Стереть' : k} onClick=${() => press(k)}>${k}</button>` : html`<span></span>`,
      )}
    </div>
    <div class="btn-row" style="margin-top:12px">
      <button type="button" class="btn btn--primary btn--big" onClick=${() => { onDone(num()); onClose(); }}>Готово</button>
    </div>
  <//>`;
}

export function Stepper({ value, step, min = 0, start = null, onChange, onTap, label, suggested = false, display = null }) {
  const set = (v) => onChange(Math.max(min, Math.round(v * 100) / 100));
  const shown = display ?? (value == null ? '—' : fmtNum(value));
  // From an empty value, ± starts at `start` (e.g. the last known bodyweight) instead of 0.
  const base = (d) => (value == null && start != null ? start : (value ?? 0) + d);
  return html`<div class="stepper">
    <button type="button" aria-label=${'Уменьшить: ' + label} onClick=${() => set(base(-step))}>−</button>
    <button type="button" class=${'stepper__value' + (value == null ? ' stepper__value--empty' : suggested ? ' stepper__value--suggested' : '')}
      aria-label=${label + ': ' + shown + '. Нажмите, чтобы ввести'} onClick=${onTap}>${shown}</button>
    <button type="button" aria-label=${'Увеличить: ' + label} onClick=${() => set(base(step))}>+</button>
  </div>`;
}

export function RirPicker({ value, target, onChange, label = 'RIR' }) {
  return html`<div class="rir" role="group" aria-label="Фактический RIR">
    <span class="rir__label">${label}</span>
    ${[0, 1, 2, 3, 4, 5].map((n) => {
      const inTarget = target && n >= target[0] && n <= target[1];
      return html`<button type="button" class=${inTarget ? 'is-target' : ''} aria-pressed=${String(value === n)}
        onClick=${() => onChange(value === n ? null : n)}>${n}</button>`;
    })}
  </div>`;
}

export function confirmSheet({ title, text, okLabel, danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const id = openSheet((close) => {
      const finish = (v) => {
        if (!done) {
          done = true;
          resolve(v);
        }
        close();
      };
      return html`<${Sheet} title=${title} onClose=${() => finish(false)}>
        ${text ? html`<p class="muted" style="margin-bottom:16px">${text}</p>` : null}
        <div class="btn-row">
          <button type="button" class="btn" onClick=${() => finish(false)}>Отмена</button>
          <button type="button" class=${'btn ' + (danger ? 'btn--danger' : 'btn--primary')} onClick=${() => finish(true)}>${okLabel}</button>
        </div>
      <//>`;
    });
    return id;
  });
}
