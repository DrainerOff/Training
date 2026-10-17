// Personal records: overview (inside «Прогресс»), a card per exercise variant, manual entry.

import { html, useState, app, Icon, Sheet, openSheet, NumberPad, Stepper, RirPicker, confirmSheet, local } from './core.js';
import { recordsDerived } from './derive.js';
import { STATE, assess, describeEvent as describe, fmtLoad, repProgress, chartReps, estimateProgress, estimate1rm, bodyweightNear, recentAchievements, day } from '../lib/records.js';
import { allOptions, CATEGORY } from '../lib/program.js';
import { fmtDay, fmtDayShort, fmtNum, isoDate, normName, parseNum, plural, daysBetween } from '../lib/util.js';

const RANK = { new: 0, improvable: 1, steady: 2, unknown: 3 };

export function StateLabel({ state }) {
  const s = STATE[state];
  return html`<span class=${'status status--' + s.tone} data-state=${state}><span class="status__glyph" aria-hidden="true">${state === 'new' ? '★' : state === 'improvable' ? '↑' : state === 'steady' ? '•' : '·'}</span>${s.label}</span>`;
}

function Source({ perf }) {
  return perf.source === 'manual'
    ? html`<span class="src src--manual">вручную</span>`
    : html`<span class="src">тренировка</span>`;
}

// Dates outside this year carry the year: a record from April 2025 must not read as this April.
const thisYear = () => new Date().getFullYear();
const when = (iso) => day(iso, thisYear());
const describeEvent = (e) => describe(e, { thisYear: thisYear() });
const setText = (p, category = p.category) => (category === 'pullup' ? `${p.weight > 0 ? `+${fmtNum(p.weight)}` : 'СВ'}×${p.reps}` : `${fmtNum(p.weight)}×${p.reps}`);
const repsWord = (n) => plural(n, 'повторение', 'повторения', 'повторений');

// ---------------------------------------------------------------- overview (in «Прогресс»)

export function RecordsOverview() {
  const { books, metrics, steps } = recordsDerived();
  const today = isoDate();
  const list = [...books.values()].map((b) => ({ book: b, a: assess(b, { today, metrics, step: steps.get(b.key) || 2.5 }) }));
  list.sort((x, y) => RANK[x.a.state] - RANK[y.a.state] || (x.book.perfs.at(-1).date < y.book.perfs.at(-1).date ? 1 : -1));
  const fresh = recentAchievements(books, { today, days: 60, limit: 5 });
  const open = (key) => app.ui.go({ view: { type: 'records', key } });

  if (!list.length) {
    return html`<div class="empty">
      <h2>Рекордов пока нет</h2>
      <p>Рекорды появятся сами после тренировок. Прошлые достижения можно добавить вручную.</p>
      <button type="button" class="btn btn--primary" style="margin-top:14px" onClick=${() => openRecordSheet({})}><${Icon} name="plus" />Добавить рекорд</button>
    </div>`;
  }
  return html`
    <p class="muted" style="font-size:14px">Рекорд — наибольший вес на конкретное число повторений, отдельно для каждого варианта упражнения. Новый рекорд не стирает прежние: вся история сохраняется.</p>
    ${fresh.length
      ? html`<h2 class="section-title">Новые рекорды</h2>
        <ul class="rows">${fresh.map(({ book, event }) => html`<li><button type="button" class="row" onClick=${() => open(book.key)}>
          <span class="row__title">${book.name}</span>
          <span class="row__date muted">${when(event.date)}</span>
          <span class="row__sub">${describeEvent(event)} · <${Source} perf=${event.perf} /></span>
        </button></li>`)}</ul>`
      : null}
    <h2 class="section-title">Упражнения</h2>
    <ul class="rows">${list.map(({ book, a }) => {
      const top = book.table.filter((r) => !r.coveredBy).slice(0, 3); // the heaviest standing records
      return html`<li><button type="button" class="row" onClick=${() => open(book.key)}>
        <span class="row__title">${book.name}</span>
        <${StateLabel} state=${a.state} />
        <span class="row__sub num-list">${top.map((r) => html`<span><b>${fmtLoad(r.best.weight, book.category)}</b> × ${r.reps}</span>`)}</span>
      </button></li>`;
    })}</ul>
  `;
}

