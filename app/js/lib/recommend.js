// Weight for today: «Можно повысить», «Лучше закрепить» or «Недостаточно данных». A pure rule over
// the history of one exercise variant (strength series): no storage, no DOM, no network. It never
// changes the composer; the owner takes the weight with «Использовать» or ignores it.
//
//  * Like with like: the reference is the latest result of the same variant in the same week of the
//    cycle (week 2 vs week 2), since the latest «новая точка отсчёта». Another week is never a reason
//    to go up or to hold: without a same-week result there is only an approximate «Ориентир» (below).
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
//  * «Закрепить» is the heaviest weight done in enough successful sets: one heavy set below the range
//    with the rest lighter does not make that heavy weight the working one.
//
// «Ориентир» (kind 'estimate') — only where the same week has no result yet: the weight is recounted
// from the latest result of another week of the cycle. It is always marked approximate.
//  * Source: a heavy week (2 or 3) of the same variant, after the baseline, not older than 8 weeks,
//    without pain or worse technique. A light week is never a source.
//  * RIR is required: reps to failure = reps + RIR. Without it nothing is estimated.
//  * The heaviest sets (all at the top weight, plus the next weight down when that is one set), at
//    least two; their median by Epley. One strong set decides nothing.
//  * Heavy week: the weight on the owner's grid (source weight ± steps) nearest to the middle of the
//    week's window of reps to failure, with at least half a rep above its bottom — so it errs light.
//  * Light week (10–12 reps at the RIR of its target, lib/program.js PHASE[1]) from a heavy one is a
//    long way to recount: Epley and Brzycki differ by 3–9% there, so the hint is
//    «≈ weight (from–to)» between the two. At the same strength it is never heavier than week 2: its
//    window of reps to failure lies above week 2's, and both formulas give less load for more reps.
//    Where one step is over ~10% of the weight (light dumbbells), the nearest weight can be the week 2
//    one.
//  * Pull-ups: the whole load (body + added). A body-weight difference below one step is weigh-in
//    noise and is not recounted (the same threshold as above).
//  * Today's first working set corrects it by one step: below the window → a step down, two or more
//    reps above it → a step up.

import { daysBetween, fmtDay, fmtNum, median, plural } from './util.js';

export const STALE_DAYS = 56;
// Week 1 (light, RIR of its target) in the owner's scheme is 10–12 reps. The program keeps no rep
// range for it (targets are unchanged by v1.3), so the range is used here only.
export const LIGHT_REPS = [10, 12];

export const KIND = {
  up: 'Можно повысить',
  hold: 'Лучше закрепить',
  estimate: 'Ориентир',
  none: 'Недостаточно данных',
};

// How the hint was made, said in its ⓘ: the same week of the cycle, another heavy week, a recount
// from a heavy week to the light one.
export const BASIS = {
  same: 'По результату той же недели цикла',
  heavy: 'По сопоставимой тяжёлой неделе — приблизительно',
  light: 'Приблизительная оценка по другой неделе',
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
// → { kind: 'up' | 'hold' | 'estimate' | 'none', label, weight, conditional, reasons: [string], ref,
//     basis: 'same' | 'heavy' | 'light' | null, approx, range? }
export function recommend(args) {
  const a = sameWeek(args);
  if (!a.otherWeek) return a;
  const e = estimate(args, a.otherWeek);
  delete a.otherWeek;
  if (e.weight != null) return e;
  return { ...a, reasons: [...a.reasons, ...e.reasons] };
}

function sameWeek({
  list = [], session, target, category = null, step = 2.5, share = 0,
  todaySets = [], todayFlags = {}, bodyweightToday = null,
}) {
  step = step > 0 ? step : 2.5;
  const week = session.week;
  const reps = target?.reps || (week === 1 ? LIGHT_REPS : null);
  const rir = target?.rir || null;
  const load = (w) => fmtLoad(w, category);
  const out = (kind, weight, reasons, extra = {}) => ({ kind, label: KIND[kind], weight, conditional: false, reasons, ref: null, basis: kind === 'none' ? null : 'same', approx: false, ...extra });
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
    ], { otherWeek: { seg, before, from } });
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
  const goalAt = (w) => `Цель — ${reps[1]} ${plural(reps[1], 'повторение', 'повторения', 'повторений')}${rir ? ` при RIR ${range(rir)}` : ''} во всех подходах по ${load(w)}.`;
  const goal = goalAt(top);
  const [lo, hi] = reps;
  if (atTop.length < need) {
    // The top weight in too few sets. If it was below the range there, it is not the working weight:
    // hold the heaviest weight done in enough sets within the range (else the heaviest done in range,
    // else the lightest done).
    const short = atTop.filter((s) => s.reps < lo);
    if (short.length) {
      const ok = sets.filter((s) => s.reps >= lo);
      const count = (w) => ok.filter((s) => (s.weight || 0) === w).length;
      const weights = [...new Set(sets.map((s) => s.weight || 0))].sort((a, b) => b - a).filter((w) => w < top);
      const w = weights.find((x) => count(x) >= need) ?? weights.find((x) => count(x) > 0) ?? weights[weights.length - 1];
      if (w != null) {
        const n = count(w);
        return out('hold', w, [...reasons,
          `По ${load(top)} — ${short.map((s) => setText(s, category)).join(', ')}: ниже диапазона ${range(reps)}, поэтому рабочий вес — ${load(w)}${n ? ` (${n} ${plural(n, 'подход', 'подхода', 'подходов')} в диапазоне)` : ''}.`,
          goalAt(w), ...bwNotes], { ref: refInfo });
      }
    }
    return hold([`По ${load(top)} — ${atTop.length} ${plural(atTop.length, 'подход', 'подхода', 'подходов')} из ${target.sets}. ${goal}`], bwNotes);
  }

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

