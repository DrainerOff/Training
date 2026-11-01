// The workout screen — used between sets. Everything the hand needs is in the bottom dock.

import {
  html, useState, useEffect, app, Icon, WeekMark, Sheet, openSheet, NumberPad, Stepper, RirPicker, Toggle, Seg,
  fmtWeight, SyncBadge, useNow, local, confirmSheet,
} from './core.js';
import { derived, latestBodyweight, recordsDerived, exercisesNow } from './derive.js';
import { itemTarget, suggestNext } from '../lib/planner.js';
import { fmtTarget, PHASE, phaseSummary, CATEGORY, CATEGORY_KEYS, exerciseCatalog, makeOption } from '../lib/program.js';
import { previousExposures, compareExposures, weightDrop } from '../lib/plateau.js';
import { recommend, fmtLoad, BASIS } from '../lib/recommend.js';
import { searchExercises, findExact, setMainOption } from '../lib/exercises.js';
import { fmtNum, fmtDay, fmtDayShort, fmtDuration, plural, isoDate } from '../lib/util.js';
import { describeComparison } from './describe.js';
import { SETUP_MAX } from '../data/store.js';

const STALE_MS = 12 * 3600 * 1000;

function buildRows(session) {
  const { series, bodyweightAt, shareOf } = derived();
  return session.items.map((item) => {
    const sets = app.store.setsOf(session.id, item.slotId);
    const target = itemTarget(item, session.week);
    const list = series.get(item.seriesKey);
    const prevs = previousExposures(list, {
      week: session.week,
      sessionId: session.id,
      date: session.date,
      startedAt: session.startedAt,
      baseline: !!item.flags?.baseline,
    });
    // A suggestion beside «Прошлый раз», never written into the composer by itself.
    const rec = recommend({
      list, session, target, category: item.category, step: item.step || 2.5,
      share: shareOf(item.seriesKey, item.category), todaySets: sets, todayFlags: item.flags || {},
      bodyweightToday: bodyweightAt(session.date),
    });
    const working = sets.filter((s) => !s.drop).length;
    const drops = sets.length - working;
    const complete = !!item.skipped || (working >= target.sets && drops >= target.drop);
    return { item, sets, target, prevs, rec, working, drops, complete };
  });
}

export function Workout({ session, mode = 'live', syncStatus }) {
  const rows = buildRows(session);
  const activeKey = `active:${session.id}`;
  const [activeSlot, setActiveSlotRaw] = useState(() => local.get(activeKey));
  const setActive = (id) => {
    local.set(activeKey, id);
    setActiveSlotRaw(id);
  };
  const active = rows.find((r) => r.item.slotId === activeSlot) || rows.find((r) => !r.complete) || rows[0] || null;
  const live = mode === 'live';
  const stale = live && Date.now() - session.startedAt > STALE_MS;
  const phase = `var(--plate-${session.week})`;

  useWakeLock(live);

  const nextAfter = (slotId) => {
    const i = rows.findIndex((r) => r.item.slotId === slotId);
    return [...rows.slice(i + 1), ...rows.slice(0, i)].find((r) => !r.complete && r.item.slotId !== slotId) || null;
  };

  // Confirmation + undo live inside the dock for a few seconds, so nothing covers the list.
  const [justLogged, setJustLogged] = useState(null);
  useEffect(() => {
    if (!justLogged) return undefined;
    const t = setTimeout(() => setJustLogged(null), 5000);
    return () => clearTimeout(t);
  }, [justLogged]);

  const onLogged = (set, row) => {
    const working = row.working + (set.drop ? 0 : 1);
    const drops = row.drops + (set.drop ? 1 : 0);
    const nowComplete = working >= row.target.sets && drops >= row.target.drop;
    const undo = () => {
      app.store.deleteSet(set.id);
      setActive(row.item.slotId);
      setJustLogged(null);
    };
    let text = `Подход ${set.setNo} записан`;
    if (nowComplete && !row.complete) {
      const next = nextAfter(row.item.slotId);
      if (next) {
        setActive(next.item.slotId);
        text = `Готово: ${row.item.name}`;
      } else text = 'Все упражнения выполнены';
    }
    // A personal record is said right away (it also appears in Прогресс → Рекорды).
    const pr = recordsDerived().books.get(set.seriesKey)?.events.find((e) => e.perf.setId === set.id && e.kind === 'record');
    if (pr) text = `Новый рекорд: ${fmtWeight(set.weight, row.item.category)}×${set.reps}`;
    setJustLogged({ id: set.id, text, undo });
  };

  return html`
    <main class="screen screen--with-dock" style=${`--phase:${phase}`}>
      <header class="topbar wk-head">
        ${live ? null : html`<button type="button" class="icon-btn" onClick=${() => app.ui.back()} aria-label="Назад"><${Icon} name="back" /></button>`}
        <${WeekMark} week=${session.week} size="md" />
        <div class="wk-head__text">
          <div class="wk-head__title">День ${session.day}${session.date !== isoDate() ? `, ${fmtDay(session.date)}` : ''}</div>
        </div>
        <${SyncBadge} status=${syncStatus} onClick=${() => app.ui.go({ view: { type: 'settings' } })} />
        <button type="button" class="icon-btn" aria-label="Меню тренировки" onClick=${() => openSessionMenu(session, mode)}><${Icon} name="more" /></button>
      </header>
      <p class="wk-sub">Цикл ${session.cycle}, ${session.week === 1 ? 'лёгкая' : 'тяжёлая'} неделя ${session.week}: ${phaseSummary(session.week)}</p>

      ${stale
        ? html`<div class="notice notice--caution">
            <h3>Тренировка начата ${fmtDay(session.date)}</h3>
            <p>Если она уже закончена — завершите её, чтобы начать следующую.</p>
            <div class="btn-row"><button type="button" class="btn" onClick=${() => openFinish(session, rows)}>Завершить</button></div>
          </div>`
        : null}

      ${rows.length === 0
        ? html`<div class="empty"><h2>В этом дне нет упражнений</h2><p>Добавьте упражнение ниже или заполните программу в настройках.</p></div>`
        : null}

      <div>
        ${rows.map((r) =>
          active && r.item.slotId === active.item.slotId
            ? html`<${ExercisePanel} key=${r.item.slotId} row=${r} session=${session}
                next=${nextAfter(r.item.slotId)} onNext=${(id) => setActive(id)} />`
            : html`<${ExerciseRow} key=${r.item.slotId} row=${r} onOpen=${() => setActive(r.item.slotId)} />`,
        )}
      </div>

      <button type="button" class="btn btn--quiet btn--block" style="margin-top:8px" onClick=${() => openAddItem(session, setActive)}>
        <${Icon} name="plus" /> Добавить упражнение
      </button>

      <div class="finish">
        ${live
          ? html`<button type="button" class="btn btn--primary btn--block btn--big" onClick=${() => openFinish(session, rows)}>Завершить тренировку</button>`
          : html`<button type="button" class="btn btn--primary btn--block btn--big" onClick=${() => app.ui.back()}>Готово</button>`}
      </div>
    </main>
    ${active
      ? html`<${Dock} key=${`${active.item.slotId}:${active.sets.length}`} row=${active} session=${session} live=${live} onLogged=${onLogged} justLogged=${justLogged} />`
      : null}
  `;
}

