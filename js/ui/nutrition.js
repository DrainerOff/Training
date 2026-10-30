// «Питание»: calories and macros per accounting day — today against the goals of the phase, the week
// with its coverage, the history with corrections, goals with their history, a paste from ChatGPT,
// old days from a table. Totals only: no foods, meals, barcodes or photos. Numbers say what they are
// based on; the tone is informative, never a verdict.

import { html, useState, app, openSheet, Sheet, Seg, Toggle, confirmSheet, copyText, local } from './core.js';
import { fmtDay, fmtDayWeekday, fmtNum, plural, isoDate, keepUnits } from '../lib/util.js';
import { phaseOn, MODES, addDays } from '../lib/phase.js';
import {
  FIELDS, LABEL, UNIT, STATUS, SOURCE, DAY_START_HOUR, nutritionId, accountingDate, parseAmount, amountOf, fmtAmount,
  dayLine, goalsOn, goalsFromSameMode, targets, against, percent, fmtTarget, summarize, weekStart, coverageText,
  parseNutritionText, parseNutritionCsv, planNutritionImport, applyExternal, ACTION_TEXT,
} from '../lib/nutrition.js';

export const dayStartHour = () => {
  const h = Number(app.store.state.kv.nutritionDayStart);
  return Number.isInteger(h) && h >= 0 && h <= 10 ? h : DAY_START_HOUR;
};
export const nutritionToday = () => accountingDate(new Date(), dayStartHour());
const fail = (err) => app.ui.toast(err?.message || String(err));
const unitOf = (f) => (f === 'kcal' ? 'ккал' : 'г');

export function Nutrition() {
  const st = app.store.state;
  const today = nutritionToday();
  const phases = [...st.phases.values()];
  const goals = [...st.nutritionGoals.values()];
  const records = [...st.nutrition.values()];
  const phase = phaseOn(phases, today);
  const goal = goalsOn(goals, phases, today);
  const rec = st.nutrition.get(nutritionId(today));
  const day = rec && !rec.deleted ? rec : null;
  const week = summarize(records, { from: weekStart(today), to: addDays(weekStart(today), 6), phase, goals, phases, today });
  const replaced = records.filter((r) => !r.deleted && r.prev && r.date >= addDays(today, -60)).sort((a, b) => b.date.localeCompare(a.date));
  const history = records.filter((r) => !r.deleted).sort((a, b) => b.date.localeCompare(a.date));
  const [more, setMore] = useState(false);

  return html`<div class="nutr">
    ${replaced.map((r) => html`<${ReplacedNotice} rec=${r} />`)}
    <${TodayCard} date=${today} day=${day} goal=${goal} />
    <div class="btn-row nutr-actions">
      <button type="button" class="btn" onClick=${() => openPaste()}>Вставить из ChatGPT</button>
      <button type="button" class="btn" onClick=${() => openDay(day ? day.date : today)}>${day ? 'Изменить день' : 'Записать день'}</button>
    </div>
    <${WeekCard} week=${week} phase=${phase} today=${today} />
    <${GoalsCard} phase=${phase} goal=${goal} today=${today} />

    <h2 class="section-title">Дни</h2>
    ${history.length
      ? html`<ul class="rows" aria-label="Питание по дням">
          ${(more ? history : history.slice(0, 14)).map((r) => html`<li><button type="button" class="row" onClick=${() => openDay(r.date)}>
            <span class="row__title">${fmtDayWeekday(r.date)}</span>
            <span class="num body-value">${fmtAmount(r, 'kcal')} ккал</span>
            <span class="row__sub">${dayLine(r).replace(/^[^·]+· /, '')} · ${SOURCE[r.source] || r.source} · ${STATUS[r.status]}${r.approx || r.ranges ? ' · приблизительно' : ''}</span>
          </button></li>`)}
        </ul>
        ${history.length > 14 && !more ? html`<button type="button" class="btn btn--block nutr-more" onClick=${() => setMore(true)}>Показать все (${history.length})</button>` : null}`
      : html`<p class="muted nutr-empty">Дней пока нет. Запишите итог дня вручную, вставьте блок из ChatGPT или загрузите старые дни таблицей.</p>`}

    <h2 class="section-title">Загрузка и ChatGPT</h2>
    <ul class="rows">
      <li><button type="button" class="row" onClick=${() => openImport()}>
        <span class="row__title">Загрузить старые дни</span><span></span>
        <span class="row__sub">таблица CSV или список дней: сначала предпросмотр, ничего не складывается и не придумывается</span>
      </button></li>
      <li><button type="button" class="row" onClick=${() => openChatGptHelp()}>
        <span class="row__title">Как подключить ChatGPT</span><span></span>
        <span class="row__sub">одна инструкция для чата: лист App_NutritionInbox или блок для вставки</span>
      </button></li>
      <li><button type="button" class="row" onClick=${() => openDayStart()}>
        <span class="row__title">Учётный день</span>
        <span class="body-value">до ${String(dayStartHour()).padStart(2, '0')}:00 — вчера</span>
        <span class="row__sub">после полуночи день не меняется, пока вы не легли спать</span>
      </button></li>
    </ul>
  </div>`;
}

