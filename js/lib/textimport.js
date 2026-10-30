// Parser for past workouts pasted as text (e.g. produced by ChatGPT from the old sheet,
// or typed by hand). Nothing is saved until the owner confirms the preview.
//
//   16.10.2026 цикл 1 неделя 1 день 1
//   Подтягивания прямым хватом: 0x6, 0x6, 0x6
//   Жим штанги под наклоном: 60x10@4, 60x10@4, 60x9@3
//   Наклонный Hammer: 40x10 x3          ← «x3» = три одинаковых подхода
//   Икры в жиме ногами: 100x12, 100x12, 100x11, дроп 70x10
//   # строки с решёткой — комментарии

import { findOptionByName, programToText, PHASE } from './program.js';
import { slugify } from './util.js';

// Requests behind «Скопировать запрос для ChatGPT». They name no spreadsheet: every user keeps the
// old records somewhere of their own, so the request asks to attach them to the chat.
export const PROGRAM_PROMPT = `Перепиши программу тренировок из того, что я приложу (таблица, фото или текст), строго в этом текстовом формате, ничего не меняя в составе упражнений и порядке:

День 1: <название дня, если есть>
- <Упражнение> [категория] / <альтернатива> / <альтернатива>

Категории: [base] — базовые (жим штанги, маятниковый присед, горизонтальные и вертикальные тяги), [hammer] — Hammer, [pullup] — подтягивания, [iso] — изоляция и пресс, [calves] — икры.
Если в программе для упражнения указаны свои подходы/повторения по неделям, добавь в строку н1=3x10-12@${PHASE[1].rir.join('-')} н2=... н3=... (подходы x повторения @ RIR). Если не указаны — не добавляй.
Выведи только текст программы, без пояснений.`;

const range = (r) => `${r[0]}–${r[1]}`;

// With the program of this phone appended, so the names come back exactly as the app knows them
// (a name it doesn't know starts a separate series). The starter draft is not worth appending.
export function resultsPrompt(program) {
  const names = program && !program.draft && program.days?.some((d) => d.slots.length)
    ? `Названия упражнений — точно как в моей программе ниже (название — до квадратных скобок, через « / » перечислены варианты, бери тот, что делался):\n\n${programToText(program)}`
    : 'Названия упражнений — как в записях.\n';
  return `Выпиши ВСЕ фактически выполненные тренировки из того, что я приложу (таблица, фото или текст) — только реально записанные результаты, не план и не расчётные значения — в формате:

16.10.2026 цикл 1 неделя 1 день 1
Подтягивания прямым хватом: св x6, 5x6@2, 5x6@1
Жим штанги под наклоном: 60x10@4, 60x10@4, 62,5x9@3
Икры в жиме ногами: 100x12, 100x12, дроп 70x10

Правила: пустая строка между тренировками. Вес в кг (дробные через запятую), «x» между весом и повторениями, «@RIR» только если фактический RIR записан. Подтягивания без веса — «св x6», с отягощением — только добавочный вес, без плюса: «5x6». Дроп-сет — «дроп 70x10». Неделя цикла: 1 — лёгкая, 2 — ${range(PHASE[2].reps)} повторений, 3 — ${range(PHASE[3].reps)}. Ничего не придумывай: если значение не записано, пропусти подход; если не ясно, какой это цикл, неделя или день, спроси меня. Выведи только текст тренировок, без пояснений.
${names}`;
}

const HEADER_DATE = /(\d{1,2})\.(\d{1,2})\.(\d{4})|(\d{4})-(\d{2})-(\d{2})/;
const TOKENS = {
  cycle: /(?:цикл|ц)\s*(\d+)/i,
  week: /(?:неделя|нед|н)\s*([123])\b/i,
  day: /(?:день|д)\s*(\d+)/i,
};
// weight × reps [× count] [@rir]; weight may be "св"/"bw" for bodyweight.
// Tokens are matched rather than split on commas, because "62,5x9" uses a decimal comma.
const SET_RE = /(дроп\s+|drop\s+)?(св|bw|\d+(?:[.,]\d+)?)\s*[xх×*]\s*(\d+)(?:\s*[xх×*]\s*(\d+))?(?:\s*@\s*(\d+(?:\.5)?))?/gi;

export function parseResultsText(text, program) {
  const sessions = [];
  const errors = [];
  let cur = null;
  String(text || '')
    .split(/\r?\n/)
    .forEach((raw, idx) => {
      const line = raw.trim();
      const ln = idx + 1;
      if (!line || line.startsWith('#')) return;
      const dm = line.match(HEADER_DATE);
      if (dm && !line.includes(':')) {
        const date = dm[1] ? `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}` : `${dm[4]}-${dm[5]}-${dm[6]}`;
        const rest = line.replace(dm[0], ' ');
        const pick = (re) => {
          const m = rest.match(re);
          return m ? Number(m[1]) : null;
        };
        cur = { date, cycle: pick(TOKENS.cycle), week: pick(TOKENS.week), day: pick(TOKENS.day), items: [], line: ln };
        if (!cur.cycle || !cur.week || !cur.day) {
          errors.push({ line: ln, msg: 'Укажите цикл, неделю и день: «цикл 1 неделя 1 день 1»' });
        }
        sessions.push(cur);
        return;
      }
      if (!cur) {
        errors.push({ line: ln, msg: 'Сначала строка с датой тренировки' });
        return;
      }
      const colon = line.indexOf(':');
      if (colon < 1) {
        errors.push({ line: ln, msg: 'Ожидается «Упражнение: 60x10, 60x9»' });
        return;
      }
      const name = line.slice(0, colon).trim();
      const opt = findOptionByName(program, name);
      const item = {
        name: opt ? opt.name : name,
        key: opt ? opt.key : slugify(name),
        slotId: opt ? opt.slot.id : null,
        category: opt ? opt.slot.category : null,
        known: !!opt,
        sets: [],
      };
      const body = line.slice(colon + 1).split('#')[0];
      const leftover = body.replace(SET_RE, (tok, drop, w, r, cnt, rirTok) => {
        const weight = /^(св|bw)$/i.test(w) ? 0 : Number(w.replace(',', '.'));
        const count = cnt ? Number(cnt) : 1;
        if (count > 10) {
          errors.push({ line: ln, msg: `Слишком много повторов подхода «${tok.trim()}»` });
          return ' ';
        }
        const rir = rirTok != null ? Number(rirTok) : null;
        for (let i = 0; i < count; i++) item.sets.push({ weight, reps: Number(r), rir, drop: !!drop });
        return ' ';
      });
      for (const junk of leftover.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
        errors.push({ line: ln, msg: `Не понял подход «${junk}»` });
      }
      if (item.sets.length) cur.items.push(item);
    });
  return { sessions, errors };
}
