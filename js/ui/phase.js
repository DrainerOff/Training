// The bulk / cut / maintenance card on «Тело» and the sheet to set a phase. What the card shows is
// computed in lib/phase.js; this file only words it, always with what a number is based on.

import { html, useState, app, openSheet, Sheet, Seg, confirmSheet } from './core.js';
import { isoDate, fmtDay, fmtDayShort, fmtNum, parseNum, plural } from '../lib/util.js';
import { MODES, STATUS_TEXT, RATE_MIN_DAYS, RATE_MIN_SPAN, addDays, sortedPhases, targetBand } from '../lib/phase.js';

const signed = (n, digits = 2) => `${n >= 0 ? '+' : '−'}${fmtNum(Math.abs(n), digits)}`;
const days = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;

function fail(err) {
  app.ui.toast(err?.message || String(err));
}

const GLYPH = { bulk: '▲', cut: '▼', maintain: '●' };

export function PhaseCard({ phase, report }) {
  if (!phase) {
    return html`<section class="phase phase--none" aria-label="Режим">
      <div class="phase__title">Режим не задан</div>
      <p class="phase__text">Укажите набор, сушку или поддержание и целевой темп. Тогда темп веса сравнивается с целью, а талия, силовые и сон считаются за тот же период.</p>
      <button type="button" class="btn btn--small" onClick=${() => openPhase()}>Задать режим</button>
    </section>`;
  }
  const r = report;
  const week = Math.floor(r.weeks - 1e-9) + 1;
  return html`<section class=${`phase phase--${phase.mode}`} aria-label="Режим">
    <div class="phase__head">
      <div class="phase__tagline">
        <span class="phase__tag"><span aria-hidden="true">${GLYPH[phase.mode]} </span>${MODES[phase.mode].label}</span>
        <span class="phase__since">${phase.end ? '' : `Неделя ${week} · `}с ${fmtDayShort(phase.start)}${phase.end ? ` по ${fmtDayShort(phase.end)}` : ''}</span>
      </div>
      <button type="button" class="btn btn--small" onClick=${() => openPhase(phase.id)}>Изменить</button>
    </div>
    <div class="phase__label">Темп веса, % массы в неделю</div>
    <div class="phase__hero">
      <span class=${'num phase__rate' + (r.rate ? '' : ' phase__rate--none')}>${r.rate ? signed(r.rate.pct) : '–'}</span>
      <div class="phase__side">
        <div><div class="phase__label">цель</div><span class="num">${signed(r.target)}</span></div>
        <div><div class="phase__label">кг в неделю</div><span class="num">${r.rate ? signed(r.rate.perWeek) : '–'}</span></div>
      </div>
    </div>
    ${r.rate
      ? html`<${Gauge} pct=${r.rate.pct} target=${r.target} />
          <div class=${`phase__status phase__status--${r.status}`}><span class="phase__dot" aria-hidden="true"></span><span class="phase__status-text">${STATUS_TEXT[r.status]}</span></div>
          <p class="phase__text">По ${r.rate.days} ${plural(r.rate.days, 'дню', 'дням', 'дням')} со взвешиванием.${r.targetKg != null ? ` Цель ≈ ${signed(r.targetKg)} кг в неделю.` : ''}${r.recent && Math.abs(r.recent.pct - r.rate.pct) >= 0.05 ? ` Последние 3 недели: ${signed(r.recent.pct)} % в неделю.` : ''}</p>`
      : html`<p class="phase__text">Темп веса: данных недостаточно: нужно ${RATE_MIN_DAYS} дней со взвешиванием за ${RATE_MIN_SPAN}+ дней, сейчас ${days(r.weighDays)}. Цель ${signed(r.target)} % массы в неделю${r.targetKg != null ? ` (≈ ${signed(r.targetKg)} кг)` : ''}.</p>`}
  </section>`;
}

// A row of segments from below zero to above the target: the corridor of the target is lit, the
// current rate is the tall dark segment. The corridor is lib/phase.js targetBand, the same band the
// status is computed with.
const LEDS = 24;
function Gauge({ pct, target }) {
  const band = targetBand(target);
  const reach = Math.max(Math.abs(target) + 2 * band, Math.abs(pct) + band, 0.5);
  const lo = Math.min(-band, target - reach, pct - band * 0.5);
  const hi = Math.max(band, target + reach, pct + band * 0.5);
  const step = (hi - lo) / LEDS;
  const at = (v) => Math.min(LEDS - 1, Math.max(0, Math.floor((v - lo) / step)));
  const now = at(pct);
  const pos = (v) => `${(((v - lo) / (hi - lo)) * 100).toFixed(1)}%`;
  const label = `Шкала темпа: сейчас ${signed(pct)}, коридор цели от ${signed(target - band)} до ${signed(target + band)} % в неделю`;
  return html`<div class="gauge" role="img" aria-label=${label}>
    <div class="gauge__leds">
      ${Array.from({ length: LEDS }, (_, i) => {
        const mid = lo + (i + 0.5) * step;
        const cls = i === now ? 'gauge__led--now' : Math.abs(mid - target) <= band ? 'gauge__led--band' : '';
        return html`<i class=${'gauge__led ' + cls}></i>`;
      })}
      <span class="gauge__zero" style=${`left:${pos(0)}`}></span>
    </div>
    <div class="gauge__ticks" aria-hidden="true">
      <span style="left:0;transform:none">${signed(lo)}</span>
      ${Math.abs(target) > step * 3 ? html`<span style=${`left:${pos(0)}`}>0</span>` : null}
      <span class="gauge__target" style=${`left:${pos(target)}`}>цель</span>
      <span style="left:auto;right:0;transform:none">${signed(hi)}</span>
    </div>
  </div>`;
}

