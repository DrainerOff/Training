// Body: the phase and its rate, the weight chart, week-to-week change, four scores (waist,
// strength, sleep, recovery), and the raw data behind grouped rows. Device data (App_Body,
// App_Sleep) wins for its day over a v1.0 check-in, so nothing counts twice.

import { html, useState, app, openSheet, Sheet, Icon, local } from './core.js';
import { MetricFields } from './workout.js';
import { weightTrend, rollingAverage } from '../lib/plateau.js';
import { isoDate, fmtDay, fmtDayShort, fmtNum, fmtTime, sum, plural } from '../lib/util.js';
import { healthDelivery, describeDelivery } from '../lib/health.js';
import { KINDS, GIRTHS, dailyWeights, sleepNights, sleepAverage, latestOf } from '../lib/bodydata.js';
import { ImportButton, importFile, openAddBody, openKindHistory, openNights, Sources, sleepLine } from './bodyentry.js';
import { PhaseCard, PhaseWeeks } from './phase.js';
import { MODES, phaseOn, phaseReport, sortedPhases, targetBand, addDays } from '../lib/phase.js';
import { derived } from './derive.js';

const signed = (n, digits = 2) => `${n >= 0 ? '+' : '−'}${fmtNum(Math.abs(n), digits)}`;

export function Body() {
  const st = app.store.state;
  const today = isoDate();
  const metrics = [...st.metrics.values()].filter((m) => !m.deleted).sort((a, b) => b.date.localeCompare(a.date));
  const body = [...st.body.values()];
  const { days } = dailyWeights(body, metrics);
  const trend = weightTrend(days, { today });
  const recent = metrics.filter((m) => m.recovery != null).slice(0, 7);
  const recAvg = recent.length ? sum(recent.map((m) => m.recovery)) / recent.length : null;
  const { nights } = sleepNights(st.sleep.values(), metrics);
  const s7 = sleepAverage(nights, today, 7);
  const lastNight = nights[nights.length - 1] || null;
  const weighIns = body.filter((r) => r.kind === 'weight' && !r.deleted).sort((a, b) => (a.measuredAt < b.measuredAt ? 1 : -1));
  const girths = ['fat', ...GIRTHS].map((k) => latestOf(body, k)).filter(Boolean);
  const waist = latestOf(body, 'waist');
  const nothing = !metrics.length && !body.some((r) => !r.deleted) && !nights.length;
  const phase = phaseOn(st.phases.values(), today);
  const report = phase ? phaseReport(phase, { days, body, nights, series: derived().series, shareOf: derived().shareOf, today }) : null;
  const lastMetric = metrics[0];
  const week7 = Array.from({ length: 7 }, (_, i) => nights.find((n) => n.date === addDays(today, i - 6))?.hours ?? null);

  return html`<main class="screen">
    <header class="topbar topbar--large">
      <h1>Тело</h1>
      <button type="button" class="add-btn" aria-label="Добавить: самочувствие, замер или файл" onClick=${() => openAdd(today)}><${Icon} name="plus" /></button>
    </header>

    <${HealthQuiet} />
    <${PhaseCard} phase=${phase} report=${report} />

    ${nothing
      ? html`<div class="empty body-empty">
          <h2>Пока нет данных</h2>
          <p>Добавьте замер вручную или загрузите историю: вес и сон из экспорта «Здоровья», обхваты из Fitdays+.</p>
        </div>`
      : null}

    ${trend ? html`<${WeightCard} trend=${trend} phase=${phase} today=${today} />` : null}
    ${report ? html`<${PhaseWeeks} report=${report} />` : null}

    <section class="tiles" aria-label="Показатели">
      <button type="button" class="tile" onClick=${() => openKindHistory('waist')}>
        <span class="tile__label">Талия, см</span>
        <span class="num tile__value">${waist ? fmtNum(waist.last.value, 1) : '–'}</span>
        <span class="tile__sub">${report?.waist.enough
          ? `${signed(report.waist.waistChange, 1)} за режим${report.waist.weightChange != null ? ` при весе ${signed(report.waist.weightChange, 1)} кг` : ''}`
          : report
            ? `нужны 2 замера с разницей 2+ недели, сейчас ${report.waist.count}`
            : waist
              ? fmtDay(waist.last.date)
              : 'нет замеров'}</span>
      </button>
      <button type="button" class="tile" onClick=${() => (report?.strength.compared ? openStrength(report) : app.ui.go({ tab: 'progress' }))}>
        <span class="tile__label">Силовые</span>
        ${report?.strength.compared
          ? html`<span class="num tile__value tile__value--split">${report.strength.up}<small class="tile__up">▲</small> ${report.strength.flat}<small>●</small> ${report.strength.down}<small>▼</small></span>
              <span class="tile__sub">растут · на месте · снижаются</span>`
          : html`<span class="num tile__value">–</span>
              <span class="tile__sub">${report ? 'нужна та же неделя цикла с разницей 2+ недели' : 'считаются за период режима'}</span>`}
      </button>
      <button type="button" class="tile" onClick=${() => openNights()}>
        <span class="tile__label">Сон, ч</span>
        <span class="tile__row">
          <span class="num tile__value">${s7.avg != null ? fmtNum(s7.avg, 1) : '–'}</span>
          ${s7.nights ? html`<${SleepBars} hours=${week7} />` : null}
        </span>
        <span class="tile__sub">${s7.nights ? `весь сон за сутки, ${s7.nights} из 7 дней` : 'нет данных за 7 дней'}${report?.sleep.nights ? html`<br />за режим ${fmtNum(report.sleep.avg, 1)} ч` : null}</span>
      </button>
      <button type="button" class="tile" onClick=${() => openMetrics()}>
        <span class="tile__label">Восстановление</span>
        <span class="num tile__value">${recAvg != null ? html`${fmtNum(recAvg, 1)}<small> / 5</small>` : '–'}</span>
        <span class="tile__sub">${recent.length ? `последние ${recent.length} ${plural(recent.length, 'запись', 'записи', 'записей')}` : 'нет записей'}</span>
      </button>
    </section>
    <p class="phase__text body-note">Цифры показывают, что происходило, но не почему. Процент жира с весов — оценка и в расчёт не входит.</p>

    <h2 class="section-title">Данные</h2>
    <ul class="rows">
      <li><button type="button" class="row row--icon" onClick=${() => openKindHistory('weight')}>
        <span class="tile-icon" style="--c:var(--accent)"><${Icon} name="scale" /></span>
        <span class="row__title">Взвешивания</span>
        <span class="num body-value">${weighIns.length ? `${fmtNum(weighIns[0].value, 2)} кг` : ''}</span>
        <span class="row__sub">${weighIns.length
          ? `${weighIns.length} · последнее ${fmtDayShort(weighIns[0].date)}, ${weighIns[0].measuredAt.slice(11, 16)}${weighIns[0].source ? ` · ${weighIns[0].source}` : ''}`
          : 'Взвешиваний из «Здоровья» пока нет. Вес из записей самочувствия учитывается в среднем и темпе.'}</span>
      </button></li>
      <li><button type="button" class="row row--icon" onClick=${() => openGirths()}>
        <span class="tile-icon" style="--c:var(--cut)"><${Icon} name="ruler" /></span>
        <span class="row__title">Обхваты</span>
        <span></span>
        <span class="row__sub">${girths.length
          ? girths.map((g) => `${KINDS[g.last.kind].label.toLowerCase()} ${fmtNum(g.last.value, 1)}`).join(' · ')
          : 'Нет замеров. Талию можно добавить вручную, остальные обхваты — из экспорта Fitdays+.'}</span>
      </button></li>
      <li><button type="button" class="row row--icon" onClick=${() => openNights()}>
        <span class="tile-icon" style="--c:var(--sleep)"><${Icon} name="moon" /></span>
        <span class="row__title">Сон по дням</span>
        <span class="num body-value">${lastNight ? `${fmtNum(lastNight.hours, 1)} ч` : ''}</span>
        <span class="row__sub">${lastNight
          ? `${fmtDay(lastNight.date)} · ${sleepLine(lastNight)}`
          : 'Нет данных о сне. Сон по фазам Apple Watch можно загрузить из файла.'}</span>
      </button></li>
      <li><button type="button" class="row row--icon" onClick=${() => openMetrics()}>
        <span class="tile-icon" style="--c:var(--plate-1)"><${Icon} name="pulse" /></span>
        <span class="row__title">Самочувствие</span>
        <span></span>
        <span class="row__sub">${lastMetric ? `${fmtDay(lastMetric.date)}: ${metricLine(lastMetric) || 'заметка'}` : 'Пока нет записей. Вес лучше записывать утром, натощак.'}</span>
      </button></li>
    </ul>

    <h2 class="section-title">Источники и загрузка</h2>
    <${Sources} />
    <${ImportButton} />
  </main>`;
}