// ---------------------------------------------------------------- today

function TodayCard({ date, day, goal }) {
  const t = targets(goal);
  const kcal = amountOf(day, 'kcal');
  const pct = kcal ? percent(kcal.value, t?.kcal) : null;
  return html`<section class="phase nutr-today" aria-label="Питание за учётный день">
    <div class="phase__head">
      <div class="phase__tagline">
        <span class="phase__tag">${fmtDay(date)}</span>
        <span class="phase__since">${day ? `${STATUS[day.status]}${day.approx || day.ranges ? ' · приблизительно' : ''} · ${SOURCE[day.source] || day.source}` : 'учётный день'}</span>
      </div>
    </div>
    ${day
      ? html`<div class="phase__label">Калории</div>
          <div class="nutr-hero">
            <span class="num phase__rate">${fmtAmount(day, 'kcal')}</span>
            <span class="nutr-hero__goal">${t?.kcal ? html`из ${fmtTarget(t.kcal, 'kcal')}${pct != null ? html` · <b class="num">${pct}%</b>` : ''}` : 'цель не задана'}</span>
          </div>
          <div class="nutr-macros">
            ${['protein', 'fat', 'carbs'].map((f) => html`<${MacroCell} f=${f} day=${day} t=${t?.[f]} rest=${f === 'carbs' && t?.carbsRest} />`)}
          </div>
          ${day.comment ? html`<p class="phase__text">${day.comment}</p>` : null}`
      : html`<p class="phase__text">За ${fmtDay(date)} записи ещё нет. Учётный день сменится в ${String(dayStartHour()).padStart(2, '0')}:00, а не в полночь.</p>`}
  </section>`;
}

function MacroCell({ f, day, t, rest }) {
  const a = amountOf(day, f);
  const res = a ? against(a.value, t) : null;
  const pct = a ? percent(a.value, t) : null;
  const word = res === 'below' ? (t[1] == null ? 'ниже минимума' : 'ниже цели') : res === 'above' ? 'выше цели' : res === 'within' ? 'в цели' : '';
  return html`<div class="nutr-cell" data-state=${res || 'none'}>
    <div class="phase__label">${LABEL[f]}, г</div>
    <div class="num nutr-cell__value">${fmtAmount(day, f)}</div>
    <div class="nutr-cell__goal">${t ? `${rest ? 'остаток ' : ''}${fmtTarget(t, f)}` : rest ? 'остаток: нужны цели калорий, белков и жиров' : 'цель не задана'}${pct != null ? ` · ${pct}%` : ''}</div>
    ${word ? html`<div class="nutr-cell__state">${word}</div>` : null}
  </div>`;
}

