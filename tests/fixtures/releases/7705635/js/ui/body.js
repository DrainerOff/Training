// Bodyweight, sleep, recovery — and the rate of weight gain.

import { html, useState, app, openSheet, Sheet } from './core.js';
import { MetricFields } from './workout.js';
import { weightTrend, rollingAverage } from '../lib/analytics.js';
import { isoDate, fmtDay, fmtDayShort, fmtNum, sum } from '../lib/util.js';

export function Body() {
  const metrics = [...app.store.state.metrics.values()].filter((m) => !m.deleted).sort((a, b) => b.date.localeCompare(a.date));
  const trend = weightTrend(metrics, { today: isoDate() });
  const recent = metrics.filter((m) => m.recovery != null).slice(0, 7);
  const recAvg = recent.length ? sum(recent.map((m) => m.recovery)) / recent.length : null;
  const sleeps = metrics.filter((m) => m.sleep != null).slice(0, 7);
  const sleepAvg = sleeps.length ? sum(sleeps.map((m) => m.sleep)) / sleeps.length : null;

  return html`<main class="screen">
    <header class="topbar"><h1>Тело и восстановление</h1></header>
    <button type="button" class="btn btn--primary btn--block" onClick=${() => openEntry(isoDate())}>Записать за сегодня</button>

    <div class="stat-row">
      <div class="stat">
        <div class="stat__label">Вес, 7 дней</div>
        <div class="stat__value">${trend?.avg7 != null ? fmtNum(trend.avg7, 1) : '–'}</div>
        <div class="stat__unit">кг</div>
      </div>
      <div class="stat">
        <div class="stat__label">Темп набора</div>
        <div class="stat__value">${trend?.perWeek != null ? `${trend.perWeek >= 0 ? '+' : '−'}${fmtNum(Math.abs(trend.perWeek), 2)}` : '–'}</div>
        <div class="stat__unit">кг в неделю</div>
      </div>
      <div class="stat">
        <div class="stat__label">Восстановление</div>
        <div class="stat__value">${recAvg != null ? fmtNum(recAvg, 1) : '–'}</div>
        <div class="stat__unit">из 5, за 7 записей</div>
      </div>
    </div>
    <p class="muted" style="font-size:13px">
      ${trend?.perWeek != null
        ? `Темп по взвешиваниям за 4 недели: ${trend.perWeekPct >= 0 ? '+' : '−'}${fmtNum(Math.abs(trend.perWeekPct), 2)}% массы в неделю.`
        : 'Темп появится, когда будет хотя бы 4 взвешивания за 10+ дней.'}
      ${sleepAvg != null ? ` Сон в среднем ${fmtNum(sleepAvg, 1)} ч.` : ''}
    </p>

    ${trend && trend.points.length >= 2 ? html`<${WeightChart} points=${trend.points.slice(-60)} />` : null}

    <h2 class="section-title">Записи</h2>
    ${metrics.length === 0 ? html`<p class="muted">Пока нет записей. Вес лучше записывать утром, натощак.</p>` : null}
    <ul class="rows">
      ${metrics.slice(0, 60).map(
        (m) => html`<li><button type="button" class="row" onClick=${() => openEntry(m.date)}>
          <span class="row__title">${fmtDay(m.date)}</span>
          <span class="num" style="font-size:22px;font-weight:700">${m.bodyweight != null ? fmtNum(m.bodyweight, 1) + ' кг' : ''}</span>
          <span class="row__sub">${[
            m.recovery != null ? `восстановление ${m.recovery}/5` : null,
            m.sleep != null ? `сон ${fmtNum(m.sleep, 1)} ч` : null,
            m.note || null,
          ].filter(Boolean).join(', ')}</span>
        </button></li>`,
      )}
    </ul>
  </main>`;
}

function openEntry(date) {
  openSheet((close) => html`<${EntrySheet} date=${date} onClose=${close} />`);
}