const metricLine = (m) => [
  m.bodyweight != null ? `${fmtNum(m.bodyweight, 1)} кг` : null,
  m.recovery != null ? `восстановление ${m.recovery}/5` : null,
  m.sleep != null ? `сон ${fmtNum(m.sleep, 1)} ч` : null,
].filter(Boolean).join(', ');

// 7 days of sleep, all sleep of each day (the same hours the average counts); a gap is a day
// without data.
function SleepBars({ hours }) {
  const max = Math.max(9, ...hours.filter((h) => h != null));
  return html`<svg class="tile__bars" width="62" height="34" viewBox="0 0 62 34" aria-hidden="true">
    ${hours.map((h, i) => (h == null
      ? html`<rect x=${i * 9} y="31" width="6" height="3" rx="1.5" fill="var(--hairline)" />`
      : html`<rect x=${i * 9} y=${34 - (h / max) * 34} width="6" height=${(h / max) * 34} rx="2" fill="var(--sleep)" />`))}
  </svg>`;
}

// ---------------------------------------------------------------- sheets behind the rows

function openAdd(today) {
  openSheet((close) => html`<${Sheet} title="Добавить" onClose=${close}>
    <ul class="rows">
      <li><button type="button" class="row row--icon" onClick=${() => { close(); openEntry(today); }}>
        <span class="tile-icon" style="--c:var(--plate-1)"><${Icon} name="pulse" /></span>
        <span class="row__title">Записать самочувствие</span><span></span>
        <span class="row__sub">восстановление, сон и вес за день</span>
      </button></li>
      <li><button type="button" class="row row--icon" onClick=${() => { close(); openAddBody(); }}>
        <span class="tile-icon" style="--c:var(--cut)"><${Icon} name="ruler" /></span>
        <span class="row__title">Добавить замер</span><span></span>
        <span class="row__sub">вес, талия или другой обхват</span>
      </button></li>
      <li><label class="row row--icon add-file">
        <span class="tile-icon" style="--c:var(--accent)"><${Icon} name="note" /></span>
        <span class="row__title">Загрузить из файла (CSV)</span><span></span>
        <span class="row__sub">экспорт «Здоровья» или Fitdays+, читается только на этом телефоне</span>
        <input type="file" accept=".csv,text/csv,text/plain" class="sr-only" onChange=${(e) => importFile(e, close)} />
      </label></li>
    </ul>
  <//>`);
}