// ---------------------------------------------------------------- one exercise

export function RecordsDetail({ seriesKey }) {
  const { books, metrics, steps, duplicates } = recordsDerived();
  const [showCovered, setShowCovered] = useState(false);
  const book = books.get(seriesKey);
  const manual = [...app.store.state.records.values()].filter((r) => r.seriesKey === seriesKey && !r.deleted).sort((a, b) => (a.date < b.date ? 1 : -1));
  const name = book?.name || manual[0]?.exercise || seriesKey;
  const category = book?.category || manual[0]?.category || null;
  const today = isoDate();
  const a = assess(book, { today, metrics, step: steps.get(seriesKey) || 2.5 });
  const est = book ? estimate1rm({ ...book.heaviest, rir: null }, { bodyweight: bodyweightNear(metrics, book.heaviest.date) }) : null;
  const add = () => openRecordSheet({ preset: { seriesKey, exercise: name, category } });

  return html`<main class="screen">
    <header class="topbar">
      <button type="button" class="icon-btn" aria-label="Назад" onClick=${() => app.ui.back()}><${Icon} name="back" /></button>
      <h1>${name}</h1>
    </header>

    <div class=${'callout callout--' + STATE[a.state].tone}>
      <div class="callout__head"><${StateLabel} state=${a.state} /></div>
      <ul>${a.reasons.map((r) => html`<li>${r}</li>`)}</ul>
    </div>

    ${book
      ? html`
        <h2 class="section-title">Текущие рекорды</h2>
        <ul class="rec-table" aria-label="Рекорды по числу повторений">
          ${book.table.filter((r) => showCovered || !r.coveredBy).map((r) => html`<li class=${'rec' + (r.coveredBy ? ' rec--covered' : '')}>
            <span class="rec__reps"><b class="num">${r.reps}</b>повт.</span>
            <span class="rec__load num">${fmtLoad(r.best.weight, category)}</span>
            <span class="rec__meta">${when(r.best.date)}${r.best.rir != null ? `, RIR ${fmtNum(r.best.rir)}` : ''} · <${Source} perf=${r.best} /></span>
            ${r.coveredBy ? html`<span class="rec__covered">перекрыт: ${setText(r.coveredBy, category)}, ${when(r.coveredBy.date)}</span>` : null}
          </li>`)}
        </ul>
        ${book.table.some((r) => r.coveredBy)
          ? html`<button type="button" class="link rec-more" aria-expanded=${String(showCovered)} onClick=${() => setShowCovered(!showCovered)}>${showCovered
              ? 'Скрыть перекрытые'
              : `Показать перекрытые (${book.table.filter((r) => r.coveredBy).length}) — позже поднято больше на большее число повторений`}</button>`
          : null}
        <div class="rec-facts">
          <p><b>Максимальный вес:</b> ${fmtLoad(book.heaviest.weight, category)} на ${book.heaviest.reps} ${repsWord(book.heaviest.reps)}, ${when(book.heaviest.date)}.</p>
          ${est != null && !book.table.some((r) => r.reps === 1)
            ? html`<p class="muted">Расчётный 1ПМ ≈ ${fmtNum(est, 1)} кг — ориентир по формуле, а не рекорд: подхода на 1 повторение не было.</p>`
            : null}
          ${category === 'pullup' ? html`<p class="muted">Подтягивания сравниваются по дополнительному весу; масса тела в рекорд не входит.</p>` : null}
        </div>

        <h2 class="section-title">Динамика</h2>
        <${RecordChart} book=${book} metrics=${metrics} />

        <h2 class="section-title">История рекордов</h2>
        <ol class="rec-history">
          ${[...book.events].reverse().map((e) => html`<li class=${'rec-event' + (e.kind === 'record' ? ' rec-event--record' : '')}>
            <span class="rec-event__date">${when(e.date)} · ${e.perf.source === 'manual'
              ? html`<button type="button" class="rec-event__src rec-event__src--manual" onClick=${() => openRecordSheet({ record: app.store.state.records.get(e.perf.recordId) })}>вручную ›</button>`
              : html`<button type="button" class="rec-event__src" onClick=${() => app.ui.go({ view: { type: 'session', id: e.perf.sessionId } })}>тренировка ›</button>`}</span>
            <span class="rec-event__text">${describeEvent(e)}</span>
          </li>`)}
        </ol>`
      : html`<p class="muted" style="margin:12px 0">Для этого упражнения пока нет результатов, которые можно считать рекордом.</p>`}

    <h2 class="section-title">Добавлено вручную</h2>
    ${manual.length
      ? html`<ul class="rows">${manual.map((r) => {
          const twin = duplicates.get(r.id);
          return html`<li><button type="button" class="row" onClick=${() => openRecordSheet({ record: r })}>
            <span class="row__title num-list"><b>${setText(r, category)}</b></span>
            <span class="muted">${when(r.date)}</span>
            <span class="row__sub">${[r.rir != null ? `RIR ${fmtNum(r.rir)}` : null, r.bodyweight ? `масса тела ${fmtNum(r.bodyweight)} кг` : null, r.note || null, twin ? `совпадает с подходом из тренировки ${when(twin.date)} — учтён один раз` : null].filter(Boolean).join(' · ') || 'изменить или удалить'}</span>
          </button></li>`;
        })}</ul>`
      : html`<p class="muted" style="font-size:14px">Нет. Добавьте прошлый рекорд, если он был до приложения.</p>`}
    <button type="button" class="btn btn--block" style="margin-top:14px" onClick=${add}><${Icon} name="plus" />Добавить рекорд вручную</button>
  </main>`;
}