function ExerciseRow({ row, onOpen }) {
  const { item, sets, target, complete, working } = row;
  const total = target.sets + target.drop;
  const p = Math.min(1, sets.length / total);
  const last = sets[sets.length - 1];
  return html`<div class="ex">
    <button type="button" class="ex__row" onClick=${onOpen} aria-label=${`${item.name}: ${sets.length} из ${total}`}>
      <span class=${'ex__check' + (complete ? ' ex__check--done' : sets.length ? ' ex__check--part' : '')} style=${`--p:${p}`}>
        ${complete ? html`<${Icon} name="check" />` : null}
      </span>
      <span>
        <span class="ex__name">${item.name}</span>
        ${item.skipped ? html`<span class="ex__alt">пропущено</span>` : last ? html`<span class="ex__alt">последний: ${fmtWeight(last.weight, item.category)} × ${last.reps}</span>` : html`<span class="ex__alt">${fmtTarget(target)}</span>`}
      </span>
      <span class="ex__count">${working}/${target.sets}</span>
    </button>
  </div>`;
}

function PrevHint({ prevs, session, category }) {
  const p = prevs.samePhase || prevs.latest;
  // Before a «новая точка отсчёта»: shown for reference when this week has no result since the mark.
  const old = !prevs.samePhase ? prevs.old : null;
  if (!p && !old) return html`<div class="prev"><div class="prev__label">Это упражнение ещё не выполнялось — начните с комфортного веса.</div></div>`;
  const sets = (e) => html`<div class="prev__sets" aria-label="Прошлый результат, подсказка">
    ${e.sets.map((s) => html`<span class="ghost">${fmtWeight(s.weight, category)}×${s.reps}${s.rir != null ? html`<small>RIR ${fmtNum(s.rir)}</small>` : null}</span>`)}
    ${e.drops.map((s) => html`<span class="ghost"><small>дроп</small> ${fmtWeight(s.weight, category)}×${s.reps}</span>`)}
  </div>`;
  const where = !p
    ? null
    : prevs.samePhase
      ? p.cycle !== session.cycle
        ? `Цикл ${p.cycle}, та же неделя, ${fmtDay(p.date)}`
        : `Неделя ${p.week}, ${fmtDay(p.date)}`
      : `Последний раз — неделя ${p.week} (другая фаза), ${fmtDay(p.date)}`;
  return html`<div class="prev">
    ${p ? html`<div class="prev__label">${where}</div>${sets(p)}` : null}
    ${old
      ? html`<div class=${'prev__label' + (p ? ' prev__label--old' : '')}>До новой точки отсчёта (${prevs.mark === session.date ? 'отмечена сегодня' : `с ${fmtDay(prevs.mark)}`}): ${old.week !== session.week ? `неделя ${old.week}, ` : ''}${fmtDay(old.date)} — только для справки</div>${sets(old)}`
      : null}
  </div>`;
}

// Settings of this exercise variant (seat, handles, stops…): they stay with the machine, so they
// are shown in every workout until changed. Each variant has its own.
function SetupLine({ item }) {
  const text = app.store.setupOf(item.seriesKey);
  const open = () => openSheet((close) => html`<${SetupSheet} item=${item} onClose=${close} />`);
  return text
    ? html`<button type="button" class="setup" onClick=${open} aria-label=${`Настройки «${item.name}»: ${text}. Изменить`}>
        <${Icon} name="tune" /><span class="setup__text"><span class="setup__label">Настройки:</span> ${text}</span>
      </button>`
    : html`<button type="button" class="setup setup--empty" onClick=${open}><${Icon} name="tune" />Настройки тренажёра</button>`;
}

function SetupSheet({ item, onClose }) {
  const [initial] = useState(() => app.store.setupOf(item.seriesKey));
  const [text, setText] = useState(initial);
  const save = async () => {
    try {
      await app.store.saveSetup(item.seriesKey, item.name, text);
      onClose();
    } catch (err) {
      app.ui.toast(`Не удалось сохранить: ${err.message}`);
    }
  };
  return html`<${Sheet} title=${`Настройки: ${item.name}`} onClose=${onClose} dirty=${text.trim() !== initial}
    footer=${html`<button type="button" class="btn btn--primary" onClick=${save}>Сохранить</button>`}>
    <p class="muted" style="font-size:14px">Сохраняются для этого варианта и видны в каждой тренировке. У других вариантов — свои. Их же можно править в Настройках → Программа.</p>
    <div class="sheet__section">
      <textarea class="input" style="min-height:90px" maxlength=${SETUP_MAX} aria-label="Настройки тренажёра"
        placeholder="Например: сиденье 5, ручки 3, упор на 2-м отверстии" value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>
    </div>
  <//>`;
}

function ExercisePanel({ row, session, next, onNext }) {
  const { item, sets, target, prevs, complete } = row;
  const total = target.sets + target.drop;
  const planned = [];
  for (let i = sets.length; i < total; i++) planned.push(i);
  const flags = item.flags || {};
  return html`<section class="panel" aria-label=${item.name}>
    <div class="panel__head">
      <div style="flex:1;min-width:0">
        <h2 class="panel__title">${item.name}</h2>
        <div class="panel__target">${fmtTarget(target)}</div>
      </div>
      <button type="button" class="swap" onClick=${() => openSwap(session, item)}><${Icon} name="swap" />Заменить</button>
    </div>
    <${SetupLine} item=${item} />
    <${PrevHint} prevs=${prevs} session=${session} category=${item.category} />
    <ol class="sets" aria-label="Подходы сегодня">
      ${sets.map(
        (s, i) => html`<li class="set" key=${s.id}>
          <span class="set__no">${i + 1}</span>
          <button type="button" class="set__main" onClick=${() => openSetEdit(s, item)} aria-label=${`Подход ${i + 1}: ${fmtWeight(s.weight, item.category)} на ${s.reps}. Изменить`}>
            <span class="set__nums">${fmtWeight(s.weight, item.category)}${item.category === 'pullup' && !s.weight ? '' : html`<span class="unit">кг</span>`}<span class="x">×</span>${s.reps}</span>
          </button>
          <span class="set__tags">
            ${s.rir != null ? html`<span class="tag">RIR ${fmtNum(s.rir)}</span>` : null}
            ${s.drop ? html`<span class="tag">дроп</span>` : null}
            ${s.pain ? html`<span class="tag tag--bad">боль</span>` : null}
            ${s.technique ? html`<span class="tag tag--bad">техника</span>` : null}
            ${s.seriesKey !== item.seriesKey ? html`<span class="tag">${s.exercise}</span>` : null}
            <button type="button" class=${'set__note' + (s.note ? ' set__note--on' : '')} title=${s.note || null}
              aria-label=${s.note ? `Заметка к подходу ${i + 1}: ${s.note}. Изменить` : `Добавить заметку к подходу ${i + 1}`}
              onClick=${() => openSetEdit(s, item, { focus: 'note' })}><${Icon} name="note" /></button>
          </span>
        </li>`,
      )}
      ${planned.map(
        (i) => html`<li class=${'set ' + (i === sets.length ? 'set--next' : 'set--planned')} key=${'p' + i}>
          <span class="set__no">${i + 1}</span>
          <span class="set__main">${i >= target.sets ? 'дроп-сет' : i === sets.length ? 'следующий' : ''}</span>
          <span></span>
        </li>`,
      )}
    </ol>
    ${flags.pain || flags.technique || flags.baseline || item.note
      ? html`<div class="item-note">
          ${flags.pain ? html`<span class="tag tag--bad">боль</span> ` : null}
          ${flags.technique ? html`<span class="tag tag--bad">техника хуже</span> ` : null}
          ${flags.baseline ? html`<span class="tag">новая точка отсчёта</span> ` : null}
          ${item.note}
        </div>`
      : null}
    <div class="panel__tools">
      <button type="button" class="toggle" onClick=${() => openMarks(session, item)}><${Icon} name="flag" />Отметки и комментарий</button>
      ${!complete && !sets.length
        ? html`<button type="button" class="toggle" onClick=${() => app.store.updateItem(session.id, item.slotId, { skipped: true })}>Пропустить</button>`
        : null}
      ${item.skipped
        ? html`<button type="button" class="toggle" onClick=${() => app.store.updateItem(session.id, item.slotId, { skipped: false })}>Вернуть</button>`
        : null}
      ${complete && next
        ? html`<button type="button" class="toggle" aria-pressed="true" onClick=${() => onNext(next.item.slotId)}>Дальше: ${next.item.name}</button>`
        : null}
    </div>
  </section>`;
}

