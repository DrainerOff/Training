// Human wording for analytics results.

import { fmtNum, plural } from '../lib/util.js';

export function describeComparison(cmp) {
  const tone = cmp.verdict === 'up' ? 'up' : cmp.verdict === 'down' ? 'down' : 'flat';
  const word = cmp.verdict === 'up' ? 'лучше' : cmp.verdict === 'down' ? 'хуже' : 'на уровне';
  let detail;
  const r = Math.abs(cmp.repsDelta);
  if (cmp.sameWeights && cmp.repsDelta !== 0) {
    detail = `${cmp.repsDelta > 0 ? '+' : '−'}${r} ${plural(r, 'повторение', 'повторения', 'повторений')} при том же весе`;
  } else if (cmp.sameWeights) {
    detail = cmp.verdict === 'flat' ? 'те же веса и повторения' : `те же цифры, RIR ${cmp.verdict === 'up' ? 'выше — легче' : 'ниже — тяжелее'}`;
  } else if (cmp.pairs.every((p) => p.cur.reps === p.prev.reps) && new Set(cmp.pairs.map((p) => (p.cur.weight || 0) - (p.prev.weight || 0))).size === 1) {
    const dw = (cmp.pairs[0].cur.weight || 0) - (cmp.pairs[0].prev.weight || 0);
    detail = `${dw > 0 ? '+' : '−'}${fmtNum(Math.abs(dw))} кг при тех же повторениях`;
  } else {
    const pct = cmp.median * 100;
    detail = `${pct >= 0 ? '+' : '−'}${fmtNum(Math.abs(pct), 1)}% силы по подходам`;
  }
  if (cmp.setsDelta < 0) detail += `, подходов меньше на ${-cmp.setsDelta}`;
  return { tone, word, detail, short: `${word}, ${detail}` };
}
