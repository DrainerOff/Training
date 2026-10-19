// Body: weight and its rate of change, girths, main sleep, recovery — and where each came from.
// Device data (App_Body, App_Sleep) wins for its day over a v1.0 check-in, so nothing counts twice.

import { html, useState, app, openSheet, Sheet } from './core.js';
import { MetricFields } from './workout.js';
import { weightTrend, rollingAverage } from '../lib/plateau.js';
import { isoDate, fmtDay, fmtDayShort, fmtNum, sum } from '../lib/util.js';
import { KINDS, GIRTHS, dailyWeights, sleepNights, sleepAverage, latestOf, isCounted } from '../lib/bodydata.js';
import { ImportButton, openAddBody, openBodyRecord, openKindHistory, openNights, Sources, suspectText, sleepLine } from './bodyentry.js';
import { PhaseCard } from './phase.js';
import { phaseOn, phaseReport } from '../lib/phase.js';
import { derived } from './derive.js';

export function Body() {
  const st = app.store.state;
  const today = isoDate();
  const metrics = [...st.metrics.values()].filter((m) => !m.deleted).sort((a, b) => b.date.localeCompare(a.date));
  const body = [...st.body.values()];
  const { days, suspects } = dailyWeights(body, metrics);
  const trend = weightTrend(days, { today });
  const recent = metrics.filter((m) => m.recovery != null).slice(0, 7);
  const recAvg = recent.length ? sum(recent.map((m) => m.recovery)) / recent.length : null;
  const { nights } = sleepNights(st.sleep.values(), metrics);
  const s7 = sleepAverage(nights, today, 7);
  const s30 = sleepAverage(nights, today, 30);
  const lastNight = nights[nights.length - 1] || null;
  const weighIns = body.filter((r) => r.kind === 'weight' && !r.deleted).sort((a, b) => (a.measuredAt < b.measuredAt ? 1 : -1));
  const girths = ['fat', ...GIRTHS].map((k) => latestOf(body, k)).filter(Boolean);
  const nothing = !metrics.length && !body.some((r) => !r.deleted) && !nights.length;
  const phase = phaseOn(st.phases.values(), today);
  const report = phase ? phaseReport(phase, { days, body, nights, series: derived().series, today }) : null;

  return html`<main class="screen">
    <header class="topbar"><h1>Тело и восстановление</h1></header>
    <div class="btn-row">
      <button type="button" class="btn btn--primary" onClick=${() => openEntry(today)}>Записать самочувствие</button>
      <button type="button" class="btn" onClick=${() => openAddBody()}>Добавить замер</button>
    </div>

    <${PhaseCard} phase=${phase} report=${report} />

    <div class="stat-row">
      <div class="stat">
        <div class="stat__label">Вес, 7 дней</div>
        <div class="stat__value">${trend?.avg7 != null ? fmtNum(trend.avg7, 1) : '–'}</div>
        <div class="stat__unit">кг</div>
      </div>
      <div class="stat">
        <div class="stat__label">Темп</div>
        <div class="stat__value">${trend?.perWeek != null ? `${trend.perWeek >= 0 ? '+' : '−'}${fmtNum(Math.abs(trend.perWeek), 2)}` : '–'}</div>
        <div class="stat__unit">кг в неделю</div>
      </div>
      <div class="stat">
        <div class="stat__label">Сон, 7 дней</div>
        <div class="stat__value">${s7.avg != null ? fmtNum(s7.avg, 1) : '–'}</div>
        <div class="stat__unit">${s7.nights ? `ч, ночей: ${s7.nights}` : 'ч'}</div>
      </div>
    </div>
    <p class="muted" style="font-size:13px">
      ${trend?.perWeek != null
        ? `Темп по взвешиваниям за 4 недели: ${trend.perWeekPct >= 0 ? '+' : '−'}${fmtNum(Math.abs(trend.perWeekPct), 2)}% массы в неделю.`
        : 'Темп появится, когда будет хотя бы 4 дня со взвешиванием за 10+ дней.'}
      ${recAvg != null ? ` Восстановление ${fmtNum(recAvg, 1)} из 5 (последние ${recent.length} записей).` : ''}
    </p>

    ${trend && trend.points.length >= 2 ? html`<${WeightChart} points=${trend.points.slice(-60)} />` : null}

    ${nothing
      ? html`<div class="empty body-empty">
          <h2>Пока нет данных</h2>
          <p>Добавьте замер вручную или загрузите историю: вес и сон из экспорта «Здоровья», обхваты из Fitdays+.</p>
        </div>`
      : null}

    <h2 class="section-title">Сон</h2>
    ${lastNight
      ? html`<button type="button" class="row" onClick=${() => openNights()}>
          <span class="row__title">${fmtDay(lastNight.date)}: ${fmtNum(lastNight.hours, 1)} ч</span>
          <span class="muted">${s30.avg != null ? `30 дней: ${fmtNum(s30.avg, 1)} ч` : ''}</span>
          <span class="row__sub">${sleepLine(lastNight)}</span>
        </button>`
      : html`<p class="muted">Нет данных о сне. Основной сон по фазам Apple Watch можно загрузить из файла.</p>`}

    <h2 class="section-title">Обхваты</h2>
    ${girths.length
      ? html`<ul class="rows">
          ${girths.map(
            (g) => html`<li><button type="button" class="row" onClick=${() => openKindHistory(g.last.kind)}>
              <span class="row__title">${KINDS[g.last.kind].label}</span>
              <span class="num body-value">${fmtNum(g.last.value, 1)} ${KINDS[g.last.kind].unit}</span>
              <span class="row__sub">${fmtDay(g.last.date)}${g.change != null ? `, за 4+ недели ${g.change >= 0 ? '+' : '−'}${fmtNum(Math.abs(g.change), 1)}` : ''}${g.last.kind === 'fat' ? ', оценка весов, не точное измерение' : ''}</span>
            </button></li>`,
          )}
        </ul>`
      : html`<p class="muted">Нет замеров. Талию можно добавить вручную, остальные обхваты — из экспорта Fitdays+.</p>`}

    <h2 class="section-title">Взвешивания</h2>
    ${weighIns.length
      ? html`<ul class="rows">
          ${weighIns.slice(0, 40).map(
            (r) => html`<li><button type="button" class="row" onClick=${() => openBodyRecord(r.id)}>
              <span class="row__title">${fmtDay(r.date)}, ${r.measuredAt.slice(11, 16)}</span>
              <span class="num body-value">${fmtNum(r.value, 2)} кг</span>
              <span class="row__sub">${[r.source, r.edited ? 'исправлено' : null, !isCounted(r, suspects) ? (r.excluded === true ? 'не учитывается' : suspectText(suspects.get(r.id))) : null, r.note || null].filter(Boolean).join(' · ')}</span>
            </button></li>`,
          )}
        </ul>
        ${weighIns.length > 40 ? html`<button type="button" class="btn btn--quiet btn--block" onClick=${() => openKindHistory('weight')}>Все взвешивания (${weighIns.length})</button>` : null}`
      : html`<p class="muted">Взвешиваний из «Здоровья» пока нет. Вес из записей самочувствия учитывается в среднем и темпе.</p>`}

    <h2 class="section-title">Самочувствие</h2>
    ${metrics.length === 0 ? html`<p class="muted">Пока нет записей. Вес лучше записывать утром, натощак.</p>` : null}
    <ul class="rows">
      ${metrics.slice(0, 30).map(
        (m) => html`<li><button type="button" class="row" onClick=${() => openEntry(m.date)}>
          <span class="row__title">${fmtDay(m.date)}</span>
          <span class="num body-value">${m.bodyweight != null ? fmtNum(m.bodyweight, 1) + ' кг' : ''}</span>
          <span class="row__sub">${[
            m.recovery != null ? `восстановление ${m.recovery}/5` : null,
            m.sleep != null ? `сон ${fmtNum(m.sleep, 1)} ч` : null,
            m.note || null,
          ].filter(Boolean).join(', ')}</span>
        </button></li>`,
      )}
    </ul>

    <h2 class="section-title">Источники и загрузка</h2>
    <${Sources} />
    <${ImportButton} />
  </main>`;
}


