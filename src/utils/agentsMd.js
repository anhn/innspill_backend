const WORD_BUDGET = 400;
const LINE_BUDGET = 80;
const DEFAULT_SCRIPTS = ['test', 'lint', 'build', 'dev', 'ci', 'eval:hints'];

const COMMAND = /\b(npm|npx|pnpm|yarn)\s+(run\s+)?([\w:-]+)|\bpytest\b|\bmvn\b/i;
const NFR_WORDS = /\b(p95|ms|seconds?|sekund\w*|kwh|energy|energi|email|e-post|prompt|privacy|personvern|\.env|secret|hemmelig|key|nøkkel)\b/i;
const LINT_WORDS = /\b(indent\w*|semicolons?|semikolon|quotes?|anførsel\w*|trailing|no `?any`?|unused imports?|camelcase)\b/i;
const VAGUE_WORDS = /\b(fast|quick|secure|safe|clean|good|nice|user-friendly|best practices?|rask|sikker|ryddig|god|bra|brukervennlig)\b/i;

function noteFor(text, scripts) {
  const command = text.match(COMMAND);
  if (command) {
    const tool = command[1] && command[1].toLowerCase();
    const script = command[3] && command[3].toLowerCase();
    if (!tool || script === 'ci' || script === 'install' || script === 'i') return 'ci';
    return scripts.includes(script || '') ? 'ci' : 'missing';
  }
  const hasNumber = /\d/.test(text);
  if (NFR_WORDS.test(text) && (hasNumber || /never|aldri|only|bare|no |ingen/i.test(text))) return 'nfr';
  if (LINT_WORDS.test(text)) return 'lint';
  if (VAGUE_WORDS.test(text) && !hasNumber) return 'vague';
  return null;
}

/** Line notes for AGENTS.md. The same rules the studio shows while the group types. */
function annotateAgentsMd(text, knownScripts = DEFAULT_SCRIPTS) {
  const scripts = knownScripts.map((script) => String(script).toLowerCase());
  const lines = String(text || '').split('\n');
  const words = String(text || '').trim() ? String(text).trim().split(/\s+/).length : 0;
  const notes = lines
    .map((line, index) => ({
      line: index + 1,
      text: line,
      kind: line.trim().startsWith('#') ? null : noteFor(line, scripts),
    }))
    .filter((item) => item.kind);
  const missing = notes.filter((note) => note.kind === 'missing');
  const vague = notes.filter((note) => note.kind === 'vague');
  const lower = String(text || '').toLowerCase();
  const headings = ['purpose', 'commands', 'boundaries', 'quality'].filter((heading) => lower.includes(heading));
  const checks = [
    { id: 'headings', level: headings.length === 4 ? 'ok' : 'fail', message: 'The four headings are purpose, commands, boundaries, and quality.' },
    { id: 'budget', level: words <= WORD_BUDGET && lines.length <= LINE_BUDGET ? 'ok' : 'fail', message: `${words} words, ${lines.length} lines.` },
    { id: 'commands', level: notes.some((note) => note.kind === 'ci') && missing.length === 0 ? 'ok' : 'fail', message: 'Commands should be scripts this repository already has.' },
    { id: 'checkable', level: notes.length > 0 && vague.length === 0 ? 'ok' : 'fail', message: 'Rules need to be specific enough to check.' },
  ];
  return { words, lines: lines.length, notes, checks };
}

module.exports = { annotateAgentsMd, WORD_BUDGET, LINE_BUDGET };