// ---------------------------------------------------------------- the dock

function Dock({ row, session, live, onLogged, justLogged }) {
  const { item, sets, target, prevs, working, drops } = row;
  const category = item.category;
  const dropDue = target.drop > 0 && working >= target.sets && drops < target.drop;
  const [dropMode, setDropMode] = useState(dropDue);
  // After a «новая точка отсчёта» without a result of this week since, nothing from before the mark
  // (nor another week) is a weight to start from: the «Ориентир» if there is one, else an empty field.
  const cut = !!prevs.mark && !prevs.samePhase;
  const prevRef = cut ? null : prevs.samePhase || prevs.latest;
  const otherPhase = !prevs.samePhase && !!prevs.latest;
  let sug = suggestNext({ todaySets: sets, prev: prevRef, target, step: item.step, drop: dropMode });
  // A light week not done yet: the heavy week's weight would be far too heavy, so the first set
  // starts from the approximate «Ориентир» (lib/recommend.js) instead.
  const hint = row.rec?.kind === 'estimate' && row.rec.weight != null && (row.rec.basis === 'light' || cut) ? row.rec : null;
  if (hint && !dropMode && sug.source !== 'today') sug = { weight: hint.weight, reps: hint.reps?.[0] ?? sug.reps, source: 'estimate' };
  if (sug.weight == null && category === 'pullup') sug.weight = 0;
  // Another week's result is a weight reference only; reps follow today's target.
  if (sug.source === 'prev' && otherPhase && target.reps && sug.reps != null) {
    sug.reps = Math.min(Math.max(sug.reps, target.reps[0]), target.reps[1]);
  }
  const draftKey = `draft:${session.id}:${item.slotId}:${sets.length}:${dropMode ? 1 : 0}`;
  const fresh = () => ({ weight: sug.weight, reps: sug.reps, rir: null, touchedW: false, touchedR: false });
  const [v, setV] = useState(() => local.get(draftKey) || fresh());
  const [busy, setBusy] = useState(false);
  const [rirMissing, setRirMissing] = useState(false);
  useEffect(() => setV(local.get(draftKey) || fresh()), [dropMode]);

  const update = (patch) =>
    setV((prev) => {
      const n = { ...prev, ...patch };
      local.set(draftKey, n);
      return n;
    });

  const allSets = app.store.setsOf(session.id);
  const lastAt = allSets.length ? Math.max(...allSets.map((s) => s.createdAt)) : null;
  const now = useNow(1000, live && !!lastAt);
  const rest = live && lastAt && now - lastAt < 30 * 60 * 1000 ? fmtDuration((now - lastAt) / 1000) : null;

  // Today's weight 10%+ below the same week last time: was it meant? Asked in place of the
  // recommendation line (which would say «закрепить» the old weight) until answered.
  const askKey = `drop-ask:${session.id}:${item.slotId}`;
  const [noAskYet, setNoAskYet] = useState(() => !local.get(askKey));
  const drop = noAskYet ? weightDrop({ todaySets: sets, ref: prevs.samePhase, category, flags: item.flags || {} }) : null;
  const markBaseline = async () => {
    await app.store.updateItem(session.id, item.slotId, { flags: { baseline: true } });
    app.ui.toast('Отмечено: новая точка отсчёта');
  };
  const noAsk = () => {
    local.set(askKey, true);
    setNoAskYet(false);
  };

  const n = sets.length + 1;
  // Set number first: on a narrow screen the exercise name is what gets truncated.
  const setLabel = dropMode ? 'Дроп-сет' : working >= target.sets ? `Подход ${working + 1}, сверх плана` : `Подход ${working + 1} из ${target.sets}`;
  const weightHint = v.touchedW
    ? ''
    : sug.source === 'prev'
      ? otherPhase ? 'из другой фазы' : 'как в прошлый раз'
      : sug.source === 'estimate' ? 'ориентир, ≈'
        : sug.source === 'today' ? `как подход ${n - 1}` : sug.source === 'drop' ? '≈70% веса' : '';
  const canLog = v.weight != null && v.reps != null && v.reps > 0 && !busy;

  const log = async () => {
    if (!canLog) return;
    // RIR is part of every set (0 is a value): without it the set is not recorded, the weight and
    // reps stay as typed. One short notice, nothing to confirm.
    if (v.rir == null) {
      setRirMissing(true);
      app.ui.toast('Не указан RIR', { ms: 2500 });
      return;
    }
    setBusy(true);
    try {
      const { set, duplicate } = await app.store.logSet(session.id, item.slotId, { weight: v.weight, reps: v.reps, rir: v.rir, drop: dropMode });
      if (duplicate) {
        setBusy(false); // second tap of a double tap: nothing new recorded, keep the button usable
        return;
      }
      local.set(draftKey, null);
      onLogged(set, row);
    } catch (err) {
      app.ui.toast(`Не удалось записать: ${err.message}`);
      setBusy(false);
    }
  };

  const padWeight = () =>
    openSheet((close) => html`<${NumberPad} title=${category === 'pullup' ? 'Дополнительный вес, кг' : 'Вес, кг'} value=${v.weight} step=${item.step || 2.5} unit="кг"
      onDone=${(w) => update({ weight: w, touchedW: true })} onClose=${close} />`);
  const padReps = () =>
    openSheet((close) => html`<${NumberPad} title="Повторения" value=${v.reps} decimals=${false} onDone=${(r) => update({ reps: r, touchedR: true })} onClose=${close} />`);

  return html`<section class="dock" style=${`--phase:var(--plate-${session.week})`} aria-label="Запись подхода">
    <div class="dock__head">
      ${justLogged
        ? html`<span class="dock__done" role="status"><${Icon} name="check" /><span class="dock__done-text">${justLogged.text}</span></span>
            <button type="button" class="dock__undo" onClick=${justLogged.undo}>Отменить</button>`
        : html`<span class="dock__what"><b class="dock__set">${setLabel}</b> <span class="dock__name">${item.name}</span></span>`}
      ${target.drop > 0
        ? html`<${Toggle} on=${dropMode} onChange=${setDropMode}>дроп</${Toggle}>`
        : null}
      ${rest ? html`<span class="dock__rest" aria-label=${'Отдых ' + rest}>отдых ${rest}</span>` : null}
    </div>
    <${LastTime} prevs=${prevs} category=${category} index=${working} drop=${dropMode} />
    ${dropMode
      ? null
      : drop
        ? html`<${DropAsk} drop=${drop} item=${item} onMark=${markBaseline} onNo=${noAsk} />`
        : html`<${Recommendation} rec=${row.rec} category=${category} current=${v.weight} onUse=${(w) => update({ weight: w, touchedW: true })} />`}
    <div class="dock__grid">
      <div>
        <div class="field__label"><span>${category === 'pullup' ? 'Доп. вес, кг' : 'Вес, кг'}</span><span class="field__hint">${weightHint}</span></div>
        <${Stepper} label="Вес" value=${v.weight} step=${item.step || 2.5} suggested=${(sug.source === 'prev' || sug.source === 'estimate') && !v.touchedW}
          display=${v.weight != null && category === 'pullup' && v.weight === 0 ? 'СВ' : null}
          onChange=${(w) => update({ weight: w, touchedW: true })} onTap=${padWeight} />
      </div>
      <div>
        <div class="field__label"><span>Повторения</span>${target.reps ? html`<span class="field__hint">цель ${target.reps[0] === target.reps[1] ? target.reps[0] : `${target.reps[0]}–${target.reps[1]}`}</span>` : null}</div>
        <${Stepper} label="Повторения" value=${v.reps} step=${1} suggested=${(sug.source === 'prev' || sug.source === 'estimate') && !v.touchedR}
          onChange=${(r) => update({ reps: r, touchedR: true })} onTap=${padReps} />
      </div>
    </div>
    <${RirPicker} value=${v.rir} target=${target.rir} missing=${rirMissing && v.rir == null} onChange=${(rir) => update({ rir })} />
    <div class="dock__log">
      <button type="button" class="btn btn--primary btn--block btn--big" disabled=${!canLog} onClick=${log}>
        ${v.weight == null ? 'Введите вес' : v.reps == null ? 'Введите повторения' : html`Записать <span class="num">${fmtWeight(v.weight, category)} × ${v.reps}</span>`}
      </button>
    </div>
  </section>`;
}

