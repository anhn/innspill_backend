/** Exercise 1 checkers: 1.1 stories and interviews, 1.2 NFRs, 1.3 acceptance criteria, 1.4 AGENTS.md. */
const { partText, sectionUnder, listItems, tables, col, jaccard, cut } = require('./text');
const { GENERIC_ROLES, VERIFY, vagueIssues, hasNumber, referenceIssues, identityIssues, worst } = require('./rules');
const { byShare, criterion, suggestScore } = require('./rollup');
const { judge } = require('./judge');

const HIDDEN = {
  kari: [/wifi|campus|past paper|tidligere eksamen|eksamensoppgave/i, /laptop|gruppe|group|share|three|tre/i, /solution|løsning|paste|lim|example|eksempel/i],
  jonas: [/late|sent|23|midnight|midnatt/i, /last year|fjor|reuse|gjenbruk/i, /silent|stille|lecture|foreles/i],
  ingrid: [/email|e-post|log/i, /train|trening|opt/i, /export|eksport|server/i],
};
const STORY = /^As (?:an? |one of |the )?(.+?),\s*I (?:want|need|would like)(?: to)? (.+?)(?:,?\s*so that (.+?))?\.?$/i;
const SOURCE = /\((?:Source|Kilde)\s*:\s*([^)]+)\)/i;
const labelsOf = (parts) => (parts || []).map((p) => p.label);
const fileText = (ctx, labelRe) => {
  const part = (ctx.parts || []).find((p) => labelRe.test(p.label));
  return part ? partText(ctx.text, part.label, labelsOf(ctx.parts)) : '';
};

function interviewsOf(log) {
  try {
    const data = JSON.parse(log || '');
    return Array.isArray(data?.interviews) ? data.interviews : [];
  } catch {
    return [];
  }
}

/** The interview line a source points to: "Kari S. 09:45", "Jonas 15:25, follow-up", "real-student interview, line 4". */
function findSource(source, interviews, transcript) {
  const real = source.match(/real[- ]student[^,]*,\s*line\s*(\d+)/i);
  if (real) {
    const n = real[1];
    const line = String(transcript || '').split('\n').find((l) => new RegExp(`^\\s*${n}\\s+\\S`).test(l));
    return line ? { kind: 'transcript', label: `Real student, line ${n}`, text: line.replace(/^\s*\d+\s+/, ''), at: `line ${n}` } : { missing: `There is no line ${n} in the real-student transcript.` };
  }
  const m = source.match(/^\s*([A-ZÆØÅa-zæøå][\w .æøå-]*?)\s+(\d{1,2}[:.]\d{2})/);
  if (!m) return { missing: `The source “${source}” is not in the form “Name hh:mm”.` };
  const who = m[1].trim().toLowerCase();
  const at = m[2].replace('.', ':').padStart(5, '0');
  const interview = interviews.find((i) => i.name.toLowerCase().startsWith(who.split(' ')[0]) || i.persona === who.split(' ')[0]);
  if (!interview) return { missing: `No interview with ${m[1]} in the RE Studio logs.` };
  const messages = interview.messages || [];
  let k = messages.findIndex((x) => x.who === 'persona' && x.at === at);
  if (k < 0) {
    const q = messages.findIndex((x) => x.at === at);
    if (q >= 0) k = messages.findIndex((x, j) => j > q && x.who === 'persona');
  }
  if (k < 0) return { missing: `${interview.name} has no answer at ${at} in the logs.` };
  const question = [...messages.slice(0, k)].reverse().find((x) => x.who === 'you');
  return { kind: 'interview', label: `${interview.name} ${messages[k].at}`, text: messages[k].text, at: messages[k].at, question: question?.text };
}

