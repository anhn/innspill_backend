/**
 * Work handed in from an InnSpill tool is stored as JSON in a submission's conversationLog
 * (RE Studio interviews, Automated review findings and labels, Acceptance testing, LLM test lab,
 * Sustainability lab). The feedback agents get a readable summary of it instead of raw JSON,
 * so the context fits and the model sees the structure the group worked in.
 */

const cut = (text, n) => {
  const s = text == null ? '' : String(text).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};
const nums = (raw) => String(raw || '').split(/[\s,;]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const sd = (v) => {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};

function reStudio(d) {
  const lines = [`RE Studio interviews (${(d.interviews || []).length} stakeholders):`];
  for (const i of d.interviews || []) {
    lines.push(`\n## ${i.name} (${(i.messages || []).length} messages)`);
    for (const m of i.messages || []) lines.push(`[${m.at}] ${m.who === 'you' ? 'Group' : i.name}: ${cut(m.text, 280)}`);
  }
  return lines.join('\n');
}

function review(d) {
  const labels = d.labels || {};
  const findings = d.findings || [];
  const labelled = findings.filter((f) => labels[f.id] && labels[f.id].verdict && String(labels[f.id].reason || '').trim());
  const tools = [...new Set(findings.flatMap((f) => f.tools || []))];
  const lines = [
    `Automated review of ${d.repo} at commit ${d.commit}: ${findings.length} findings, ${labelled.length} labelled by the group.`,
    'Precision per tool from the group\'s labels:',
    ...tools.map((tool) => {
      const l = labelled.filter((f) => (f.tools || []).includes(tool));
      const tp = l.filter((f) => labels[f.id].verdict === 'tp').length;
      return `- ${tool}: ${tp}/${l.length} true problems${l.length ? ` (${Math.round((tp / l.length) * 100)}%)` : ''}`;
    }),
    '',
    'Findings and the group\'s labels:',
    ...findings.map((f) => {
      const label = labels[f.id];
      const verdict = label && label.verdict ? (label.verdict === 'tp' ? 'TRUE PROBLEM' : 'FALSE ALARM') : 'NOT LABELLED';
      return `- ${f.id} [${(f.tools || []).join(', ')}${f.severity ? `, ${f.severity}` : ''}] ${f.file}:${f.line}${f.endLine ? `-${f.endLine}` : ''} ${cut(f.title, 90)}${f.code ? ` | code: ${cut(f.code, 120)}` : ''} → ${verdict}${label && label.reason ? `: "${cut(label.reason, 220)}"` : ''}`;
    }),
  ];
  if (d.comparison) lines.push('', `Group's one-page comparison: ${cut(d.comparison, 1500)}`);
  return lines.join('\n');
}

function acceptance(d) {
  const results = d.results || {};
  const lines = [`Acceptance test of ${d.partner || 'the partner group'}:`, 'Criteria and results:'];
  for (const c of d.criteria || []) {
    const r = results[c.id] || {};
    lines.push(`- ${c.id}: ${cut(c.text, 160)} → ${r.result || 'not tested'}${r.evidence ? ` (evidence: ${cut(r.evidence, 160)})` : ''}`);
  }
  lines.push(`Bug reports filed: ${(d.issues || []).length}`);
  for (const i of d.issues || []) lines.push(`- #${i.id} ${cut(i.title, 100)}. Steps: ${cut(i.steps, 160)}. Expected: ${cut(i.expected, 100)}. Actual: ${cut(i.actual, 100)}.`);
  const s = d.sessions || {};
  const n = d.notes || {};
  lines.push(`User session P1: script "${cut(s.p1, 160)}"; observations "${cut(n.p1, 240)}"`);
  lines.push(`User session P2: script "${cut(s.p2, 160)}"; observations "${cut(n.p2, 240)}"`);
  lines.push(`Load test: ${d.load || 'not run'}`);
  return lines.join('\n');
}

function llmLab(d) {
  const lab = d.lab || {};
  const f = lab.feature || {};
  const cases = lab.cases || [];
  const techniques = [...new Set(cases.map((c) => c.technique).filter(Boolean))];
  const lines = [
    `LLM test lab. Feature: ${cut(f.name, 80)}. Purpose: ${cut(f.purpose, 200)}. Model: ${cut(f.model, 60)}. Inputs: ${cut(f.inputs, 120)}. Outputs: ${cut(f.outputs, 120)}. Guardrails: ${cut(f.guardrails, 200)}. Requirements: ${cut(f.requirements, 160)}. Risks: ${(f.risks || []).join(', ')}.`,
    `${cases.length} test cases, techniques: ${techniques.join(', ') || 'none'}.`,
    ...cases.map((c) => `- ${c.id} ${cut(c.title, 80)} [${c.technique}; linked to ${cut(c.link, 60)}] input "${cut(c.input, 140)}" expected "${cut(c.expected, 140)}" oracle ${c.oracle || '-'}; ${c.passed === '' || c.passed == null ? '?' : c.passed}/${c.runs} runs passed; verdict ${c.verdict || '-'}${c.output ? `; reply: "${cut(c.output, 160)}"` : ''}${c.notes ? `; notes: ${cut(c.notes, 160)}` : ''}`),
  ];
  return lines.join('\n');
}

function sustainability(d) {
  const lab = d.lab || {};
  const s = lab.setup || {};
  const m = (label, x) => {
    const runs = nums(x.runs);
    return `${label}: commit ${x.commit || '-'}, ${runs.length} runs, mean ${runs.length ? mean(runs).toFixed(4) : '-'} kWh, sd ${runs.length > 1 ? sd(runs).toFixed(4) : '-'}, LLM calls ${x.calls || '-'}, tokens ${x.tokensIn || '-'}/${x.tokensOut || '-'}, EcoLogits ${x.llmLow || '-'}–${x.llmHigh || '-'} kWh, latency ${x.latency || '-'}`;
  };
  const q = lab.quality || {};
  return [
    `Sustainability lab. NFR: ${cut(s.nfr, 160)} (limit ${s.limit || '-'} kWh per session). Session: ${cut(s.session, 160)}. Machine: ${cut(s.machine, 80)}. LLM: ${cut(s.model, 60)}. Grid: ${s.grid || '-'} ${cut(s.gridSource, 60)}.`,
    m('Baseline', lab.baseline || {}),
    m('After', lab.after || {}),
    `Changes (${(lab.changes || []).length}):`,
    ...(lab.changes || []).map((c) => `- [${c.kind}] ${cut(c.title, 80)} (${c.commit || '-'}): ${cut(c.what, 160)}. Why: ${cut(c.why, 160)}`),
    `Quality with the 3.2 cases: ${q.before || '-'} → ${q.after || '-'} of ${q.total || '-'}. ${cut(q.notes, 200)}`,
    `Uncertainty: ${cut(lab.uncertainty, 400)}`,
    `Reflection: ${cut(lab.reflection, 400)}`,
  ].join('\n');
}

const FORMATTERS = { 're-studio': reStudio, review, acceptance, 'llm-lab': llmLab, sustainability };

/** Returns { tool, text } for structured tool work, or null for an ordinary conversation log. */
function describeToolWork(raw) {
  if (!raw || typeof raw !== 'string' || raw.trim()[0] !== '{') return null;
  try {
    const data = JSON.parse(raw);
    const format = data && FORMATTERS[data.tool];
    return format ? { tool: data.tool, text: format(data) } : null;
  } catch {
    return null;
  }
}

/** The prompt block for a submission's conversationLog. Tool work gets more room than a chat log. */
function conversationBlock(raw, chatLimit = 2000, toolLimit = 9000) {
  if (!raw) return '';
  const work = describeToolWork(raw);
  if (work) {
    const text = work.text.length > toolLimit ? `${work.text.slice(0, toolLimit)}\n... [truncated]` : work.text;
    return `<tool_work tool="${work.tool}">\n${text}\n</tool_work>`;
  }
  const text = raw.length > chatLimit ? `${raw.substring(0, chatLimit)}\n... [log truncated]` : raw;
  return `<conversation_log>\n${text}\n</conversation_log>`;
}

module.exports = { describeToolWork, conversationBlock };
