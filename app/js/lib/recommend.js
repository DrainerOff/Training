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
//  * Order: where today the exercise stands two or more places later in the day's program than in that
//    workout, it is not raised («закрепить», with the reason): more work before it, less to lift
//    (a press moved behind another press). Earlier is no reason to change. Places are compared within
//    one day of the program: where that workout was another day (the exercise is in two days, at their
//    own places), today's place is compared with the latest workout of today's day in the same week of
//    the cycle, else with nothing. With the variant twice in a day, its place nearest before today's.
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
//    But not by a whole window: where one step is large for the weight (12 → 14,5 kg is +21%) and that
//    weight lands above the window (too light, reps to spare), the next step up is taken when it misses
//    the window by less and by at most one rep below it. The ⓘ says so.
//  * Light week (its target: base lifts and Hammer 10–12, isolation 12–15, at the RIR of PHASE[1];
//    lib/program.js CATEGORY lightReps) from a heavy one is a long way to recount: Epley and Brzycki
//    differ by 3–8% there for 10–12 and by 8–13% for 12–15, so the hint is «≈ weight (from–to)»
//    between the two. At the same strength it is never heavier than week 2: its window of reps to
//    failure lies above week 2's, and both formulas give less load for more reps.
//    Where one step is over ~10% of the weight (light dumbbells), the nearest weight can be the week 2
//    one.
//  * Pull-ups: the whole load (body + added). A body-weight difference below one step is weigh-in
//    noise and is not recounted (the same threshold as above).
//  * Today's latest working set (with RIR) corrects it by one step from that set's weight: below the
//    window → a step down, two or more reps above it → a step up, else that weight. Not the first set
//    only: on the light week, with short rests, the reps to failure can fall by a few from the first
//    set to the second, and «в цели: этот вес и дальше» after the first one is wrong by then.
//    A set harder than the planned RIR with no rep to spare at the bottom of the window (12 to failure
//    at 10–12, RIR 2–3) is below it too: the next set, more tired, falls short. A step up follows the
//    large-step rule above (it errs light) and never goes back to a weight that was below the window
//    today: with dumbbells 10 / 12,5 the hint would swing between the two after every set.
//    A step down follows it too, the other way: the next set is taken a rep weaker (the light week
//    loses about one to failure from set to set), and the weight stays where one step down lands above
//    the window by more than this weight falls below it, plus a rep (a cable stack in 2,5 kg plates:
//    5 → 2,5 kg is half the load, ≈54 to failure at 14–18) — only when that set was at most one rep
//    below the window, and not where a set at the lighter weight today was in the window or below it.
//    Where that step lands above the window, the ⓘ names the weight between the two for the middle of
//    the window: small add-on weights make it. The advice for the first set goes once a set is logged.
//  * Order: two or more places later in the day's program than in the source workout → the ⓘ and
//    the line say so; the weight itself is not recounted (one case is not a number). Compared within
//    one day of the program, as above.
//  * Reps to failure are rounded to a millionth: the median of n−1 and n+1 is n, not n + 4e-15, and
//    a hint never changes by a step with the order of the sets.

import { daysBetween, fmtDay, fmtNum, median, plural } from './util.js';

