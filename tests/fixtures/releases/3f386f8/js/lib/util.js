// Small shared helpers: ids, dates, numbers. No DOM access — safe to import in Node tests.

export function uid(prefix = '') {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let rnd = '';
  for (const b of bytes) rnd += b.toString(16).padStart(2, '0');
  return prefix + Date.now().toString(36) + rnd;
}

export function isoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetween(a, b) {
  return Math.round((parseISODate(b) - parseISODate(a)) / 86400000);
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function fmtDay(iso) {
  if (!iso) return '';
  const d = parseISODate(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function fmtDayWeekday(iso) {
  if (!iso) return '';
  const d = parseISODate(iso);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function fmtDayShort(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

export function fmtTime(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) return `${Math.floor(m / 60)} ч ${m % 60} мин`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Russian decimal comma, no trailing zeros: 82.5 -> "82,5", 80 -> "80".
export function fmtNum(n, maxDigits = 2) {
  if (n == null || Number.isNaN(n)) return '–';
  const r = Math.round(n * 10 ** maxDigits) / 10 ** maxDigits;
  return String(r).replace('.', ',');
}

export function parseNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function roundToStep(value, step) {
  if (!step) return value;
  return Math.round(value / step) * step;
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function sum(arr) {
  let t = 0;
  for (const v of arr) t += v;
  return t;
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function normName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

// Stable series key derived from an exercise name. Different names => different series,
// which is exactly what we want for alternatives (Hammer vs dumbbells are not comparable).
export function slugify(name) {
  const s = normName(name)
    .split('')
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, 48) || 'ex';
}
