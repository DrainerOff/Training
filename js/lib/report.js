// Weekly report: the last full calendar week (Monday to Sunday) and the 4 weeks up to it — training,
// body, nutrition, sleep — as plain sentences, and the same as compact text for ChatGPT. Pure and
// local: nothing leaves the phone unless the owner copies it. Every figure says what it is based
// on; with too little data it says «недостаточно данных»; relations are described, never causes.

import { seriesComparisons } from './plateau.js';
import { weeklyWeights, rateOf, rateStatus, STATUS_TEXT, phaseOn, addDays, MODES } from './phase.js';
import { summarize, weekStart } from './nutrition.js';
import { fmtDay, fmtNum, plural, sum } from './util.js';

// A week of nutrition counts for the kcal–weight comparison with 5+ final days; advice on calories
// needs 2+ such weeks and a weight rate over the same span.
export const NUTRITION_WEEK_DAYS = 5;
export const ADVICE_WEEKS = 2;
const KCAL_PER_KG = 7700;
const SHORT_SLEEP = 6;

export function lastFullWeek(today) {
  const mon = weekStart(today);
  return { from: addDays(mon, -7), to: addDays(mon, -1) };
}

const signed = (n, d = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtNum(Math.abs(n), d)}`;
const days = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
const inWeek = (date, w) => date >= w.from && date <= w.to;

// `days` — lib/bodydata.js dailyWeights().days; `nights` — sleepNights().nights; `series` —
// buildExposures (with body weight per date); the rest are plain store records.
export function weeklyReport({
  today, sessions = [], series = new Map(), program = null, days: weights = [], body = [], nights = [],
  nutrition = [], goals = [], phases = [], shareOf = () => 0, nameOf = (k) => k,
}) {
  const week = lastFullWeek(today);
  const four = [3, 2, 1, 0].map((i) => ({ from: addDays(week.from, -7 * i), to: addDays(week.to, -7 * i) }));
  const phase = phaseOn(phases, week.to);
  return {
    week,
    four,
    phase,
    training: training(week, { sessions, series, program, shareOf, nameOf }),
    body: bodyPart(week, four, { weights, body, phase }),
    nutrition: nutritionPart(week, four, { nutrition, goals, phases, phase, weights, today }),
    sleep: sleepPart(week, { nights, sessions }),
  };
}

// ---------------------------------------------------------------- training

function training(week, { sessions, series, program, shareOf, nameOf }) {
  const done = sessions.filter((s) => !s.deleted && s.status === 'done' && inWeek(s.date, week));
  const planned = program?.days?.length || null;
  const up = [];
  const flat = [];
  const down = [];
  const firsts = [];
  const pain = [];
  const technique = [];
  for (const [key, list] of series) {
    const comps = seriesComparisons(list.filter((e) => !e.active), { category: list[0]?.category, share: shareOf(key, list[0]?.category) });
    for (const c of comps) {
      const e = c.exposure;
      if (!inWeek(e.date, week)) continue;
      const name = nameOf(key, e);
      if (e.flags.pain) pain.push({ name, date: e.date });
      if (e.flags.technique) technique.push({ name, date: e.date });
      if (!c.cmp) {
        if (e.sets.length) firsts.push({ name, date: e.date, week: e.week });
        continue;
      }
      if (e.flags.pain) continue;
      const item = { name, date: e.date, week: e.week, prevDate: c.cmp.prev.date, median: c.cmp.median };
      (c.effective === 'up' ? up : c.effective === 'down' ? down : flat).push(item);
    }
  }
  const lines = [];
  if (!done.length) lines.push('За неделю тренировок не записано.');
  else lines.push(`За неделю выполнено ${done.length} ${plural(done.length, 'тренировка', 'тренировки', 'тренировок')}${planned ? ` из ${planned} по плану` : ''}.`);
  const compared = up.length + flat.length + down.length;
  if (compared) {
    lines.push(`С той же неделей цикла сравнено ${compared} ${plural(compared, 'упражнение', 'упражнения', 'упражнений')}: лучше — ${up.length}, на месте — ${flat.length}, ниже — ${down.length}.`);
    if (up.length) lines.push(`Лучше: ${up.map((x) => x.name).join(', ')}.`);
    if (down.length) lines.push(`Ниже: ${down.map((x) => `${x.name} (против ${fmtDay(x.prevDate)})`).join(', ')}.`);
  } else if (done.length) lines.push('Сравнивать не с чем: для этих упражнений нет прошлого результата на той же неделе цикла — недостаточно данных.');
  if (firsts.length && compared) lines.push(`Без сравнения (первый раз на этой неделе цикла): ${firsts.length}.`);
  if (pain.length) lines.push(`Боль отмечена: ${pain.map((x) => `${x.name}, ${fmtDay(x.date)}`).join('; ')}.`);
  if (technique.length) lines.push(`Техника хуже: ${technique.map((x) => `${x.name}, ${fmtDay(x.date)}`).join('; ')}.`);
  return { done: done.length, planned, up, flat, down, firsts, pain, technique, lines };
}

// ---------------------------------------------------------------- body

function bodyPart(week, four, { weights, body, phase }) {
  const ww = weeklyWeights(weights, { from: four[0].from, to: week.to });
  const cur = ww.find((w) => w.start === week.from) || { days: 0, avg: null, change: null };
  const prevW = ww.find((w) => w.start === addDays(week.from, -7));
  const lines = [];
  if (cur.avg == null) lines.push(`Средний вес за неделю: недостаточно данных (взвешиваний — ${cur.days}, нужно 3).`);
  else {
    lines.push(`Средний вес ${fmtNum(cur.avg, 1)} кг по ${cur.days} ${plural(cur.days, 'дню', 'дням', 'дням')} со взвешиванием${prevW?.avg != null ? `, за неделю ${signed(cur.avg - prevW.avg, 2)} кг (${signed(((cur.avg - prevW.avg) / prevW.avg) * 100, 2)} %)` : ''}.`);
  }
  const span = weights.filter((d) => d.date >= four[0].from && d.date <= week.to);
  const rate = rateOf(span);
  let status = null;
  if (phase) {
    const target = Number(phase.targetPct) || 0;
    if (rate) {
      status = rateStatus(rate.pct, target);
      lines.push(`Темп за 4 недели ${signed(rate.pct, 2)} % массы в неделю при цели ${signed(target, 2)} % (${MODES[phase.mode]?.label.toLowerCase() || phase.mode}) — ${STATUS_TEXT[status]}.`);
    } else lines.push('Темп за 4 недели: недостаточно данных (нужно 6 дней со взвешиванием за 14+ дней).');
  } else if (rate) lines.push(`Темп за 4 недели ${signed(rate.pct, 2)} % массы в неделю; режим не задан, сравнить с целью нельзя.`);
  const waist = [...body].filter((r) => r.kind === 'waist' && !r.deleted && r.excluded !== true).sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : 1));
  const wNow = waist.filter((r) => r.date <= week.to).pop();
  const wOld = waist.filter((r) => r.date <= addDays(week.to, -21)).pop();
  if (wNow && inWeek(wNow.date, week)) lines.push(`Талия ${fmtNum(wNow.value, 1)} см${wOld ? `, за 3+ недели ${signed(wNow.value - wOld.value, 1)} см` : ''}.`);
  else lines.push(`Талия: за неделю замеров нет${wNow ? ` (последний — ${fmtNum(wNow.value, 1)} см, ${fmtDay(wNow.date)})` : ''}.`);
  return { weekly: ww, avg: cur.avg, weighDays: cur.days, change: prevW?.avg != null && cur.avg != null ? cur.avg - prevW.avg : null, rate, status, lines };
}

// ---------------------------------------------------------------- nutrition

function nutritionPart(week, four, { nutrition, goals, phases, phase, weights, today }) {
  const s = summarize(nutrition, { from: week.from, to: week.to, phase, goals, phases, today });
  const lines = [];
  const of = `${s.days} ${plural(s.days, 'дня', 'дней', 'дней')}`;
  if (phase && s.days < 7) lines.push(`Неделя считается с начала режима: ${days(s.days)}.`);
  if (!s.final) lines.push(`Питание: итогов дней нет${s.drafts ? `, черновиков — ${s.drafts} (в средние не входят)` : ''} — недостаточно данных.`);
  else {
    const a = s.avg;
    if (a.kcal) lines.push(`Средняя калорийность по ${a.kcal.n} из ${of} — ${a.kcal.approx ? '≈' : ''}${fmtNum(a.kcal.value, 0)} ккал.`);
    const macro = ['protein', 'fat', 'carbs'].filter((f) => a[f]).map((f) => `${{ protein: 'белки', fat: 'жиры', carbs: 'углеводы' }[f]} ${a[f].approx ? '≈' : ''}${fmtNum(a[f].value, 0)} г (${a[f].n} дн.)`);
    if (macro.length) lines.push(`В среднем: ${macro.join(', ')}.`);
    if (s.drafts) lines.push(`Черновиков — ${s.drafts}: в средние не входят.`);
    if (s.approxDays) lines.push(`Приблизительные значения или диапазоны — в ${s.approxDays} ${plural(s.approxDays, 'дне', 'днях', 'днях')}.`);
    const p = s.check.protein;
    const pn = p.below.length + p.within.length + p.above.length;
    if (pn) lines.push(p.below.length ? `Белок ниже цели в ${p.below.length} ${plural(p.below.length, 'дне', 'днях', 'днях')} из ${pn}.` : pn === 1 ? 'Белок не ниже цели (1 день).' : `Белок не ниже цели во всех ${pn} ${plural(pn, 'дне', 'днях', 'днях')}.`);
    const k = s.check.kcal;
    const kn = k.below.length + k.within.length + k.above.length;
    if (kn) lines.push(`Калории в цели — ${k.within.length} из ${kn}${k.below.length ? `, ниже — ${k.below.length}` : ''}${k.above.length ? `, выше — ${k.above.length}` : ''}.`);
    else if (phase) lines.push('Цели по калориям для этого режима не заданы.');
  }
  // Kcal against weight, week by week (inside the phase when there is one).
  const ww = weeklyWeights(weights, { from: four[0].from, to: week.to });
  const rows = four.map((w) => {
    const ns = summarize(nutrition, { from: w.from, to: w.to, phase, goals, phases, today });
    const wk = ww.find((x) => x.start === w.from);
    return { ...w, kcal: ns.avg.kcal, final: ns.final, days: ns.days, weight: wk?.avg ?? null, weighDays: wk?.days || 0 };
  });
  const full = rows.filter((r) => r.kcal && r.final >= NUTRITION_WEEK_DAYS && r.weight != null);
  let advice = null;
  if (full.length >= 2) {
    lines.push(`Калории и вес по неделям: ${rows.map((r) => `${fmtDay(r.from)} — ${r.kcal && r.final ? `${r.kcal.approx ? '≈' : ''}${fmtNum(r.kcal.value, 0)} ккал (${r.final} дн.)` : 'нет данных'}, ${r.weight != null ? `${fmtNum(r.weight, 1)} кг` : 'вес —'}`).join('; ')}.`);
  }
  const span = weights.filter((d) => d.date >= full[0]?.from && d.date <= week.to);
  const rate = full.length >= ADVICE_WEEKS ? rateOf(span) : null;
  if (phase && rate && full.length >= ADVICE_WEEKS) {
    const target = Number(phase.targetPct) || 0;
    const st = rateStatus(rate.pct, target);
    const avgKcal = sum(full.map((r) => r.kcal.value)) / full.length;
    const mass = sum(full.map((r) => r.weight)) / full.length;
    const diff = (((rate.pct - target) / 100) * mass * KCAL_PER_KG) / 7; // kcal a day above (+) or below (−) the target pace
    if (st === 'on') advice = `За ${full.length} ${plural(full.length, 'неделю', 'недели', 'недель')} при ≈${fmtNum(avgKcal, 0)} ккал в день темп веса в пределах цели — менять калорийность повода нет.`;
    else if (Math.abs(diff) >= 50) {
      const step = Math.min(300, Math.max(100, Math.round(Math.abs(diff) / 50) * 50));
      advice = `За ${full.length} ${plural(full.length, 'неделю', 'недели', 'недель')} при ≈${fmtNum(avgKcal, 0)} ккал в день темп ${signed(rate.pct, 2)} % в неделю — ${STATUS_TEXT[st]} (цель ${signed(target, 2)} %). Если цель прежняя, можно попробовать ${diff > 0 ? 'уменьшить' : 'увеличить'} калории примерно на ${step} ккал в день и посмотреть ещё 2 недели. Оценка грубая: вес колеблется, связь калорий и веса за такой срок не точная.`;
    }
  } else if (s.final) {
    lines.push(`Советы по калорийности — только по 2+ неделям, где записано ${NUTRITION_WEEK_DAYS}+ дней питания и 3+ взвешивания; таких недель ${full.length} — недостаточно данных.`);
  }
  if (advice) lines.push(advice);
  return { summary: s, weeks: rows, advice, lines };
}

// ---------------------------------------------------------------- sleep

function sleepPart(week, { nights, sessions }) {
  const wk = nights.filter((n) => inWeek(n.date, week));
  const prev = nights.filter((n) => n.date >= addDays(week.from, -7) && n.date <= addDays(week.to, -7));
  const avg = wk.length ? sum(wk.map((n) => n.hours)) / wk.length : null;
  const avgPrev = prev.length ? sum(prev.map((n) => n.hours)) / prev.length : null;
  const lines = [];
  if (avg == null) lines.push('Сон: за неделю данных нет — недостаточно данных.');
  else lines.push(`Сон в среднем ${fmtNum(avg, 1)} ч по ${wk.length} из 7 ${plural(7, 'ночи', 'ночей', 'ночей')}${avgPrev != null ? `, неделей раньше — ${fmtNum(avgPrev, 1)} ч (${prev.length} из 7)` : ''}.`);
  const byDate = new Map(nights.map((n) => [n.date, n]));
  const done = sessions.filter((s) => !s.deleted && s.status === 'done' && inWeek(s.date, week));
  const short = done.filter((s) => byDate.get(s.date)?.hours < SHORT_SLEEP);
  const known = done.filter((s) => byDate.has(s.date));
  if (known.length && short.length) lines.push(`${short.length} из ${known.length} тренировок — в день после сна короче ${SHORT_SLEEP} ч. Это совпадение во времени, не вывод о причине.`);
  return { avg, nights: wk.length, avgPrev, short: short.length, lines };
}

// ---------------------------------------------------------------- text for ChatGPT

export function reportText(r) {
  const out = [`Отчёт за неделю ${fmtDay(r.week.from)} — ${fmtDay(r.week.to)}${r.phase ? `, режим: ${MODES[r.phase.mode]?.label || r.phase.mode} с ${fmtDay(r.phase.start)}, цель ${signed(Number(r.phase.targetPct) || 0, 2)} % массы в неделю` : ', режим не задан'}.`];
  const part = (title, lines) => out.push('', `${title}:`, ...lines.map((l) => `- ${l}`));
  part('Тренировки', r.training.lines);
  part('Тело', r.body.lines);
  part('Питание', r.nutrition.lines);
  part('Сон', r.sleep.lines);
  out.push('', 'Данные из моего трекера: только итоги, средние по записанным дням; «недостаточно данных» — значит, выводов по этому пункту нет.');
  return out.join('\n');
}
