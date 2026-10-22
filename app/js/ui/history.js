// Workout history grouped by cycle. Tapping a workout opens it for viewing and editing.

import { html, app, Plate, SyncBadge } from './core.js';
import { derived } from './derive.js';
import { fmtDayWeekday, plural } from '../lib/util.js';

export function History({ syncStatus }) {
  const { sessions } = derived();
  const list = [...sessions].sort(
    (a, b) => b.date.localeCompare(a.date) || (b.startedAt || 0) - (a.startedAt || 0),
  );
  const groups = new Map();
  for (const s of list) {
    if (!groups.has(s.cycle)) groups.set(s.cycle, []);
    groups.get(s.cycle).push(s);
  }
  const cycles = [...groups.keys()].sort((a, b) => b - a);

  return html`<main class="screen">
    <header class="topbar topbar--large">
      <h1>История</h1>
      <${SyncBadge} status=${syncStatus} onClick=${() => app.ui.go({ view: { type: 'settings' } })} />
    </header>
    ${list.length === 0
      ? html`<div class="empty">
          <h2>Тренировок пока нет</h2>
          <p>Начните тренировку на вкладке «Тренировка» или перенесите прошлые результаты в настройках.</p>
          <button type="button" class="btn" style="margin-top:14px" onClick=${() => app.ui.go({ view: { type: 'results-import' } })}>Перенести прошлые тренировки</button>
        </div>`
      : cycles.map(
          (c) => html`<h2 class="section-title">Цикл ${c}</h2>
            <ul class="rows">
              ${groups.get(c).map((s) => {
                const sets = app.store.setsOf(s.id);
                const ex = new Set(sets.map((x) => x.seriesKey)).size;
                return html`<li><button type="button" class="row" onClick=${() => app.ui.go({ view: { type: 'session', id: s.id } })}>
                  <span class="row__lead"><${Plate} week=${s.week} /><span class="row__title">День ${s.day}</span></span>
                  <span class="muted" style="font-size:14px">${s.status === 'done' ? '' : 'в процессе'}</span>
                  <span class="row__sub">${fmtDayWeekday(s.date)}: ${ex} ${plural(ex, 'упражнение', 'упражнения', 'упражнений')}, ${sets.length} ${plural(sets.length, 'подход', 'подхода', 'подходов')}</span>
                </button></li>`;
              })}
            </ul>`,
        )}
  </main>`;
}
