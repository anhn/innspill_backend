/** Exercise 2 checkers: 2.1 pull requests, 2.2 labelled findings, 2.3 fixes and the latest run. */
const { partText, cut } = require('./text');
const { vagueWords, worst } = require('./rules');
const { byShare, criterion, suggestScore } = require('./rollup');
const { judge } = require('./judge');

const toolData = (log, tool) => {
  try {
    const d = JSON.parse(log || '');
    return d && d.tool === tool ? d : null;
  } catch {
    return null;
  }
};
const prNumber = (url) => (String(url).match(/\/pull\/(\d+)/) || [])[1];

/** One item per pull request, with the GitHub checks made at hand-in as issues. */
function prItems(part) {
  return (part?.links || []).map((l, k) => {
    const issues = [];
    if (l.error) issues.push({ rule: 'link', severity: 'error', message: l.error });
    for (const c of l.checks || []) if (!c.ok) issues.push({ rule: c.label.toLowerCase().split(' ')[0], severity: /CI/.test(c.label) ? 'warning' : 'error', message: `${c.label}: not found.` });
    return {
      // Links can point to several repositories, so the id is the position, not the PR number.
      id: `L${k + 1}`,
      label: prNumber(l.url) ? `${(l.url.match(/github\.com\/[^/]+\/([^/]+)/) || [])[1] || ''}#${prNumber(l.url)}` : `Link ${k + 1}`,
      text: l.title || l.url,
      quote: l.title || '',
      url: l.pinnedUrl || l.url,
      fields: { checks: (l.checks || []).map((c) => `${c.ok ? '✓' : '✗'} ${c.label}`).join(' · '), facts: (l.facts || []).join(' · ') },
      issues,
      evidence: [],
      status: worst(issues),
    };
  });
}
const passed = (items, label) => items.filter((i) => !i.issues.some((x) => x.message.startsWith(label))).length;

async function assess21(ctx) {
  const part = (ctx.parts || []).find((p) => /pull request/i.test(p.label));
  const items = prItems(part);
  const n = items.length;
  const merged = passed(items, 'Merged');
  const plans = passed(items, 'Approved plan');
  const notes = passed(items, 'Decision note');
  const ci = passed(items, 'CI green');
  const criteria = [
    criterion('merged', 'Every core feature is merged', merged >= 3 && n >= 4 ? 'met' : merged >= 2 ? 'partly' : 'not', `${merged} of ${n} pull requests are merged (three core features and your own expected).`, items.filter((i) => i.issues.some((x) => x.message.startsWith('Merged'))).map((i) => i.id)),
    criterion('plans', 'Every pull request has an approved plan', byShare(n ? plans / n : 0, 0.99, 0.5), `${plans} of ${n} link an issue with “Plan approved”.`, items.filter((i) => i.issues.some((x) => x.message.startsWith('Approved plan'))).map((i) => i.id), 1.5),
    criterion('notes', 'Every pull request has a decision note', byShare(n ? notes / n : 0, 0.99, 0.5), `${notes} of ${n} have a Decision note.`, items.filter((i) => i.issues.some((x) => x.message.startsWith('Decision note'))).map((i) => i.id), 1.5),
    criterion('ci', 'CI is green', byShare(n ? ci / n : 0, 0.99, 0.5), `${ci} of ${n} have green CI.`, items.filter((i) => i.issues.some((x) => x.message.startsWith('CI'))).map((i) => i.id)),
  ];
  return { sections: [{ id: 'prs', title: 'Pull requests', kind: 'links', columns: ['checks', 'facts'], items }], facts: { prs: n, merged, plans, notes, ci }, criteria, suggested: suggestScore(criteria), summary: '', usage: null };
}

const THIN = /^(ok|fine|yes|no|true|false|not a problem|false positive|correct|agree|n\/a|-)\.?$/i;