function ReplacedNotice({ rec }) {
  const p = rec.prev;
  return html`<section class="notice notice--caution" role="status" aria-label=${`Замена ручной записи, ${fmtDay(rec.date)}`}>
    <h3>${fmtDay(rec.date)}: запись из ChatGPT заменила ваши значения</h3>
    <p>Сейчас: ${dayLine(rec)}. Было вручную: ${dayLine(p)}.</p>
    <div class="btn-row">
      <button type="button" class="btn" onClick=${() => app.store.revertNutrition(rec.id).then(() => app.ui.toast('Вернули значения, введённые вручную'), fail)}>Вернуть мои</button>
      <button type="button" class="btn" onClick=${() => app.store.keepNutrition(rec.id).catch(fail)}>Оставить ChatGPT</button>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- the week

function WeekCard({ week, phase, today }) {
  const s = week;
  const lines = [];
  if (!phase) lines.push('Режим не задан: неделя считается без целей. Режим задаётся на вкладке «Тело».');
  const a = s.avg;
  if (a.kcal) lines.push(`Средняя калорийность по ${a.kcal.n} из ${s.days} ${plural(s.days, 'дня', 'дней', 'дней')} — ${a.kcal.approx ? '≈' : ''}${fmtNum(a.kcal.value, 0)} ккал.`);
  if (a.protein) lines.push(`Белки в среднем ${a.protein.approx ? '≈' : ''}${fmtNum(a.protein.value, 0)} г, жиры ${a.fat ? fmtNum(a.fat.value, 0) : '–'} г, углеводы ${a.carbs ? fmtNum(a.carbs.value, 0) : '–'} г.`);
  const pb = s.check.protein.below.length;
  const pw = s.check.protein.within.length + s.check.protein.above.length;
  if (pb + pw) lines.push(pb ? `Белок ниже цели в ${pb} ${plural(pb, 'дне', 'днях', 'днях')} из ${pb + pw}.` : pw === 1 ? 'Белок не ниже цели (1 день).' : `Белок не ниже цели во всех ${pw} ${plural(pw, 'дне', 'днях', 'днях')}.`);
  const k = s.check.kcal;
  if (k.below.length + k.within.length + k.above.length) {
    lines.push(`Калории в цели — ${k.within.length} ${plural(k.within.length, 'день', 'дня', 'дней')}${k.below.length ? `, ниже — ${k.below.length}` : ''}${k.above.length ? `, выше — ${k.above.length}` : ''}.`);
  }
  if (s.approxDays) lines.push(`${s.approxDays} ${plural(s.approxDays, 'день', 'дня', 'дней')} с приблизительными значениями или диапазоном: средние помечены «≈».`);
  return html`<section class="notice nutr-week" aria-label="Питание за неделю">
    <h3>Неделя с ${fmtDay(s.from)}${phase && phase.start > s.from ? ` (режим с ${fmtDay(phase.start)})` : ''}</h3>
    <p class="nutr-week__cov">${coverageText(s)}${s.final && s.final < 3 ? ' — для выводов мало дней' : ''}</p>
    ${s.final ? html`<ul class="nutr-lines">${lines.map((l) => html`<li>${keepUnits(l)}</li>`)}</ul>` : html`<p>${lines[0] || 'Итогов дней за эту неделю ещё нет.'}</p>`}
    <div class="btn-row"><button type="button" class="btn" onClick=${() => app.ui.go({ view: { type: 'report' } })}>Отчёт за неделю</button></div>
  </section>`;
}

// ---------------------------------------------------------------- goals

function GoalsCard({ phase, goal, today }) {
  const t = targets(goal);
  if (!phase) {
    return html`<section class="notice" aria-label="Цели по питанию">
      <h3>Цели по питанию</h3>
      <p>Цели привязаны к режиму (набор, сушка, поддержание) и его датам. Задайте режим на вкладке «Тело», затем цели здесь.</p>
    </section>`;
  }
  return html`<section class="notice" aria-label="Цели по питанию">
    <h3>Цели · ${MODES[phase.mode].label} с ${fmtDay(phase.start)}</h3>
    ${t
      ? html`<ul class="nutr-lines">
          ${FIELDS.map((f) => html`<li>${LABEL[f]}: ${f === 'carbs' && t.carbsRest ? (t.carbs ? `остаток, ${fmtTarget(t.carbs, f)}` : 'остаток') : fmtTarget(t[f], f)}${f === 'protein' && t.protein && t.protein[1] == null ? ' (минимум)' : ''}</li>`)}
        </ul>
        ${goal.from > phase.start ? html`<p class="muted nutr-small">Действуют с ${fmtDay(goal.from)}.</p>` : null}`
      : html`<p>Цели для этого режима не заданы.</p>`}
    <div class="btn-row"><button type="button" class="btn" onClick=${() => openGoals(phase.id, today)}>${t ? 'Изменить цели' : 'Задать цели'}</button></div>
  </section>`;
}

function openGoals(phaseId, today) {
  openSheet((close) => html`<${GoalsSheet} phaseId=${phaseId} today=${today} onClose=${close} />`);
}

const str = (v) => (v == null ? '' : String(v).replace('.', ','));
const numOrNull = (v) => {
  const a = parseAmount(v, 'kcal');
  return a && a.value != null ? a.value : null;
};

function GoalsSheet({ phaseId, today, onClose }) {
  const st = app.store.state;
  const phase = st.phases.get(phaseId);
  const goals = [...st.nutritionGoals.values()];
  const mine = goals.filter((g) => !g.deleted && g.phaseId === phaseId).sort((a, b) => b.from.localeCompare(a.from));
  const base = mine[0] || goalsFromSameMode(goals, st.phases.values(), phase);
  const [v, setV] = useState(() => ({
    from: mine.length ? (today >= phase.start ? today : phase.start) : phase.start,
    kcalMin: str(base?.kcalMin), kcalMax: str(base?.kcalMax), proteinMin: str(base?.proteinMin), proteinMax: str(base?.proteinMax),
    fatMin: str(base?.fatMin), fatMax: str(base?.fatMax), carbsMin: str(base?.carbsMin), carbsMax: str(base?.carbsMax),
    carbsMode: base?.carbsMode || 'rest', note: base?.note || '',
  }));
  const set = (k) => (e) => setV({ ...v, [k]: e.currentTarget.value });
  const g = Object.fromEntries(['kcalMin', 'kcalMax', 'proteinMin', 'proteinMax', 'fatMin', 'fatMax', 'carbsMin', 'carbsMax'].map((k) => [k, numOrNull(v[k])]));
  // One number = exactly that (kcal, fat, explicit carbs); protein alone = a minimum.
  for (const f of ['kcal', 'fat', 'carbs']) {
    if (g[f + 'Min'] == null && g[f + 'Max'] != null) g[f + 'Min'] = g[f + 'Max'];
    if (g[f + 'Max'] == null && g[f + 'Min'] != null) g[f + 'Max'] = g[f + 'Min'];
  }
  const preview = targets({ ...g, carbsMode: v.carbsMode });
  const bad = ['kcal', 'protein', 'fat', 'carbs'].some((f) => g[f + 'Min'] != null && g[f + 'Max'] != null && g[f + 'Min'] > g[f + 'Max']);
  const fromOk = v.from >= phase.start && (!phase.end || v.from <= phase.end);
  const save = async () => {
    try {
      await app.store.saveNutritionGoals({ phaseId, from: v.from, ...g, carbsMode: v.carbsMode, note: v.note });
      app.ui.toast('Цели сохранены');
      onClose();
    } catch (err) {
      fail(err);
    }
  };
  const pair = (f, a, b, hint) => html`<div class="sheet__section">
    <div class="sheet__label">${LABEL[f]}, ${unitOf(f)} — ${hint}</div>
    <div class="nutr-pair">
      <input class="input" inputmode="decimal" aria-label=${`${LABEL[f]}: от`} placeholder="от" value=${v[a]} onInput=${set(a)} />
      <span aria-hidden="true">–</span>
      <input class="input" inputmode="decimal" aria-label=${`${LABEL[f]}: до`} placeholder="до" value=${v[b]} onInput=${set(b)} />
    </div>
  </div>`;
  const footer = html`<button type="button" class="btn btn--primary" disabled=${bad || !fromOk} onClick=${save}>Сохранить</button>`;
  return html`<${Sheet} title="Цели по питанию" onClose=${onClose} footer=${footer}>
    <p class="muted nutr-small">${MODES[phase.mode].label} с ${fmtDay(phase.start)}${phase.end ? ` по ${fmtDay(phase.end)}` : ''}. Изменение с другой даты сохраняется отдельно — прошлые дни считаются по своим целям.</p>
    <div class="sheet__section">
      <label class="sheet__label" for="goal-from">Действуют с</label>
      <input id="goal-from" class="input" type="date" min=${phase.start} max=${phase.end || ''} value=${v.from} onInput=${set('from')} />
    </div>
    ${pair('kcal', 'kcalMin', 'kcalMax', 'число или диапазон')}
    ${pair('protein', 'proteinMin', 'proteinMax', 'минимум или диапазон')}
    ${pair('fat', 'fatMin', 'fatMax', 'число или диапазон')}
    <div class="sheet__section">
      <div class="sheet__label">Углеводы</div>
      <${Seg} label="Углеводы" fill=${true} value=${v.carbsMode} onChange=${(m) => setV({ ...v, carbsMode: m })}
        options=${[{ value: 'rest', label: 'Остаток' }, { value: 'explicit', label: 'Задать' }]} />
      ${v.carbsMode === 'rest'
        ? html`<p class="muted nutr-small">${preview?.carbs ? `Остаток калорий после белков (4 ккал/г) и жиров (9 ккал/г): ${fmtTarget(preview.carbs, 'carbs')}.` : 'Остаток считается, когда заданы калории, белки и жиры.'}</p>`
        : null}
    </div>
    ${v.carbsMode === 'explicit' ? pair('carbs', 'carbsMin', 'carbsMax', 'число или диапазон') : null}
    <div class="sheet__section">
      <input class="input" aria-label="Заметка к целям" placeholder="Заметка" value=${v.note} onInput=${set('note')} />
    </div>
    ${bad ? html`<p class="warn-line">Начало диапазона больше конца.</p>` : null}
    ${!fromOk ? html`<p class="warn-line">Дата должна быть внутри режима.</p>` : null}
    ${mine.length
      ? html`<h3 class="section-title">История целей</h3>
          <ul class="rows">${mine.map((x) => {
            const t = targets(x);
            return html`<li class="row"><span class="row__title">с ${fmtDay(x.from)}</span><span></span>
              <span class="row__sub">${fmtTarget(t.kcal, 'kcal')} · Б ${fmtTarget(t.protein, 'protein')} · Ж ${fmtTarget(t.fat, 'fat')} · У ${t.carbsRest ? 'остаток' : fmtTarget(t.carbs, 'carbs')}</span></li>`;
          })}</ul>`
      : null}
  <//>`;
}