// ---------------------------------------------------------------- chart

const W = 340;
const H = 180;
const M = { l: 38, r: 12, t: 12, b: 26 };

function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

// One rep count per chart (a record for 6 reps never shares a line with 10); "1ПМ (расчёт)"
// is the only cross-rep view, and it says so.
function RecordChart({ book, metrics }) {
  const reps = chartReps(book).slice(0, 5);
  const key = `records.chart:${book.key}`;
  const [mode, setModeRaw] = useState(() => {
    const saved = local.get(key);
    return saved === 'e1rm' || reps.includes(saved) ? saved : reps[0];
  });
  const setMode = (m) => {
    local.set(key, m);
    setModeRaw(m);
  };
  const [tip, setTip] = useState(null);
  const today = isoDate();
  const isEst = mode === 'e1rm';
  const pts = isEst
    ? estimateProgress(book, { metrics }).map((p) => ({ date: p.date, v: p.value, label: `${setText(p.from, book.category)}${p.from.rir != null ? `, RIR ${fmtNum(p.from.rir)}` : ''}`, source: p.from.source }))
    : repProgress(book, mode).map((p) => ({ date: p.date, v: p.weight, label: `${fmtLoad(p.weight, book.category)} × ${mode}`, source: p.source }));

  const tabs = html`<div class="seg seg--chips" role="group" aria-label="Что показать">
    ${reps.map((r) => html`<button type="button" aria-pressed=${String(mode === r)} onClick=${() => { setMode(r); setTip(null); }}>${r} повт.</button>`)}
    <button type="button" aria-pressed=${String(isEst)} onClick=${() => { setMode('e1rm'); setTip(null); }}>1ПМ (расчёт)</button>
  </div>`;

  if (!pts.length) {
    return html`${tabs}<div class="chart chart-empty">${isEst ? 'Для расчёта нужны подходы до 12 повторений (для подтягиваний — с записанной массой тела).' : 'Нет данных.'}</div>`;
  }
  const end = pts[pts.length - 1].date > today ? pts[pts.length - 1].date : today;
  const t0 = pts[0].date;
  const span = Math.max(1, daysBetween(t0, end));
  const x = (d) => M.l + (daysBetween(t0, d) / span) * (W - M.l - M.r);
  let lo = Math.min(...pts.map((p) => p.v));
  let hi = Math.max(...pts.map((p) => p.v));
  const pad = (hi - lo) * 0.15 || Math.max(2.5, hi * 0.05);
  lo = Math.max(0, lo - pad);
  hi += pad;
  const ticks = niceTicks(lo, hi);
  lo = Math.min(lo, ticks[0]);
  hi = Math.max(hi, ticks[ticks.length - 1]);
  const y = (v) => M.t + (1 - (v - lo) / (hi - lo || 1)) * (H - M.t - M.b);
  // Records only ever go up: a step line that holds each value until it is beaten (to today).
  let d = '';
  if (isEst) d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  else {
    pts.forEach((p, i) => {
      d += i ? `H${x(p.date).toFixed(1)}V${y(p.v).toFixed(1)}` : `M${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`;
    });
    d += `H${x(end).toFixed(1)}`;
  }
  const sel = tip != null && pts[tip] ? tip : pts.length - 1;
  return html`${tabs}<figure class="chart" style="margin:8px 0 0">
    <svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${isEst ? 'Расчётный 1ПМ по дням — ориентир' : `Рекорд на ${mode} ${repsWord(mode)} по времени`}>
      ${ticks.map((t) => html`<g>
        <line x1=${M.l} x2=${W - M.r} y1=${y(t)} y2=${y(t)} stroke="var(--hairline)" stroke-width="1" />
        <text x=${M.l - 6} y=${y(t) + 4} text-anchor="end" font-size="11" fill="var(--steel)">${fmtNum(t, 1)}</text>
      </g>`)}
      <text x=${M.l} y=${H - 6} font-size="11" fill="var(--steel)">${fmtDayShort(t0)}</text>
      <text x=${W - M.r} y=${H - 6} text-anchor="end" font-size="11" fill="var(--steel)">${end === today ? 'сегодня' : fmtDayShort(end)}</text>
      <path d=${d} fill="none" stroke=${isEst ? 'var(--steel)' : 'var(--plate-2)'} stroke-width="2.5" stroke-dasharray=${isEst ? '5 4' : null} stroke-linejoin="round" />
      ${pts.map((p, i) => html`<circle cx=${x(p.date)} cy=${y(p.v)} r=${i === sel ? 6.5 : 5}
        fill=${p.source === 'manual' ? 'var(--paper)' : isEst ? 'var(--steel)' : 'var(--plate-2)'} stroke=${p.source === 'manual' ? 'var(--plate-2)' : 'var(--paper)'} stroke-width="2.5" />`)}
      ${pts.map((p, i) => html`<circle cx=${x(p.date)} cy=${y(p.v)} r="16" fill="transparent" tabindex="0" role="button"
        aria-label=${`${when(p.date)}: ${p.label}`} onClick=${() => setTip(i)} onFocus=${() => setTip(i)} />`)}
    </svg>
    <div class="chart__readout" aria-live="polite">
      ${when(pts[sel].date)} · ${pts[sel].source === 'manual' ? 'вручную' : 'тренировка'}
      <strong>${isEst ? `≈ ${fmtNum(pts[sel].v, 1)} кг · ${pts[sel].label}` : pts[sel].label}</strong>
    </div>
    <figcaption class="muted" style="font-size:12px;padding:2px 8px 4px">${isEst
      ? 'Расчётный 1ПМ (формула Эпли с учётом RIR до 3) — только для сравнения разных повторений. Это не рекорд.'
      : pts.length === 1
        ? `Пока один результат на ${mode} ${repsWord(mode)} — линия продолжится со следующим рекордом.`
        : `Рекорд на ${mode} ${repsWord(mode)}: держится, пока его не превысят. Пустые точки — добавлено вручную.`}</figcaption>
  </figure>`;
}

