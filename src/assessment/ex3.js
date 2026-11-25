/** Exercise 3 checkers: 3.1 acceptance testing, 3.2 LLM test lab, 3.3 energy, 3.4 reflection. */
const { partText, cut } = require('./text');
const { worst } = require('./rules');
const { byShare, criterion, suggestScore } = require('./rollup');
const { judge } = require('./judge');
const { prItems, toolData } = require('./ex2');

async function assess31(ctx) {
  const d = toolData(ctx.conversationLog, 'acceptance');
  const results = d?.results || {};
  const criteriaItems = (d?.criteria || []).map((c) => {
    const r = results[c.id] || {};
    const issues = [];
    if (!r.result) issues.push({ rule: 'untested', severity: 'error', message: 'Not tested.' });
    else if (/fail/i.test(r.result) && !(d.issues || []).some((i) => String(i.criterion || i.title || '').includes(c.id) || String(i.steps || '').includes(c.id))) issues.push({ rule: 'nobug', severity: 'warning', message: 'Failed, but no bug report refers to it.' });
    if (r.result && !String(r.evidence || '').trim()) issues.push({ rule: 'evidence', severity: 'info', message: 'No evidence noted.' });
    return { id: c.id, label: c.id, text: c.text, quote: `${c.id}: ${String(c.text).slice(0, 60)}`, fields: { result: r.result || '–', evidence: r.evidence || '' }, issues, evidence: [], status: worst(issues) };
  });
  const bugs = (d?.issues || []).map((b) => {
    const issues = [];
    for (const [k, name] of [['steps', 'steps to reproduce'], ['expected', 'expected result'], ['actual', 'actual result']]) if (!String(b[k] || '').trim()) issues.push({ rule: 'bug', severity: 'error', message: `No ${name}.` });
    return { id: `B${b.id}`, label: `#${b.id}`, text: b.title, quote: `#${b.id} ${b.title}`, fields: { steps: b.steps || '', expected: b.expected || '', actual: b.actual || '' }, issues, evidence: [], status: 'ok' };
  });
  const ai = bugs.length ? await judge({
    off: ctx.noAi,
    system: 'You assess Task 3.1: bug reports a student group filed for a partner group after acceptance testing.',
    input: { instructions: 'For each bug report decide whether another developer could reproduce it from the steps alone, and say what is missing.', format: { bugs: [{ id: 'B1', reproducible: true, missing: '…' }], summary: 'two sentences' }, bugs: bugs.map((b) => ({ id: b.id, title: b.text, ...b.fields })) },
  }) : { data: null, usage: null };
  for (const v of ai.data?.bugs || []) {
    const b = bugs.find((x) => x.id === v.id);
    if (b && v.reproducible === false) b.issues.push({ rule: 'reproducible', severity: 'error', message: `Not reproducible: ${v.missing}`, by: 'ai' });
  }
  for (const b of bugs) b.status = worst(b.issues);
  const n = criteriaItems.length;
  const tested = criteriaItems.filter((c) => !c.issues.some((i) => i.rule === 'untested')).length;
  const repro = bugs.filter((b) => b.status !== 'fail').length;
  const criteria = [
    criterion('tested', 'Every acceptance criterion was tested', n ? byShare(tested / n, 0.99, 0.7) : 'not', `${tested} of ${n} criteria tested.`, criteriaItems.filter((c) => c.status === 'fail').map((c) => c.id), 1.5),
    criterion('bugs', 'Each bug report can be reproduced', bugs.length ? byShare(repro / bugs.length, 0.99, 0.6) : 'met', bugs.length ? `${repro} of ${bugs.length} bug reports are reproducible.` : 'No bugs reported.', bugs.filter((b) => b.status === 'fail').map((b) => b.id), 1.5),
    { ...criterion('rating', 'The partner group rates the reports', 'na', 'The partner\'s rating is not collected in InnSpill yet.'), weight: 0 },
  ];
  return { sections: [{ id: 'criteria', title: 'Partner criteria tested', kind: 'list', columns: ['result', 'evidence'], items: criteriaItems }, { id: 'bugs', title: 'Bug reports', kind: 'list', columns: ['steps', 'expected', 'actual'], items: bugs }], facts: { criteria: n, tested, bugs: bugs.length }, criteria, suggested: suggestScore(criteria), summary: ai.data?.summary || '', usage: ai };
}