// ---------------------------------------------------------------- one day

export function openDay(date) {
  openSheet((close) => html`<${DaySheet} date=${date} onClose=${close} />`);
}

function DaySheet({ date, onClose }) {
  const st = app.store.state;
  const cur = st.nutrition.get(nutritionId(date));
  const has = cur && !cur.deleted;
  const init = () => {
    const out = { date, status: has ? cur.status : 'final', approx: has ? !!cur.approx : false, comment: has ? cur.comment || '' : '' };
    for (const f of FIELDS) {
      const r = has ? cur.ranges?.[f] : null;
      out[f] = r ? `${r[0]}-${r[1]}` : has && cur[f] != null ? String(cur[f]).replace('.', ',') : '';
    }
    return out;
  };
  const [v, setV] = useState(init);
  const set = (k) => (e) => setV({ ...v, [k]: e.currentTarget.value });
  const parsed = Object.fromEntries(FIELDS.map((f) => [f, parseAmount(v[f], f)]));
  const errors = FIELDS.filter((f) => parsed[f]?.error).map((f) => `${LABEL[f]}: ${parsed[f].error}`);
  const anyValue = FIELDS.some((f) => parsed[f] && !parsed[f].error);
  const valid = !errors.length && anyValue && /^\d{4}-\d{2}-\d{2}$/.test(v.date);
  const save = async () => {
    const other = v.date !== date ? st.nutrition.get(nutritionId(v.date)) : null;
    if (other && !other.deleted) {
      const ok = await confirmSheet({ title: `За ${fmtDay(v.date)} уже есть запись`, text: `${dayLine(other)}. Заменить её этой?`, okLabel: 'Заменить', danger: true });
      if (!ok) return;
    }
    const values = { date: v.date, status: v.status, approx: v.approx, comment: v.comment, ranges: null };
    for (const f of FIELDS) {
      const a = parsed[f];
      values[f] = a && a.value != null ? a.value : null;
      if (a?.range) values.ranges = { ...(values.ranges || {}), [f]: a.range };
      if (a?.approx) values.approx = true;
    }
    try {
      await app.store.saveNutrition(values, { from: has ? date : null });
      app.ui.toast(`${fmtDay(v.date)}: сохранено`);
      onClose();
    } catch (err) {
      fail(err);
    }
  };
  const remove = async () => {
    const ok = await confirmSheet({ title: `Удалить ${fmtDay(date)}?`, text: 'День пропадёт из истории и средних на всех устройствах. Та же запись из ChatGPT его не вернёт, новая — вернёт.', okLabel: 'Удалить', danger: true });
    if (!ok) return;
    await app.store.deleteNutrition(cur.id).catch(fail);
    app.ui.toast(`${fmtDay(date)}: удалено`, { action: { label: 'Вернуть', fn: () => app.store.restoreNutrition(cur.id) } });
    onClose();
  };
  const footer = html`<button type="button" class="btn btn--primary" disabled=${!valid} onClick=${save}>Сохранить</button>`;
  return html`<${Sheet} title=${has ? `Питание, ${fmtDay(date)}` : 'Итог дня'} onClose=${onClose} footer=${footer} dirty=${JSON.stringify(v) !== JSON.stringify(init())}>
    <div class="sheet__section">
      <label class="sheet__label" for="nutr-date">Учётный день</label>
      <input id="nutr-date" class="input" type="date" max=${addDays(isoDate(), 1)} value=${v.date} onInput=${set('date')} />
    </div>
    <div class="nutr-form">
      ${FIELDS.map((f) => html`<div>
        <label class="sheet__label" for=${'nutr-' + f}>${LABEL[f]}, ${unitOf(f)}</label>
        <input id=${'nutr-' + f} class="input" inputmode="decimal" autocomplete="off" placeholder=${f === 'kcal' ? 'например 3200' : ''} value=${v[f]} onInput=${set(f)} />
      </div>`)}
    </div>
    <p class="muted nutr-small">Можно диапазон: «2800-3000». Он сохранится как диапазон, а в средних будет середина с пометкой «≈».</p>
    <div class="sheet__section">
      <${Seg} label="Статус дня" fill=${true} value=${v.status} onChange=${(s) => setV({ ...v, status: s })}
        options=${[{ value: 'draft', label: 'Черновик' }, { value: 'final', label: 'Итог подтверждён' }]} />
      <p class="muted nutr-small">Черновик не входит в средние и не заменяет итог из ChatGPT.</p>
    </div>
    <div class="sheet__section btn-row">
      <${Toggle} on=${v.approx} onChange=${(a) => setV({ ...v, approx: a })}>Приблизительно</${Toggle}>
    </div>
    <div class="sheet__section">
      <input class="input" aria-label="Комментарий" placeholder="Комментарий" value=${v.comment} onInput=${set('comment')} />
    </div>
    ${errors.length ? html`<p class="warn-line">${errors.join('; ')}</p>` : null}
    ${has ? html`<p class="muted nutr-small">Источник: ${SOURCE[cur.source] || cur.source}. После сохранения — «вручную».</p>
      <button type="button" class="btn btn--block btn--danger" onClick=${remove}>Удалить день</button>` : null}
  <//>`;
}

