// "Today" when no workout is running: what's next, what was done last time, one big Start.

import { html, useState, app, Icon, Sheet, openSheet, SyncBadge, fmtWeight } from './core.js';
import { derived } from './derive.js';
import { nextWorkout, findSameSlotSession, itemsForDay, itemTarget } from '../lib/planner.js';
import { PHASE, phaseSummary, fmtTarget, fmtRange } from '../lib/program.js';
import { previousExposures } from '../lib/plateau.js';
import { isoDate, fmtDay, fmtDayWeekday, plural } from '../lib/util.js';
import { CycleWeekDay } from './workout.js';
import { pendingFixes, applyFix, revertFix } from '../data/fixes.js';

export function Home({ syncStatus }) {
  const st = app.store.state;
  const { series, sessions } = derived();
  const days = st.program.days.map((d) => d.day);
  const auto = nextWorkout(sessions, days);
  const [pick, setPick] = useState(null);
  const plan = pick || { ...auto, date: isoDate() };
  const items = itemsForDay(st.program, plan.day);
  const dup = findSameSlotSession(sessions, plan);
  const today = isoDate();

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

    <${FixNotices} />

    ${st.program.draft
      ? html`<div class="notice notice--caution">
          <h3>Перенесите программу</h3>
          <p>Сейчас в программе только подтягивания. Если программа и тренировки уже есть в Google Таблице — подключите синхронизацию в настройках, и всё загрузится оттуда. Иначе добавьте упражнения один раз: вставьте текстом или соберите в редакторе.</p>
          <div class="btn-row">
            <button type="button" class="btn" onClick=${() => app.ui.go({ view: { type: 'settings' } })}>Синхронизация</button>
            <button type="button" class="btn" onClick=${() => app.ui.go({ view: { type: 'program-import' } })}>Вставить текстом</button>
            <button type="button" class="btn" onClick=${() => app.ui.go({ view: { type: 'program' } })}>Редактор</button>
          </div>
        </div>`
      : null}

    <section class="next" aria-label="Следующая тренировка">
      <div class="next__date">${pick ? 'Выбрано вручную' : 'Следующая по плану'}</div>
      <h2 class="next__title">День ${plan.day}</h2>
      <div class="next__meta">Цикл ${plan.cycle}. ${PHASE[plan.week].title}: ${phaseSummary(plan.week)}</div>
      <${CycleMap} plan=${plan} days=${days} sessions=${sessions} />
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

    <div class="home-actions">
      <button type="button" class="link" onClick=${() => openStart(plan, days, setPick, false)}>Другой день или неделя</button>
      <button type="button" class="link" onClick=${() => openStart(plan, days, null, true, start)}>Записать прошедшую тренировку</button>
      <button type="button" class="link" onClick=${() => app.ui.go({ view: { type: 'report' } })}>Отчёт за неделю</button>
    </div>
    <div class="start-bar">
      <button type="button" class="btn btn--primary btn--block btn--big" onClick=${() => start()}>Начать тренировку</button>
    </div>
  </main>`;
}

// Where the next workout sits in the cycle: three weeks (light, 8–10, 6–8), a pip per day.
// Filled pips are workouts done in this cycle, the amber one is the next; a missed day stays empty.
function CycleMap({ plan, days, sessions }) {
  const done = new Set(sessions.filter((s) => !s.deleted && s.status === 'done' && s.cycle === plan.cycle).map((s) => `${s.week}:${s.day}`));
  const count = [1, 2, 3].reduce((n, w) => n + days.filter((d) => done.has(`${w}:${d}`)).length, 0);
  const label = `Цикл ${plan.cycle}: неделя ${plan.week} из 3, день ${days.indexOf(plan.day) + 1} из ${days.length}. В этом цикле выполнено тренировок: ${count} из ${days.length * 3}.`;
  return html`<div class="cycle" role="img" aria-label=${label}>
    ${[1, 2, 3].map((w) => html`<div class=${`cycle__week cycle__week--w${w}` + (w === plan.week ? ' cycle__week--now' : '')}>
      <div class="cycle__name">Неделя ${w}</div>
      <div class="cycle__what">${w === 1 ? 'лёгкая' : `${fmtRange(PHASE[w].reps)} повт.`}</div>
      <div class="cycle__days">
        ${days.map((d) => html`<i class=${done.has(`${w}:${d}`) ? 'done' : w === plan.week && d === plan.day ? 'next' : ''}></i>`)}
      </div>
    </div>`)}
  </div>`;
}

// One-time corrections of recorded data (data/fixes.js): each is shown on a device that has those
// records as recorded, until the owner applies it here (or another device's correction arrives
// through sync). Nothing changes before «Исправить».
const fixLater = new Set();
let fixBusy = false;
function FixNotices() {
  const pending = pendingFixes(app.store.state).filter((x) => !fixLater.has(x.fix.id));
  return pending.map(({ fix, plan }) => html`<${FixNotice} key=${fix.id} fix=${fix} plan=${plan} />`);
}

function FixNotice({ fix, plan }) {
  const [, rerender] = useState(0);
  if (fixLater.has(fix.id)) return null;
  const apply = async () => {
    if (fixBusy) return;
    fixBusy = true;
    rerender((x) => x + 1);
    try {
      const res = await applyFix(app.store, fix);
      if (res) {
        const what = [res.sets ? `${res.sets} ${plural(res.sets, 'подход', 'подхода', 'подходов')}` : '', res.program ? (fix.day ? `программа дня ${fix.day}` : 'программа') : ''].filter(Boolean).join(', ');
        app.ui.toast(`Исправлено: ${what}`, {
          ms: 15000,
          action: { label: 'Отменить', fn: () => revertFix(app.store, fix).catch((err) => app.ui.toast(`Не удалось отменить: ${err.message}`)) },
        });
      }
    } catch (err) {
      app.ui.toast(`Исправлено не всё: ${err.message}. Нажмите «Исправить» ещё раз — остальное доделается.`, { ms: 10000 });
    } finally {
      fixBusy = false;
      rerender((x) => x + 1);
    }
  };
  const many = new Set(plan.moves.map((m) => m.sessionId)).size > 1;
  return html`<div class="notice notice--caution fix" aria-label=${fix.label}>
    <h3>${fix.title}</h3>
    ${plan.moves.length || !fix.moves.length
      ? html`<p>${fix.why}${plan.moves.length ? ' Веса, повторения, RIR и дата не меняются.' : ''}</p>`
      : html`<p>Подходы уже перенесены, но в программе нет этих вариантов — вероятно, программу изменили на другом устройстве до синхронизации.</p>`}
    ${plan.moves.length ? html`<ul class="fix__list">
      ${plan.moves.map((m) => html`<li>
        <span class="fix__what">${many ? html`<span class="fix__date">${fmtDay(m.date)}: </span>` : null}<span class="fix__from">${m.from.name}</span> → <b>${m.to.name}</b></span>
        <span class="fix__sets">${m.sets.length ? m.sets.map((x) => `${fmtWeight(x.weight, m.item.category)}×${x.reps}`).join(', ') : 'подходы уже перенесены, осталось название упражнения'}</span>
      </li>`)}
    </ul>` : null}
    ${plan.skipped.map((m) => html`<p>«${m.from.name}»: в этом упражнении есть подходы, записанные после тренировки, — его не трогаю. При необходимости — «Заменить» в этой тренировке.</p>`)}
    ${plan.program ? html`<p>${fix.programText}</p>` : null}
    <p>Перед изменением на телефоне сохраняется резервная копия, после — можно отменить.</p>
    <div class="btn-row">
      <button type="button" class="btn btn--primary" disabled=${fixBusy} onClick=${apply}>Исправить</button>
      <button type="button" class="btn" onClick=${() => { fixLater.add(fix.id); rerender((x) => x + 1); }}>Позже</button>
    </div>
  </div>`;
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
  const footer = html`<button type="button" class="btn btn--primary btn--big" disabled=${past && !v.date}
    onClick=${() => onPick(v)}>${past ? 'Открыть для записи' : 'Выбрать'}</button>`;
  return html`<${Sheet} title=${past ? 'Прошедшая тренировка' : 'Выбрать тренировку'} onClose=${onClose} footer=${footer}>
    ${past
      ? html`<div class="sheet__section">
          <div class="sheet__label">Дата тренировки</div>
          <input class="input" type="date" max=${isoDate()} value=${v.date} onInput=${(e) => setV({ ...v, date: e.currentTarget.value })} />
        </div>`
      : null}
    <${CycleWeekDay} value=${v} days=${days} onChange=${setV} />
    ${dup ? html`<p class="warn-line">Уже есть: ${fmtDay(dup.date)}. Будет ещё одна тренировка с теми же отметками.</p>` : null}
  <//>`;
}