function EntrySheet({ date, onClose }) {
  const [d, setD] = useState(date);
  return html`<${Sheet} title="Самочувствие и вес" onClose=${onClose}>
    <div class="sheet__section">
      <div class="sheet__label">Дата</div>
      <input class="input" type="date" value=${d} max=${isoDate()} onInput=${(e) => setD(e.currentTarget.value)} />
    </div>
    ${d ? html`<${EntryForm} key=${d} date=${d} onClose=${onClose} />` : null}
  <//>`;
}

// Re-mounted per date: the form always shows (and saves/deletes) the record of the chosen date.
function EntryForm({ date, onClose }) {
  const prev = app.store.state.metrics.get(`m${date}`);
  const live = prev && !prev.deleted ? prev : null;
  const [v, setV] = useState({
    recovery: live?.recovery ?? null,
    sleep: live?.sleep ?? null,
    bodyweight: live?.bodyweight ?? null,
    note: live?.note || '',
  });
  const empty = v.recovery == null && v.sleep == null && v.bodyweight == null && !v.note;
  return html`
    <${MetricFields} v=${v} setV=${setV} />
    <div class="sheet__section">
      <input class="input" placeholder="Заметка" value=${v.note} onInput=${(e) => setV({ ...v, note: e.currentTarget.value })} />
    </div>
    <div class="btn-row">
      ${live ? html`<button type="button" class="btn btn--danger" onClick=${async () => { await app.store.deleteMetric(live.id); onClose(); }}>Удалить</button>` : null}
      <button type="button" class="btn btn--primary" disabled=${empty} onClick=${async () => {
        await app.store.saveMetric(date, v);
        onClose();
      }}>Сохранить</button>
    </div>`;
}

const W = 340;
const H = 160;
const M = { l: 34, r: 12, t: 10, b: 24 };

// One series (bodyweight): dots for weigh-ins, line for the 7-day average. No legend needed.
function WeightChart({ points }) {
  const pts = rollingAverage(points);
  const ws = pts.map((p) => p.w);
  let lo = Math.min(...ws);
  let hi = Math.max(...ws);
  const pad = Math.max(0.3, (hi - lo) * 0.15);
  lo -= pad;
  hi += pad;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const x = (t) => M.l + ((t - t0) / (t1 - t0 || 1)) * (W - M.l - M.r);
  const y = (w) => M.t + (1 - (w - lo) / (hi - lo)) * (H - M.t - M.b);
  const step = (hi - lo) / 3;
  const ticks = [0, 1, 2, 3].map((i) => lo + step * i);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.avg).toFixed(1)}`).join(' ');
  return html`<figure class="chart" style="margin:6px 0 0">
    <svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Вес тела и среднее за 7 дней">
      ${ticks.map((t) => html`<g>
        <line x1=${M.l} x2=${W - M.r} y1=${y(t)} y2=${y(t)} stroke="var(--hairline)" stroke-width="1" />
        <text x=${M.l - 6} y=${y(t) + 4} text-anchor="end" font-size="11" fill="var(--steel)">${fmtNum(t, 1)}</text>
      </g>`)}
      <text x=${M.l} y=${H - 6} font-size="11" fill="var(--steel)">${fmtDayShort(pts[0].date)}</text>
      <text x=${W - M.r} y=${H - 6} text-anchor="end" font-size="11" fill="var(--steel)">${fmtDayShort(pts[pts.length - 1].date)}</text>
      <path d=${line} fill="none" stroke="var(--iron)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      ${pts.map((p) => html`<circle cx=${x(p.t)} cy=${y(p.w)} r="4" fill="var(--steel)" stroke="var(--paper)" stroke-width="2"><title>${fmtDay(p.date)}: ${fmtNum(p.w, 1)} кг</title></circle>`)}
    </svg>
    <figcaption class="muted" style="font-size:12px;padding:2px 8px 4px">Точки — взвешивания, линия — среднее за 7 дней.</figcaption>
  </figure>`;
}