function openGirths() {
  openSheet((close) => html`<${GirthsSheet} onClose=${close} />`);
}

function GirthsSheet({ onClose }) {
  const body = [...app.store.state.body.values()];
  const girths = ['fat', ...GIRTHS].map((k) => latestOf(body, k)).filter(Boolean);
  return html`<${Sheet} title="Обхваты" onClose=${onClose}>
    <button type="button" class="btn btn--block" onClick=${() => openAddBody()}>Добавить замер</button>
    ${girths.length
      ? html`<ul class="rows" style="margin-top:12px">
          ${girths.map(
            (g) => html`<li><button type="button" class="row" onClick=${() => openKindHistory(g.last.kind)}>
              <span class="row__title">${KINDS[g.last.kind].label}</span>
              <span class="num body-value">${fmtNum(g.last.value, 1)} ${KINDS[g.last.kind].unit}</span>
              <span class="row__sub">${fmtDay(g.last.date)}${g.change != null ? `, за 4+ недели ${signed(g.change, 1)}` : ''}${g.last.kind === 'fat' ? ', оценка весов, не точное измерение' : ''}</span>
            </button></li>`,
          )}
        </ul>`
      : html`<p class="muted" style="margin-top:12px">Нет замеров. Талию можно добавить вручную, остальные обхваты — из экспорта Fitdays+.</p>`}
  <//>`;
}

