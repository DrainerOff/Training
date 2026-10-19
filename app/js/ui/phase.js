// The bulk / cut / maintenance card on «Тело» and the sheet to set a phase. What the card shows is
// computed in lib/phase.js; this file only words it, always with what a number is based on.

import { html, useState, app, openSheet, Sheet, Seg, confirmSheet } from './core.js';
import { isoDate, fmtDay, fmtDayShort, fmtNum, parseNum, plural } from '../lib/util.js';
import { MODES, STATUS_TEXT, RATE_MIN_DAYS, RATE_MIN_SPAN, addDays, sortedPhases } from '../lib/phase.js';

const signed = (n, digits = 2) => `${n >= 0 ? '+' : '−'}${fmtNum(Math.abs(n), digits)}`;
const days = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;

function fail(err) {
  app.ui.toast(err?.message || String(err));
}

export function PhaseCard({ phase, report }) {
  if (!phase) {
    return html`<section class="callout phase">
      <div class="callout__head">Режим не задан</div>
      <p class="muted phase__text">Укажите набор, сушку или поддержание и целевой темп. Тогда темп веса сравнивается с целью, а талия, силовые и сон считаются за тот же период.</p>
      <button type="button" class="btn" onClick=${() => openPhase()}>Задать режим</button>
    </section>`;
  }
  const r = report;
  const weeks = Math.floor(r.weeks);
  const shown = r.weekly.slice(-6).reverse();
  return html`<section class="callout phase">
    <div class="phase__head">
      <div>
        <div class="callout__head">${MODES[phase.mode].label}</div>
        <div class="muted phase__text">с ${fmtDay(phase.start)}${phase.end ? ` по ${fmtDay(phase.end)}` : ''}, ${weeks ? `${weeks} ${plural(weeks, 'неделя', 'недели', 'недель')}` : days(Math.round(r.weeks * 7))}. Цель ${signed(r.target)} % массы в неделю${r.targetKg != null ? ` (≈ ${signed(r.targetKg)} кг)` : ''}.</div>
      </div>
      <button type="button" class="btn btn--small" onClick=${() => openPhase(phase.id)}>Изменить</button>
    </div>

    <ul class="phase__facts">
      <li>
        <b>Темп веса:</b>
        ${r.rate
          ? html` ${signed(r.rate.pct)} % в неделю (${signed(r.rate.perWeek)} кг), <span class=${`phase__status phase__status--${r.status}`}>${STATUS_TEXT[r.status]}</span>. <span class="muted">По ${r.rate.days} ${plural(r.rate.days, 'дню', 'дням', 'дням')} со взвешиванием.</span>
              ${r.recent && Math.abs(r.recent.pct - r.rate.pct) >= 0.05 ? html`<br /><span class="muted">Последние 3 недели: ${signed(r.recent.pct)} % в неделю.</span>` : null}`
          : html` <span class="muted">данных недостаточно: нужно ${RATE_MIN_DAYS} дней со взвешиванием за ${RATE_MIN_SPAN}+ дней, сейчас ${days(r.weighDays)}.</span>`}
      </li>
      <li>
        <b>Талия:</b>
        ${r.waist.enough
          ? html` ${signed(r.waist.waistChange, 1)} см${r.waist.weightChange != null ? ` при весе ${signed(r.waist.weightChange, 1)} кг` : ''} <span class="muted">(${fmtDay(r.waist.from)} → ${fmtDay(r.waist.to)}${r.waist.cmPerKg != null ? `, ${fmtNum(r.waist.cmPerKg, 1)} см на кг` : ''}).</span>`
          : html` <span class="muted">нужны 2 замера с разницей 2+ недели, сейчас ${r.waist.count}.</span>`}
      </li>
      <li>
        <b>Силовые:</b>
        ${r.strength.compared
          ? html` растут ${r.strength.up}, на месте ${r.strength.flat}, снижаются ${r.strength.down}. <span class="muted">Лучший подход в ту же неделю цикла в начале и в конце режима.</span>`
          : html` <span class="muted">для сравнения нужна одна и та же неделя цикла с разницей 2+ недели.</span>`}
      </li>
      <li>
        <b>Сон:</b>
        ${r.sleep.nights
          ? html` ${fmtNum(r.sleep.avg, 1)} ч в среднем <span class="muted">(${r.sleep.nights} ${plural(r.sleep.nights, 'ночь', 'ночи', 'ночей')} с данными).</span>`
          : html` <span class="muted">нет данных за период.</span>`}
      </li>
    </ul>

    ${shown.length
      ? html`<details class="phase__weeks">
          <summary>Средний вес по неделям</summary>
          <ul>
            ${shown.map(
              (w) => html`<li>
                <span>${fmtDayShort(w.start)}–${fmtDayShort(addDays(w.start, 6))}</span>
                <span class=${w.avg == null ? 'muted' : ''}>${w.avg != null ? `${fmtNum(w.avg, 1)} кг` : `мало: ${days(w.days)}`}</span>
                <span class="muted">${w.change != null ? signed(w.change, 2) : ''}</span>
              </li>`,
            )}
          </ul>
          <p class="muted phase__text">Неделя считается, если в ней 3+ дня со взвешиванием.</p>
        </details>`
      : null}
    <p class="muted phase__text">Цифры показывают, что происходило, но не почему. Процент жира с весов — оценка и в расчёт не входит.</p>
  </section>`;
}