// ---------------------------------------------------------------- add / edit

// Variants from the program (each one separate), then exercises that exist only in the history.
function exerciseChoices() {
  const st = app.store.state;
  const seen = new Set();
  const out = [];
  for (const o of allOptions(st.program)) {
    if (seen.has(o.key)) continue;
    seen.add(o.key);
    out.push({ seriesKey: o.key, exercise: o.name, category: o.slot.category, step: o.slot.step || 2.5, group: `День ${o.day}` });
  }
  const { books } = recordsDerived();
  for (const b of books.values()) {
    if (seen.has(b.key)) continue;
    seen.add(b.key);
    out.push({ seriesKey: b.key, exercise: b.name, category: b.category, step: 2.5, group: 'Из истории' });
  }
  return out;
}

function ExercisePicker({ onPick, onClose }) {
  const [q, setQ] = useState('');
  const all = exerciseChoices();
  const n = normName(q);
  const list = n ? all.filter((c) => normName(c.exercise).includes(n)) : all;
  const groups = [];
  for (const c of list) {
    let g = groups.find((x) => x.name === c.group);
    if (!g) groups.push((g = { name: c.group, items: [] }));
    g.items.push(c);
  }
  return html`<${Sheet} title="Упражнение" onClose=${onClose}>
    <input class="input" type="search" placeholder="Поиск по названию" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} aria-label="Поиск упражнения" />
    <p class="muted" style="font-size:13px;margin:8px 0 0">Каждый вариант — отдельная серия рекордов: Hammer и гантели, наклон и горизонт, хваты подтягиваний не смешиваются.</p>
    ${groups.map((g) => html`<div class="sheet__section">
      <div class="sheet__label">${g.name}</div>
      ${g.items.map((c) => html`<button type="button" class="choice" onClick=${() => { onPick(c); onClose(); }}>
        <span class="choice__main">${c.exercise}<span class="choice__sub">${CATEGORY[c.category]?.label || ''}</span></span>
      </button>`)}
    </div>`)}
    ${groups.length ? null : html`<p class="muted" style="margin-top:12px">Ничего не найдено.</p>`}
  <//>`;
}