async function assess32(ctx) {
  const d = toolData(ctx.conversationLog, 'llm-lab');
  const lab = d?.lab || {};
  const f = lab.feature || {};
  const featureMissing = ['name', 'purpose', 'model', 'inputs', 'outputs', 'guardrails', 'requirements'].filter((k) => !String(f[k] || '').trim());
  const cases = (lab.cases || []).map((c) => {
    const issues = [];
    if (!c.technique) issues.push({ rule: 'technique', severity: 'warning', message: 'No technique named.' });
    if (!c.oracle) issues.push({ rule: 'oracle', severity: 'warning', message: 'No oracle: how is a pass decided?' });
    const runs = Number(c.runs) || 0;
    const ok = c.passed === '' || c.passed == null ? null : Number(c.passed);
    if (!runs || ok === null) issues.push({ rule: 'runs', severity: 'error', message: 'Not run, or the result is missing.' });
    const failed = /fail/i.test(c.verdict || '') || (ok !== null && ok < runs);
    if (failed && String(c.notes || '').trim().length < 20) issues.push({ rule: 'explained', severity: 'error', message: 'A failure without an explanation.' });
    return { id: c.id, label: c.id, text: c.title, quote: `${c.id} ${c.title}`, fields: { technique: c.technique || '', result: ok === null ? '–' : `${ok}/${runs}`, verdict: c.verdict || '', notes: c.notes || '' }, issues, evidence: [], status: 'ok' };
  });
  const injection = cases.some((c) => /inject/i.test(c.fields.technique));
  const ai = cases.length ? await judge({
    off: ctx.noAi,
    system: 'You assess Task 3.2: tests of the LLM feature in a student tutor app.',
    input: { instructions: 'Do the techniques fit the risks of this feature? Name risks with no test. For each failed or injection case, is the explanation adequate?', format: { fit: true, untestedRisks: ['…'], cases: [{ id: 'C1', explained: true, note: '…' }], summary: 'two sentences' }, feature: f, cases: (lab.cases || []).map((c) => ({ id: c.id, title: c.title, technique: c.technique, expected: cut(c.expected, 200), result: `${c.passed}/${c.runs}`, verdict: c.verdict, notes: cut(c.notes, 300) })) },
  }) : { data: null, usage: null };
  for (const v of ai.data?.cases || []) {
    const c = cases.find((x) => x.id === v.id);
    if (c && v.explained === false) c.issues.push({ rule: 'explained', severity: 'warning', message: `Explanation not adequate: ${v.note}`, by: 'ai' });
  }
  for (const c of cases) c.status = worst(c.issues);
  // The link to the test code comes from the lab; older hand-ins had it as a portal part.
  const codePart = (ctx.parts || []).find((p) => /test code/i.test(p.label));
  const codeLink = String(lab.codeLink || codePart?.links?.[0]?.url || '').trim();
  const codeOk = /github\.com\/[^/]+\/[^/]+\/(blob|commit|tree|pull)\//.test(codeLink) && (!codePart || codePart.status === 'ready');
  const n = cases.length;
  const criteria = [
    criterion('checklist', 'The lab checklist is complete', !featureMissing.length && n >= 5 && cases.every((c) => !c.issues.some((i) => i.rule === 'runs')) ? 'met' : featureMissing.length <= 2 && n ? 'partly' : 'not', `${featureMissing.length ? `Feature missing: ${featureMissing.join(', ')}. ` : ''}${n} test cases; ${cases.filter((c) => c.issues.some((i) => i.rule === 'runs')).length} not run.`),
    criterion('fit', 'Techniques fit the risks', ai.data ? (ai.data.fit && !(ai.data.untestedRisks || []).length ? 'met' : ai.data.fit ? 'partly' : 'not') : 'partly', ai.data ? (ai.data.untestedRisks?.length ? `Risks without a test: ${ai.data.untestedRisks.join('; ')}.` : 'The techniques cover the stated risks.') : 'Not judged.', [], 1.5),
    criterion('explained', 'Every failure and injection result is explained', !injection ? 'partly' : byShare(n ? cases.filter((c) => !c.issues.some((i) => i.rule === 'explained')).length / n : 0, 0.99, 0.6), `${injection ? 'Injection is tested.' : 'No injection test.'} ${cases.filter((c) => c.issues.some((i) => i.rule === 'explained')).length} results lack an explanation.`, cases.filter((c) => c.issues.some((i) => i.rule === 'explained')).map((c) => c.id), 1.5),
    criterion('code', 'Test code is linked and runs in CI', codeOk ? 'met' : codeLink ? 'partly' : 'not', codeLink ? `Test code: ${codeLink}${codeOk ? '' : ' (not a link to a file or commit on GitHub)'}.` : 'No link to the test code in the lab.', [], 0.5),
  ];
  return { sections: [{ id: 'cases', title: 'Test cases', kind: 'list', columns: ['technique', 'result', 'verdict'], items: cases }], facts: { cases: n, injection }, criteria, suggested: suggestScore(criteria), summary: ai.data?.summary || '', usage: ai };
}