// ---------------------------------------------------------------- paste and import

function openPaste() {
  openSheet((close) => html`<${InputSheet} mode="paste" onClose=${close} />`);
}
function openImport() {
  openSheet((close) => html`<${InputSheet} mode="import" onClose=${close} />`);
}

// What each entry would do, without writing anything: the same rules as the write.
function previewPaste(entries) {
  const st = app.store.state;
  const work = new Map();
  return entries.map((e) => {
    const id = nutritionId(e.entry.date);
    const existing = work.get(id) || st.nutrition.get(id);
    const r = applyExternal(existing, e.entry, { rev: e.rev, source: 'chatgpt', at: Date.now() });
    if (r.rec) work.set(id, r.rec);
    return { ...e, action: r.action, replacesManual: !!(r.rec?.prev && r.rec.prev !== existing?.prev) };
  });
}

function InputSheet({ mode, onClose }) {
  const [text, setText] = useState('');
  const [replace, setReplace] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const isCsv = mode === 'import' && /^[^\n]*(дата|date)[^\n]*[;,\t]/i.test(text.trim());
  const parsed = !text.trim() ? null : isCsv ? parseNutritionCsv(text) : parseNutritionText(text);
  const paste = mode === 'paste' && parsed ? previewPaste(parsed.entries) : null;
  const plan = mode === 'import' && parsed ? planNutritionImport(parsed, app.store.state.nutrition) : null;
  const errors = parsed ? (plan ? plan.errors : parsed.errors) : [];
  const count = paste ? paste.filter((x) => x.action === 'create' || x.action === 'update').length : plan ? plan.add.length + replace.size : 0;
  const run = async () => {
    setBusy(true);
    try {
      const r = paste
        ? await app.store.importNutrition(parsed.entries, { source: 'chatgpt' })
        : await app.store.importNutrition([...plan.add, ...plan.conflicts.filter((c) => replace.has(c.entry.date))], { source: 'import', conflicts: 'ask', replace });
      const n = r.create + r.update;
      app.ui.toast(`Записано дней: ${n}`, { action: n ? { label: 'Отменить', fn: () => app.store.undoNutritionImport(r.batch) } : null, ms: 8000 });
      onClose();
    } catch (err) {
      fail(err);
      setBusy(false);
    }
  };
  const readFile = async (e) => {
    const file = e.currentTarget.files?.[0];
    if (file) setText(await file.text());
  };
  const footer = html`<button type="button" class="btn btn--primary" disabled=${!count || busy} onClick=${run}>${count ? `Записать ${count} ${plural(count, 'день', 'дня', 'дней')}` : 'Нечего записывать'}</button>`;
  return html`<${Sheet} title=${mode === 'paste' ? 'Вставить из ChatGPT' : 'Старые дни'} onClose=${onClose} footer=${footer} dirty=${!!text}>
    <p class="muted nutr-small">${mode === 'paste'
      ? 'Вставьте блок, который ChatGPT выдал по «Закрыть день». Один день на дату: повтор ничего не меняет, черновик не заменяет итог, ваши ручные значения можно будет вернуть.'
      : 'Таблица с первой строкой-заголовком (дата, ккал, белки, жиры, углеводы, статус) или дни блоками, как из ChatGPT. Значения не придумываются: пустое остаётся пустым. Одна дата дважды — ошибка, дни не складываются.'}</p>
    <textarea class="input" aria-label="Текст" placeholder=${mode === 'paste' ? 'Дата: 2026-10-22\nКкал: 3250 · Белки: 160 · Жиры: 90 · Углеводы: 420\nСтатус: итог' : 'дата;ккал;белки;жиры;углеводы;статус'} value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>
    ${mode === 'import' ? html`<label class="btn btn--block nutr-file">Выбрать файл CSV<input type="file" accept=".csv,text/csv,text/plain" class="sr-only" onChange=${readFile} /></label>` : null}
    ${paste?.length
      ? html`<ul class="rows nutr-preview" aria-label="Что будет записано">${paste.map((x) => html`<li class="row">
          <span class="row__title">${fmtDay(x.entry.date)}</span><span class="nutr-tag" data-action=${x.action}>${ACTION_TEXT[x.action]}</span>
          <span class="row__sub">${dayLine(x.entry)} · ${STATUS[x.entry.status]}${x.replacesManual ? ' · заменит ваши ручные значения (их можно вернуть)' : ''}</span>
        </li>`)}</ul>`
      : null}
    ${plan
      ? html`<p class="nutr-small nutr-plan">Новых: ${plan.add.length} · совпадают: ${plan.same.length} · отличаются: ${plan.conflicts.length} · ошибок: ${plan.errors.length}</p>
        ${plan.add.filter((x) => x.entry.status === 'draft').length ? html`<p class="muted nutr-small">Черновики загрузятся черновиками и не войдут в средние.</p>` : null}
        ${plan.conflicts.length
          ? html`<p class="sheet__label">Отличаются от записанного — заменить только отмеченные:</p>
            <ul class="rows nutr-preview">${plan.conflicts.map((c) => html`<li class="row">
              <label class="nutr-check"><input type="checkbox" checked=${replace.has(c.entry.date)}
                onChange=${(e) => { const n = new Set(replace); e.currentTarget.checked ? n.add(c.entry.date) : n.delete(c.entry.date); setReplace(n); }} />
                <span><b>${fmtDay(c.entry.date)}</b> — файл: ${dayLine(c.entry)}; сейчас: ${dayLine(c.current)}</span></label>
            </li>`)}</ul>`
          : null}`
      : null}
    ${errors.length
      ? html`<div class="warn-line" role="alert">${errors.slice(0, 8).map((e) => html`<div>Строка ${e.line}: ${e.errors.join('; ')}</div>`)}${errors.length > 8 ? html`<div>…и ещё ${errors.length - 8}</div>` : null}</div>`
      : null}
  <//>`;
}

