/** Criteria roll-up and the suggested score. */
const VALUE = { met: 1, partly: 0.5, not: 0 };

function byShare(share, met = 0.9, partly = 0.6) {
  if (share >= met) return 'met';
  if (share >= partly) return 'partly';
  return 'not';
}

function criterion(id, label, status, reason, refs = [], weight = 1) {
  return { id, label, status, reason, refs, weight };
}

/** 0–5 from the weighted criteria; a criterion marked `cap` limits the score when not met. */
function suggestScore(criteria) {
  const scored = criteria.filter((c) => c.status in VALUE);
  if (!scored.length) return { score: null, reason: 'Nothing to score.' };
  const total = scored.reduce((a, c) => a + c.weight, 0);
  let value = scored.reduce((a, c) => a + VALUE[c.status] * c.weight, 0) / total;
  let score = Math.round(value * 5);
  for (const c of scored) if (c.cap !== undefined && c.status !== 'met') score = Math.min(score, c.cap);
  const weak = scored.filter((c) => c.status !== 'met').map((c) => `${c.label} (${c.status === 'not' ? 'not met' : 'partly'})`);
  return { score, reason: weak.length ? `Held back by: ${weak.join('; ')}.` : 'Every criterion is met.' };
}

const count = (items, status) => items.filter((i) => i.status === status).length;

module.exports = { byShare, criterion, suggestScore, count };
