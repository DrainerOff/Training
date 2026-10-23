// Weight for today: «Можно повысить», «Лучше закрепить» or «Недостаточно данных». A pure rule over
// the history of one exercise variant (strength series): no storage, no DOM, no network. It never
// changes the composer; the owner takes the weight with «Использовать» or ignores it.
//
//  * Like with like: the reference is the latest result of the same variant in the same week of the
//    cycle (week 2 vs week 2), since the latest «новая точка отсчёта». Another week is never a reason
//    to go up: without a same-week result there is no recommendation.
//  * Double progression: the top working weight of that workout goes up by a step when every set at
//    it reached the top of today's rep range. With RIR recorded the effort counts too: 9 reps at RIR 2
//    is 10 at RIR 1, and 10 reps to failure is not 10 at RIR 1. The sets at that weight must be all of
//    the planned sets, or all but one.
//  * Without RIR an increase is conditional and says so.
//  * Pain or worse technique (in that workout, since then, or today): no increase.
//  * A break of 8+ weeks: the old weight first.
//  * Where the body is part of the load (pull-ups), a body-weight gain worth a step is already an
//    increase.
//  * Today's sets count: a set at the recommended weight below the range turns «повысить» into
//    «закрепить».

import { daysBetween, fmtDay, fmtNum, plural } from './util.js';

export const STALE_DAYS = 56;
// Week 1 (light, RIR 4–5) in the owner's scheme is 10–12 reps. The program keeps no rep range for it
// (targets are unchanged by v1.3), so the range is used here only.
export const LIGHT_REPS = [10, 12];

export const KIND = {
  up: 'Можно повысить',
  hold: 'Лучше закрепить',
  none: 'Недостаточно данных',
};

export function fmtLoad(w, category) {
  if (category === 'pullup') return w > 0 ? `+${fmtNum(w)} кг` : 'без доп. веса';
  return `${fmtNum(w)} кг`;
}

function setText(s, category) {
  const w = category === 'pullup' && !(s.weight > 0) ? 'СВ' : fmtNum(s.weight || 0);
  return `${w}×${s.reps}${s.rir != null ? ` (RIR ${fmtNum(s.rir)})` : ''}`;
}

const range = (r) => (r[0] === r[1] ? String(r[0]) : `${r[0]}–${r[1]}`);
const valid = (s) => !s.deleted && !s.drop && s.reps > 0;
const round = (w) => Math.round(w * 100) / 100;

