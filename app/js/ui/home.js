// "Today" when no workout is running: what's next, what was done last time, one big Start.

import { html, useState, app, Icon, Plate, Sheet, openSheet, SyncBadge, fmtWeight } from './core.js';
import { derived } from './derive.js';
import { nextWorkout, findSameSlotSession, itemsForDay, itemTarget } from '../lib/planner.js';
import { PHASE, phaseSummary, fmtTarget } from '../lib/program.js';
import { previousExposures } from '../lib/analytics.js';
import { isoDate, fmtDay, fmtDayWeekday } from '../lib/util.js';
import { CycleWeekDay } from './workout.js';

export function Home({ syncStatus }) {
  const st = app.store.state;
  const { series, sessions } = derived();
  const days = st.program.days.map((d) => d.day);
  const auto = nextWorkout(sessions, days.length || 4);
  const [pick, setPick] = useState(null);
  const plan = pick || { ...auto, date: isoDate() };
  const items = itemsForDay(st.program, plan.day);
  const dup = findSameSlotSession(sessions, plan);
  const today = isoDate();
  const metricToday = st.metrics.get(`m${today}`);

  const start = async (p = plan) => {
    const s = await app.store.startSession(p);
    app.ui.go({ tab: 'today', view: null });
    return s;
  };

  return html`<main class="screen">
    <header class="topbar">
      <span class="topbar__date">${fmtDayWeekday(today)}</span>
      <${SyncBadge} status=${syncStatus} onClick=${() => app.ui.go({ view: { type: 'settings' } })} />
      <button type="button" class="icon-btn" aria-label="Настройки" onClick=${() => app.ui.go({ view: { type: 'settings' } })}><${Icon} name="gear" /></button>
    </header>

    ${st.program.draft
      ? html`<div class="notice notice--caution">
          <h3>Перенесите программу</h3>
          <p>Сейчас в программе только подтягивания. Добавьте упражнения из исходной программы — один раз: вставьте текстом или соберите в редакторе.</p>
          <div class="btn-row">
            <button type="button" class="btn" onClick=${() => app.ui.go({ view: { type: 'program-import' } })}>Вставить текстом</button>
            <button type="button" class="btn" onClick=${() => app.ui.go({ view: { type: 'program' } })}>Редактор</button>
          </div>
        </div>`
      : null}

    <section class="next" aria-label="Следующая тренировка">
      <${Plate} week=${plan.week} size="hero" />
      <div>
        <div class="next__date">${pick ? 'Выбрано вручную' : 'Следующая по плану'}</div>
        <h2 class="next__title">День ${plan.day}</h2>
        <div class="next__meta">Цикл ${plan.cycle}. ${PHASE[plan.week].title}: ${phaseSummary(plan.week)}</div>
      </div>
    </section>

    ${dup ? html`<p class="warn-line" style="margin:-8px 0 12px">Такая тренировка уже записана: ${fmtDay(dup.date)}. Проверьте день и неделю.</p>` : null}

    <ul class="plan-list" aria-label="Упражнения">
      ${items.map((it) => {
        const p = previousExposures(series.get(it.seriesKey), { week: plan.week, sessionId: '', date: plan.date });
        const ref = p.samePhase || p.latest;
        return html`<li>
          <span class="plan-list__name">${it.name}</span>
          <span class="plan-list__target">${fmtTarget(itemTarget(it, plan.week))}</span>
          <span class="plan-list__prev">${ref
            ? `${p.samePhase ? 'прошлый раз на этой неделе' : `последний раз (неделя ${ref.week})`}: ${ref.sets.map((s) => `${fmtWeight(s.weight, it.category)}×${s.reps}`).join(', ')}`
            : 'ещё не выполнялось'}</span>
        </li>`;
      })}
    </ul>

    <div class="sheet__section">
      <div class="sheet__label">Восстановление сегодня (необязательно)</div>
      <div class="scale" role="group" aria-label="Восстановление сегодня">
        ${[1, 2, 3, 4, 5].map((n) => html`<button type="button" aria-pressed=${String(metricToday?.recovery === n)}
          onClick=${() => app.store.saveMetric(today, { recovery: metricToday?.recovery === n ? null : n })}>${n}</button>`)}
      </div>
    </div>

    <button type="button" class="btn btn--primary btn--block btn--big" onClick=${() => start()}>Начать тренировку</button>
    <div class="home-actions">
      <button type="button" class="link" onClick=${() => openStart(plan, days, setPick, false)}>Другой день или неделя</button>
      <button type="button" class="link" onClick=${() => openStart(plan, days, null, true, start)}>Записать прошедшую тренировку</button>
    </div>
  </main>`;
}

function openStart(plan, days, setPick, past, start) {
  openSheet((close) => html`<${StartSheet} plan=${plan} days=${days} past=${past} onClose=${close}
    onPick=${(p) => {
      if (past) start(p);
      else setPick(p);
      close();
    }} />`);
}

function StartSheet({ plan, days, past, onPick, onClose }) {
  const [v, setV] = useState({ ...plan, date: past ? '' : plan.date });
  const dup = findSameSlotSession(derived().sessions, v);
  return html`<${Sheet} title=${past ? 'Прошедшая тренировка' : 'Выбрать тренировку'} onClose=${onClose}>
    ${past
      ? html`<div class="sheet__section">
          <div class="sheet__label">Дата тренировки</div>
          <input class="input" type="date" max=${isoDate()} value=${v.date} onInput=${(e) => setV({ ...v, date: e.currentTarget.value })} />
        </div>`
      : null}
    <${CycleWeekDay} value=${v} days=${days} onChange=${setV} />
    ${dup ? html`<p class="warn-line">Уже есть: ${fmtDay(dup.date)}. Будет ещё одна тренировка с теми же отметками.</p>` : null}
    <button type="button" class="btn btn--primary btn--block btn--big" style="margin-top:14px" disabled=${past && !v.date}
      onClick=${() => onPick(v)}>${past ? 'Открыть для записи' : 'Выбрать'}</button>
  <//>`;
}
