// The workout screen — used between sets. Everything the hand needs is in the bottom dock.

import {
  html, useState, useEffect, app, Icon, Plate, Sheet, openSheet, NumberPad, Stepper, RirPicker, Toggle, Seg,
  fmtWeight, SyncBadge, useNow, local, confirmSheet,
} from './core.js';
import { derived, latestBodyweight } from './derive.js';
import { itemTarget, suggestNext } from '../lib/planner.js';
import { fmtTarget, PHASE, phaseSummary, CATEGORY, CATEGORY_KEYS, KNOWN_EXERCISES, makeOption } from '../lib/program.js';
import { previousExposures, compareExposures } from '../lib/analytics.js';
import { fmtNum, fmtDay, fmtDuration, plural, normName, isoDate } from '../lib/util.js';
import { describeComparison } from './describe.js';

const STALE_MS = 12 * 3600 * 1000;

function buildRows(session) {
  const { series } = derived();
  return session.items.map((item) => {
    const sets = app.store.setsOf(session.id, item.slotId);
    const target = itemTarget(item, session.week);
    const prevs = previousExposures(series.get(item.seriesKey), {
      week: session.week,
      sessionId: session.id,
      date: session.date,
      startedAt: session.startedAt,
    });
    const working = sets.filter((s) => !s.drop).length;
    const drops = sets.length - working;
    const complete = !!item.skipped || (working >= target.sets && drops >= target.drop);
    return { item, sets, target, prevs, working, drops, complete };
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
    setJustLogged({ id: set.id, text, undo });
  };

  return html`
    <main class="screen screen--with-dock" style=${`--phase:${phase}`}>
      <header class="topbar wk-head">
        ${live ? null : html`<button type="button" class="icon-btn" onClick=${() => app.ui.back()} aria-label="Назад"><${Icon} name="back" /></button>`}
        <${Plate} week=${session.week} />
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
  if (!p) return html`<div class="prev"><div class="prev__label">Это упражнение ещё не выполнялось — начните с комфортного веса.</div></div>`;
  const where = prevs.samePhase
    ? p.cycle !== session.cycle
      ? `Цикл ${p.cycle}, та же неделя, ${fmtDay(p.date)}`
      : `Неделя ${p.week}, ${fmtDay(p.date)}`
    : `Последний раз — неделя ${p.week} (другая фаза), ${fmtDay(p.date)}`;
  return html`<div class="prev">
    <div class="prev__label">${where}</div>
    <div class="prev__sets" aria-label="Прошлый результат, подсказка">
      ${p.sets.map((s) => html`<span class="ghost">${fmtWeight(s.weight, category)}×${s.reps}${s.rir != null ? html`<small>RIR ${fmtNum(s.rir)}</small>` : null}</span>`)}
      ${p.drops.map((s) => html`<span class="ghost"><small>дроп</small> ${fmtWeight(s.weight, category)}×${s.reps}</span>`)}
    </div>
  </div>`;
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
      <button type="button" class="toggle" onClick=${() => openMarks(session, item)}><${Icon} name="flag" />Отметки и заметка</button>
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
  const prevRef = prevs.samePhase || prevs.latest;
  const sug = suggestNext({ todaySets: sets, prev: prevRef, target, step: item.step, drop: dropMode });
  if (sug.weight == null && category === 'pullup') sug.weight = 0;
  const draftKey = `draft:${session.id}:${item.slotId}:${sets.length}:${dropMode ? 1 : 0}`;
  const fresh = () => ({ weight: sug.weight, reps: sug.reps, rir: null, touchedW: false, touchedR: false });
  const [v, setV] = useState(() => local.get(draftKey) || fresh());
  const [busy, setBusy] = useState(false);
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

  const n = sets.length + 1;
  // Set number first: on a narrow screen the exercise name is what gets truncated.
  const setLabel = dropMode ? 'Дроп-сет' : working >= target.sets ? `Подход ${working + 1}, сверх плана` : `Подход ${working + 1} из ${target.sets}`;
  const weightHint = v.touchedW ? '' : sug.source === 'prev' ? 'как в прошлый раз' : sug.source === 'today' ? `как подход ${n - 1}` : sug.source === 'drop' ? '≈70% веса' : '';
  const canLog = v.weight != null && v.reps != null && v.reps > 0 && !busy;

  const log = async () => {
    if (!canLog) return;
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
    <div class="dock__grid">
      <div>
        <div class="field__label"><span>${category === 'pullup' ? 'Доп. вес, кг' : 'Вес, кг'}</span><span class="field__hint">${weightHint}</span></div>
        <${Stepper} label="Вес" value=${v.weight} step=${item.step || 2.5} suggested=${sug.source === 'prev' && !v.touchedW}
          display=${v.weight != null && category === 'pullup' && v.weight === 0 ? 'СВ' : null}
          onChange=${(w) => update({ weight: w, touchedW: true })} onTap=${padWeight} />
      </div>
      <div>
        <div class="field__label"><span>Повторения</span>${target.reps ? html`<span class="field__hint">цель ${target.reps[0] === target.reps[1] ? target.reps[0] : `${target.reps[0]}–${target.reps[1]}`}</span>` : null}</div>
        <${Stepper} label="Повторения" value=${v.reps} step=${1} suggested=${sug.source === 'prev' && !v.touchedR}
          onChange=${(r) => update({ reps: r, touchedR: true })} onTap=${padReps} />
      </div>
    </div>
    <${RirPicker} value=${v.rir} target=${target.rir} onChange=${(rir) => update({ rir })} />
    <div class="dock__log">
      <button type="button" class="btn btn--primary btn--block btn--big" disabled=${!canLog} onClick=${log}>
        ${v.weight == null ? 'Введите вес' : v.reps == null ? 'Введите повторения' : html`Записать <span class="num">${fmtWeight(v.weight, category)} × ${v.reps}</span>`}
      </button>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- sheets

function openSetEdit(set, item) {
  openSheet((close) => html`<${SetEditSheet} set=${set} item=${item} onClose=${close} />`);
}

function SetEditSheet({ set, item, onClose }) {
  const [v, setV] = useState({ ...set });
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
  return html`<${Sheet} title=${`Подход ${set.setNo}: ${set.exercise}`} onClose=${onClose}>
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
      <input class="input" placeholder="Заметка к подходу" value=${v.note || ''} onInput=${(e) => up({ note: e.currentTarget.value })} />
    </div>
    <div class="btn-row">
      <button type="button" class="btn btn--danger" onClick=${remove}>Удалить</button>
      <button type="button" class="btn btn--primary" disabled=${v.weight == null || !v.reps} onClick=${save}>Сохранить</button>
    </div>
  <//>`;
}

function openSwap(session, item) {
  openSheet((close) => html`<${SwapSheet} session=${session} item=${item} onClose=${close} />`);
}

function SwapSheet({ session, item, onClose }) {
  const { series } = derived();
  const [name, setName] = useState('');
  const [category, setCategory] = useState(item.category);
  const choose = async (opt) => {
    await app.store.swapVariant(session.id, item.slotId, opt);
    onClose();
  };
  return html`<${Sheet} title="Заменить упражнение" onClose=${onClose}>
    <p class="muted" style="font-size:14px">Каждый вариант — отдельная силовая серия. Результаты разных вариантов не сравниваются между собой.</p>
    <div class="sheet__section">
      ${item.options.map((o) => {
        const list = series.get(o.key);
        const last = list && list.filter((e) => e.sessionId !== session.id).pop();
        return html`<button type="button" class="choice" onClick=${() => choose(o)}>
          <span class="choice__main">${o.name}<span class="choice__sub">${last ? `последний раз ${fmtDay(last.date)}` : 'ещё не выполнялось'}</span></span>
          ${o.key === item.seriesKey ? html`<span class="choice__mark"><${Icon} name="check" label="Сейчас" /></span>` : null}
        </button>`;
      })}
    </div>
    <div class="sheet__section">
      <div class="sheet__label">Другое упражнение</div>
      <input class="input" placeholder="Название" value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
      <div style="margin-top:8px">
        <${Seg} label="Категория" value=${category} onChange=${setCategory} options=${CATEGORY_KEYS.map((k) => ({ value: k, label: CATEGORY[k].label }))} />
      </div>
      <button type="button" class="btn btn--block" style="margin-top:10px" disabled=${!name.trim()}
        onClick=${async () => {
          await app.store.updateItem(session.id, item.slotId, { category });
          await choose(makeOption(name.trim()));
        }}>Заменить на «${name.trim() || '…'}»</button>
    </div>
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
  return html`<${Sheet} title=${item.name} onClose=${onClose}>
    ${row('pain', 'Боль', 'Эта тренировка не учитывается в оценке плато и регресса.', 'bad')}
    ${row('technique', 'Техника хуже', 'Прирост в этот день не засчитывается как прогресс.', 'bad')}
    ${row('baseline', 'Новая точка отсчёта', 'Техника строже, другие настройки или амплитуда: сравнение начнётся заново, без ложного регресса.')}
    <div class="sheet__section">
      <textarea class="input" style="min-height:90px" placeholder="Заметка: настройки тренажёра, ощущения…" value=${note} onInput=${(e) => setNote(e.currentTarget.value)}></textarea>
    </div>
    <button type="button" class="btn btn--primary btn--block" onClick=${async () => {
      await app.store.updateItem(session.id, item.slotId, { flags, note });
      onClose();
    }}>Сохранить</button>
  <//>`;
}

function openAddItem(session, setActive) {
  openSheet((close) => html`<${AddItemSheet} session=${session} onClose=${close} onAdded=${setActive} />`);
}

function AddItemSheet({ session, onClose, onAdded }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('iso');
  const present = new Set(session.items.flatMap((i) => i.options.map((o) => normName(o.name))));
  const picks = KNOWN_EXERCISES.filter((k) => !present.has(normName(k.name)));
  const add = async (n, c) => {
    const item = await app.store.addItem(session.id, { name: n, category: c });
    onClose();
    if (item) onAdded(item.slotId);
  };
  return html`<${Sheet} title="Добавить упражнение" onClose=${onClose}>
    <p class="muted" style="font-size:14px">Только в эту тренировку. Чтобы упражнение было всегда, добавьте его в программу.</p>
    <div class="sheet__section">
      <input class="input" placeholder="Название" value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
      <div style="margin-top:8px">
        <${Seg} label="Категория" value=${category} onChange=${setCategory} options=${CATEGORY_KEYS.map((k) => ({ value: k, label: CATEGORY[k].label }))} />
      </div>
      <button type="button" class="btn btn--primary btn--block" style="margin-top:10px" disabled=${!name.trim()} onClick=${() => add(name.trim(), category)}>Добавить</button>
    </div>
    ${picks.length
      ? html`<div class="sheet__section"><div class="sheet__label">Из вашего списка</div>
          ${picks.map((k) => html`<button type="button" class="choice" onClick=${() => add(k.name, k.category)}>
            <span class="choice__main">${k.name}<span class="choice__sub">${CATEGORY[k.category].label}</span></span></button>`)}
        </div>`
      : null}
  <//>`;
}

function openSessionMenu(session, mode) {
  openSheet((close) => html`<${Sheet} title="Тренировка" onClose=${close}>
    <button type="button" class="choice" onClick=${() => { close(); openSessionEdit(session); }}>
      <span class="choice__main">Изменить день, неделю, цикл или дату</span></button>
    <button type="button" class="choice" onClick=${() => { close(); openCheckin(session.date); }}>
      <span class="choice__main">Самочувствие и вес тела<span class="choice__sub">за ${fmtDay(session.date)}</span></span></button>
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
  return html`<${Sheet} title="Параметры тренировки" onClose=${onClose}>
    <${CycleWeekDay} value=${v} days=${days} onChange=${setV} />
    <div class="sheet__section">
      <div class="sheet__label">Дата</div>
      <input class="input" type="date" value=${v.date} onInput=${(e) => setV({ ...v, date: e.currentTarget.value })} />
    </div>
    <p class="muted" style="font-size:13px">Состав упражнений не меняется — меняются только отметки дня и фазы.</p>
    <button type="button" class="btn btn--primary btn--block" style="margin-top:12px" disabled=${!v.date} onClick=${async () => {
      await app.store.updateSession(session.id, v);
      onClose();
    }}>Сохранить</button>
  <//>`;
}

export function CycleWeekDay({ value, days, onChange }) {
  return html`
    <div class="sheet__section">
      <div class="sheet__label">Неделя цикла</div>
      <${Seg} fill label="Неделя цикла" value=${value.week} onChange=${(week) => onChange({ ...value, week })}
        options=${[1, 2, 3].map((w) => ({ value: w, label: html`<${Plate} week=${w} size="sm" /> ${w === 1 ? 'лёгкая' : PHASE[w].reps.join('–')}` }))} />
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
  // Bodyweight is NOT pre-filled from an older weigh-in: saving recovery alone must not
  // invent a measurement. The last value is shown as a hint and as the ± starting point.
  const [v, setV] = useState({
    recovery: prev?.recovery ?? null,
    sleep: prev?.sleep ?? null,
    bodyweight: prev?.bodyweight ?? null,
  });
  return html`<${Sheet} title=${`Самочувствие, ${fmtDay(date)}`} onClose=${onClose}>
    <${MetricFields} v=${v} setV=${setV} />
    <button type="button" class="btn btn--primary btn--block" style="margin-top:14px" onClick=${async () => {
      await app.store.saveMetric(date, v);
      onClose();
      app.ui.toast('Сохранено');
    }}>Сохранить</button>
  <//>`;
}

export function MetricFields({ v, setV }) {
  const lastWeight = latestBodyweight();
  return html`
    <div class="sheet__section">
      <div class="sheet__label">Восстановление: 1 — разбит, 5 — отлично</div>
      <div class="scale" role="group" aria-label="Восстановление">
        ${[1, 2, 3, 4, 5].map((n) => html`<button type="button" aria-pressed=${String(v.recovery === n)} onClick=${() => setV({ ...v, recovery: v.recovery === n ? null : n })}>${n}</button>`)}
      </div>
    </div>
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
  const bw = latestBodyweight();
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
  return html`<${Sheet} title="Итог тренировки" onClose=${onClose}>
    <p class="muted">${allSets} ${plural(allSets, 'подход', 'подхода', 'подходов')}${minutes > 0 ? `, ${minutes} мин` : ''}. Сравнение — с той же неделей прошлого цикла.</p>
    <ul class="rows" style="margin-top:10px">
      ${rows.filter((r) => r.sets.length).map((r) => {
        const cur = { sets: r.sets.filter((s) => !s.drop), category: r.item.category };
        const ref = r.prevs.samePhase;
        const cmp = ref && cur.sets.length ? compareExposures(cur, ref, { category: r.item.category, bodyweight: bw }) : null;
        const d = cmp ? describeComparison(cmp) : null;
        return html`<li class="row">
          <span class="row__title">${r.item.name}</span>
          <span class=${d ? 'delta--' + d.tone : 'muted'} style="font-size:14px">${d ? d.short : 'нет сравнения'}</span>
          <span class="row__sub">${r.sets.map((s) => `${s.drop ? 'дроп ' : ''}${fmtWeight(s.weight, r.item.category)}×${s.reps}`).join(', ')}</span>
        </li>`;
      })}
    </ul>
    ${missing > 0 ? html`<p class="warn-line">Не выполнено подходов по плану: ${missing}. Можно завершить и так.</p>` : null}
    <div class="btn-row" style="margin-top:14px">
      <button type="button" class="btn" onClick=${onClose}>Продолжить</button>
      <button type="button" class="btn btn--primary" onClick=${finish}>Завершить</button>
    </div>
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