// Last time for this exact variant (strength series), right above the inputs, so it is in view
// without scrolling the list. Same week of the cycle first; otherwise the latest result from
// another week, marked as another phase — a reference for the weight, not a comparison.
// Nothing is invented when there is no history.
function LastTime({ prevs, category, index, drop }) {
  const p = prevs.samePhase || prevs.latest || prevs.old;
  if (!p) {
    return html`<div class="dock__prev" role="note" data-kind="first"><span class="dock__prev-label">Первое выполнение</span></div>`;
  }
  // Before a «новая точка отсчёта» — only when nothing since the mark: a reference, not a target.
  const kind = prevs.samePhase ? 'same' : prevs.latest ? 'other' : 'before';
  const list = drop && p.drops.length ? p.drops : p.sets;
  const now = drop ? (p.drops.length ? 0 : -1) : index;
  const sets = list.map((s) => `${fmtWeight(s.weight, category)}×${s.reps}`);
  const label = kind === 'same' ? 'Прошлый раз' : kind === 'other' ? `Другая фаза, неделя ${p.week}` : `До новой точки отсчёта, неделя ${p.week}`;
  return html`<div class=${'dock__prev' + (kind !== 'same' ? ' dock__prev--other' : '')} role="note" data-kind=${kind}
    aria-label=${`${label}, ${fmtDay(p.date)}: ${sets.join(', ')}`}>
    <span class="dock__prev-label">${kind === 'same' ? 'Прошлый раз' : kind === 'other' ? `Другая фаза · нед. ${p.week}` : `До отсчёта · нед. ${p.week}`}</span>
    <span class="dock__prev-sets num">${sets.map((t, i) => html`<span class=${i === now ? 'is-now' : null}>${t}</span>`)}</span>
    <span class="dock__prev-date">${fmtDayShort(p.date)}</span>
  </div>`;
}

// A deliberate drop? One line where the recommendation stands: «−13% · нарочно?», «Да» sets
// «Новая точка отсчёта» for this exercise today (the same as in «Отметки и комментарий»), «Нет»
// hides it for this workout. ⓘ says it in full. Nothing blocks logging.
function DropAsk({ drop, item, onMark, onNo }) {
  const kg = (w) => `${fmtWeight(w, item.category)}\u00a0кг`;
  const full = `Вес на ${drop.pct}% ниже, чем ${fmtDay(drop.date)}: было ${kg(drop.was)}, сегодня ${kg(drop.now)}.`;
  const info = () => openSheet((close) => html`<${Sheet} title="Вес ниже прошлого раза" onClose=${close}>
    <p class="rec-sheet__head"><b>${full}</b></p>
    <ul class="rec-sheet__why">
      <li>Если вы снизили вес нарочно — ради техники, полной амплитуды или других настроек тренажёра, — отметьте новую точку отсчёта. Тогда сравнение начнётся с сегодняшней тренировки: ни просадки, ни регресса, а «Прошлый раз» и подсказки пойдут от нового веса.</li>
      <li>Если это просто тяжёлый день, ничего не отмечайте: результат сравнится с прошлым как обычно.</li>
      <li>Отметку можно снять или поставить позже в «Отметки и комментарий», в том числе из «Истории».</li>
    </ul>
    <div class="btn-row">
      <button type="button" class="btn btn--primary" onClick=${() => { close(); onMark(); }}>Отметить точку отсчёта</button>
      <button type="button" class="btn" onClick=${() => { close(); onNo(); }}>Нет, это просадка</button>
    </div>
  <//>`);
  return html`<div class="dock__rec dock__ask" role="note" aria-label=${`${full} Снизили нарочно?`}>
    <button type="button" class="dock__rec-why" onClick=${info} aria-label=${`${full} Снизили нарочно? Подробнее`}>
      <span class="dock__rec-label">Вес</span><b class="num">−${drop.pct}%</b><span class="dock__rec-tag">· нарочно?</span>
      <${Icon} name="info" />
    </button>
    <button type="button" class="dock__rec-use" onClick=${onMark} aria-label="Да, отметить новую точку отсчёта">Да</button>
    <button type="button" class="dock__rec-use" onClick=${onNo} aria-label="Нет, это просадка">Нет</button>
  </div>`;
}