const nums = (raw) => String(raw || '').split(/[\s,;]+/).map(Number).filter((x) => Number.isFinite(x) && x > 0);
const mean = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
const sd = (v) => (v.length < 2 ? 0 : Math.sqrt(v.reduce((a, b) => a + (b - mean(v)) ** 2, 0) / (v.length - 1)));

async function assess33(ctx) {
  const d = toolData(ctx.conversationLog, 'sustainability');
  const lab = d?.lab || {};
  const s = lab.setup || {};
  const base = nums(lab.baseline?.runs);
  const after = nums(lab.after?.runs);
  const changes = lab.changes || [];
  const q = lab.quality || {};
  const items = [
    { id: 'baseline', label: 'Baseline', text: `${base.length} runs, mean ${base.length ? mean(base).toFixed(4) : '–'} kWh, sd ${base.length > 1 ? sd(base).toFixed(4) : '–'}`, fields: { runs: String(base.length) }, issues: base.length >= 5 ? [] : [{ rule: 'runs', severity: 'error', message: `${base.length} runs; at least five needed.` }] },
    { id: 'after', label: 'After', text: `${after.length} runs, mean ${after.length ? mean(after).toFixed(4) : '–'} kWh, sd ${after.length > 1 ? sd(after).toFixed(4) : '–'}`, fields: { runs: String(after.length) }, issues: after.length >= 5 ? [] : [{ rule: 'runs', severity: 'error', message: `${after.length} runs; at least five needed.` }] },
    { id: 'setup', label: 'Same session and machine', text: `${cut(s.session, 80) || 'No session script'} · ${cut(s.machine, 60) || 'No machine'}`, fields: {}, issues: [...(!s.session ? [{ rule: 'setup', severity: 'error', message: 'The scripted session is not described.' }] : []), ...(!s.machine ? [{ rule: 'setup', severity: 'error', message: 'The machine is not named.' }] : [])] },
    { id: 'uncertainty', label: 'Uncertainty', text: cut(lab.uncertainty, 160) || 'Not stated', fields: {}, issues: /\d/.test(lab.uncertainty || '') && /sd|±|standard|uncertain|interval|variance|usikker/i.test(lab.uncertainty || '') ? [] : [{ rule: 'uncertainty', severity: 'error', message: 'The uncertainty is not stated with numbers.' }] },
    { id: 'quality', label: 'Quality held', text: `${q.before || '–'} → ${q.after || '–'} of ${q.total || '–'}`, fields: {}, issues: !q.after ? [{ rule: 'quality', severity: 'error', message: 'Quality after the change is not reported.' }] : Number(q.after) < Number(q.before) && String(q.notes || '').trim().length < 20 ? [{ rule: 'quality', severity: 'error', message: 'Quality dropped and the drop is not explained.' }] : [] },
  ].map((i) => ({ ...i, quote: '', evidence: [], status: worst(i.issues) }));
  const kinds = new Set(changes.map((c) => String(c.kind || '').toLowerCase()));
  const changeItems = changes.map((c, k) => {
    const issues = [];
    if (!/^[0-9a-f]{7,40}$/i.test(String(c.commit || '').trim())) issues.push({ rule: 'commit', severity: 'error', message: 'No commit for this change.' });
    if (String(c.what || '').trim().length < 15) issues.push({ rule: 'what', severity: 'warning', message: 'What changed is not described.' });
    if (String(c.why || '').trim().length < 15) issues.push({ rule: 'why', severity: 'warning', message: 'Why it should save energy is not said.' });
    return { id: `C${c.id ?? k + 1}`, label: `${c.kind || 'change'} ${k + 1}`, text: c.title || '(untitled)', quote: '', fields: { kind: c.kind || '', commit: c.commit || '' }, issues, evidence: [], status: 'ok' };
  });
  // The AI reads the measurements as handed in; it does not measure again.
  const ai = base.length || after.length ? await judge({
    off: ctx.noAi,
    system: 'You assess Task 3.3: a student group measured the energy of one scripted study session in their tutor app before and after a code change and an LLM change.',
    input: {
      instructions: 'Use only the numbers given. Is the difference between before and after larger than the spread of the runs? Does each change plausibly explain a saving, given the LLM calls and tokens? Is the reflection consistent with the numbers? Flag claims the data does not support.',
      format: { significant: true, note: '…', changes: [{ id: 'C1', plausible: true, note: '…' }], reflectionSupported: true, reflectionNote: '…', summary: 'two sentences' },
      setup: s,
      baseline: { ...lab.baseline, mean: base.length ? mean(base) : null, sd: base.length > 1 ? sd(base) : null },
      after: { ...lab.after, mean: after.length ? mean(after) : null, sd: after.length > 1 ? sd(after) : null },
      changes: changes.map((c, k) => ({ id: changeItems[k].id, kind: c.kind, title: c.title, what: cut(c.what, 300), why: cut(c.why, 300) })),
      quality: q,
      uncertainty: cut(lab.uncertainty, 600),
      reflection: cut(lab.reflection, 1200),
    },
  }) : { data: null, usage: null };
  for (const v of ai.data?.changes || []) {
    const it = changeItems.find((i) => i.id === v.id);
    if (it && v.plausible === false) it.issues.push({ rule: 'plausible', severity: 'warning', message: `The saving is not plausible from the data: ${v.note}`, by: 'ai' });
  }
  for (const it of changeItems) it.status = worst(it.issues);
  if (ai.data && ai.data.significant === false) items[3].issues.push({ rule: 'significant', severity: 'warning', message: `The difference may be within the spread of the runs: ${ai.data.note}`, by: 'ai' });
  items[3].status = worst(items[3].issues);
  const criteria = [
    criterion('comparable', 'Before and after are comparable', items.slice(0, 3).every((i) => i.status === 'ok') ? 'met' : items.slice(0, 3).some((i) => i.status === 'ok') ? 'partly' : 'not', items.slice(0, 3).flatMap((i) => i.issues.map((x) => x.message)).join(' ') || 'At least five runs each, same session and machine.', ['baseline', 'after', 'setup'], 1.5),
    criterion('changes', 'At least one code change and one LLM change, each with a commit', kinds.has('code') && [...kinds].some((k) => k.includes('llm')) && changeItems.every((i) => !i.issues.some((x) => x.rule === 'commit')) ? 'met' : changes.length ? 'partly' : 'not', `${changes.length} changes (${[...kinds].join(', ') || 'none'}); ${changeItems.filter((i) => !i.issues.some((x) => x.rule === 'commit')).length} with a commit.`, changeItems.filter((i) => i.status !== 'ok').map((i) => i.id)),
    criterion('quality', 'Quality held, or the drop is explained', items[4].status === 'ok' ? 'met' : 'not', items[4].issues.map((i) => i.message).join(' ') || 'Quality held.', ['quality']),
    criterion('uncertainty', 'The uncertainty is stated', items[3].status === 'ok' ? 'met' : 'not', items[3].issues.map((i) => i.message).join(' ') || 'Stated with numbers.', ['uncertainty']),
  ];
  if (ai.data && ai.data.reflectionSupported === false) criteria.push(criterion('reflection', 'The reflection matches the numbers', 'partly', ai.data.reflectionNote || 'The reflection claims more than the data shows.', [], 0.5));
  return { sections: [{ id: 'method', title: 'Measurement method', kind: 'list', items }, { id: 'changes', title: 'Changes', kind: 'list', columns: ['kind', 'commit'], items: changeItems }], facts: { baseline: base.length, after: after.length }, criteria, suggested: suggestScore(criteria), summary: ai.data?.summary || '', usage: ai };
}