// `list` — exposures of this variant (lib/plateau.js buildExposures, chronological, with `bw`);
// `session` — today's workout { id, date, week, startedAt }; `target` — today's target
// (lib/program.js targetFor); `todaySets` — sets already logged today for this exercise;
// `todayFlags` — pain / technique / baseline marked today; `share` — lifted part of body weight;
// `bodyweightToday` — lib/bodyweight.js bodyweightAt(today) or null.
// → { kind: 'up' | 'hold' | 'none', label, weight, conditional, reasons: [string], ref }
export function recommend({
  list = [], session, target, category = null, step = 2.5, share = 0,
  todaySets = [], todayFlags = {}, bodyweightToday = null,
}) {
  step = step > 0 ? step : 2.5;
  const week = session.week;
  const reps = target?.reps || (week === 1 ? LIGHT_REPS : null);
  const rir = target?.rir || null;
  const load = (w) => fmtLoad(w, category);
  const out = (kind, weight, reasons, extra = {}) => ({ kind, label: KIND[kind], weight, conditional: false, reasons, ref: null, ...extra });
  if (!reps) return out('none', null, ['Для этого упражнения на этой неделе не задан диапазон повторений.']);
  if (todayFlags.baseline) {
    return out('none', null, ['Сегодня отмечена новая точка отсчёта: сравнивать не с чем. Следующая рекомендация будет от сегодняшнего результата.']);
  }

  const startedAt = session.startedAt ?? Infinity;
  const before = list.filter((e) => e.sessionId !== session.id
    && (e.date < session.date || (e.date === session.date && (e.startedAt || 0) < startedAt))
    && e.sets.some(valid));
  let from = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    if (before[i].flags?.baseline) {
      from = i;
      break;
    }
  }
  const seg = before.slice(from);
  let ref = null;
  for (let i = seg.length - 1; i >= 0 && !ref; i--) if (seg[i].week === week) ref = seg[i];
  if (!ref) {
    if (!before.length) return out('none', null, ['Это первое выполнение этого варианта упражнения.']);
    const since = from > 0 ? ` после новой точки отсчёта (${fmtDay(before[from].date)})` : '';
    return out('none', null, [
      `На неделе ${week} этот вариант${since} ещё не выполнялся.`,
      'Результат другой недели цикла для повышения не используется: там другие повторения и RIR.',
    ]);
  }

  const sets = ref.sets.filter(valid);
  const top = Math.max(...sets.map((s) => s.weight || 0));
  const atTop = sets.filter((s) => (s.weight || 0) === top);
  const reasons = [`Прошлый раз на неделе ${week}, ${fmtDay(ref.date)}: ${sets.map((s) => setText(s, category)).join(', ')}.`];
  const refInfo = { date: ref.date, week, sessionId: ref.sessionId };
  const hold = (why, more = []) => out('hold', top, [...reasons, ...why, ...more], { ref: refInfo });

  // Body weight, where it is part of the load.
  const bwNotes = [];
  let bwGain = 0;
  if (share > 0) {
    const a = ref.bw?.value;
    const b = bodyweightToday?.value;
    if (a > 0 && b > 0) {
      bwGain = share * (b - a);
      if (Math.abs(b - a) >= 0.5) {
        bwNotes.push(`Масса тела ${b > a ? 'больше' : 'меньше'} на ${fmtNum(Math.abs(b - a), 1)} кг, чем ${fmtDay(ref.date)}${share !== 1 ? ` (в нагрузке ${fmtNum(share * 100, 0)}%)` : ''}.`);
      }
    } else {
      bwNotes.push('Масса тела на одну из дат неизвестна: её изменение не учтено.');
    }
  }

  // Pain or worse technique: then, since then (any week), or today.
  const todayPain = todayFlags.pain || todaySets.some((s) => !s.deleted && s.pain);
  const todayTech = todayFlags.technique || todaySets.some((s) => !s.deleted && s.technique);
  const later = before.slice(before.indexOf(ref) + 1);
  const painLater = later.find((e) => e.flags?.pain);
  if (todayPain) return hold(['Сегодня отмечена боль: вес не повышаем. Если боль повторяется, снизьте вес или замените упражнение.'], bwNotes);
  if (ref.flags?.pain) return hold([`В тот раз была отмечена боль: вес не повышаем.`], bwNotes);
  if (painLater) return hold([`${fmtDay(painLater.date)} (неделя ${painLater.week}) была отмечена боль: вес пока не повышаем.`], bwNotes);
  if (todayTech) return hold(['Сегодня отмечено, что техника хуже: вес не повышаем.'], bwNotes);
  if (ref.flags?.technique) return hold(['В тот раз техника была хуже: сначала тот же вес с хорошей техникой.'], bwNotes);

  const gap = daysBetween(ref.date, session.date);
  if (gap > STALE_DAYS) {
    const w = Math.floor(gap / 7);
    return hold([`Это было ${w} ${plural(w, 'неделю', 'недели', 'недель')} назад: после перерыва сначала прежний вес.`], bwNotes);
  }

  const need = Math.max(1, (target?.sets || atTop.length) - 1);
  const goal = `Цель — ${reps[1]} ${plural(reps[1], 'повторение', 'повторения', 'повторений')}${rir ? ` при RIR ${range(rir)}` : ''} во всех подходах по ${load(top)}.`;
  if (atTop.length < need) {
    return hold([`По ${load(top)} — ${atTop.length} ${plural(atTop.length, 'подход', 'подхода', 'подходов')} из ${target.sets}. ${goal}`], bwNotes);
  }

  const [lo, hi] = reps;
  const rLo = rir ? rir[0] : null;
  const evals = atTop.map((s) => {
    const known = rLo != null && s.rir != null;
    const est = known ? s.reps + s.rir - rLo : s.reps;
    return { s, known, est, pass: s.reps >= lo && est >= hi };
  });
  const short = evals.filter((x) => !x.pass);
  if (short.length) {
    const failed = short.some((x) => x.known && x.s.reps >= hi);
    return hold([
      `До верха диапазона ${range(reps)} не дошли: ${short.map((x) => setText(x.s, category)).join(', ')}${failed ? ' — с меньшим запасом, чем RIR по плану' : ''}.`,
      goal,
    ], bwNotes);
  }

  // Up. Two steps only when RIR shows a clear surplus in every set and two steps stay a small jump.
  const conditional = rLo != null && evals.some((x) => !x.known);
  const surplus = Math.min(...evals.map((x) => x.est - hi));
  const base = top + (share > 0 && bodyweightToday?.value > 0 ? share * bodyweightToday.value : 0);
  const steps = !conditional && rLo != null && surplus >= 3 && (base <= 0 || 2 * step <= 0.06 * base) ? 2 : 1;
  const weight = round(top + steps * step);
  const why = conditional
    ? [`Во всех подходах по ${load(top)} — ${hi} и больше повторений.`,
      `RIR в тот раз записан не везде, поэтому рекомендация условная: повышайте, только если подходы давались с запасом RIR ${range(rir)}. Если шли до отказа — лучше закрепить ${load(top)}.`]
    : [`Во всех подходах по ${load(top)} — верх диапазона ${range(reps)}${rLo != null ? ` с запасом RIR ${range(rir)} или больше` : ''}.`];
  if (steps === 2) why.push(`Запас большой (≈${surplus} ${plural(surplus, 'повторение', 'повторения', 'повторений')} сверх диапазона), поэтому +${fmtNum(2 * step)} кг.`);
  else why.push(`Шаг веса ${fmtNum(step)} кг.`);
  if (share > 0 && bwGain >= step) {
    return hold([...why.slice(0, 1), `Но масса тела выросла: нагрузка уже больше на ≈${fmtNum(bwGain, 1)} кг. Сначала закрепите ${load(top)} с новой массой тела.`], bwNotes);
  }

  // Today's sets: one at the new weight fell below the range → back to the old weight.
  const low = todaySets.filter(valid).find((s) => (s.weight || 0) >= weight && s.reps < lo);
  if (low) {
    return hold([...why.slice(0, 1), `Сегодня ${setText(low, category)} — ниже диапазона ${range(reps)}: лучше вернуться к ${load(top)}.`], bwNotes);
  }
  const ok = todaySets.filter(valid).filter((s) => (s.weight || 0) >= weight);
  if (ok.length) why.push(`Сегодня по ${load(weight)}: ${ok.map((s) => setText(s, category)).join(', ')}.`);
  return out('up', weight, [...reasons, ...why, ...bwNotes], { conditional, ref: refInfo, steps });
}