export const STALE_DAYS = 56;

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
const fine = (x) => Math.round(x * 1e6) / 1e6;
const ORDINAL = ['первый', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой'];

// Two or more places later in the day's program than in the workout compared with: more work before it.
export const MOVED_PLACES = 2;
// The workout whose place counts: the reference itself when it was today's day of the program, else
// the latest workout of today's day in the same week of the cycle (or none) — two days of the program
// put an exercise at their own places every time, and that is no reason to hold its weight.
function placeRef(ref, before, day) {
  if (!ref || ref.day == null || day == null || ref.day === day) return ref;
  for (let i = before.length - 1; i >= 0; i--) if (before[i].day === day && before[i].week === ref.week) return before[i];
  return null;
}
// With the variant twice in that workout (`places`), the place nearest before today's counts.
function movedLater(p, order) {
  if (!Number.isInteger(order) || !p) return null;
  const then = Math.max(-1, ...(p.places?.length ? p.places : [p.order]).filter((x) => Number.isInteger(x) && x <= order));
  if (then < 0 || order - then < MOVED_PLACES) return null;
  return { then: then + 1, now: order + 1 };
}
const movedText = (p, mv, ref) => `${p === ref ? `В тот раз (${fmtDay(p.date)})` : `${fmtDay(p.date)} (день ${p.day})`} упражнение было ${mv.then}-м по порядку, сегодня оно ${mv.now}-е: перед ним больше работы`;

// The working weight of a workout: its top weight, unless that weight was done in too few of the
// planned sets and below the range there (one heavy set, the rest lighter) — then the heaviest weight
// done in enough sets within the range, else the heaviest done in range, else the lightest done.
// «Закрепить» holds it; lib/plateau.js weightDrop compares today's weight with it.
// → { weight, top, atTop, need, short: [top sets below the range], inRange: sets in range at weight } or null
export function workingWeight(sets, target) {
  const v = sets.filter(valid);
  if (!v.length) return null;
  const top = Math.max(...v.map((s) => s.weight || 0));
  const atTop = v.filter((s) => (s.weight || 0) === top);
  const need = Math.max(1, (target?.sets || atTop.length) - 1);
  const lo = target?.reps?.[0];
  const res = { weight: top, top, atTop, need, short: [], inRange: 0 };
  if (atTop.length >= need || lo == null) return res;
  const short = atTop.filter((s) => s.reps < lo);
  if (!short.length) return res;
  const ok = v.filter((s) => s.reps >= lo);
  const count = (w) => ok.filter((s) => (s.weight || 0) === w).length;
  const weights = [...new Set(v.map((s) => s.weight || 0))].sort((a, b) => b - a).filter((w) => w < top);
  const w = weights.find((x) => count(x) >= need) ?? weights.find((x) => count(x) > 0) ?? weights[weights.length - 1];
  return w == null ? res : { ...res, weight: w, short, inRange: count(w) };
}

// `list` — exposures of this variant (lib/plateau.js buildExposures, chronological, with `bw`);
// `session` — today's workout { id, date, week, startedAt }; `target` — today's target
// (lib/program.js targetFor); `todaySets` — sets already logged today for this exercise;
// `todayFlags` — pain / technique / baseline marked today; `share` — lifted part of body weight;
// `bodyweightToday` — lib/bodyweight.js bodyweightAt(today) or null; `order` — today's place of the
// exercise in the day's program (0 = first), or null.
// → { kind: 'up' | 'hold' | 'estimate' | 'none', label, weight, conditional, reasons: [string], ref,
//     basis: 'same' | 'heavy' | 'light' | null, approx, range?, moved? }
//   `moved` — { then, now } (1-based places) when the reference stood two or more places earlier;
//   left out once a working set is logged today (the ⓘ still says it).
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
  todaySets = [], todayFlags = {}, bodyweightToday = null, order = null,
}) {
  step = step > 0 ? step : 2.5;
  const week = session.week;
  const reps = target?.reps || null;
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
  const ww = workingWeight(sets, target);
  const { top, atTop, need } = ww;
  const reasons = [`Прошлый раз на неделе ${week}, ${fmtDay(ref.date)}: ${sets.map((s) => setText(s, category)).join(', ')}.`];
  const refInfo = { date: ref.date, week, sessionId: ref.sessionId };
  // Later in the day's program than that time: said with every hold; an increase waits. The line
  // under the advice (`moved`) only until today's first working set has answered it.
  const place = placeRef(ref, before, session.day);
  const moved = movedLater(place, order);
  const movedNote = moved ? [`${movedText(place, moved, ref)}, вес может быть завышен — проверьте первым подходом.`] : [];
  const movedInfo = moved && !todaySets.some(valid) ? { moved } : {};
  // Every hold names the working weight (pain, worse technique, a break included): not one heavy set
  // below the range — that is also what lib/plateau.js weightDrop measures a drop from.
  const hold = (why, more = []) => out('hold', ww.weight, [...reasons, ...why, ...more, ...movedNote], { ref: refInfo, ...movedInfo });

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

  const goalAt = (w) => `Цель — ${reps[1]} ${plural(reps[1], 'повторение', 'повторения', 'повторений')}${rir ? ` при RIR ${range(rir)}` : ''} во всех подходах по ${load(w)}.`;
  const goal = goalAt(top);
  const [lo, hi] = reps;
  if (atTop.length < need) {
    // The top weight in too few sets. If it was below the range there, it is not the working weight
    // (workingWeight).
    if (ww.weight !== top) {
      const { weight: w, short, inRange: n } = ww;
      return out('hold', w, [...reasons,
        `По ${load(top)} — ${short.map((s) => setText(s, category)).join(', ')}: ниже диапазона ${range(reps)}, поэтому рабочий вес — ${load(w)}${n ? ` (${n} ${plural(n, 'подход', 'подхода', 'подходов')} в диапазоне)` : ''}.`,
        goalAt(w), ...bwNotes, ...movedNote], { ref: refInfo, ...movedInfo });
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

  if (moved) {
    return out('hold', top, [...reasons, ...why.slice(0, 1),
      `${movedText(place, moved, ref)}, поэтому вес пока не повышаем: сначала ${load(top)} на новом месте.`, ...bwNotes],
    { ref: refInfo, ...movedInfo });
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
  todaySets = [], todayFlags = {}, bodyweightToday = null, order = null,
}, { seg, before }) {
  step = step > 0 ? step : 2.5;
  const week = session.week;
  const light = week === 1;
  const reps = target?.reps || null;
  const rir = target?.rir || null;
  const load = (w) => fmtLoad(w, category);
  const none = (why) => ({ weight: null, reasons: why ? [why] : [] });
  // «при 10 кг», but pull-ups with no added weight: «без доп. веса», not «при без доп. веса».
  const atLoad = (w) => (category === 'pullup' && !(w > 0) ? load(w) : `при ${load(w)}`);
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
  const grid = (w) => Math.max(0, round(top + Math.round(fine((w - top) / step)) * step));
  const lo = reps[0] + rir[0];
  const hi = reps[1] + rir[1];
  const aim = (lo + hi) / 2;
  const C = cap(EPLEY);
  const rtfAt = (w) => fine(30 * (C / (w + body) - 1));

  let weight = null;
  let span = null;
  let coarse = null;
  if (light) {
    const ep = EPLEY.load(C, aim) - body;
    const bz = aim < 30 ? BRZYCKI.load(cap(BRZYCKI), aim) - body : ep;
    weight = grid((ep + bz) / 2);
    span = [grid(Math.min(ep, bz)), grid(Math.max(ep, bz))];
    if (span[0] === span[1]) span = null;
  } else {
    const cands = [];
    // Twelve steps each way, or half the load where the step is fine for it (0,5 kg at 150 kg).
    const K = Math.max(12, Math.ceil((0.5 * (top + body)) / step));
    for (let k = -K; k <= K; k++) {
      const w = round(top + k * step);
      if (w < 0 || (share === 0 && w <= 0)) continue;
      cands.push({ w, r: rtfAt(w) });
    }
    let best = null;
    for (const c of cands) {
      if (c.r < lo + 0.5) continue;
      if (!best || Math.abs(c.r - aim) < Math.abs(best.r - aim)) best = c;
    }
    if (!best) return none();
    // A step that is large for the weight (light dumbbells): the nearest allowed weight can land well
    // above the window — reps to spare, no target hit. Then the next step up is taken when it is at most
    // one rep below the window and misses it by over a rep less than the lighter one overshoots it (the
    // lighter weight keeps one rep of advantage: it still errs light, just not by the whole window).
    if (best.r > hi + 1) {
      const up = cands.find((c) => c.w === round(best.w + step));
      if (up) {
        const n = (c) => fmtNum(Math.max(0, c.r), 0);
        if (up.r >= lo - 1 && Math.max(0, lo - up.r) + 1 < best.r - hi) {
          coarse = `Шаг ${fmtNum(step)} кг для этого веса крупный: ${atLoad(best.w)} выходит около ${n(best)} повторений до отказа — легче цели, при ${load(up.w)} — около ${n(up)}. Взят ${load(up.w)}: он ближе к цели.`;
          best = up;
        } else {
          coarse = `Шаг ${fmtNum(step)} кг для этого веса крупный: при ${load(up.w)} выходит около ${n(up)} повторений до отказа — тяжелее цели, поэтому ${load(best.w)}.`;
        }
      }
    }
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
  const place = placeRef(src, before, session.day);
  const moved = movedLater(place, order);
  if (moved) reasons.push(`${movedText(place, moved, src)}, поэтому ориентир может быть завышен — проверьте первым подходом.`);
  if (light) {
    reasons.push(`Цель лёгкой недели — ${goal}. Такой пересчёт неточен: ${span ? `формулы дают от ${load(span[0])} до ${load(span[1])}, ` : ''}ошибка около ±10%.`);
  } else {
    reasons.push(`По этим подходам ${atLoad(weight)} выходит около ${fmtNum(rtfAt(weight), 0)} повторений до отказа (повторения + RIR); цель недели — ${goal}.`);
    if (coarse) reasons.push(coarse);
  }
  reasons.push(...notes);
  // Today's latest working set (with RIR) corrects the hint by one step from its weight: the sets
  // after the first show how the weight holds up as they go on. What to do after the first set is
  // said only until one is logged: then the line about that set says it (it may keep the weight).
  const working = todaySets.filter(valid);
  const withRir = working.filter((s) => s.rir != null);
  const last = withRir.at(-1);
  const down = Math.max(0, round(weight - step));
  reasons.push(light
    ? `Это приблизительная оценка по другой неделе.${last ? '' : ` Если первый подход тяжелее RIR ${fmtNum(rir[0])} — снизьте вес.`}`
    : `Это приблизительный расчёт по другой неделе, а не результат той же недели.${last ? '' : ` Если первый подход пойдёт тяжелее плана — следующий ${load(down)}.`}`);
  // Below the window, or harder than the planned RIR without a rep to spare at its bottom.
  const below = (s) => s.reps + s.rir < lo + (s.rir < rir[0] ? 1 : 0);
  if (last) {
    const n = working.indexOf(last) + 1;
    const now = `Сегодня ${ORDINAL[n - 1] || `${n}-й`} подход ${setText(last, category)}`;
    const r = last.reps + last.rir;
    const w = last.weight || 0;
    if (below(last)) {
      // A step down as in the large-step rule, the other way: the next set is taken a rep weaker
      // (the light week loses about one to failure from set to set), and this weight stays where one
      // step down lands above the window by more than this weight falls below it, plus a rep — the
      // lighter weight keeps one rep of advantage. Only when this set was at most one rep below the
      // window (as the heavier weight in that rule), and never where a set at the lighter weight
      // today was not clearly lighter than the target: what was done beats the formula.
      const down = Math.max(0, round(w - step));
      const next = r - 1;
      const capNext = EPLEY.cap(w + body, next);
      const downR = down + body > 0 ? fine(30 * (capNext / (down + body) - 1)) : Infinity;
      const why = r < lo ? 'ниже цели' : `тяжелее плана (RIR ${range(rir)})`;
      const tried = withRir.some((s) => (s.weight || 0) >= down && (s.weight || 0) < w && s.reps + s.rir < hi + 2);
      if (!tried && r >= lo - 1 && Math.max(0, lo - next) + 1 < downR - hi) {
        weight = w;
        const at = !Number.isFinite(downR) ? 'на шаг легче — уже без веса'
          : `${atLoad(down)} выходит около ${fmtNum(downR, 0)} повторений до отказа — легче цели`;
        reasons.push(`${now} — ${why}, но шаг ${fmtNum(step)} кг для этого веса крупный: ${at}. Этот вес и дальше, останавливайтесь на RIR ${range(rir)}, даже если повторений меньше.`);
      } else {
        weight = down;
        reasons.push(`${now} — ${why}: следующий ${load(weight)}.`);
      }
      // Where a step is large for the weight, the weight between the two (body weight aside) for the
      // middle of the window: on a cable stack with small add-on weights it can be done.
      if (downR > hi) {
        const mid = Math.round(2 * (capNext / (1 + aim / 30) - body)) / 2;
        if (mid > down && mid < w) reasons.push(`Точнее — около ${load(mid)}, если есть чем добрать вес (маленький блин, гантель). Шаг веса упражнения меняется в программе.`);
      }
    } else if (r >= hi + 2) {
      // A step up as in the large-step rule: only when that weight misses the window by less than this
      // one overshoots it — and never back to a weight that was below the window today.
      const up = round(w + step);
      const upR = fine(30 * (EPLEY.cap(w + body, r) / (up + body) - 1));
      const failed = withRir.find((s) => (s.weight || 0) >= up && below(s));
      weight = w;
      if (failed) {
        reasons.push(`${now} — заметно легче цели, но ${setText(failed, category)} сегодня уже был ниже цели: этот вес и дальше.`);
      } else if (upR >= lo - 1 && Math.max(0, lo - upR) + 1 < r - hi) {
        weight = up;
        reasons.push(`${now} — заметно легче цели: следующий ${load(weight)}.`);
      } else {
        reasons.push(`${now} — заметно легче цели, но шаг ${fmtNum(step)} кг для этого веса крупный: при ${load(up)} выходит около ${fmtNum(Math.max(0, upR), 0)} повторений до отказа — тяжелее цели. Этот вес и дальше.`);
      }
    } else {
      weight = w;
      reasons.push(last.rir < rir[0]
        ? `${now} — вес в цели, но подход тяжелее плана: этот вес и дальше, останавливайтесь на RIR ${range(rir)}.`
        : `${now} — в цели: этот вес и дальше.`);
    }
    span = null;
  }

  return {
    kind: 'estimate', label: KIND.estimate, weight, conditional: false, approx: true,
    basis: light ? 'light' : 'heavy', range: span, reps, reasons,
    ref: { date: src.date, week: src.week, sessionId: src.sessionId },
    ...(moved && !working.length ? { moved } : {}),
  };
}