// Today's weight, one compact line under «Прошлый раз»: what and why (ⓘ), and «Использовать» to put
// it into the weight field. Nothing changes until that tap. Not shown for a drop set. A «Ориентир»
// from another week is always shown as approximate: «≈» and «приблизительно».
function Recommendation({ rec, category, current, onUse }) {
  if (!rec) return null;
  const info = () => openSheet((close) => html`<${RecommendationSheet} rec=${rec} category=${category} onClose=${close} />`);
  const has = rec.weight != null;
  const approx = rec.kind === 'estimate';
  const tag = rec.kind === 'up' ? (rec.conditional ? 'условно' : 'повысить') : rec.kind === 'hold' ? 'закрепить' : approx ? 'примерно' : '';
  const weight = `${approx ? '≈' : ''}${fmtLoad(rec.weight, category)}`;
  const span = approx && rec.range ? ` (от ${fmtLoad(rec.range[0], category)} до ${fmtLoad(rec.range[1], category)})` : '';
  const said = !has
    ? `Рекомендация: ${rec.label.toLowerCase()}`
    : approx
      ? `Ориентир на сегодня, приблизительно: ${fmtLoad(rec.weight, category)}${span}`
      : `Рекомендуем сегодня: ${fmtLoad(rec.weight, category)}, ${rec.label.toLowerCase()}${rec.conditional ? ', условно' : ''}`;
  return html`<div class=${'dock__rec' + (rec.kind === 'up' ? ' dock__rec--up' : '') + (approx ? ' dock__rec--approx' : '')} role="note" aria-label=${said} data-kind=${rec.kind}>
    <button type="button" class="dock__rec-why" onClick=${info} aria-label=${said + '. Почему'}>
      ${has
        ? html`<span class="dock__rec-label">${approx ? 'Ориентир:' : 'Сегодня:'}</span><b class="num">${weight}</b><span class="dock__rec-tag">· ${tag}</span>`
        : html`<span class="dock__rec-label dock__rec-label--keep">Рекомендация:</span><span class="dock__rec-tag">недостаточно данных</span>`}
      <${Icon} name="info" />
    </button>
    ${has && current !== rec.weight
      ? html`<button type="button" class="dock__rec-use" onClick=${() => onUse(rec.weight)}>Использовать</button>`
      : null}
  </div>`;
}

function RecommendationSheet({ rec, category, onClose }) {
  const approx = rec.kind === 'estimate';
  const head = rec.weight == null
    ? rec.label
    : approx
      ? `${rec.label}: ≈${fmtLoad(rec.weight, category)}${rec.range ? ` (от ${fmtLoad(rec.range[0], category)} до ${fmtLoad(rec.range[1], category)})` : ''}`
      : `${rec.label}: ${fmtLoad(rec.weight, category)}${rec.conditional ? ' (условно)' : ''}`;
  return html`<${Sheet} title="Рекомендация на сегодня" onClose=${onClose}>
    <p class="rec-sheet__head"><b>${head}</b></p>
    ${rec.basis ? html`<p class="rec-sheet__basis">${BASIS[rec.basis]}</p>` : null}
    <ul class="rec-sheet__why">${rec.reasons.map((r) => html`<li>${r.replace(/ кг/g, '\u00a0кг')}</li>`)}</ul>
    <p class="muted" style="font-size:13px">Это подсказка по вашим прошлым подходам, а не обещание результата. Вес в поле меняется, только если нажать «Использовать». «Повысить» и «закрепить» — только по той же неделе цикла. Ориентир по другой неделе — приблизительный расчёт: проверьте его первым подходом.</p>
    <div class="btn-row"><button type="button" class="btn btn--block" onClick=${onClose}>Понятно</button></div>
  <//>`;
}

// ---------------------------------------------------------------- sheets

function openSetEdit(set, item, { focus = null } = {}) {
  openSheet((close) => html`<${SetEditSheet} set=${set} item=${item} focus=${focus} onClose=${close} />`);
}

function SetEditSheet({ set, item, focus, onClose }) {
  const [start] = useState(() => ({ ...set }));
  const [v, setV] = useState(start);
  const up = (p) => setV((x) => ({ ...x, ...p }));
  const save = async () => {
    await app.store.updateSet(set.id, { weight: v.weight, reps: v.reps, rir: v.rir, drop: v.drop, pain: v.pain, technique: v.technique, note: v.note });
    onClose();
  };
  const remove = async () => {
    await app.store.deleteSet(set.id);
    onClose();
    app.ui.toast('Подход удалён', { action: { label: 'Вернуть', fn: () => app.store.restoreSet(set.id) } });
  };
  const footer = html`
    <button type="button" class="btn btn--danger" onClick=${remove}>Удалить</button>
    <button type="button" class="btn btn--primary" disabled=${v.weight == null || !v.reps} onClick=${save}>Сохранить</button>`;
  return html`<${Sheet} title=${`Подход ${set.setNo}: ${set.exercise}`} onClose=${onClose} footer=${footer} dirty=${JSON.stringify(v) !== JSON.stringify(start)}>
    <div class="dock__grid">
      <div>
        <div class="field__label">${item.category === 'pullup' ? 'Доп. вес, кг' : 'Вес, кг'}</div>
        <${Stepper} label="Вес" value=${v.weight} step=${item.step || 2.5} onChange=${(w) => up({ weight: w })}
          onTap=${() => openSheet((c) => html`<${NumberPad} title="Вес, кг" value=${v.weight} step=${item.step || 2.5} unit="кг" onDone=${(w) => w != null && up({ weight: w })} onClose=${c} />`)} />
      </div>
      <div>
        <div class="field__label">Повторения</div>
        <${Stepper} label="Повторения" value=${v.reps} step=${1} onChange=${(r) => up({ reps: r })}
          onTap=${() => openSheet((c) => html`<${NumberPad} title="Повторения" value=${v.reps} decimals=${false} onDone=${(r) => r != null && up({ reps: r })} onClose=${c} />`)} />
      </div>
    </div>
    <${RirPicker} value=${v.rir} onChange=${(rir) => up({ rir })} />
    <div class="panel__tools" style="border:0">
      <${Toggle} on=${v.drop} onChange=${(drop) => up({ drop })}>Дроп-сет</${Toggle}>
      <${Toggle} on=${v.pain} tone="bad" onChange=${(pain) => up({ pain })}>Боль</${Toggle}>
      <${Toggle} on=${v.technique} tone="bad" onChange=${(technique) => up({ technique })}>Техника хуже</${Toggle}>
    </div>
    <div class="sheet__section">
      <input class="input" placeholder="Заметка к подходу" aria-label="Заметка к подходу" value=${v.note || ''} autofocus=${focus === 'note'}
        onInput=${(e) => up({ note: e.currentTarget.value })} />
    </div>
  <//>`;
}

function openSwap(session, item) {
  openSheet((close) => html`<${SwapSheet} session=${session} item=${item} onClose=${close} />`);
}

// One line under a found exercise: category, where it is in the program, when it was done last.
function entryLine(e) {
  const main = e.where.filter((w) => w.main).map((w) => w.day);
  const alt = e.where.filter((w) => !w.main).map((w) => w.day);
  const days = (list) => `${list.length > 1 ? 'дни' : 'день'} ${list.join(', ')}`;
  return [
    CATEGORY[e.category]?.label,
    e.matched ? `записывалось как «${e.matched}»` : null,
    main.length ? days(main) : alt.length ? `альтернатива, ${days(alt)}` : null,
    e.last ? `${fmtDay(e.last.date)}, ${fmtWeight(e.last.weight, e.category)}${e.category === 'pullup' && e.last.weight ? ' кг доп.' : ' кг'}` : 'ещё не выполнялось',
  ].filter(Boolean).join(' · ');
}

