// Progress: what needs attention, then per-exercise history with every working set.

import { html, useState, app, Icon, Plate, Seg, fmtWeight, SetText, local } from './core.js';
import { RecordsOverview, openRecordSheet } from './records.js';
import { derived, latestBodyweight } from './derive.js';
import { overview, seriesStatus, STATUS } from '../lib/plateau.js';
import { CATEGORY } from '../lib/program.js';
import { fmtDay, fmtDayShort, fmtNum, median } from '../lib/util.js';
import { describeComparison } from './describe.js';

export function StatusLabel({ status }) {
  const s = STATUS[status];
  return html`<span class=${'status status--' + s.tone}><span class="status__glyph" aria-hidden="true">${s.glyph}</span>${s.label}</span>`;
}

// «Прогресс» and «Рекорды» share one tab: a fifth tab would be too tight on a 320-pt iPhone.
export function ProgressList() {
  const [mode, setModeRaw] = useState(() => (local.get('progress.mode') === 'records' ? 'records' : 'progress'));
  const setMode = (m) => {
    local.set('progress.mode', m);
    setModeRaw(m);
    document.querySelector('.screen')?.scrollTo?.(0, 0);
  };
  const switcher = html`<${Seg} fill label="Раздел" value=${mode} onChange=${setMode}
    options=${[{ value: 'progress', label: 'Прогресс' }, { value: 'records', label: 'Рекорды' }]} />`;
  if (mode === 'records') {
    return html`<main class="screen">
      <header class="topbar topbar--large"><h1>Рекорды</h1>
        <button type="button" class="icon-btn icon-btn--accent" aria-label="Добавить рекорд" onClick=${() => openRecordSheet({})}><${Icon} name="plus" /></button>
      </header>
      ${switcher}
      <div style="margin-top:12px"><${RecordsOverview} /></div>
    </main>`;
  }
  return html`<${ProgressPane} switcher=${switcher} />`;
}

function ProgressPane({ switcher }) {
  const { series, categories } = derived();
  const rows = overview(series, { categoryOf: (k) => categories.get(k), bodyweight: latestBodyweight() });
  const attention = rows.filter((r) => STATUS[r.status].rank <= STATUS.dip.rank);
  const rest = rows.filter((r) => STATUS[r.status].rank > STATUS.dip.rank);
  const open = (key) => app.ui.go({ view: { type: 'exercise', key } });

  const item = (r) => {
    const last = r.result.counted[r.result.counted.length - 1];
    const d = last?.cmp ? describeComparison({ ...last.cmp, verdict: last.effective }) : null;
    return html`<li><button type="button" class="row" onClick=${() => open(r.key)}>
      <span class="row__title">${r.name}</span>
      <${StatusLabel} status=${r.status} />
      <span class="row__sub">${d
        ? `Неделя ${last.exposure.week}, ${fmtDay(last.exposure.date)}: ${d.short}`
        : `${r.sessions} ${r.sessions === 1 ? 'тренировка' : 'тренировки'}, последняя ${fmtDay(r.last.date)}`}</span>
    </button></li>`;
  };

  return html`<main class="screen">
    <header class="topbar topbar--large"><h1>Прогресс</h1></header>
    ${switcher}
    <div style="margin-top:12px"></div>
    ${rows.length === 0
      ? html`<div class="empty">
          <h2>Пока нечего сравнивать</h2>
          <p>После первой тренировки здесь появится история упражнений, а когда неделя цикла повторится — сравнение с ней.</p>
        </div>`
      : html`
        <p class="muted" style="font-size:14px">Сравниваются одинаковые недели цикла: вторая со второй, третья с третьей. Все рабочие подходы, с учётом RIR, боли и техники. Лёгкая неделя в оценку не входит.</p>
        ${attention.length ? html`<h2 class="section-title">Требует внимания</h2><ul class="rows">${attention.map(item)}</ul>` : null}
        ${rest.length ? html`<h2 class="section-title">${attention.length ? 'Остальные' : 'Упражнения'}</h2><ul class="rows">${rest.map(item)}</ul>` : null}
      `}
  </main>`;
}