function openMetrics() {
  openSheet((close) => html`<${MetricsSheet} onClose=${close} />`);
}

function MetricsSheet({ onClose }) {
  const metrics = [...app.store.state.metrics.values()].filter((m) => !m.deleted).sort((a, b) => b.date.localeCompare(a.date));
  return html`<${Sheet} title="Самочувствие" onClose=${onClose}>
    <button type="button" class="btn btn--primary btn--block" onClick=${() => openEntry(isoDate())}>Записать самочувствие</button>
    ${metrics.length
      ? html`<ul class="rows" style="margin-top:12px">
          ${metrics.slice(0, 90).map(
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
        </ul>`
      : html`<p class="muted" style="margin-top:12px">Пока нет записей. Вес лучше записывать утром, натощак.</p>`}
  <//>`;
}

function openStrength(report) {
  const s = report.strength;
  const GL = { up: '▲', flat: '●', down: '▼' };
  openSheet((close) => html`<${Sheet} title="Силовые за режим" onClose=${close}>
    <p class="muted" style="font-size:13px">Лучший подход в ту же неделю цикла в начале и в конце режима. Изменение меньше 1 % считается «на месте».</p>
    <ul class="rows" style="margin-top:10px">
      ${s.items.map(
        (it) => html`<li><div class="row">
          <span class="row__title">${it.name}</span>
          <span class=${'num body-value strength--' + it.verdict}>${GL[it.verdict]} ${signed(it.change * 100, 1)} %</span>
          <span class="row__sub">неделя ${it.week}: ${fmtDay(it.from)} → ${fmtDay(it.to)}</span>
        </div></li>`,
      )}
    </ul>
  <//>`);
}

// ---------------------------------------------------------------- weight chart

const PERIODS = [
  { value: '4w', label: '4 нед', days: 28 },
  { value: '3m', label: '3 мес', days: 91 },
  { value: 'all', label: 'Всё', days: Infinity },
];

function WeightCard({ trend, phase, today }) {
  const [period, setPeriodRaw] = useState(() => local.get('body.period', '3m'));
  const setPeriod = (p) => {
    local.set('body.period', p);
    setPeriodRaw(p);
  };
  const span = (PERIODS.find((p) => p.value === period) || PERIODS[1]).days;
  const all = rollingAverage(trend.points);
  const endT = all[all.length - 1].t;
  const pts = all.filter((p) => p.t > endT - span);
  const anchor = phase ? all.find((p) => p.date >= phase.start) : null;
  return html`<section class="card weight-card" aria-label="Вес">
    <div class="card__head">
      <span class="card__label">Вес · среднее 7 дней</span>
      <div class="period" role="group" aria-label="Период">
        ${PERIODS.map((p) => html`<button type="button" aria-pressed=${String(p.value === period)} onClick=${() => setPeriod(p.value)}>${p.label}</button>`)}
      </div>
    </div>
    <div class="weight-card__nums">
      <span><span class="num weight-card__avg">${trend.avg7 != null ? fmtNum(trend.avg7, 1) : '–'}</span> <span class="weight-card__unit">кг</span></span>
      <span class="weight-card__rate">${trend.perWeek != null
        ? html`<b class="num">${signed(trend.perWeek)} кг</b> в неделю<br />за 4 недели, ${signed(trend.perWeekPct)} %`
        : 'темп: нужны 4 дня со взвешиванием за 10+ дней'}</span>
    </div>
    ${pts.length >= 2
      ? html`<${WeightChart} pts=${pts} phase=${phase} anchor=${anchor} today=${today} />`
      : html`<p class="phase__text">График появится после второго дня со взвешиванием${span !== Infinity ? ' в выбранном периоде' : ''}.</p>`}
  </section>`;
}

const W = 340;
const H = 190;
const M = { l: 30, r: 6, t: 22, b: 22 };
const BAND = { bulk: 'var(--accent-soft)', cut: 'var(--cut-soft)', maintain: 'var(--fill)' };
const BAND_TEXT = { bulk: 'var(--accent-text)', cut: 'var(--cut)', maintain: 'var(--steel)' };
const GLYPH = { bulk: '▲', cut: '▼', maintain: '●' };

// Dots are weigh-ins, the line is the 7-day average. Behind them the phases as bands; for the
// running phase, the corridor of the target (lib/phase.js targetBand) from its first average.
function WeightChart({ pts, phase, anchor, today }) {
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const tOf = (iso) => Date.parse(iso + 'T00:00:00Z') / 86400000;
  let corridor = null;
  if (phase && anchor) {
    const end = Math.min(phase.end && phase.end < today ? tOf(phase.end) : t1, t1);
    const from = Math.max(anchor.t, t0);
    if (end - anchor.t >= 7 && end > from) {
      const target = Number(phase.targetPct) || 0;
      const band = targetBand(target);
      const at = (t, pct) => anchor.avg * (1 + (pct / 100) * ((t - anchor.t) / 7));
      corridor = { from, to: end, hiAt: (t) => at(t, target + band), loAt: (t) => at(t, target - band), midAt: (t) => at(t, target) };
    }
  }
  const ws = pts.flatMap((p) => [p.w, p.avg]);
  if (corridor) ws.push(corridor.hiAt(corridor.to), corridor.loAt(corridor.to), corridor.hiAt(corridor.from), corridor.loAt(corridor.from));
  let lo = Math.min(...ws);
  let hi = Math.max(...ws);
  const stepKg = [0.5, 1, 2, 5, 10].find((s) => (hi - lo) / s <= 4) || 10;
  lo = Math.floor(lo / stepKg) * stepKg;
  hi = Math.ceil(hi / stepKg) * stepKg;
  if (hi - lo < stepKg * 2) hi = lo + stepKg * 2;
  const x = (t) => M.l + ((t - t0) / (t1 - t0 || 1)) * (W - M.l - M.r);
  const y = (w) => M.t + (1 - (w - lo) / (hi - lo)) * (H - M.t - M.b);
  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += stepKg) ticks.push(v);
  const bands = sortedPhases(app.store.state.phases.values())
    .map((p) => ({ p, a: Math.max(t0, tOf(p.start)), b: Math.min(t1, p.end ? tOf(p.end) : t1) }))
    .filter((b) => b.b > b.a);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.avg).toFixed(1)}`).join(' ');
  const marks = [pts[0], pts[pts.length - 1]];
  const ps = phase ? tOf(phase.start) : null;
  if (ps != null && x(ps) - x(t0) > 60 && x(t1) - x(ps) > 60) marks.splice(1, 0, { t: ps, date: phase.start });
  return html`<figure class="weight-chart">
    <svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${`Вес с ${fmtDay(pts[0].date)} по ${fmtDay(pts[pts.length - 1].date)}: взвешивания и среднее за 7 дней${corridor ? ', коридор цели режима' : ''}`}>
      ${bands.map((b) => html`<g>
        <rect x=${x(b.a)} y=${M.t - 18} width=${x(b.b) - x(b.a)} height=${H - M.b - M.t + 18} fill=${BAND[b.p.mode]} />
        ${x(b.b) - x(b.a) > 54 ? html`<text x=${x(b.a) + 6} y=${M.t - 5} font-size="11" font-weight="800" letter-spacing="1" fill=${BAND_TEXT[b.p.mode]}>${GLYPH[b.p.mode]} ${MODES[b.p.mode].label.toUpperCase()}</text>` : null}
      </g>`)}
      ${ticks.map((t) => html`<g>
        <line x1=${M.l} x2=${W - M.r} y1=${y(t)} y2=${y(t)} stroke="var(--hairline)" stroke-width="1" />
        <text x=${M.l - 6} y=${y(t) + 4} text-anchor="end" font-size="11" fill="var(--steel)">${fmtNum(t, stepKg < 1 ? 1 : 0)}</text>
      </g>`)}
      ${corridor
        ? html`<polygon points=${[[corridor.from, corridor.loAt], [corridor.from, corridor.hiAt], [corridor.to, corridor.hiAt], [corridor.to, corridor.loAt]].map(([t, f]) => `${x(t).toFixed(1)},${y(f(t)).toFixed(1)}`).join(' ')} fill="var(--accent)" fill-opacity="0.28" />
            <line x1=${x(corridor.from)} y1=${y(corridor.midAt(corridor.from))} x2=${x(corridor.to)} y2=${y(corridor.midAt(corridor.to))} stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="5 4" />`
        : null}
      ${pts.map((p) => html`<circle cx=${x(p.t)} cy=${y(p.w)} r="2.6" fill="var(--ghost)"><title>${fmtDay(p.date)}: ${fmtNum(p.w, 1)} кг</title></circle>`)}
      <path d=${line} fill="none" stroke="var(--iron)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />
      ${marks.map((m, i) => html`<text x=${x(m.t)} y=${H - 5} text-anchor=${i === 0 ? 'start' : i === marks.length - 1 ? 'end' : 'middle'} font-size="11" fill="var(--steel)">${fmtDayShort(m.date)}</text>`)}
    </svg>
    <figcaption class="chart__legend">
      <span><i class="legend-dot"></i>взвешивания</span>
      <span><i class="legend-line"></i>среднее 7 дней</span>
      ${corridor ? html`<span><i class="legend-band"></i>коридор цели</span>` : null}
    </figcaption>
  </figure>`;
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

// The automations in «Команды» went quiet: an informative note with what came last and how to check.
export function HealthQuiet() {
  const st = app.store.state;
  const d = healthDelivery({ ingest: st.kv.ingest, body: st.body.values(), sleep: st.sleep.values() });
  if (!d.quiet) return null;
  const at = (ms) => `${fmtDay(isoDate(new Date(ms)))}, ${fmtTime(ms)}`;
  return html`<div class="notice notice--caution" role="status" aria-label="Данные из «Здоровья»">
    <h3>Данные из «Здоровья» не приходят</h3>
    <p>${describeDelivery(d, { fmt: at })} Если вы взвешивались или спали с часами, проверьте автоматизации.</p>
    <div class="btn-row"><button type="button" class="btn" onClick=${() => openSheet((close) => html`<${HealthCheckSheet} onClose=${close} />`)}>Как проверить</button></div>
  </div>`;
}

function HealthCheckSheet({ onClose }) {
  return html`<${Sheet} title="Проверить «Команды»" onClose=${onClose}>
    <ol class="steps">
      <li>Разблокируйте iPhone: пока он заблокирован, iOS не даёт читать «Здоровье», и автоматизация по времени может не сработать.</li>
      <li>Откройте «Команды» → вкладка «Автоматизация». Автоматизации для Zepp Life и Fitdays+ («Закрыто») и ежедневная («Время суток») должны быть на месте, с «Запускать сразу» и командой «Здоровье → таблица».</li>
      <li>Запустите команду «Здоровье → таблица» вручную на вкладке «Команды» и вернитесь в приложение: оно синхронизируется само, и это предупреждение пропадёт.</li>
      <li>В таблице на листе App_HealthLog появится строка с временем запуска и числом строк — значения туда не пишутся. Если в ней есть ошибка, она названа словами.</li>
    </ol>
    <p class="muted" style="font-size:13px">Подробно — docs/SHORTCUTS.md в репозитории.</p>
  <//>`;
}