// ---------------------------------------------------------------- set / edit a phase

export function openPhase(id = null) {
  openSheet((close) => html`<${PhaseSheet} id=${id} onClose=${close} />`);
}

function PhaseSheet({ id, onClose }) {
  const prev = id ? app.store.state.phases.get(id) : null;
  const today = isoDate();
  const [mode, setMode] = useState(prev?.mode || 'bulk');
  const [start, setStart] = useState(prev?.start || today);
  const [end, setEnd] = useState(prev?.end || '');
  const [target, setTarget] = useState(prev ? fmtNum(prev.targetPct, 2) : fmtNum(MODES.bulk.target, 2));
  const [note, setNote] = useState(prev?.note || '');
  const t = parseNum(String(target).replace('−', '-').replace('+', ''));
  const valid = MODES[mode] && start && t != null && Math.abs(t) <= 2 && (!end || end >= start);
  const pick = (m) => {
    setMode(m);
    if (!prev) setTarget(fmtNum(MODES[m].target, 2));
  };
  const save = async () => {
    try {
      await app.store.savePhase({ id, mode, start, end: end || null, targetPct: t, note });
      app.ui.toast(prev ? 'Режим изменён' : `${MODES[mode].label}: режим задан`);
      onClose();
    } catch (err) {
      fail(err);
    }
  };
  const finish = async () => {
    try {
      await app.store.savePhase({ ...prev, end: today });
      app.ui.toast('Режим завершён');
      onClose();
    } catch (err) {
      fail(err);
    }
  };
  const remove = async () => {
    const ok = await confirmSheet({ title: 'Удалить режим?', text: 'Взвешивания и тренировки останутся, удалится только сам период и цель.', okLabel: 'Удалить', danger: true });
    if (!ok) return;
    await app.store.deletePhase(id);
    onClose();
  };
  const past = sortedPhases(app.store.state.phases.values()).filter((p) => p.id !== id);
  const footer = html`<button type="button" class="btn btn--primary" disabled=${!valid} onClick=${save}>Сохранить</button>`;
  return html`<${Sheet} title=${prev ? 'Режим' : 'Новый режим'} onClose=${onClose} footer=${footer}>
    <div class="sheet__section">
      <${Seg} label="Режим" fill value=${mode} onChange=${pick} options=${Object.entries(MODES).map(([value, m]) => ({ value, label: m.label }))} />
    </div>
    <div class="sheet__section body-when">
      <div>
        <label class="sheet__label" for="phase-start">Начало</label>
        <input id="phase-start" class="input" type="date" value=${start} onInput=${(e) => setStart(e.currentTarget.value)} />
      </div>
      <div>
        <label class="sheet__label" for="phase-end">Конец</label>
        <input id="phase-end" class="input" type="date" min=${start} value=${end} onInput=${(e) => setEnd(e.currentTarget.value)} />
      </div>
    </div>
    <div class="sheet__section">
      <label class="sheet__label" for="phase-target">Целевой темп, % массы в неделю</label>
      <input id="phase-target" class="input" inputmode="decimal" autocomplete="off" value=${target} onInput=${(e) => setTarget(e.currentTarget.value)} />
      <p class="muted phase__text">${mode === 'cut' ? 'При сушке темп отрицательный, например −0,5.' : mode === 'bulk' ? 'Например +0,25: при весе 80 кг это около 0,2 кг в неделю.' : 'При поддержании цель — 0.'} Допустимо от −2 до +2.</p>
    </div>
    <div class="sheet__section">
      <input class="input" placeholder="Заметка" aria-label="Заметка" value=${note} onInput=${(e) => setNote(e.currentTarget.value)} />
    </div>
    ${!prev ? html`<p class="muted phase__text">Если сейчас идёт другой режим, он закончится накануне начала нового.</p>` : null}
    ${prev
      ? html`<div class="btn-row">
          ${!prev.end ? html`<button type="button" class="btn" onClick=${finish}>Завершить сегодня</button>` : null}
          <button type="button" class="btn btn--danger" onClick=${remove}>Удалить</button>
        </div>`
      : null}
    ${past.length
      ? html`<h3 class="section-title">Все режимы</h3>
          <ul class="rows">
            ${past.map(
              (p) => html`<li><button type="button" class="row" onClick=${() => { onClose(); openPhase(p.id); }}>
                <span class="row__title">${MODES[p.mode].label}</span>
                <span class="muted">${signed(p.targetPct)} %</span>
                <span class="row__sub">${fmtDay(p.start)} — ${p.end ? fmtDay(p.end) : 'идёт'}</span>
              </button></li>`,
            )}
          </ul>`
      : null}
  <//>`;
}