// Search over the program and the whole history, and a new exercise when nothing fits.
// `onPick({ option, category, step })`: a found exercise keeps its series, category and weight step.
// `idle`: shown under the field while nothing is typed.
function ExerciseSearch({ exclude = [], category: startCategory = 'iso', createLabel, onPick, idle = null }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(startCategory);
  const index = exercisesNow();
  const q = query.trim();
  const found = searchExercises(index, q, { exclude });
  const exact = q ? findExact(index, q) : null;
  return html`<div class="sheet__section ex-search">
    <input class="input" type="search" enterkeyhint="search" autocomplete="off" placeholder="Найти в программе и истории" aria-label="Найти упражнение"
      value=${query} onInput=${(e) => setQuery(e.currentTarget.value)} />
    ${found.map((e) => html`<button type="button" class="choice" key=${e.key}
        onClick=${() => onPick({ option: { key: e.key, name: e.name }, category: e.category, step: e.step })}>
      <span class="choice__main">${e.name}<span class="choice__sub">${entryLine(e)}</span></span>
    </button>`)}
    ${q && !found.length && !exact ? html`<p class="muted ex-search__none">В программе и истории такого нет.</p>` : null}
    ${q && exact && exclude.includes(exact.key) ? html`<p class="muted ex-search__none">Это упражнение уже выбрано.</p>` : null}
    ${q && !exact
      ? html`<div class="ex-search__new">
          <div class="sheet__label">Новое упражнение — отдельная серия, история с нуля</div>
          ${found.length ? html`<p class="muted ex-search__hint">Если это ${found.length > 1 ? 'одно из упражнений выше' : `«${found[0].name}»`}, выберите его — история будет общей.</p>` : null}
          <${Seg} label="Категория" value=${category} onChange=${setCategory} options=${CATEGORY_KEYS.map((k) => ({ value: k, label: CATEGORY[k].label }))} />
          <button type="button" class="btn btn--block" style="margin-top:10px" onClick=${() => onPick({ option: makeOption(q), category, step: null })}>${createLabel(q)}</button>
        </div>`
      : null}
    ${q ? null : idle}
  </div>`;
}

function SwapSheet({ session, item, onClose }) {
  const { series } = derived();
  const program = app.store.state.program;
  const slot = item.adhoc ? null : program?.days.flatMap((d) => d.slots.map((s) => ({ ...s, day: d.day }))).find((s) => s.id === item.slotId) || null;
  // «Изменить программу на будущее»: the choice becomes the slot's main variant from the next workout.
  const [forever, setForever] = useState(false);
  const [keepOld, setKeepOld] = useState(true);
  // Sets already recorded under the current variant: were they really done on it?
  const [asking, setAsking] = useState(null);
  const logged = app.store.setsOf(session.id, item.slotId).filter((x) => x.seriesKey === item.seriesKey);
  const choose = async (pick) => {
    if (logged.length && pick.option.key !== item.seriesKey) {
      setAsking(pick);
      return;
    }
    await finish(pick, false);
  };
  const finish = async (pick, move) => {
    const opt = pick.option;
    try {
      if (move) {
        const { moved } = await app.store.reassignVariant(session.id, item.slotId, opt);
        app.ui.toast(`${moved} ${plural(moved, 'подход перенесён', 'подхода перенесены', 'подходов перенесены')} в «${opt.name}»`);
      } else {
        await app.store.swapVariant(session.id, item.slotId, opt);
      }
      const patch = {};
      if (pick.category && pick.category !== item.category) patch.category = pick.category;
      if (pick.step && pick.step !== item.step) patch.step = pick.step;
      if (Object.keys(patch).length) await app.store.updateItem(session.id, item.slotId, patch);
      if (forever && slot) {
        const now = app.store.state.program;
        const next = setMainOption(now, slot.id, opt, { keepOld, category: pick.category, step: pick.step });
        const before = now.days.flatMap((d) => d.slots).find((s) => s.id === slot.id);
        const after = next?.days.flatMap((d) => d.slots).find((s) => s.id === slot.id);
        if (after && JSON.stringify([after.options, after.category, after.step]) !== JSON.stringify([before.options, before.category, before.step])) {
          await app.store.saveProgram(next);
          app.ui.toast(`Программа, день ${slot.day}: основное — «${opt.name}»`);
        }
      }
      onClose();
    } catch (err) {
      app.ui.toast(`Не удалось сохранить: ${err.message}`);
    }
  };
  if (asking) {
    const n = logged.length;
    const sets = logged.map((x) => `${fmtWeight(x.weight, item.category)}×${x.reps}`).join(', ');
    return html`<${Sheet} title=${`«${asking.option.name}»`} onClose=${onClose}>
      <p class="muted" style="font-size:14px">Уже ${plural(n, 'записан', 'записано', 'записано')} ${n} ${plural(n, 'подход', 'подхода', 'подходов')} на «${item.name}»: ${sets}.</p>
      <div class="sheet__section">
        <button type="button" class="choice" onClick=${() => finish(asking, true)}>
          <span class="choice__main">Записал не то упражнение — перенести их<span class="choice__sub">Подходы перейдут в серию «${asking.option.name}». Веса, повторения, RIR и дата не меняются.</span></span>
        </button>
        <button type="button" class="choice" onClick=${() => finish(asking, false)}>
          <span class="choice__main">Дальше делаю «${asking.option.name}»<span class="choice__sub">Записанные подходы остаются в «${item.name}» — они сделаны на нём.</span></span>
        </button>
      </div>
    <//>`;
  }
  const main = slot?.options[0];
  return html`<${Sheet} title="Заменить упражнение" onClose=${onClose}>
    <p class="muted" style="font-size:14px">Каждый вариант — отдельная силовая серия. Результаты разных вариантов не сравниваются между собой.</p>
    ${slot
      ? html`<div class="sheet__section">
          <button type="button" class="choice" aria-pressed=${String(forever)} onClick=${() => setForever(!forever)}>
            <span class="choice__main">Изменить программу на будущее<span class="choice__sub">${forever ? `Выбранное станет основным в дне ${slot.day}, следующие тренировки начнутся с него.` : 'Выключено: замена только на эту тренировку.'}</span></span>
            <span class="toggle" aria-hidden="true" aria-pressed=${String(forever)}>${forever ? 'да' : 'нет'}</span>
          </button>
          ${forever
            ? html`<button type="button" class="choice" aria-pressed=${String(keepOld)} onClick=${() => setKeepOld(!keepOld)}>
                <span class="choice__main">Оставить «${main.name}» альтернативой<span class="choice__sub">${keepOld ? 'Его история сохраняется в любом случае.' : 'Уберётся из программы, история сохранится.'}</span></span>
                <span class="toggle" aria-hidden="true" aria-pressed=${String(keepOld)}>${keepOld ? 'да' : 'нет'}</span>
              </button>`
            : null}
        </div>`
      : null}
    <div class="sheet__section">
      ${item.options.map((o) => {
        const list = series.get(o.key);
        const last = list && list.filter((e) => e.sessionId !== session.id).pop();
        return html`<button type="button" class="choice" onClick=${() => choose({ option: o })}>
          <span class="choice__main">${o.name}<span class="choice__sub">${last ? `последний раз ${fmtDay(last.date)}` : 'ещё не выполнялось'}</span></span>
          ${o.key === item.seriesKey ? html`<span class="choice__mark"><${Icon} name="check" label="Сейчас" /></span>` : null}
        </button>`;
      })}
    </div>
    <div class="sheet__label" style="margin-top:14px">Другое упражнение</div>
    <${ExerciseSearch} exclude=${item.options.map((o) => o.key)} category=${item.category} createLabel=${(q) => `Заменить на новое «${q}»`} onPick=${choose} />
  <//>`;
}