// Change of the weekly average weight, week to week, against the target in kg; the averages
// themselves behind «Средний вес по неделям».
export function PhaseWeeks({ report }) {
  const r = report;
  const shown = r.weekly.slice(-6);
  if (!shown.length) return null;
  const bars = shown.some((w) => w.change != null);
  return html`<section class="card phase-weeks" aria-label="Изменение за неделю">
    <div class="card__head">
      <span class="card__label">Изменение за неделю, кг</span>
      ${r.targetKg != null ? html`<span class="card__label">цель ≈ ${signed(r.targetKg)}</span>` : null}
    </div>
    ${bars
      ? html`<${WeekBars} weeks=${shown} target=${r.targetKg} />`
      : html`<p class="phase__text">Изменение появится, когда будут 2 недели подряд по 3+ дня со взвешиванием.</p>`}
    <details class="phase__weeks">
      <summary>Средний вес по неделям</summary>
      <ul>
        ${[...shown].reverse().map(
          (w) => html`<li>
            <span>${fmtDayShort(w.start)}–${fmtDayShort(addDays(w.start, 6))}</span>
            <span class=${w.avg == null ? 'muted' : ''}>${w.avg != null ? `${fmtNum(w.avg, 1)} кг` : `мало: ${days(w.days)}`}</span>
            <span class="muted">${w.change != null ? signed(w.change, 2) : ''}</span>
          </li>`,
        )}
      </ul>
    </details>
    <p class="phase__text">Неделя считается, если в ней 3+ дня со взвешиванием.</p>
  </section>`;
}

const BW = 340;
const BH = 128;
function WeekBars({ weeks, target }) {
  const vals = weeks.map((w) => w.change).filter((v) => v != null);
  const lo = Math.min(0, ...vals, target ?? 0);
  const hi = Math.max(0, ...vals, target ?? 0);
  const pad = Math.max(0.05, (hi - lo) * 0.08);
  const top = 20;
  const bottom = BH - 36;
  const y = (v) => top + ((hi + pad - v) / (hi - lo + 2 * pad)) * (bottom - top);
  const slot = BW / weeks.length;
  const bw = Math.min(34, slot * 0.56);
  const label = weeks.map((w) => `${fmtDayShort(w.start)}: ${w.change != null ? signed(w.change, 2) + ' кг' : w.avg != null ? 'первая неделя' : 'мало взвешиваний'}`).join(', ');
  return html`<svg class="bars" viewBox=${`0 0 ${BW} ${BH}`} role="img" aria-label=${`Изменение среднего веса по неделям: ${label}`}>
    <line x1="0" x2=${BW} y1=${y(0)} y2=${y(0)} stroke="var(--hairline)" stroke-width="1.5" />
    ${target != null
      ? html`<line x1="0" x2=${BW} y1=${y(target)} y2=${y(target)} stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="5 4" />`
      : null}
    ${weeks.map((w, i) => {
      const cx = slot * (i + 0.5);
      if (w.change == null) {
        return html`<g>
          <text x=${cx} y=${y(0) - 6} text-anchor="middle" font-size="11" fill="var(--ghost)">${w.avg != null ? '·' : 'мало'}</text>
          <text x=${cx} y=${BH - 4} text-anchor="middle" font-size="11" fill="var(--steel)">${fmtDayShort(w.start)}</text>
        </g>`;
      }
      const y0 = y(0);
      const y1 = y(w.change);
      const h = Math.max(2, Math.abs(y1 - y0));
      return html`<g>
        <rect x=${cx - bw / 2} y=${Math.min(y0, y1)} width=${bw} height=${h} rx="4" fill="var(--steel)" />
        <text x=${cx} y=${w.change >= 0 ? Math.min(y0, y1) - 5 : Math.max(y0, y1) + 13} text-anchor="middle" font-size="12" font-weight="700" fill="var(--iron)">${signed(w.change, 2)}</text>
        <text x=${cx} y=${BH - 4} text-anchor="middle" font-size="11" fill="var(--steel)">${fmtDayShort(w.start)}</text>
      </g>`;
    })}
  </svg>`;
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
