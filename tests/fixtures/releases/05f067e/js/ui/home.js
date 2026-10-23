// "Today" when no workout is running: what's next, what was done last time, one big Start.

import { html, useState, app, Icon, Sheet, openSheet, SyncBadge, fmtWeight } from './core.js';
import { derived } from './derive.js';
import { nextWorkout, findSameSlotSession, itemsForDay, itemTarget } from '../lib/planner.js';
import { PHASE, phaseSummary, fmtTarget, fmtRange } from '../lib/program.js';
import { previousExposures } from '../lib/plateau.js';
import { isoDate, fmtDay, fmtDayWeekday, plural } from '../lib/util.js';
import { CycleWeekDay } from './workout.js';
import { pendingFix, applyFix, revertFix } from '../data/fixes.js';

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

    <${ImportNotice} />
    <${FixNotice} />

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

    <div class="sheet__section">
      <div class="sheet__label">Восстановление сегодня (необязательно)</div>
      <div class="scale" role="group" aria-label="Восстановление сегодня">
        ${[1, 2, 3, 4, 5].map((n) => html`<button type="button" aria-pressed=${String(metricToday?.recovery === n)}
          onClick=${() => app.store.saveMetric(today, { recovery: metricToday?.recovery === n ? null : n })}>${n}</button>`)}
      </div>
    </div>

    <div class="home-actions">
      <button type="button" class="link" onClick=${() => openStart(plan, days, setPick, false)}>Другой день или неделя</button>
      <button type="button" class="link" onClick=${() => openStart(plan, days, null, true, start)}>Записать прошедшую тренировку</button>
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

// Shown once after the bundled import from the old Google Sheet: what came in, what was skipped.
function ImportNotice() {
  const r = app.store.state.kv.importNotice;
  if (!r || r.seen) return null;
  const dismiss = () => app.store.setKV({ importNotice: { ...r, seen: true } });
  const session = app.store.state.sessions.get('gs-s5');
  if (r.problems?.length) {
    return html`<div class="notice notice--caution">
      <h3>Перенос из Google Таблицы не выполнен</h3>
      <p>${r.problems.join('; ')}</p>
      <div class="btn-row"><button type="button" class="btn" onClick=${dismiss}>Понятно</button></div>
    </div>`;
  }
  const lines = [];
  if (r.program) lines.push('программа: 4 дня, 3-недельный цикл, варианты упражнений');
  if (r.sessions) lines.push(`тренировка 16 октября: ${r.sets} подходов`);
  if (r.metrics) lines.push('вес тела и сон за 16 октября');
  return html`<div class="notice">
    <h3>Перенесено из Google Таблицы</h3>
    <p>${lines.length ? lines.join('; ') + '.' : 'Новых данных нет.'} Исходные таблицы не изменялись.</p>
    ${r.skipped.map((s) => html`<p>${s}</p>`)}
    <div class="btn-row">
      ${session && !session.deleted
        ? html`<button type="button" class="btn" onClick=${() => { dismiss(); app.ui.go({ view: { type: 'session', id: session.id } }); }}>Открыть 16 октября</button>`
        : null}
      <button type="button" class="btn" onClick=${dismiss}>Понятно</button>
    </div>
  </div>`;
}

// The 18.10.2026 correction: shown on a device that has those records as recorded, until the
// owner applies it here (or another device's correction arrives through sync). Nothing changes
// before «Исправить».
let fixLater = false;
let fixBusy = false;
function FixNotice() {
  const [, rerender] = useState(0);
  const plan = fixLater ? null : pendingFix(app.store.state);
  if (!plan) return null;
  const apply = async () => {
    if (fixBusy) return;
    fixBusy = true;
    rerender((x) => x + 1);
    try {
      const res = await applyFix(app.store);
      if (res) {
        const what = [res.sets ? `${res.sets} ${plural(res.sets, 'подход', 'подхода', 'подходов')}` : '', res.program ? 'программа дня 2' : ''].filter(Boolean).join(', ');
        app.ui.toast(`Исправлено: ${what}`, {
          ms: 15000,
          action: { label: 'Отменить', fn: () => revertFix(app.store).catch((err) => app.ui.toast(`Не удалось отменить: ${err.message}`)) },
        });
      }
    } catch (err) {
      app.ui.toast(`Исправлено не всё: ${err.message}. Нажмите «Исправить» ещё раз — остальное доделается.`, { ms: 10000 });
    } finally {
      fixBusy = false;
      rerender((x) => x + 1);
    }
  };
  return html`<div class="notice notice--caution fix" aria-label="Исправление тренировки 18 октября">
    <h3>Исправить тренировку 18 октября</h3>
    ${plan.moves.length
      ? html`<p>Записано под упражнениями программы, а сделано на других тренажёрах. Подходы перейдут в серии того, что было сделано. Веса, повторения, RIR и дата не меняются.</p>`
      : html`<p>Подходы уже перенесены, но в программе нет этих вариантов — вероятно, программу изменили на другом устройстве до синхронизации.</p>`}
    <ul class="fix__list">
      ${plan.moves.map((m) => html`<li>
        <span class="fix__what"><span class="fix__from">${m.from.name}</span> → <b>${m.to.name}</b></span>
        <span class="fix__sets">${m.sets.length ? m.sets.map((x) => `${fmtWeight(x.weight, m.item.category)}×${x.reps}`).join(', ') : 'подходы уже перенесены, осталось название упражнения'}</span>
      </li>`)}
    </ul>
    ${plan.skipped.map((m) => html`<p>«${m.from.name}»: в этом упражнении есть подходы, записанные после тренировки, — его не трогаю. При необходимости — «Заменить» в этой тренировке.</p>`)}
    ${plan.program
      ? html`<p>Программа, день 2: основными станут «Гиперэкстензия в тренажере» и «Тяга штанги к подбородку в Смите», прежние варианты останутся альтернативами. К кроссоверу добавятся «Обратная бабочка двумя руками» и «одной рукой».</p>`
      : null}
    <p>Перед изменением на телефоне сохраняется резервная копия, после — можно отменить.</p>
    <div class="btn-row">
      <button type="button" class="btn btn--primary" disabled=${fixBusy} onClick=${apply}>Исправить</button>
      <button type="button" class="btn" onClick=${() => { fixLater = true; rerender((x) => x + 1); }}>Позже</button>
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