export function ExerciseDetail({ seriesKey }) {
  const { series, categories } = derived();
  const list = series.get(seriesKey) || [];
  const done = list.filter((e) => !e.active);
  const category = categories.get(seriesKey) || list[list.length - 1]?.category || null;
  const bw = latestBodyweight();
  const result = seriesStatus(done, { category, bodyweight: bw });
  const [filter, setFilter] = useState('heavy');
  const weeksIn = new Set(list.map((e) => e.week));
  const shown = list.filter((e) => (filter === 'heavy' ? e.week !== 1 : e.week === filter));
  const byExposure = new Map(result.comparisons.map((c) => [c.exposure, c]));
  const name = list[list.length - 1]?.name || seriesKey;

  return html`<main class="screen">
    <header class="topbar">
      <button type="button" class="icon-btn" aria-label="Назад" onClick=${() => app.ui.back()}><${Icon} name="back" /></button>
      <h1>${name}</h1>
    </header>
    <div class="callout">
      <div class="callout__head"><${StatusLabel} status=${result.status} /></div>
      ${result.reasons.length ? html`<ul>${result.reasons.map((r) => html`<li>${r}</li>`)}</ul>` : null}
      ${category ? html`<p class="muted" style="font-size:13px;margin-top:6px">${CATEGORY[category]?.label || ''}. Альтернативные варианты упражнения — отдельные серии.</p>` : null}
    </div>

    <${Seg} label="Фаза" value=${filter} onChange=${setFilter}
      options=${[
        { value: 'heavy', label: 'Тяжёлые' },
        ...[2, 3, 1].filter((w) => weeksIn.has(w)).map((w) => ({ value: w, label: html`<${Plate} week=${w} size="sm" /> неделя` })),
      ]} />

    <div style="margin:12px 0 4px">
      <${SetsChart} exposures=${shown} category=${category} />
    </div>

    <h2 class="section-title">Все тренировки</h2>
    ${shown.length === 0 ? html`<p class="muted">В этой фазе пока нет тренировок.</p>` : null}
    ${[...shown].reverse().map((e) => {
      const c = byExposure.get(e);
      const d = c?.cmp ? describeComparison({ ...c.cmp, verdict: c.effective || c.cmp.verdict }) : null;
      return html`<div class="expo">
        <div class="expo__head">
          <${Plate} week=${e.week} size="sm" />
          <button type="button" class="expo__date link" style="padding:0" onClick=${() => app.ui.go({ view: { type: 'session', id: e.sessionId } })}>${fmtDay(e.date)}</button>
          <span class="muted">цикл ${e.cycle}, день ${e.day}${e.active ? ', в процессе' : ''}</span>
        </div>
        <div class="expo__sets">
          ${e.sets.map((s) => html`<${SetText} set=${s} category=${category} />`)}
          ${e.drops.map((s) => html`<span class="drop"><${SetText} set=${s} category=${category} /></span>`)}
        </div>
        ${d
          ? html`<div class="expo__cmp"><span class=${'delta--' + d.tone}>${d.word}</span> — ${d.detail}; к ${fmtDay(c.cmp.prev.date)}</div>`
          : null}
        ${c?.notes?.length ? html`<div class="expo__cmp">${c.notes.join('; ')}</div>` : null}
        ${e.note ? html`<div class="expo__cmp">${e.note}</div>` : null}
      </div>`;
    })}
  </main>`;
}

// ---------------------------------------------------------------- chart

const W = 340;
const H = 190;
const M = { l: 34, r: 12, t: 12, b: 26 };

function value(set, category) {
  if (category === 'pullup') return set.weight || 0;
  return (set.weight || 0) * (1 + (set.reps || 0) / 30);
}

