// «Отчёт за неделю»: the last full calendar week and the 4 weeks up to it, computed on the phone from
// what is stored here (lib/report.js). Works offline; leaves the phone only if copied.

import { html, app, Icon, copyText } from './core.js';
import { derived } from './derive.js';
import { weeklyReport, reportText } from '../lib/report.js';
import { dailyWeights, sleepNights } from '../lib/bodydata.js';
import { fmtDay, isoDate } from '../lib/util.js';

export function buildReport(today = isoDate()) {
  const st = app.store.state;
  const { series, sessions, shareOf } = derived();
  const metrics = [...st.metrics.values()];
  return weeklyReport({
    today,
    sessions,
    series,
    program: st.program,
    days: dailyWeights(st.body.values(), metrics).days,
    body: [...st.body.values()],
    nights: sleepNights(st.sleep.values(), metrics).nights,
    nutrition: [...st.nutrition.values()],
    goals: [...st.nutritionGoals.values()],
    phases: [...st.phases.values()],
    shareOf,
    nameOf: (key, e) => e?.name || key,
  });
}

export function Report() {
  const r = buildReport();
  const parts = [
    ['Тренировки', r.training.lines],
    ['Тело', r.body.lines],
    ['Питание', r.nutrition.lines],
    ['Сон', r.sleep.lines],
  ];
  return html`<main class="screen">
    <header class="topbar">
      <button type="button" class="icon-btn" aria-label="Назад" onClick=${() => app.ui.back()}><${Icon} name="back" /></button>
      <h1>Отчёт за неделю</h1>
    </header>
    <p class="muted report-period">${fmtDay(r.week.from)} — ${fmtDay(r.week.to)}: последняя полная неделя, сравнения — с той же неделей цикла и за 4 недели. Считается на телефоне, без сети.</p>
    ${parts.map(([title, lines]) => html`<section class="notice report-part" aria-label=${title}>
      <h3>${title}</h3>
      <ul class="nutr-lines">${lines.map((l) => html`<li>${l}</li>`)}</ul>
    </section>`)}
    <div class="btn-row">
      <button type="button" class="btn btn--primary btn--block" onClick=${() => copyText(reportText(r))}>Скопировать отчёт для ChatGPT</button>
    </div>
    <p class="muted nutr-small report-period">Копируется только этот текст: итоги и средние, без отдельных записей.</p>
  </main>`;
}
