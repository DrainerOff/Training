// Is Apple Health data still arriving? The iPhone automations in «Команды» send weigh-ins, waist and
// sleep to the sheet on their own; when they stop (an iOS update, a changed setting) nothing breaks
// visibly, the data just stops. Pure functions — no storage, no DOM.

export const QUIET_HOURS = 48;
const TYPES = { weight: 'вес', waist: 'талия', fat: 'жир', sleep: 'сон' };

// When «Команды» last delivered something: from the sheet's log (Apps Script API 6 reports it with
// every sync, kv `ingest`) and from the newest unedited record that came that way (an older
// Apps Script) — whichever is later. Records only show deliveries that brought something new, so
// the log is the better source. { used, last, hours, quiet, byType: { weight: ms, … }, fromLog }.
export function healthDelivery({ ingest = null, body = [], sleep = [], now = Date.now() } = {}) {
  const byType = {};
  const bump = (type, at) => {
    if (!(at > 0)) return;
    if (!byType[type] || at > byType[type]) byType[type] = at;
  };
  for (const [type, v] of Object.entries(ingest?.byType || {})) bump(type, Number(v?.at));
  for (const r of body) if (!r.deleted && !r.edited && r.via === 'shortcut') bump(r.kind, r.updatedAt);
  for (const r of sleep) if (!r.deleted && !r.edited && r.via === 'shortcut') bump('sleep', r.updatedAt);
  const times = Object.values(byType);
  if (!times.length) return { used: false, last: null, hours: null, quiet: false, byType, fromLog: false };
  const last = Math.max(...times);
  const hours = (now - last) / 3600000;
  return { used: true, last, hours, quiet: hours > QUIET_HOURS, byType, fromLog: !!ingest?.lastAt };
}

// One plain line for the warning: what came last and when. `fmt(ms)` formats a time.
export function describeDelivery(d, { fmt }) {
  if (!d?.used) return '';
  const days = Math.floor(d.hours / 24);
  const ago = days >= 2 ? `${days} ${days < 5 ? 'дня' : 'дней'}` : `${Math.floor(d.hours)} ч`;
  const parts = Object.entries(d.byType)
    .sort((a, b) => b[1] - a[1])
    .map(([t, at]) => `${TYPES[t] || t} — ${fmt(at)}`);
  return `Данные из «Здоровья» не приходят ${ago}. Последние: ${parts.join(', ')}.`;
}