function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const start = Math.floor(lo / step) * step;
  const out = [];
  for (let v = start; v <= hi + step * 0.001; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

// Every working set as a dot (not only the best one), the median of each workout as a line.
// One y-axis; weeks are separate series (blue = week 2, red = week 3, green ring = week 1).
export function SetsChart({ exposures, category }) {
  const [tip, setTip] = useState(null);
  const pts = exposures.filter((e) => e.sets.length);
  if (category === 'pullup' && !pts.some((e) => e.sets.some((s) => s.weight > 0))) {
    return html`<div class="chart chart-empty">Подтягивания с собственным весом: прогресс виден по повторениям в списке ниже. График появится, когда добавите вес.</div>`;
  }
  if (pts.length < 2) {
    return html`<div class="chart chart-empty">График появится после двух тренировок в выбранной фазе.</div>`;
  }
  const vals = pts.flatMap((e) => e.sets.map((s) => value(s, category)));
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo) * 0.12 || hi * 0.05 || 1;
  lo = Math.max(0, lo - pad);
  hi += pad;
  const ticks = niceTicks(lo, hi);
  lo = Math.min(lo, ticks[0]);
  hi = Math.max(hi, ticks[ticks.length - 1]);
  const x = (i) => M.l + (pts.length === 1 ? (W - M.l - M.r) / 2 : (i * (W - M.l - M.r)) / (pts.length - 1));
  const y = (v) => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);
  const weeks = [...new Set(pts.map((e) => e.week))].sort();
  const lines = weeks.map((w) => {
    const ps = pts.map((e, i) => ({ e, i })).filter((p) => p.e.week === w);
    const d = ps.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(median(p.e.sets.map((s) => value(s, category)))).toFixed(1)}`).join(' ');
    return { w, d, n: ps.length };
  });
  const labelEvery = Math.max(1, Math.ceil(pts.length / 5));
  const sel = tip != null && pts[tip] ? tip : pts.length - 1;
  const show = (i, ev) => {
    setTip(i);
    ev?.stopPropagation?.();
  };
  return html`<figure class="chart" style="margin:0">
    ${weeks.length > 1
      ? html`<div class="chart__legend">${weeks.map((w) => html`<span><span class="chart__key" style=${`color:var(--plate-${w})`}></span>неделя ${w}</span>`)}</div>`
      : null}
    <svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${category === 'pullup' ? 'Дополнительный вес по подходам' : 'Расчётный максимум каждого рабочего подхода, кг'}>
      ${ticks.map((t) => html`<g>
        <line x1=${M.l} x2=${W - M.r} y1=${y(t)} y2=${y(t)} stroke="var(--hairline)" stroke-width="1" />
        <text x=${M.l - 6} y=${y(t) + 4} text-anchor="end" font-size="11" fill="var(--steel)">${fmtNum(t, 0)}</text>
      </g>`)}
      ${pts.map((e, i) => (i % labelEvery === 0 || i === pts.length - 1
        ? html`<text x=${x(i)} y=${H - 6} text-anchor="middle" font-size="11" fill="var(--steel)">${fmtDayShort(e.date)}</text>`
        : null))}
      <rect x=${x(sel) - 14} y=${M.t} width="28" height=${H - M.t - M.b} rx="6" fill="var(--press)" />
      ${lines.map((l) => (l.n > 1 ? html`<path d=${l.d} fill="none" stroke=${`var(--plate-${l.w})`} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />` : null))}
      ${pts.map((e, i) => e.sets.map((s) => html`<circle cx=${x(i)} cy=${y(value(s, category))} r="4.5"
        fill=${e.week === 1 ? 'var(--paper)' : `var(--plate-${e.week})`} stroke=${e.week === 1 ? 'var(--plate-1)' : 'var(--paper)'} stroke-width="2" />`))}
      ${pts.map((e, i) => html`<rect x=${x(i) - 14} y=${M.t} width="28" height=${H - M.t - M.b} fill="transparent"
        tabindex="0" role="button" aria-label=${`${fmtDay(e.date)}, неделя ${e.week}`}
        onClick=${(ev) => show(i, ev)} onFocus=${() => show(i)} />`)}
    </svg>
    <div class="chart__readout" aria-live="polite">
      ${fmtDay(pts[sel].date)}, неделя ${pts[sel].week}${tip == null ? ' (последняя; нажмите на столбец, чтобы выбрать)' : ''}
      <strong>${pts[sel].sets.map((s) => `${fmtWeight(s.weight, category)}×${s.reps}`).join('   ')}</strong>
    </div>
    <figcaption class="muted" style="font-size:12px;padding:2px 8px 4px">${category === 'pullup'
      ? 'Точки — дополнительный вес каждого подхода, линия — медиана тренировки.'
      : 'Точки — каждый рабочий подход (расчётный максимум по весу и повторениям), линия — медиана тренировки.'}</figcaption>
  </figure>`;
}