export function openRecordSheet({ record = null, preset = null } = {}) {
  openSheet((close) => html`<${RecordSheet} record=${record} preset=${preset} onClose=${close} />`);
}

function RecordSheet({ record, preset, onClose }) {
  const { metrics, steps } = recordsDerived();
  const init = record || preset || {};
  const [v, setV] = useState({
    seriesKey: init.seriesKey || null,
    exercise: init.exercise || '',
    category: init.category || null,
    date: record?.date || isoDate(),
    weight: record?.weight ?? null,
    reps: record?.reps ?? null,
    rir: record?.rir ?? null,
    bodyweight: record?.bodyweight ?? null,
    note: record?.note || '',
  });
  const [busy, setBusy] = useState(false);
  const up = (p) => setV((x) => ({ ...x, ...p }));
  const pullup = v.category === 'pullup';
  const step = (v.seriesKey && steps.get(v.seriesKey)) || 2.5;
  const knownBw = pullup ? bodyweightNear(metrics, v.date) : null;
  const today = isoDate();
  const problem = !v.seriesKey
    ? 'Выберите упражнение'
    : v.weight == null || (!pullup && !(v.weight > 0))
      ? 'Укажите вес'
      : !(v.reps >= 1 && v.reps <= 30 && Number.isInteger(v.reps))
        ? 'Укажите повторения (1–30)'
        : !/^\d{4}-\d{2}-\d{2}$/.test(v.date) || v.date > today
          ? 'Дата не может быть в будущем'
          : null;

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    try {
      const saved = await app.store.saveRecord({ ...(record || {}), ...v, bodyweight: pullup ? v.bodyweight : null });
      onClose();
      app.ui.toast(feedback(saved, !!record));
    } catch (err) {
      setBusy(false);
      app.ui.toast(`Не удалось сохранить: ${err.message}`);
    }
  };
  const remove = async () => {
    const ok = await confirmSheet({ title: 'Удалить запись?', text: 'Остальные рекорды и история не изменятся.', okLabel: 'Удалить', danger: true });
    if (!ok) return;
    await app.store.deleteRecord(record.id);
    onClose();
    app.ui.toast('Запись удалена', { action: { label: 'Вернуть', fn: () => app.store.restoreRecord(record.id) } });
  };

  return html`<${Sheet} title=${record ? 'Изменить рекорд' : 'Новый рекорд'} onClose=${onClose}>
    <button type="button" class="choice" aria-label=${`Упражнение: ${v.exercise || 'не выбрано'}`}
      onClick=${() => openSheet((c) => html`<${ExercisePicker} onClose=${c} onPick=${(x) => up({ seriesKey: x.seriesKey, exercise: x.exercise, category: x.category })} />`)}>
      <span class="choice__main">${v.exercise || 'Выберите упражнение'}<span class="choice__sub">${v.exercise ? `${CATEGORY[v.category]?.label || ''} · изменить` : 'вариант из вашей программы'}</span></span>
      <${Icon} name="swap" />
    </button>
    <div class="dock__grid" style="margin-top:12px">
      <div>
        <div class="field__label"><span>${pullup ? 'Доп. вес, кг' : 'Вес, кг'}</span>${pullup ? html`<span class="field__hint">0 — свой вес</span>` : null}</div>
        <${Stepper} label=${pullup ? 'Дополнительный вес' : 'Вес'} value=${v.weight} step=${step} display=${pullup && v.weight === 0 ? 'СВ' : null}
          onChange=${(w) => up({ weight: w })}
          onTap=${() => openSheet((c) => html`<${NumberPad} title=${pullup ? 'Дополнительный вес, кг' : 'Вес, кг'} value=${v.weight} step=${step} unit="кг" onDone=${(w) => w != null && up({ weight: w })} onClose=${c} />`)} />
      </div>
      <div>
        <div class="field__label"><span>Повторения</span></div>
        <${Stepper} label="Повторения" value=${v.reps} step=${1} min=${1} start=${1}
          onChange=${(r) => up({ reps: Math.min(30, Math.round(r)) })}
          onTap=${() => openSheet((c) => html`<${NumberPad} title="Повторения" value=${v.reps} decimals=${false} onDone=${(r) => r != null && up({ reps: Math.round(r) })} onClose=${c} />`)} />
      </div>
    </div>
    <div class="sheet__section">
      <div class="sheet__label">Фактический RIR — если известен</div>
      <${RirPicker} value=${v.rir} onChange=${(rir) => up({ rir })} />
    </div>
    <div class="sheet__section rec-form">
      <label class="kv"><span>Дата</span>
        <input class="input" type="date" max=${today} value=${v.date} onInput=${(e) => up({ date: e.currentTarget.value })} /></label>
      ${pullup
        ? html`<label class="kv"><span>Масса тела, кг — необязательно${knownBw ? ` (записано: ${fmtNum(knownBw)})` : ''}</span>
            <input class="input" inputmode="decimal" placeholder="не указана" value=${v.bodyweight ?? ''} onInput=${(e) => up({ bodyweight: parseNum(e.currentTarget.value) })} /></label>`
        : null}
      <label class="kv"><span>Заметка — необязательно</span>
        <input class="input" placeholder="например, соревнования, до травмы" value=${v.note} onInput=${(e) => up({ note: e.currentTarget.value })} /></label>
    </div>
    ${problem && v.seriesKey ? html`<p class="muted" style="font-size:13px">${problem}</p>` : null}
    <div class="btn-row" style="margin-top:12px">
      ${record ? html`<button type="button" class="btn btn--danger" onClick=${remove}>Удалить</button>` : null}
      <button type="button" class="btn btn--primary" disabled=${!!problem || busy} onClick=${save}>${problem && !v.seriesKey ? problem : 'Сохранить'}</button>
    </div>
  <//>`;
}

// What the owner just saved means for the records — said plainly.
function feedback(rec, edited) {
  const { books, duplicates } = recordsDerived();
  const twin = duplicates.get(rec.id);
  if (twin) return `Такой подход уже есть в тренировке ${when(twin.date)} — учтён один раз.`;
  const book = books.get(rec.seriesKey);
  const ev = book?.events.find((e) => e.perf.recordId === rec.id);
  if (ev?.kind === 'record') return `Сохранено: новый рекорд — ${describeEvent(ev)}.`;
  if (ev) return `Сохранено: ${describeEvent(ev)}.`;
  const row = book?.table.find((r) => r.reps === rec.reps);
  if (row && row.best.recordId !== rec.id) return `Сохранено. На ${rec.reps} ${repsWord(rec.reps)} уже есть результат ${fmtLoad(row.best.weight, book.category)} (${when(row.best.date)}).`;
  return edited ? 'Запись обновлена.' : 'Сохранено.';
}