async function assess22(ctx) {
  const d = toolData(ctx.conversationLog, 'review');
  const findings = d?.findings || [];
  const labels = d?.labels || {};
  const items = findings.map((f) => {
    const l = labels[f.id] || {};
    const issues = [];
    if (!l.verdict) issues.push({ rule: 'label', severity: 'error', message: 'Not labelled.' });
    else if (!String(l.reason || '').trim()) issues.push({ rule: 'reason', severity: 'error', message: 'Labelled without a reason.' });
    else if (String(l.reason).trim().length < 25 || THIN.test(String(l.reason).trim())) issues.push({ rule: 'reason', severity: 'warning', message: `The reason “${cut(l.reason, 60)}” is too thin to check.` });
    return {
      id: f.id,
      label: f.id,
      text: `${f.title} (${f.file}:${f.line})`,
      quote: `${f.id} ${f.title}`,
      fields: { tools: (f.tools || []).join(', '), verdict: l.verdict === 'tp' ? 'True problem' : l.verdict === 'fp' ? 'False alarm' : '–', reason: l.reason || '' },
      issues,
      evidence: f.code ? [{ kind: 'code', label: `${f.file}:${f.line}`, text: f.code }] : [],
      status: 'ok',
    };
  });
  const labelled = items.filter((i) => !i.issues.some((x) => x.rule === 'label'));
  const ai = labelled.length ? await judge({
    off: ctx.noAi,
    system: 'You assess Task 2.2: a student group labelled automated code-review findings as true problems or false alarms, each with a reason.',
    input: {
      instructions: 'For each finding, decide whether the group\'s label is plausible given the finding and code, and whether the reason is specific (names the code, data flow or condition). Flag labels that look wrong. Then judge whether the comparison of the tools is backed by numbers that follow from these labels (findings and true problems per tool).',
      format: { labels: [{ id: 'f1', plausible: true, specific: true, note: '…' }], comparison: { backed: true, note: '…' }, summary: 'two sentences' },
      findings: findings.map((f) => ({ id: f.id, title: f.title, tools: f.tools, file: `${f.file}:${f.line}`, code: cut(f.code, 300), label: labels[f.id]?.verdict || null, reason: labels[f.id]?.reason || null })),
      comparison: cut(d?.comparison || '', 3000),
    },
  }) : { data: null, usage: null };
  for (const v of ai.data?.labels || []) {
    const it = items.find((i) => i.id === v.id);
    if (!it || !it.fields.reason) continue;
    if (v.plausible === false) it.issues.push({ rule: 'verdict', severity: 'error', message: `The label looks wrong: ${v.note}`, by: 'ai' });
    else if (v.specific === false) it.issues.push({ rule: 'reason', severity: 'warning', message: `The reason is not specific: ${v.note}`, by: 'ai' });
  }
  for (const i of items) i.status = worst(i.issues);
  const n = items.length;
  const sample = Math.min(20, n);
  const withReason = items.filter((i) => !i.issues.some((x) => ['label', 'reason'].includes(x.rule) && x.severity === 'error')).length;
  const goodReasons = items.filter((i) => !i.issues.some((x) => ['reason', 'verdict'].includes(x.rule))).length;
  const comparison = String(d?.comparison || '');
  const criteria = [
    criterion('labelled', 'Every sampled finding is labelled with a reason', withReason >= sample ? 'met' : withReason >= sample * 0.6 ? 'partly' : 'not', `${withReason} of ${n} findings have a label and a reason (sample of ${sample} expected).`, items.filter((i) => i.issues.some((x) => ['label', 'reason'].includes(x.rule) && x.severity === 'error')).map((i) => i.id), 1.5),
    criterion('reasons', 'Labels are plausible and reasons specific', byShare(n ? goodReasons / n : 0, 0.85, 0.6), `${goodReasons} of ${n} labels hold up.`, items.filter((i) => i.issues.some((x) => ['reason', 'verdict'].includes(x.rule))).map((i) => i.id), 1.5),
    criterion('comparison', 'The tool comparison is backed by the labelled results', comparison.length > 200 && ai.data?.comparison?.backed !== false ? 'met' : comparison.length > 50 ? 'partly' : 'not', `${comparison ? `${comparison.split(/\s+/).length} words` : 'No comparison'}.${ai.data?.comparison?.note ? ` ${ai.data.comparison.note}` : ''}`),
  ];
  return { sections: [{ id: 'findings', title: 'Findings and labels', kind: 'findings', columns: ['tools', 'verdict', 'reason'], items }], facts: { findings: n, labelled: withReason }, criteria, suggested: suggestScore(criteria), summary: ai.data?.summary || '', usage: ai };
}