function openMarks(session, item) {
  openSheet((close) => html`<${MarksSheet} session=${session} item=${item} onClose=${close} />`);
}

function MarksSheet({ session, item, onClose }) {
  const [flags, setFlags] = useState({ pain: false, technique: false, baseline: false, ...(item.flags || {}) });
  const [note, setNote] = useState(item.note || '');
  const row = (key, title, sub, tone) => html`<button type="button" class="choice" aria-pressed=${String(!!flags[key])} onClick=${() => setFlags({ ...flags, [key]: !flags[key] })}>
    <span class="choice__main">${title}<span class="choice__sub">${sub}</span></span>
    <span class=${'toggle' + (tone ? ' toggle--' + tone : '')} aria-hidden="true" aria-pressed=${String(!!flags[key])}>${flags[key] ? 'да' : 'нет'}</span>
  </button>`;
  const dirty = note !== (item.note || '') || ['pain', 'technique', 'baseline'].some((k) => !!flags[k] !== !!item.flags?.[k]);
  const save = async () => {
    await app.store.updateItem(session.id, item.slotId, { flags, note });
    onClose();
  };
  return html`<${Sheet} title=${item.name} onClose=${onClose} dirty=${dirty}
    footer=${html`<button type="button" class="btn btn--primary" onClick=${save}>Сохранить</button>`}>
    ${row('pain', 'Боль', 'Эта тренировка не учитывается в оценке плато и регресса.', 'bad')}
    ${row('technique', 'Техника хуже', 'Прирост в этот день не засчитывается как прогресс.', 'bad')}
    ${row('baseline', 'Новая точка отсчёта', 'Техника строже, другие настройки или амплитуда: сравнение начнётся заново, без ложного регресса.')}
    <div class="sheet__section">
      <textarea class="input" style="min-height:90px" aria-label="Комментарий к упражнению в этой тренировке"
        placeholder="Комментарий к этой тренировке: ощущения, что изменить в следующий раз…" value=${note} onInput=${(e) => setNote(e.currentTarget.value)}></textarea>
      <p class="muted" style="font-size:12px;margin-top:4px">Сиденье, ручки, ограничители — в «Настройках» над подходами: они сохраняются для варианта, а не для одной тренировки.</p>
    </div>
  <//>`;
}

function openAddItem(session, setActive) {
  openSheet((close) => html`<${AddItemSheet} session=${session} onClose=${close} onAdded=${setActive} />`);
}

function AddItemSheet({ session, onClose, onAdded }) {
  const present = new Set(session.items.flatMap((i) => i.options.map((o) => o.key)));
  const picks = exerciseCatalog(app.store.state.program).filter((k) => !present.has(k.key));
  const add = async ({ option, category, step }) => {
    const item = await app.store.addItem(session.id, { name: option.name, key: option.key, category, step: step || 2.5 });
    onClose();
    if (item) onAdded(item.slotId);
  };
  return html`<${Sheet} title="Добавить упражнение" onClose=${onClose}>
    <p class="muted" style="font-size:14px">Только в эту тренировку. Чтобы упражнение было всегда, добавьте его в программу.</p>
    <${ExerciseSearch} exclude=${[...present]} createLabel=${(q) => `Добавить новое «${q}»`} onPick=${add}
      idle=${picks.length
        ? html`<div class="sheet__section"><div class="sheet__label">Из вашей программы</div>
            ${picks.map((k) => html`<button type="button" class="choice" onClick=${() => add({ option: { key: k.key, name: k.name }, category: k.category, step: k.step })}>
              <span class="choice__main">${k.name}<span class="choice__sub">${CATEGORY[k.category].label}</span></span></button>`)}
          </div>`
        : null} />
  <//>`;
}

function openSessionMenu(session, mode) {
  // The tab bar is hidden during a workout; the other sections are reachable from here (the
  // workout stays open — the «Тренировка» tab brings it back).
  const go = (tab, close) => () => {
    close();
    app.ui.go({ tab });
  };
  openSheet((close) => html`<${Sheet} title="Тренировка" onClose=${close}>
    ${mode === 'live'
      ? html`<div class="btn-row menu-tabs" role="group" aria-label="Разделы">
          <button type="button" class="btn" onClick=${go('progress', close)}><${Icon} name="progress" />Прогресс</button>
          <button type="button" class="btn" onClick=${go('history', close)}><${Icon} name="history" />История</button>
          <button type="button" class="btn" onClick=${go('body', close)}><${Icon} name="body" />Тело</button>
        </div>`
      : null}
    <button type="button" class="choice" onClick=${() => { close(); openSessionEdit(session); }}>
      <span class="choice__main">Изменить день, неделю, цикл или дату</span></button>
    <button type="button" class="choice" onClick=${() => { close(); openCheckin(session.date); }}>
      <span class="choice__main">Вес тела и сон<span class="choice__sub">за ${fmtDay(session.date)}</span></span></button>
    ${mode === 'live'
      ? html`<button type="button" class="choice" onClick=${() => { close(); openFinish(session, buildRows(session)); }}>
          <span class="choice__main">Завершить тренировку</span></button>`
      : null}
    <button type="button" class="choice btn--danger" onClick=${async () => {
      close();
      const ok = await confirmSheet({ title: 'Удалить тренировку?', text: 'Все подходы этой тренировки будут удалены и из таблицы.', okLabel: 'Удалить', danger: true });
      if (ok) {
        await app.store.deleteSession(session.id);
        app.ui.go({ tab: mode === 'live' ? 'today' : 'history', view: null });
        app.ui.toast('Тренировка удалена');
      }
    }}><span class="choice__main">Удалить тренировку</span></button>
  <//>`);
}

function openSessionEdit(session) {
  openSheet((close) => html`<${SessionEditSheet} session=${session} onClose=${close} />`);
}

function SessionEditSheet({ session, onClose }) {
  const [v, setV] = useState({ cycle: session.cycle, week: session.week, day: session.day, date: session.date });
  const days = app.store.state.program.days.map((d) => d.day);
  const dirty = v.cycle !== session.cycle || v.week !== session.week || v.day !== session.day || v.date !== session.date;
  const save = async () => {
    await app.store.updateSession(session.id, v);
    onClose();
  };
  return html`<${Sheet} title="Параметры тренировки" onClose=${onClose} dirty=${dirty}
    footer=${html`<button type="button" class="btn btn--primary" disabled=${!v.date} onClick=${save}>Сохранить</button>`}>
    <${CycleWeekDay} value=${v} days=${days} onChange=${setV} />
    <div class="sheet__section">
      <div class="sheet__label">Дата</div>
      <input class="input" type="date" value=${v.date} onInput=${(e) => setV({ ...v, date: e.currentTarget.value })} />
    </div>
    <p class="muted" style="font-size:13px">Состав упражнений не меняется — меняются только отметки дня и фазы.</p>
  <//>`;
}