// ---------------------------------------------------------------- ChatGPT and the accounting day

export const CHATGPT_INSTRUCTION = `Веди мой дневник КБЖУ только итогами дня (ккал, белки, жиры, углеводы), без списка продуктов.
Учётный день начинается по моей команде «Новый день» и заканчивается командой «Закрыть день», даже если это после полуночи. Дата дня — дата на момент «Новый день».
По «Закрыть день» подведи итог и:
1) если можешь добавлять строки в мою Google Таблицу «Тренировки - прогресс и плато» — добавь ОДНУ новую строку в конец листа App_NutritionInbox (другие листы и строки не трогай, ничего не удаляй и не исправляй): date = ГГГГ-ММ-ДД, kcal, protein_g, fat_g, carbs_g (числа; если точно не знаешь — диапазон вида 2800-3000), status = итог, approx = да или нет, comment = коротко, written_at = текущие дата и время;
2) в любом случае выведи блок для вставки в приложение:
Дата: ГГГГ-ММ-ДД
Ккал: … · Белки: … · Жиры: … · Углеводы: …
Статус: итог · Приблизительно: да/нет · Комментарий: …
Промежуточный итог до «Закрыть день» — то же, но статус черновик. Если пересчитываешь закрытый день — тот же формат и та же дата, новые числа. Не складывай разные дни, не придумывай значения: чего не знаешь — оставь пустым.`;