// ---------------------------------------------------------------- «Ориентир» from another week

const EPLEY = { cap: (load, rtf) => load * (1 + rtf / 30), load: (cap, rtf) => cap / (1 + rtf / 30) };
const BRZYCKI = { cap: (load, rtf) => (load * 36) / (37 - rtf), load: (cap, rtf) => (cap * (37 - rtf)) / 36 };

// The heaviest sets with RIR: all at the top weight, plus the next weight down when that is one set.
function heaviest(sets) {
  const v = sets.filter((s) => valid(s) && s.rir != null).sort((a, b) => (b.weight || 0) - (a.weight || 0));
  if (!v.length) return [];
  const top = v[0].weight || 0;
  let out = v.filter((s) => (s.weight || 0) === top);
  if (out.length < 2) {
    const next = v.find((s) => (s.weight || 0) < top);
    if (next) out = out.concat(v.filter((s) => (s.weight || 0) === next.weight));
  }
  return out.length >= 2 ? out : [];
}

// The second argument is what sameWeek saw: exposures before today and those since the baseline.
function estimate({
  session, target, category = null, step = 2.5, share = 0,
  todaySets = [], todayFlags = {}, bodyweightToday = null,
}, { seg, before }) {
  step = step > 0 ? step : 2.5;
  const week = session.week;
  const light = week === 1;
  const reps = target?.reps || (light ? LIGHT_REPS : null);
  const rir = target?.rir || null;
  const load = (w) => fmtLoad(w, category);
  const none = (why) => ({ weight: null, reasons: why ? [why] : [] });
  if (!reps || !rir) return none();
  // The latest heavy week other than today's (seg has no result of today's week).
  let src = null;
  for (let i = seg.length - 1; i >= 0 && !src; i--) if (seg[i].week !== 1 && seg[i].week !== week) src = seg[i];
  if (!src) return none();
  const gap = daysBetween(src.date, session.date);
  if (gap > STALE_DAYS) return none(`Последний результат другой тяжёлой недели был ${Math.floor(gap / 7)} нед. назад: ориентир не считается.`);
  const later = before.slice(before.indexOf(src) + 1);
  const todayPain = todayFlags.pain || todaySets.some((s) => !s.deleted && s.pain);
  const todayTech = todayFlags.technique || todaySets.some((s) => !s.deleted && s.technique);
  if (src.flags?.pain || later.some((e) => e.flags?.pain) || todayPain) return none('После отметки боли ориентир не считается.');
  if (src.flags?.technique || todayTech) return none('При отметке «техника хуже» ориентир не считается.');
  const used = heaviest(src.sets);
  if (!used.length) {
    const missing = src.sets.filter(valid).some((s) => s.rir == null);
    return none(missing
      ? `${fmtDay(src.date)} (неделя ${src.week}) RIR записан не во всех подходах: без него ориентир по другой неделе не считается.`
      : `${fmtDay(src.date)} (неделя ${src.week}) меньше двух рабочих подходов: по одному подходу ориентир не считается.`);
  }

  // Body weight, where it is part of the load: a difference below a step is noise.
  const notes = [];
  let bwSrc = share > 0 ? src.bw?.value ?? null : 0;
  let bwNow = share > 0 ? bodyweightToday?.value ?? null : 0;
  if (share > 0) {
    if (!(bwSrc > 0) && !(bwNow > 0)) return none('Масса тела неизвестна ни на одну из дат: ориентир для подтягиваний не считается.');
    if (!(bwSrc > 0) || !(bwNow > 0)) {
      notes.push('Масса тела на одну из дат неизвестна: её изменение не учтено.');
      bwSrc = bwNow = bwSrc > 0 ? bwSrc : bwNow;
    } else if (Math.abs(bwNow - bwSrc) < step) {
      if (Math.abs(bwNow - bwSrc) >= 0.5) notes.push(`Масса тела отличается от ${fmtDay(src.date)} меньше чем на шаг (${fmtNum(Math.abs(bwNow - bwSrc), 1)} кг): не пересчитываю.`);
      bwSrc = bwNow;
    } else {
      notes.push(`Масса тела ${bwNow > bwSrc ? 'больше' : 'меньше'} на ${fmtNum(Math.abs(bwNow - bwSrc), 1)} кг, чем ${fmtDay(src.date)}: учтено.`);
    }
  }
  const body = share * (bwNow || 0);
  const cap = (f) => median(used.map((s) => f.cap((s.weight || 0) + share * (bwSrc || 0), s.reps + s.rir)));
  const top = used[0].weight || 0;
  const grid = (w) => Math.max(0, round(top + Math.round((w - top) / step) * step));
  const lo = reps[0] + rir[0];
  const hi = reps[1] + rir[1];
  const aim = (lo + hi) / 2;
  const C = cap(EPLEY);
  const rtfAt = (w) => 30 * (C / (w + body) - 1);

  let weight = null;
  let span = null;
  if (light) {
    const ep = EPLEY.load(C, aim) - body;
    const bz = aim < 30 ? BRZYCKI.load(cap(BRZYCKI), aim) - body : ep;
    weight = grid((ep + bz) / 2);
    span = [grid(Math.min(ep, bz)), grid(Math.max(ep, bz))];
    if (span[0] === span[1]) span = null;
  } else {
    let best = null;
    for (let k = -12; k <= 12; k++) {
      const w = round(top + k * step);
      if (w < 0 || (share === 0 && w <= 0)) continue;
      const r = rtfAt(w);
      if (r < lo + 0.5) continue;
      if (!best || Math.abs(r - aim) < Math.abs(best.r - aim)) best = { w, r };
    }
    if (!best) return none();
    weight = best.w;
  }

  const srcText = used.length === src.sets.filter(valid).length
    ? src.sets.filter(valid).map((s) => setText(s, category)).join(', ')
    : `${src.sets.filter(valid).map((s) => setText(s, category)).join(', ')} (взяты самые тяжёлые: ${used.map((s) => setText(s, category)).join(', ')})`;
  const goal = `${range(reps)} при RIR ${range(rir)}`;
  const reasons = [
    light
      ? `Лёгкой недели в истории этого варианта ещё нет, поэтому вес пересчитан с недели ${src.week} (${fmtDay(src.date)}): ${srcText}.`
      : `На неделе ${week} этот вариант ещё не выполнялся, поэтому взята неделя ${src.week} (${fmtDay(src.date)}): ${srcText}.`,
  ];
  if (light) {
    reasons.push(`Цель лёгкой недели — ${goal}. Такой пересчёт неточен: ${span ? `формулы дают от ${load(span[0])} до ${load(span[1])}, ` : ''}ошибка около ±10%.`);
  } else {
    reasons.push(`По этим подходам при ${load(weight)} выходит около ${fmtNum(rtfAt(weight), 0)} повторений до отказа (повторения + RIR); цель недели — ${goal}.`);
  }
  reasons.push(...notes);
  const down = Math.max(0, round(weight - step));
  reasons.push(light
    ? `Это приблизительная оценка по другой неделе. Если первый подход тяжелее RIR ${fmtNum(rir[0])} — снизьте вес.`
    : `Это приблизительный расчёт по другой неделе, а не результат той же недели. Если первый подход пойдёт тяжелее плана — следующий ${load(down)}.`);

  // Today's first working set (with RIR) corrects the hint by one step.
  const first = todaySets.filter((s) => valid(s) && s.rir != null)[0];
  if (first) {
    const r = first.reps + first.rir;
    const w = first.weight || 0;
    if (r < lo) {
      weight = Math.max(0, round(w - step));
      reasons.push(`Сегодня первый подход ${setText(first, category)} — ниже цели: следующий ${load(weight)}.`);
    } else if (r >= hi + 2) {
      weight = round(w + step);
      reasons.push(`Сегодня первый подход ${setText(first, category)} — заметно легче цели: следующий ${load(weight)}.`);
    } else {
      weight = w;
      reasons.push(`Сегодня первый подход ${setText(first, category)} — в цели: этот вес и дальше.`);
    }
    span = null;
  }

  return {
    kind: 'estimate', label: KIND.estimate, weight, conditional: false, approx: true,
    basis: light ? 'light' : 'heavy', range: span, reps, reasons,
    ref: { date: src.date, week: src.week, sessionId: src.sessionId },
  };
}