async function assess23(ctx) {
  const run = toolData(ctx.conversationLog, 'bug-fixing');
  const prior = toolData(ctx.related?.['2.2']?.conversationLog, 'review');
  const truth = prior ? prior.findings.filter((f) => prior.labels?.[f.id]?.verdict === 'tp') : [];
  const fixed = new Set(run?.fixed || []);
  const text = String(ctx.text || '');
  const problems = (truth.length ? truth.map((f) => ({ id: f.id, title: f.title })) : [...(run?.fixed || []), ...(run?.present || [])].map((id) => ({ id, title: '' }))).map((p) => {
    const issues = [];
    const explained = new RegExp(`\\b${p.id}\\b[^\\n]{0,200}(not fixed|won't fix|reason|because|ikke fikset)`, 'i').test(text);
    if (!fixed.has(p.id) && !explained) issues.push({ rule: 'unfixed', severity: 'error', message: 'Still present in the latest run, with no reason given.' });
    else if (!fixed.has(p.id)) issues.push({ rule: 'unfixed', severity: 'info', message: 'Not fixed; a reason is given.' });
    return { id: p.id, label: p.id, text: p.title || p.id, quote: '', fields: { status: fixed.has(p.id) ? 'Fixed' : 'Still present' }, issues, evidence: [], status: worst(issues) };
  });
  const added = (run?.added || []).map((id) => ({ id, label: id, text: 'New finding in the latest run', quote: '', fields: { status: 'New' }, issues: [{ rule: 'new', severity: 'error', message: 'Introduced by a fix.' }], evidence: [], status: 'fail' }));
  const prs = prItems((ctx.parts || []).find((p) => /pull request/i.test(p.label)));
  const testFirst = passed(prs, 'Test changed');
  const roots = passed(prs, 'Root cause');
  const n = problems.length;
  const done = problems.filter((p) => p.status !== 'fail').length;
  const criteria = [
    criterion('tests', 'Each fix has a test that failed first', prs.length ? byShare(testFirst / prs.length, 0.99, 0.5) : 'not', `${testFirst} of ${prs.length} pull requests change a test; ${roots} state the root cause.`, prs.filter((i) => i.status !== 'ok').map((i) => i.id), 1.5),
    criterion('fixed', 'Every true problem is fixed or explained', n ? byShare(done / n, 0.99, 0.6) : 'not', `${problems.filter((p) => p.fields.status === 'Fixed').length} of ${n} true problems from 2.2 are fixed; ${done - problems.filter((p) => p.fields.status === 'Fixed').length} explained.`, problems.filter((p) => p.status === 'fail').map((p) => p.id), 1.5),
    criterion('newfindings', 'The latest run has no new findings', added.length ? 'not' : run ? 'met' : 'not', run ? `Run ${run.run} at ${run.commit}: ${added.length} new findings.` : 'No run handed in.', added.map((a) => a.id)),
  ];
  return {
    sections: [
      { id: 'problems', title: 'True problems from 2.2', kind: 'list', columns: ['status'], items: [...problems, ...added] },
      { id: 'prs', title: 'Fix pull requests', kind: 'links', columns: ['checks', 'facts'], items: prs },
    ],
    facts: { problems: n, fixed: fixed.size, added: added.length, simulatedRun: true },
    criteria,
    suggested: suggestScore(criteria),
    summary: '',
    usage: null,
  };
}

module.exports = { assess21, assess22, assess23, prItems, toolData };
