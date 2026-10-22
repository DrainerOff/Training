// Workout history: the last 8 weeks at a glance, then workouts grouped by month and cycle.
// Tapping a workout opens it for viewing and editing.

import { html, app, WeekMark, SyncBadge } from './core.js';
import { derived, recordsDerived } from './derive.js';
import { fmtDayShort, fmtNum, isoDate, parseISODate, plural } from '../lib/util.js';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function History({ syncStatus }) {
  const { sessions } = derived();
  const list = [...sessions].sort(
    (a, b) => b.date.localeCompare(a.date) || (b.startedAt || 0) - (a.startedAt || 0),
  );
  const thisYear = new Date().getFullYear();
  const groups = new Map();
  for (const s of list) {
    const d = parseISODate(s.date);
    const key = `${s.date.slice(0, 7)}|${s.cycle}`;
    if (!groups.has(key)) {
      const month = MONTHS[d.getMonth()] + (d.getFullYear() === thisYear ? '' : ` ${d.getFullYear()}`);
      groups.set(key, { title: `${month} · цикл ${s.cycle}`, items: [] });
    }
    groups.get(key).items.push(s);
  }
  const records = new Map();
  for (const book of recordsDerived().books.values()) {
    for (const e of book.events) {
      const id = e.kind === 'record' ? e.perf.sessionId : null;
      if (id) records.set(id, (records.get(id) || 0) + 1);
    }
  }

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
      : html`<${Weeks} sessions=${list} />
        ${[...groups.values()].map(
          (g) => html`<h2 class="section-title">${g.title}</h2>
            <ul class="rows">
              ${g.items.map((s) => {
                const sets = app.store.setsOf(s.id);
                const ex = new Set(sets.map((x) => x.seriesKey)).size;
                const rec = records.get(s.id) || 0;
                const d = parseISODate(s.date);
                return html`<li><button type="button" class="row row--day" onClick=${() => app.ui.go({ view: { type: 'session', id: s.id } })}>
                  <span class="day-num"><span class="num">${d.getDate()}</span><small>${WEEKDAYS[d.getDay()]}</small></span>
                  <span class="row__lead"><span class="row__title">День ${s.day}</span><${WeekMark} week=${s.week} /></span>
                  <span class="muted" style="font-size:14px">${s.status === 'done' ? '' : 'в процессе'}</span>
                  <span class="row__sub">неделя ${s.week} · ${ex} ${plural(ex, 'упражнение', 'упражнения', 'упражнений')}, ${sets.length} ${plural(sets.length, 'подход', 'подхода', 'подходов')}${rec
                    ? html` · <span class="row__accent">${rec} ${plural(rec, 'рекорд', 'рекорда', 'рекордов')}</span>`
                    : null}</span>
                </button></li>`;
              })}
            </ul>`,
        )}`}
  </main>`;
}

// The last 8 calendar weeks (Monday to Sunday): one block per workout, coloured by the week of
// the cycle. The average counts only the weeks since the first workout.
function Weeks({ sessions }) {
  const today = parseISODate(isoDate());
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(monday);
    start.setDate(monday.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const from = isoDate(start);
    const to = isoDate(end);
    weeks.push({ from, to, items: sessions.filter((s) => s.date >= from && s.date <= to).sort((a, b) => a.date.localeCompare(b.date)) });
  }
  const total = weeks.reduce((n, w) => n + w.items.length, 0);
  const first = sessions[sessions.length - 1]?.date;
  const span = weeks.filter((w) => first && w.to >= first).length;
  const rows = Math.max(3, ...weeks.map((w) => w.items.length));
  const shown = [...new Set(weeks.flatMap((w) => w.items.map((s) => s.week)))].sort();
  const label = weeks.map((w, i) => `${i === weeks.length - 1 ? 'эта неделя' : `с ${fmtDayShort(w.from)}`}: ${w.items.length}`).join(', ');

  return html`<section class="weeks8" aria-label="Последние 8 недель">
    <div class="weeks8__head">
      <div><div class="weeks8__label">За 8 недель</div><span class="num weeks8__total">${total}</span> <span class="weeks8__unit">${plural(total, 'тренировка', 'тренировки', 'тренировок')}</span></div>
      <div style="text-align:right"><div class="weeks8__label">В неделю</div><span class="num weeks8__avg">${fmtNum(total / Math.max(1, span), 1)}</span></div>
    </div>
    <div class="weeks8__bars" role="img" aria-label=${`Тренировки по неделям: ${label}`} style=${`--rows:${rows}`}>
      ${weeks.map((w, i) => html`<div class=${'weeks8__col' + (i === weeks.length - 1 ? ' weeks8__col--now' : '')}>
        ${w.items.map((s) => html`<span class="weeks8__b" style=${`background:var(--plate-${s.week})`}></span>`)}
      </div>`)}
    </div>
    <div class="weeks8__ticks" aria-hidden="true">
      ${weeks.map((w, i) => html`<span>${i === weeks.length - 1 ? 'эта' : i % 2 === 0 ? fmtDayShort(w.from) : ''}</span>`)}
    </div>
    ${shown.length
      ? html`<div class="weeks8__legend" aria-hidden="true">${shown.map((wk) => html`<span><i style=${`background:var(--plate-${wk})`}></i>неделя ${wk}</span>`)}</div>`
      : null}
  </section>`;
}