async function assess34(ctx) {
  const labels = (ctx.parts || []).map((p) => p.label);
  const report = partText(ctx.text, labels.find((l) => /reflection/i.test(l)) || '', labels) || ctx.text;
  const individual = partText(ctx.text, labels.find((l) => /individual/i.test(l)) || '', labels);
  const words = (report.match(/\S+/g) || []).length;
  const pages = (individual.match(/^#{1,3}\s+\S/gm) || []).length;
  const ai = await judge({
    off: ctx.noAi,
    system: 'You assess Task 3.4: a group reflection on working with a coding agent. Claims must be backed by links to pull requests or results.',
    input: { instructions: 'List the factual claims in the report (about time saved or lost, quality, numbers, what worked). For each, say whether it is backed by a link or a reference to a pull request, issue or result in the same or next sentence.', format: { claims: [{ quote: 'exact sentence from the report', backed: true, note: '…' }], honest: { comparesFeltAndReal: true, note: '…' }, summary: 'two sentences' }, report: cut(report, 9000) },
  });
  const claims = (ai.data?.claims || []).map((c, k) => ({ id: `C${k + 1}`, label: `Claim ${k + 1}`, text: c.quote, quote: cut(c.quote, 90).replace(/…$/, ''), fields: {}, issues: c.backed ? [] : [{ rule: 'backed', severity: 'error', message: `Not backed by a link or result.${c.note ? ` ${c.note}` : ''}`, by: 'ai' }], evidence: [], status: c.backed ? 'ok' : 'fail' }));
  const backed = claims.filter((c) => c.status === 'ok').length;
  const criteria = [
    criterion('backed', 'Claims are backed by links to pull requests or results', claims.length ? byShare(backed / claims.length, 0.85, 0.5) : 'partly', `${backed} of ${claims.length} claims are backed.`, claims.filter((c) => c.status === 'fail').map((c) => c.id), 2),
    criterion('compare', 'Compares how fast it felt with how fast it was', ai.data?.honest?.comparesFeltAndReal ? 'met' : 'partly', ai.data?.honest?.note || ''),
    criterion('length', 'About three pages, plus one page each', words >= 900 && pages >= 2 ? 'met' : words >= 400 || pages >= 1 ? 'partly' : 'not', `${words} words in the group report; ${pages} individual pages.`, [], 0.5),
  ];
  return { sections: [{ id: 'claims', title: 'Claims', kind: 'list', items: claims }], facts: { words, pages, claims: claims.length, backed }, criteria, suggested: suggestScore(criteria), summary: ai.data?.summary || '', usage: ai };
}

module.exports = { assess31, assess32, assess33, assess34 };