export function CycleWeekDay({ value, days, onChange }) {
  return html`
    <div class="sheet__section">
      <div class="sheet__label">Неделя цикла</div>
      <${Seg} fill label="Неделя цикла" value=${value.week} onChange=${(week) => onChange({ ...value, week })}
        options=${[1, 2, 3].map((w) => ({ value: w, label: html`<${WeekMark} week=${w} /> ${w === 1 ? 'лёгкая' : PHASE[w].reps.join('–')}` }))} />
    </div>
    <div class="sheet__section">
      <div class="sheet__label">День</div>
      <${Seg} fill label="День" value=${value.day} onChange=${(day) => onChange({ ...value, day })} options=${days.map((d) => ({ value: d, label: String(d) }))} />
    </div>
    <div class="sheet__section">
      <div class="sheet__label">Цикл</div>
      <div style="max-width:220px">
        <${Stepper} label="Цикл" value=${value.cycle} step=${1} min=${1} onChange=${(cycle) => onChange({ ...value, cycle: Math.max(1, cycle) })}
          onTap=${() => openSheet((c) => html`<${NumberPad} title="Номер цикла" value=${value.cycle} decimals=${false} onDone=${(n) => n && onChange({ ...value, cycle: n })} onClose=${c} />`)} />
      </div>
    </div>`;
}

export function openCheckin(date) {
  openSheet((close) => html`<${CheckinSheet} date=${date} onClose=${close} />`);
}

function CheckinSheet({ date, onClose }) {
  const prev = app.store.state.metrics.get(`m${date}`);
  // Bodyweight is NOT pre-filled from an older weigh-in: saving sleep alone must not invent a
  // measurement. The last value is shown as a hint and as the ± starting point. An old «Восстановление»
  // score of this day is not shown and stays as it is (saveMetric merges fields).
  const [start] = useState(() => ({
    sleep: prev?.sleep ?? null,
    bodyweight: prev?.bodyweight ?? null,
  }));
  const [v, setV] = useState(start);
  const save = async () => {
    await app.store.saveMetric(date, v);
    onClose();
    app.ui.toast('Сохранено');
  };
  return html`<${Sheet} title=${`Вес тела и сон, ${fmtDay(date)}`} onClose=${onClose} dirty=${JSON.stringify(v) !== JSON.stringify(start)}
    footer=${html`<button type="button" class="btn btn--primary" onClick=${save}>Сохранить</button>`}>
    <${MetricFields} v=${v} setV=${setV} />
  <//>`;
}

export function MetricFields({ v, setV }) {
  const lastWeight = latestBodyweight();
  return html`
    <div class="form-grid">
      <div>
        <div class="field__label"><span>Вес тела, кг</span>${v.bodyweight == null && lastWeight ? html`<span class="field__hint">был ${fmtNum(lastWeight, 1)}</span>` : null}</div>
        <${Stepper} label="Вес тела" value=${v.bodyweight} step=${0.1} start=${lastWeight} onChange=${(bodyweight) => setV({ ...v, bodyweight })}
          onTap=${() => openSheet((c) => html`<${NumberPad} title="Вес тела, кг" value=${v.bodyweight} step=${0.1} unit="кг" onDone=${(bodyweight) => setV({ ...v, bodyweight })} onClose=${c} />`)} />
      </div>
      <div>
        <div class="field__label">Сон, ч</div>
        <${Stepper} label="Сон" value=${v.sleep} step=${0.5} start=${7} onChange=${(sleep) => setV({ ...v, sleep })}
          onTap=${() => openSheet((c) => html`<${NumberPad} title="Сон, часов" value=${v.sleep} step=${0.5} unit="ч" onDone=${(sleep) => setV({ ...v, sleep })} onClose=${c} />`)} />
      </div>
    </div>`;
}

function openFinish(session, rows) {
  openSheet((close) => html`<${FinishSheet} session=${session} rows=${rows} onClose=${close} />`);
}

function FinishSheet({ session, rows, onClose }) {
  const { bodyweightAt, shareOf } = derived();
  const missing = rows.reduce((t, r) => t + (r.item.skipped ? 0 : Math.max(0, r.target.sets - r.working)), 0);
  const allSets = rows.reduce((t, r) => t + r.sets.length, 0);
  const minutes = allSets ? Math.round((Math.max(...rows.flatMap((r) => r.sets.map((s) => s.createdAt))) - session.startedAt) / 60000) : 0;
  const finish = async () => {
    await app.store.finishSession(session.id);
    local.set(`active:${session.id}`, null);
    onClose();
    app.ui.go({ tab: 'today', view: null });
    app.ui.toast('Тренировка сохранена');
  };
  const footer = html`
    <button type="button" class="btn" onClick=${onClose}>Продолжить</button>
    <button type="button" class="btn btn--primary" onClick=${finish}>Завершить</button>`;
  return html`<${Sheet} title="Итог тренировки" onClose=${onClose} footer=${footer}>
    <p class="muted">${allSets} ${plural(allSets, 'подход', 'подхода', 'подходов')}${minutes > 0 ? `, ${minutes} мин` : ''}. Сравнение — с той же неделей прошлого цикла.</p>
    <ul class="rows" style="margin-top:10px">
      ${rows.filter((r) => r.sets.length).map((r) => {
        const cur = { sets: r.sets.filter((s) => !s.drop), category: r.item.category, bw: bodyweightAt(session.date) };
        const ref = r.prevs.samePhase;
        const cmp = ref && cur.sets.length ? compareExposures(cur, ref, { category: r.item.category, share: shareOf(r.item.seriesKey, r.item.category) }) : null;
        const d = cmp ? describeComparison(cmp) : null;
        return html`<li class="row">
          <span class="row__title">${r.item.name}</span>
          <span class=${d ? 'delta--' + d.tone : 'muted'} style="font-size:14px">${d ? d.short : 'нет сравнения'}</span>
          <span class="row__sub">${r.sets.map((s) => `${s.drop ? 'дроп ' : ''}${fmtWeight(s.weight, r.item.category)}×${s.reps}`).join(', ')}${d?.bodyweight ? html`<br />${d.bodyweight}` : null}</span>
        </li>`;
      })}
    </ul>
    ${missing > 0 ? html`<p class="warn-line">Не выполнено подходов по плану: ${missing}. Можно завершить и так.</p>` : null}
  <//>`;
}

// Keeps the screen awake during a workout when the owner enabled it (Safari 16.4+).
function useWakeLock(enabled) {
  const want = enabled && !!app.store.state.kv.wakeLock;
  useEffect(() => {
    if (!want || !('wakeLock' in navigator)) return undefined;
    let lock = null;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        lock = null;
      }
    };
    const onVis = () => document.visibilityState === 'visible' && acquire();
    acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release?.().catch(() => {});
    };
  }, [want]);
}