function openEntry(date) {
  openSheet((close) => html`<${EntrySheet} date=${date} onClose=${close} />`);
}

// The form always shows (and saves/deletes) the record of the chosen date.
function recordOf(date) {
  const prev = date && app.store.state.metrics.get(`m${date}`);
  return prev && !prev.deleted ? prev : null;
}
function valuesOf(live) {
  return { recovery: live?.recovery ?? null, sleep: live?.sleep ?? null, bodyweight: live?.bodyweight ?? null, note: live?.note || '' };
}

function EntrySheet({ date, onClose }) {
  const [d, setD] = useState(date);
  const [start, setStart] = useState(() => valuesOf(recordOf(date)));
  const [v, setV] = useState(start);
  const live = recordOf(d);
  const pick = (day) => {
    const s = valuesOf(recordOf(day));
    setD(day);
    setStart(s);
    setV(s);
  };
  const empty = v.recovery == null && v.sleep == null && v.bodyweight == null && !v.note;
  const save = async () => {
    await app.store.saveMetric(d, v);
    onClose();
  };
  const footer = html`
    ${live ? html`<button type="button" class="btn btn--danger" onClick=${async () => { await app.store.deleteMetric(live.id); onClose(); }}>Удалить</button>` : null}
    <button type="button" class="btn btn--primary" disabled=${!d || empty} onClick=${save}>Сохранить</button>`;
  return html`<${Sheet} title="Самочувствие и вес" onClose=${onClose} footer=${footer} dirty=${JSON.stringify(v) !== JSON.stringify(start)}>
    <div class="sheet__section">
      <div class="sheet__label">Дата</div>
      <input class="input" type="date" value=${d} max=${isoDate()} onInput=${(e) => pick(e.currentTarget.value)} />
    </div>
    ${d
      ? html`<${MetricFields} v=${v} setV=${setV} />
          <div class="sheet__section">
            <input class="input" placeholder="Заметка" aria-label="Заметка" value=${v.note} onInput=${(e) => setV({ ...v, note: e.currentTarget.value })} />
          </div>`
      : null}
  <//>`;
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