async function assess11(ctx) {
  const spec = fileText(ctx, /spec/i);
  const transcript = fileText(ctx, /transcript/i);
  const interviews = interviewsOf(ctx.conversationLog);
  const storyBlock = sectionUnder(spec, /user stor/i) || spec;
  const raw = listItems(storyBlock).filter((i) => i.text.length > 12 && !/^(primary actor|preconditions|postconditions|stakeholders)/i.test(i.text));
  const known = new Set(raw.map((_, k) => `US${raw[k].n ?? k + 1}`));
  for (const m of spec.matchAll(/\b(UC)[-\s]?(\d+)\b/gi)) known.add(`UC${m[2]}`);

  const stories = raw.map((item, k) => {
    const n = item.n ?? k + 1;
    const sourceMatch = item.text.match(SOURCE);
    const body = item.text.replace(SOURCE, '').trim();
    const m = body.match(STORY);
    const issues = [];
    const fields = m ? { role: m[1], want: m[2], soThat: m[3] || '' } : {};
    if (!m) issues.push({ rule: 'template', severity: 'error', message: 'Not in the template “As a <role>, I want <goal>, so that <reason>.”' });
    else {
      if (!m[3]) issues.push({ rule: 'template', severity: 'warning', message: 'No “so that” part: the reason is missing.' });
      if (GENERIC_ROLES.test(m[1].trim())) issues.push({ rule: 'role', severity: 'warning', message: `The role “${m[1]}” is generic; say which student or stakeholder.` });
      if (/\band\b/i.test(m[2]) && /\b(?:and)\s+(?:to\s+)?[a-z]+(?:e|s)?\b/i.test(m[2]) && m[2].split(/\band\b/i).length > 2) issues.push({ rule: 'compound', severity: 'info', message: 'May hold two needs; consider splitting.' });
    }
    issues.push(...vagueIssues(m ? `${m[2]} ${m[3] || ''}` : body, 'story'));
    issues.push(...referenceIssues(body, n, known));
    const evidence = [];
    if (!sourceMatch) issues.push({ rule: 'source', severity: 'error', message: 'No source: cite the interview line, e.g. (Source: Kari S. 09:45).' });
    else {
      const found = findSource(sourceMatch[1], interviews, transcript);
      if (found.missing) issues.push({ rule: 'source', severity: 'error', message: found.missing });
      else evidence.push({ ...found, supports: null });
    }
    return { id: `US${n}`, label: `US${n}`, text: body, quote: cut(body, 90).replace(/…$/, ''), source: sourceMatch?.[1] || '', fields, issues, evidence, status: 'ok' };
  });

  // Near-duplicates.
  for (let a = 0; a < stories.length; a++) for (let b = a + 1; b < stories.length; b++) {
    if (jaccard(stories[a].fields.want || stories[a].text, stories[b].fields.want || stories[b].text) > 0.7) stories[b].issues.push({ rule: 'duplicate', severity: 'warning', message: `Nearly the same as ${stories[a].id}.` });
  }

  // Use case template.
  const uc = sectionUnder(spec, /use case/i);
  const ucParts = [
    ['Primary actor', /primary actor|^actor|aktør/im],
    ['Preconditions', /precondition|forutsetning/i],
    ['Main success scenario', /main (?:success )?(?:scenario|flow)|basic flow|hovedflyt/i],
    ['Extensions (alternative flows)', /extension|alternative|alternativ/i],
    ['Postconditions', /postcondition|ettertilstand/i],
  ];
  const ucMissing = uc ? ucParts.filter(([, re]) => !re.test(uc)).map(([name]) => name) : ucParts.map(([name]) => name);
  const ucSteps = (uc.match(/^\s*\d+\.\s+/gm) || []).length;
  const ucItem = {
    id: 'UC1',
    label: 'Use case',
    text: uc ? cut(uc.split('\n')[0].replace(/^#+\s*/, ''), 120) : 'No use case found',
    quote: uc ? uc.split('\n')[0].replace(/^#+\s*/, '').trim() : '',
    issues: [
      ...ucMissing.map((name) => ({ rule: 'use-case', severity: 'error', message: `Missing: ${name}.` })),
      ...(uc && ucSteps < 3 ? [{ rule: 'use-case', severity: 'warning', message: 'The main scenario has fewer than three numbered steps.' }] : []),
    ],
    evidence: [],
    status: 'ok',
  };
  if (!uc) ucItem.issues = [{ rule: 'use-case', severity: 'error', message: 'No use case section (a heading with “Use case”).' }];

  // Interviews and hidden needs.
  const personas = ['kari', 'jonas', 'ingrid'];
  const hidden = personas.map((p) => {
    const i = interviews.find((x) => x.persona === p);
    const asked = (i?.messages || []).filter((m) => m.who === 'you').map((m) => m.text).join(' ');
    return { persona: p, name: i?.name || p, interviewed: Boolean(i), messages: i?.messages?.length || 0, found: HIDDEN[p].filter((re) => re.test(asked)).length };
  });
  const transcriptIssues = transcript ? identityIssues(transcript) : [{ rule: 'missing', severity: 'error', message: 'No real-student transcript.' }];

  // One AI call: does each cited line support its story, and what is vague or imprecise.
  const ai = await judge({
    off: ctx.noAi,
    system: 'You assess Task 1.1 in a requirements engineering course. Students interviewed AI stakeholders and wrote user stories that cite the interview line each story came from.',
    input: {
      instructions: 'For every story: decide whether the cited line supports it (yes, partly, no; "no-source" if there is none), and name what the story claims that the line does not say. List only quality problems a teacher would ask the group to fix (vague, ambiguous, not testable, compound, solution instead of need, imprecise, inconsistent with another story); skip small wording issues. Then judge the use case against the template (actor, preconditions, main scenario, extensions, postconditions). For the transcript, report only details that could identify the real student (name, contact details, place plus personal facts); anything else is not a problem.',
      format: { stories: [{ id: 'US1', supported: 'yes|partly|no|no-source', unsupported: 'what the line does not say, or empty', quality: [{ kind: 'vague|ambiguous|not-testable|compound|solution|imprecise|inconsistent', text: 'short reason quoting the story' }] }], useCase: { followsTemplate: true, problems: ['…'] }, transcript: { anonymised: true, problems: ['…'] }, summary: 'two sentences' },
      stories: stories.map((s) => ({ id: s.id, story: s.text, source: s.source || null, citedLine: s.evidence[0]?.text || null, questionAsked: s.evidence[0]?.question || null })),
      useCase: cut(uc, 2500),
      transcript: cut(transcript, 2500),
    },
  });
  const verdicts = new Map((ai.data?.stories || []).map((v) => [v.id, v]));
  for (const s of stories) {
    const v = verdicts.get(s.id);
    if (!v) continue;
    if (s.evidence[0]) s.evidence[0].supports = v.supported;
    if (v.supported === 'no' && s.evidence[0]) s.issues.push({ rule: 'trace', severity: 'error', message: `The cited line does not support this story.${v.unsupported ? ` ${v.unsupported}` : ''}` });
    if (v.supported === 'partly') s.issues.push({ rule: 'trace', severity: 'warning', message: `Only partly supported by the cited line.${v.unsupported ? ` ${v.unsupported}` : ''}` });
    for (const q of v.quality || []) if (!s.issues.some((i) => i.rule === 'vague' && q.kind === 'vague')) s.issues.push({ rule: q.kind, severity: q.kind === 'solution' ? 'info' : 'warning', message: q.text, by: 'ai' });
  }
  for (const p of ai.data?.useCase?.problems || []) if (!ucItem.issues.some((i) => p.toLowerCase().includes(i.message.toLowerCase().slice(9, 20)))) ucItem.issues.push({ rule: 'use-case', severity: 'warning', message: p, by: 'ai' });
  for (const p of ai.data?.transcript?.problems || []) transcriptIssues.push({ rule: 'identity', severity: ai.data.transcript.anonymised === false ? 'error' : 'info', message: p, by: 'ai' });
  for (const s of [...stories, ucItem]) s.status = worst(s.issues);

  const n = stories.length;
  const templ = stories.filter((s) => !s.issues.some((i) => i.rule === 'template' && i.severity === 'error')).length;
  const precise = stories.filter((s) => !s.issues.some((i) => i.severity !== 'info' && ['vague', 'ambiguous', 'not-testable', 'compound', 'imprecise', 'inconsistent', 'solution', 'role', 'duplicate', 'reference'].includes(i.rule))).length;
  // A partly supported source counts half.
  const traced = stories.reduce((a, s) => a + (!s.evidence[0] || s.issues.some((i) => i.rule === 'source') ? 0 : s.evidence[0].supports === 'partly' ? 0.5 : s.evidence[0].supports === 'no' ? 0 : 1), 0);
  const interviewed = hidden.filter((h) => h.interviewed).length;
  const found = hidden.reduce((a, h) => a + h.found, 0);
  const transcriptStatus = worst(transcriptIssues);

  const criteria = [
    criterion('count', '12–20 stories in the template', n >= 12 && n <= 20 && templ === n ? 'met' : n >= 10 && templ >= n - 2 ? 'partly' : 'not', `${n} stories; ${n - templ} not in the template.`, stories.filter((s) => s.issues.some((i) => i.rule === 'template')).map((s) => s.id)),
    criterion('quality', 'Stories are precise and testable', byShare(n ? precise / n : 0, 0.75, 0.45), `${precise} of ${n} stories have no quality problem.`, stories.filter((s) => s.status !== 'ok' && s.issues.some((i) => i.rule !== 'source' && i.rule !== 'trace')).map((s) => s.id), 1.5),
    criterion('trace', 'Every story is traced to a line that supports it', byShare(n ? traced / n : 0, 0.85, 0.6), `${Number.isInteger(traced) ? traced : traced.toFixed(1)} of ${n} stories cite a line that supports them (a partly supported source counts half).`, stories.filter((s) => s.issues.some((i) => i.rule === 'source' || i.rule === 'trace')).map((s) => s.id), 1.5),
    criterion('usecase', 'The use case follows the template', ucItem.status === 'ok' ? 'met' : ucItem.issues.filter((i) => i.severity === 'error').length <= 1 ? 'partly' : 'not', ucItem.issues.length ? ucItem.issues.map((i) => i.message).join(' ') : 'All template parts are there.', ['UC1']),
    criterion('logs', 'Interview logs from RE Studio', interviewed === 3 ? (found >= 6 ? 'met' : 'partly') : interviewed ? 'partly' : 'not', `${interviewed} of 3 stakeholders interviewed; ${found} of 9 hidden needs asked about.`, [], 0.5),
    criterion('transcript', 'Real-student transcript, anonymised', transcriptStatus === 'ok' ? 'met' : transcriptStatus === 'warn' ? 'partly' : 'not', transcriptIssues.length ? transcriptIssues.map((i) => i.message).join(' ') : 'Present and anonymised.', [], 0.5),
  ];
  criteria[5].cap = 3;

  return {
    sections: [
      { id: 'stories', title: 'User stories', kind: 'stories', items: stories },
      { id: 'usecase', title: 'Use case', kind: 'list', items: [ucItem] },
      { id: 'transcript', title: 'Real-student transcript', kind: 'list', items: [{ id: 'T1', label: 'Transcript', text: transcript ? cut(transcript, 160) : 'Missing', quote: transcript.split('\n')[0]?.trim() || '', issues: transcriptIssues, evidence: [], status: transcriptStatus }] },
    ],
    facts: { stories: n, traced, precise, interviews: interviewed, hiddenNeeds: found, hidden },
    criteria,
    suggested: suggestScore(criteria),
    summary: ai.data?.summary || '',
    usage: ai,
  };
}

const CATEGORY = {
  privacy: /privacy|personvern|personal|consent|gdpr|e-?mail|data protection/i,
  performance: /performance|ytelse|response time|latency|p9\d|throughput/i,
  llm: /llm|token|model cost|cost per|ai cost|insight|prompt/i,
  usability: /usab|brukervennl|consisten|ux|learnab|accessib|sus\b/i,
  sustainability: /energy|energi|sustainab|bærekraft|carbon|co2|\bwh\b|kwh/i,
};

const CATEGORY_NAME = { privacy: 'privacy', performance: 'performance', llm: 'LLM cost or latency', usability: 'usability', sustainability: 'sustainability' };

async function assess12(ctx) {
  const text = fileText(ctx, /nfr|spec/i) || ctx.text;
  const rows = [];
  for (const t of tables(text)) {
    if (!t.header.some((h) => /nfr|id|quality|requirement|kategori|krav/.test(h))) continue;
    for (const r of t.rows) rows.push(r);
  }
  const nfrs = rows.map((r, k) => {
    const id = (col(r, ['nfr', 'id']) || `NFR${k + 1}`).replace(/\s+/g, '');
    const fields = {
      quality: col(r, ['quality', 'category', 'type', 'kategori']),
      statement: col(r, ['requirement', 'statement', 'description', 'krav']),
      scale: col(r, ['scale', 'metric', 'measure', 'skala']),
      target: col(r, ['target', 'goal', 'threshold', 'mål']),
      verification: col(r, ['verification', 'verify', 'method', 'test', 'verifikasjon']),
    };
    const issues = [];
    if (!fields.scale) issues.push({ rule: 'scale', severity: 'error', message: 'No scale: say what is measured.' });
    if (!fields.target) issues.push({ rule: 'target', severity: 'error', message: 'No target.' });
    else if (!hasNumber(fields.target)) issues.push({ rule: 'target', severity: 'error', message: `The target “${fields.target}” has no number.` });
    if (!fields.verification) issues.push({ rule: 'verification', severity: 'error', message: 'No verification method.' });
    else if (!VERIFY.test(fields.verification)) issues.push({ rule: 'verification', severity: 'warning', message: `“${fields.verification}” is not inspection, analysis, test or demonstration.` });
    issues.push(...vagueIssues(`${fields.scale} ${fields.target}`, 'scale or target'));
    const quote = [fields.scale, fields.statement, fields.target].filter(Boolean).sort((a, b) => b.length - a.length)[0] || id;
    return { id, label: id, text: [fields.quality, fields.statement].filter(Boolean).join(': ') || r._line, quote, fields, issues, evidence: [], status: 'ok' };
  });
  const covered = Object.fromEntries(Object.entries(CATEGORY).map(([k, re]) => [k, nfrs.filter((x) => re.test(`${x.fields.quality} ${x.fields.statement} ${x.fields.scale}`)).map((x) => x.id)]));

  const ai = await judge({
    off: ctx.noAi,
    system: 'You assess Task 1.2: measurable non-functional requirements for a student tutor app (privacy, performance, LLM cost or latency, usability, sustainability).',
    input: {
      instructions: 'For each NFR decide: is it measurable (a defined scale and a numeric target someone else could check)? Is the verification method realistic for a student group (tool, load, environment, repeatable)? Give short reasons that quote the row, and one concrete fix.',
      format: { nfrs: [{ id: 'NFR1', measurable: true, measurableReason: '…', verificationRealistic: true, verificationReason: '…', fix: '…' }], summary: 'two sentences' },
      nfrs: nfrs.map((x) => ({ id: x.id, ...x.fields })),
    },
  });
  const verdicts = new Map((ai.data?.nfrs || []).map((v) => [String(v.id).replace(/\s+/g, ''), v]));
  for (const x of nfrs) {
    const v = verdicts.get(x.id);
    if (!v) continue;
    x.ai = v;
    if (v.measurable === false) x.issues.push({ rule: 'measurable', severity: 'error', message: `Not measurable: ${v.measurableReason}`, by: 'ai' });
    if (v.verificationRealistic === false) x.issues.push({ rule: 'verification', severity: 'warning', message: `Verification not realistic: ${v.verificationReason}`, by: 'ai' });
    if (v.fix && (v.measurable === false || v.verificationRealistic === false)) x.issues.push({ rule: 'fix', severity: 'info', message: `Fix: ${v.fix}`, by: 'ai' });
    x.status = worst(x.issues);
  }
  for (const x of nfrs) x.status = worst(x.issues);
  const n = nfrs.length;
  const coveredCount = Object.values(covered).filter((ids) => ids.length).length;
  const measurable = nfrs.filter((x) => !x.issues.some((i) => ['scale', 'target', 'measurable', 'vague'].includes(i.rule))).length;
  const realistic = nfrs.filter((x) => !x.issues.some((i) => i.rule === 'verification')).length;
  const criteria = [
    criterion('coverage', 'Five qualities covered', coveredCount === 5 ? 'met' : coveredCount >= 3 ? 'partly' : 'not', `Covered: ${Object.entries(covered).filter(([, v]) => v.length).map(([k]) => CATEGORY_NAME[k]).join(', ') || 'none'}.${coveredCount < 5 ? ` Missing: ${Object.entries(covered).filter(([, v]) => !v.length).map(([k]) => CATEGORY_NAME[k]).join(', ')}.` : ''}`),
    criterion('measurable', 'Each NFR is measurable', byShare(n ? measurable / n : 0, 0.99, 0.6), `${measurable} of ${n} NFRs have a scale and a numeric target.`, nfrs.filter((x) => x.issues.some((i) => ['scale', 'target', 'measurable', 'vague'].includes(i.rule))).map((x) => x.id), 1.5),
    criterion('verification', 'Verification is realistic', byShare(n ? realistic / n : 0, 0.99, 0.6), `${realistic} of ${n} NFRs have a realistic verification.`, nfrs.filter((x) => x.issues.some((i) => i.rule === 'verification')).map((x) => x.id), 1.5),
  ];
  return {
    sections: [{ id: 'nfrs', title: 'Non-functional requirements', kind: 'nfrs', columns: ['quality', 'scale', 'target', 'verification'], items: nfrs }],
    facts: { nfrs: n, covered },
    criteria,
    suggested: suggestScore(criteria),
    summary: ai.data?.summary || '',
    usage: ai,
  };
}

const AI_FEATURE = /\b(hint|ai|llm|tutor|model|chat|assistant)\b/i;
const PROPERTY = /\b(never|always|at most|at least|no more than|for every|for all|every|none of|must not)\b/i;

async function assess13(ctx) {
  const text = fileText(ctx, /trace/i) || ctx.text;
  const criteriaRows = [];
  for (const t of tables(text)) for (const r of t.rows) {
    const crit = col(r, ['criterion', 'acceptance', 'given', 'ac']) || Object.values(r).find((v) => typeof v === 'string' && /\bGiven\b/i.test(v)) || '';
    if (!crit) continue;
    criteriaRows.push({ req: col(r, ['req', 'story', 'id', 'us']), criterion: crit, issue: col(r, ['issue', 'planned issue', 'ticket']) || (r._line.match(/#\d+/) || [''])[0], test: col(r, ['test']), line: r._line });
  }
  // A plain list: every item is a criterion, so lines without Given/When/Then are checked too.
  if (!criteriaRows.length) for (const item of listItems(text)) criteriaRows.push({ req: (item.text.match(/\b(US|RE|R)[-\s]?\d+/i) || [''])[0], criterion: item.text, issue: (item.text.match(/#\d+/) || [''])[0], line: item.line });

  const items = criteriaRows.map((r, k) => {
    const issues = [];
    const c = r.criterion;
    if (!/\bGiven\b/i.test(c) || !/\bWhen\b/i.test(c) || !/\bThen\b/i.test(c)) issues.push({ rule: 'gwt', severity: 'error', message: 'Not in Given/When/Then form.' });
    const then = (c.split(/\bThen\b/i)[1] || '');
    issues.push(...vagueIssues(then, '“Then” part'));
    if (AI_FEATURE.test(c) && !PROPERTY.test(c)) issues.push({ rule: 'property', severity: 'warning', message: 'An AI feature: write the criterion as a property (never, always, at most …).' });
    if (!r.issue) issues.push({ rule: 'issue', severity: 'warning', message: 'No issue linked (e.g. #12).' });
    return { id: r.req || `AC${k + 1}`, label: r.req || `AC${k + 1}`, text: c, quote: cut(c, 80).replace(/…$/, ''), fields: { issue: r.issue, test: r.test || '' }, issues, evidence: [], status: 'ok' };
  });
  const issuePart = (ctx.parts || []).find((p) => /issue/i.test(p.label));
  const issueCount = (issuePart?.links || []).reduce((a, l) => a + Number((l.facts || []).map((f) => String(f).match(/^(\d+) issues?$/)).find(Boolean)?.[1] || (l.type === 'issue' ? 1 : 0)), 0);

  const ai = await judge({
    off: ctx.noAi,
    system: 'You assess Task 1.3: Given/When/Then acceptance criteria and a traceability matrix.',
    input: {
      instructions: 'For each criterion decide whether a tester could check it without asking anyone (observable result, concrete values), and, for AI features, whether it is written as a property. Give a short reason and a better version when it fails.',
      format: { criteria: [{ id: 'US1', testable: true, reason: '…', better: '…' }], summary: 'two sentences' },
      criteria: items.map((i) => ({ id: i.id, criterion: i.text })),
    },
  });
  const verdicts = (ai.data?.criteria || []);
  items.forEach((it, k) => {
    const v = verdicts.find((x) => x.id === it.id) || verdicts[k];
    if (v && v.testable === false) it.issues.push({ rule: 'testable', severity: 'error', message: `Not testable: ${v.reason}${v.better ? ` Better: ${v.better}` : ''}`, by: 'ai' });
    it.status = worst(it.issues);
  });
  const n = items.length;
  const stories = new Set(items.map((i) => i.id)).size;
  const criteria = [
    criterion('gwt', 'Every story has Given/When/Then criteria', n ? byShare(items.filter((i) => !i.issues.some((x) => x.rule === 'gwt')).length / n, 0.95, 0.7) : 'not', `${n} criteria for ${stories} stories.`, items.filter((i) => i.issues.some((x) => x.rule === 'gwt')).map((i) => i.id)),
    criterion('testable', 'Criteria are testable', byShare(n ? items.filter((i) => !i.issues.some((x) => ['testable', 'vague'].includes(x.rule))).length / n : 0, 0.9, 0.6), `${items.filter((i) => !i.issues.some((x) => ['testable', 'vague'].includes(x.rule))).length} of ${n} are testable.`, items.filter((i) => i.issues.some((x) => ['testable', 'vague'].includes(x.rule))).map((i) => i.id), 1.5),
    criterion('property', 'AI features as properties', items.some((i) => i.issues.some((x) => x.rule === 'property')) ? 'partly' : 'met', `${items.filter((i) => i.issues.some((x) => x.rule === 'property')).length} AI criteria are not properties.`, items.filter((i) => i.issues.some((x) => x.rule === 'property')).map((i) => i.id)),
    criterion('issues', 'Each story maps to an issue', byShare(n ? items.filter((i) => i.fields.issue).length / n : 0, 0.95, 0.6) === 'met' && (issueCount === 0 || issueCount >= stories) ? 'met' : byShare(n ? items.filter((i) => i.fields.issue).length / n : 0, 0.95, 0.5) === 'not' ? 'not' : 'partly', `${items.filter((i) => i.fields.issue).length} of ${n} criteria name an issue; ${issueCount} issues found on GitHub.`),
  ];
  return { sections: [{ id: 'criteria', title: 'Acceptance criteria', kind: 'list', items }], facts: { criteria: n, stories, issues: issueCount }, criteria, suggested: suggestScore(criteria), summary: ai.data?.summary || '', usage: ai };
}

async function assess14(ctx) {
  const text = fileText(ctx, /agents/i) || ctx.text;
  const wordsCount = (text.match(/\S+/g) || []).length;
  // Rules are list items; prose paragraphs count sentence by sentence.
  const prose = text.split('\n').filter((l) => l.trim() && !/^\s*(#|[-*+]\s|\d+[.)]\s|```)/.test(l)).join(' ');
  const sentences = prose.split(/(?<=[.!?])\s+/).filter((x) => x.split(/\s+/).length >= 4).map((x) => ({ text: x.trim() }));
  const rules = [...listItems(text), ...sentences].map((r, k) => {
    const issues = vagueIssues(r.text, 'rule');
    return { id: `R${k + 1}`, label: `R${k + 1}`, text: r.text, quote: cut(r.text, 80).replace(/…$/, ''), issues, evidence: [], status: 'ok' };
  });
  const hasCommands = /`[^`]*(npm|pnpm|yarn|bun|pytest|python|make|mvn|gradle|go test|cargo|node)\b[^`]*`|```/.test(text);
  const hasDod = /definition of done|done when|\bDoD\b|ferdig når/i.test(text);
  const security = rules.filter((r) => /secur|secret|token|auth|password|sql|xss|sanit|input valid|personal data|e-?mail|pii/i.test(r.text));
  const performance = rules.filter((r) => /perform|latency|\bms\b|p9\d|cache|n\+1|query|slow|response time/i.test(r.text));

  const ai = await judge({
    off: ctx.noAi,
    system: 'You assess Task 1.4: an AGENTS.md file, the instructions a coding agent follows.',
    input: {
      instructions: 'For each rule decide: could a reviewer check it in a pull request (checkable)? Is it already enforced by a linter or formatter (lintable, so it wastes the agent\'s attention)? Which NFR area does it come from (security, performance, privacy, usability, sustainability or none)?',
      format: { rules: [{ id: 'R1', checkable: true, lintable: false, nfr: 'security|performance|privacy|usability|sustainability|none', reason: '…' }], summary: 'two sentences' },
      rules: rules.map((r) => ({ id: r.id, rule: r.text })),
    },
  });
  for (const v of ai.data?.rules || []) {
    const r = rules.find((x) => x.id === v.id);
    if (!r) continue;
    r.fields = { nfr: v.nfr && v.nfr !== 'none' ? v.nfr : '' };
    if (v.checkable === false) r.issues.push({ rule: 'checkable', severity: 'warning', message: `Not checkable: ${v.reason}`, by: 'ai' });
    if (v.lintable) r.issues.push({ rule: 'lintable', severity: 'info', message: 'A linter or formatter already enforces this.', by: 'ai' });
  }
  for (const r of rules) r.status = worst(r.issues);
  const nfrAi = (area) => rules.some((r) => r.fields?.nfr === area);
  const n = rules.length;
  const criteria = [
    criterion('checkable', 'Each rule is specific and checkable', byShare(n ? rules.filter((r) => r.status === 'ok' || r.issues.every((i) => i.severity === 'info')).length / n : 0, 0.85, 0.6), `${rules.filter((r) => r.status === 'ok' || r.issues.every((i) => i.severity === 'info')).length} of ${n} rules are checkable.`, rules.filter((r) => r.issues.some((i) => i.severity !== 'info')).map((r) => r.id), 1.5),
    criterion('nfr', 'Rules from the NFRs (security and performance)', (security.length || nfrAi('security')) && (performance.length || nfrAi('performance')) ? 'met' : security.length || performance.length ? 'partly' : 'not', `${security.length || (nfrAi('security') ? 1 : 0)} security and ${performance.length || (nfrAi('performance') ? 1 : 0)} performance rules.`, [...security, ...performance].map((r) => r.id), 1.5),
    criterion('commands', 'Build and test commands, and a definition of done', hasCommands && hasDod ? 'met' : hasCommands || hasDod ? 'partly' : 'not', `${hasCommands ? 'Commands found' : 'No commands'}; ${hasDod ? 'definition of done found' : 'no definition of done'}.`),
    criterion('length', 'At most one page', wordsCount <= 650 ? 'met' : wordsCount <= 900 ? 'partly' : 'not', `${wordsCount} words (about ${Math.max(1, Math.round(wordsCount / 500))} page${wordsCount > 750 ? 's' : ''}).`, [], 0.5),
  ];
  return { sections: [{ id: 'rules', title: 'Rules', kind: 'list', items: rules }], facts: { rules: n, words: wordsCount }, criteria, suggested: suggestScore(criteria), summary: ai.data?.summary || '', usage: ai };
}

module.exports = { assess11, assess12, assess13, assess14, findSource, interviewsOf };
