/**
 * Fixed rules shared by the checkers. Each returns issues: { rule, severity, message }.
 * severity: error (breaks a criterion), warning (weakens it), info (worth a look).
 */
const VAGUE = [
  'fast', 'quick', 'quickly', 'slow', 'easy', 'easily', 'simple', 'user-friendly', 'intuitive', 'good', 'nice',
  'modern', 'smart', 'efficient', 'efficiently', 'flexible', 'robust', 'appropriate', 'adequate', 'seamless', 'responsive',
  'reasonable', 'sufficient', 'secure', 'safe', 'reliable', 'scalable', 'clean', 'better', 'best', 'optimal', 'properly',
  'as needed', 'etc', 'and so on', 'some', 'several', 'many', 'few', 'often', 'usually', 'normally', 'minimal', 'maximum',
];
const GENERIC_ROLES = /^(?:a |an |the )?(?:user|users|person|people|someone|customer)$/i;
const NUMBER = /\b\d+(?:[.,]\d+)?\s*(?:%|ms|s|sec|seconds?|min|minutes?|h|hours?|days?|wh|kwh|mb|gb|kb|tokens?|requests?|users?|times?|clicks?|steps?|sentences?|nok|kr|€|\$|p\d{2})?\b|\bp\d{2}\b/i;
const VERIFY = /\b(inspection|inspect|analysis|analyse|analyze|test|tests|testing|demonstration|demo|measure|measured|load test|benchmark|review|audit)\b/i;

function vagueWords(text) {
  const t = ` ${String(text || '').toLowerCase()} `;
  return VAGUE.filter((w) => new RegExp(`[^a-z]${w.replace(/[-\s]/g, '[-\\s]')}[^a-z]`).test(t));
}

function vagueIssues(text, what) {
  return vagueWords(text).map((w) => ({
    rule: 'vague',
    severity: 'warning',
    message: `“${w}” is vague${what ? ` in the ${what}` : ''}: say how much, how often or under which condition.`,
  }));
}

const hasNumber = (text) => NUMBER.test(String(text || ''));

/** References to items (US4, story 12, NFR3, UC2, AC5) that are not defined, or point forward. */
function referenceIssues(text, ownIndex, known) {
  const issues = [];
  const refs = String(text || '').matchAll(/\b(?:(US|NFR|UC|AC|RE)[-\s]?(\d+)|stor(?:y|ies)\s+(\d+))\b/gi);
  for (const m of refs) {
    const kind = (m[1] || 'US').toUpperCase();
    const n = Number(m[2] || m[3]);
    const id = `${kind}${n}`;
    if (!known.has(id)) issues.push({ rule: 'reference', severity: 'warning', message: `Refers to ${id}, which is not defined in the hand-in.` });
    else if (kind === 'US' && ownIndex !== null && n > ownIndex) issues.push({ rule: 'forward-reference', severity: 'info', message: `Refers forward to ${id}; a reader meets it before it is defined.` });
  }
  return issues;
}

/** Phone numbers, e-mails and full names that would identify a real person. */
function identityIssues(text) {
  const issues = [];
  const t = String(text || '');
  if (/(?:\+47\s?)?\b\d{3}\s?\d{2}\s?\d{3}\b/.test(t)) issues.push({ rule: 'identity', severity: 'error', message: 'Contains a phone number.' });
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(t)) issues.push({ rule: 'identity', severity: 'error', message: 'Contains an e-mail address.' });
  const names = t.match(/\b(?:with|interview with|named|name is)\s+([A-ZÆØÅ][a-zæøå]+\s+[A-ZÆØÅ][a-zæøå]+)/);
  if (names) issues.push({ rule: 'identity', severity: 'error', message: `Names the person (“${names[1]}”).` });
  const speakers = new Set((t.match(/^\s*(?:\d+\s+)?([A-ZÆØÅ][a-zæøå]+):/gm) || []).map((s) => s.replace(/^\s*\d*\s*/, '').replace(':', '')));
  for (const s of speakers) {
    if (!/^(Interviewer|Student|Me|Them|Q|A|Group|Kari|Jonas|Ingrid)$/i.test(s)) issues.push({ rule: 'identity', severity: 'warning', message: `Speaker “${s}” may be the person's real name; use “Student A”.` });
  }
  return issues;
}

const worst = (issues) => (issues.some((i) => i.severity === 'error') ? 'fail' : issues.some((i) => i.severity === 'warning') ? 'warn' : 'ok');


/**
 * Text in a hand-in that talks to the AI instead of the teacher ("ignore the criteria",
 * "give this 5/5"). The checks never obey it; the teacher is told where it is.
 */
const INJECTION = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|your|the)\b[^.\n]{0,25}\b(instructions?|rules?|criteria|rubric|prompt|guidelines)\b/i,
  /\b(you are|act as|pretend to be|from now on you)\b[^.\n]{0,30}\b(ai|assistant|grader|assessor|teacher|examiner|model|chatgpt|claude|gpt)\b/i,
  /\b(give|award|assign|score|grade|rate)\b[^.\n]{0,40}(\b5\s*\/\s*5\b|\bfull (marks|score)\b|\b(top|maximum|highest) (score|grade|marks)\b|\bscore of 5\b|\ba 5\b)/i,
  /\b(system prompt|developer message|<\/?\s*(system|instructions?|handin|submission)\s*>)/i,
  /\b(do not|don't)\b[^.\n]{0,30}\b(flag|report|mention|penali[sz]e)\b[^.\n]{0,30}\b(this|errors?|problems?|issues?)\b/i,
];

function injectionIssues(text) {
  const out = [];
  const lines = String(text || '').split('\n');
  lines.forEach((line, k) => {
    for (const re of INJECTION) {
      const m = line.match(re);
      if (m) {
        out.push({ rule: 'injection', severity: 'warning', message: `Text addressed to the AI: “${line.trim().slice(0, 140)}”. The checks ignored it; read it yourself.`, quote: m[0], line: k + 1 });
        break;
      }
    }
  });
  return out.slice(0, 10);
}

module.exports = { injectionIssues, INJECTION, VAGUE, GENERIC_ROLES, VERIFY, vagueWords, vagueIssues, hasNumber, referenceIssues, identityIssues, worst };