function openChatGptHelp() {
  openSheet((close) => html`<${Sheet} title="Как подключить ChatGPT" onClose=${close}>
    <ol class="steps">
      <li>Скопируйте инструкцию и отправьте её один раз в чат ChatGPT, где вы ведёте питание.</li>
      <li>Если ChatGPT может писать в Google Таблицу, он добавит строку в лист App_NutritionInbox. Приложение заберёт её при следующей синхронизации, а в столбце result появится, что с ней сделано.</li>
      <li>Если писать в таблицу он не может — скопируйте его блок и нажмите «Вставить из ChatGPT».</li>
      <li>Проверка: день появится здесь, в списке «Дни», с источником «ChatGPT».</li>
    </ol>
    <textarea class="input nutr-instr" readonly aria-label="Инструкция для ChatGPT" value=${CHATGPT_INSTRUCTION}></textarea>
    <div class="btn-row"><button type="button" class="btn btn--primary" onClick=${() => copyText(CHATGPT_INSTRUCTION)}>Скопировать инструкцию</button></div>
    <p class="muted nutr-small">Приложение не читает переписку с ChatGPT: в него попадает только то, что ChatGPT записал в таблицу или вы вставили. Подробно — docs/NUTRITION_CHATGPT.md.</p>
  <//>`);
}

function openDayStart() {
  openSheet((close) => html`<${DayStartSheet} onClose=${close} />`);
}
function DayStartSheet({ onClose }) {
  const [h, setH] = useState(dayStartHour());
  const save = async () => {
    await app.store.setKV({ nutritionDayStart: h });
    onClose();
  };
  return html`<${Sheet} title="Учётный день" onClose=${onClose} footer=${html`<button type="button" class="btn btn--primary" onClick=${save}>Сохранить</button>`}>
    <p class="muted nutr-small">Новая запись по умолчанию идёт в учётный день: до этого часа — ещё вчерашний. Дату всегда можно поменять в самой записи. Настройка действует на этом телефоне.</p>
    <div class="sheet__section">
      <label class="sheet__label" for="day-start">Новый день начинается в</label>
      <select id="day-start" class="input" value=${String(h)} onChange=${(e) => setH(Number(e.currentTarget.value))}>
        ${[0, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => html`<option value=${String(x)}>${String(x).padStart(2, '0')}:00</option>`)}
      </select>
    </div>
  <//>`;
}

export function rememberBodyTab(tab) {
  local.set('bodyTab', tab);
}
export function bodyTab() {
  return local.get('bodyTab') === 'nutrition' ? 'nutrition' : 'body';
}
