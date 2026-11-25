/**
 * Hand-in parts (2027 portal): parse and check GitHub links, normalise the parts
 * a student hands in, and summarise them for the feedback agents.
 * Only github.com links are fetched, so the check cannot be pointed at other hosts.
 */
const GH_API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const MAX_FILE = 300 * 1024;
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

function parseGithubUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null;
  const [owner, repoRaw, kind, ...rest] = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (!owner || !repoRaw) return null;
  const repo = repoRaw.replace(/\.git$/, '');
  const base = { owner, repo, url: `https://github.com/${owner}/${repo}` };
  if (!kind) return { ...base, type: 'repo' };
  if (kind === 'blob' && rest.length >= 2) return { ...base, type: 'file', ref: rest[0], path: rest.slice(1).join('/') };
  if (kind === 'tree') return { ...base, type: 'tree', ref: rest[0] || '', path: rest.slice(1).join('/') };
  if (kind === 'commit' && /^[0-9a-f]{7,40}$/i.test(rest[0] || '')) return { ...base, type: 'commit', sha: rest[0] };
  if (kind === 'pull' && /^\d+$/.test(rest[0] || '')) return { ...base, type: 'pull', number: Number(rest[0]) };
  if (kind === 'issues' && /^\d+$/.test(rest[0] || '')) return { ...base, type: 'issue', number: Number(rest[0]) };
  if (kind === 'issues') return { ...base, type: 'issues' };
  return { ...base, type: 'other' };
}

/** Facts about a text file that a TA would look for first. */
function fileFacts(text) {
  const lines = text.split('\n');
  const count = (re) => lines.filter((line) => re.test(line)).length;
  const facts = [];
  facts.push(`${lines.length} lines`);
  const stories = count(/\bAs an?\b.*\bI want\b/i) + count(/\bSom\b.*\bvil jeg\b/i);
  if (stories) facts.push(`${stories} user stories`);
  const given = count(/\bGiven\b/) + count(/\bGitt\b/);
  if (given) facts.push(`${given} Given/When/Then criteria`);
  const rows = count(/^\s*\|.*\|\s*$/) - count(/^\s*\|[\s:|-]+\|\s*$/);
  if (rows > 0) facts.push(`${rows} table rows`);
  const headings = count(/^#{1,6}\s/);
  if (headings) facts.push(`${headings} headings`);
  const nfr = new Set((text.match(/\bNFR[-\s]?\d+\b/gi) || []).map((x) => x.toUpperCase().replace(/[-\s]/, '')));
  if (nfr.size) facts.push(`${nfr.size} NFR ids`);
  const cites = count(/\((?:source|kilde)[^)]*\)|\binterview\b.*\b\d{1,2}:\d{2}\b/i);
  if (cites) facts.push(`${cites} lines cite an interview`);
  return facts;
}

/**
 * Pull request checks per task. 2.1: merged, approved plan, decision note, CI.
 * 2.3: merged, root cause in the description, a test file changed, CI. 3.3: merged, measured effect, CI.
 */
function pullChecks(pr, planApproved, ci, task = '2.1', files = []) {
  const body = pr.body || '';
  const merged = { label: 'Merged', ok: Boolean(pr.merged_at) };
  const green = { label: 'CI green', ok: ci === 'success' };
  if (task === '2.3') {
    return [
      merged,
      { label: 'Root cause in the description', ok: /^#{1,6}\s*root cause/im.test(body) || /\broot cause\s*:/i.test(body) },
      { label: 'Test changed in the pull request', ok: files.some((f) => /(^|\/)(tests?|__tests__|spec)(\/|$)|\.(test|spec)\.[a-z]+$|_test\.[a-z]+$/i.test(f)) },
      green,
    ];
  }
  if (task === '3.3') {
    return [merged, { label: 'Describes the measured effect', ok: /\b(k?wh|joule|energy|tokens?|latency|ms)\b/i.test(body) && /\d/.test(body) }, green];
  }
  return [
    merged,
    { label: 'Approved plan on a linked issue', ok: planApproved === true },
    { label: 'Decision note in the description', ok: /^#{1,6}\s*decision note/im.test(body) || /\bdecision note\s*:/i.test(body) },
    green,
  ];
}

function linkedIssues(body) {
  const ids = new Set();
  for (const m of String(body || '').matchAll(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|issue|plan)\s*:?\s*#(\d+)/gi)) ids.add(Number(m[1]));
  for (const m of String(body || '').matchAll(/(?:^|\s)#(\d+)\b/g)) ids.add(Number(m[1]));
  return [...ids].slice(0, 4);
}

function ciState(checkRuns, status) {
  const runs = checkRuns?.check_runs || [];
  if (runs.length) {
    if (runs.some((r) => r.status !== 'completed')) return 'pending';
    return runs.every((r) => ['success', 'neutral', 'skipped'].includes(r.conclusion)) ? 'success' : 'failure';
  }
  if (status && status.total_count) return status.state === 'success' ? 'success' : status.state;
  return 'none';
}

async function gh(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'innspill-handin' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(GH_API + path, { headers, signal: AbortSignal.timeout(10000) });
  if (res.status === 403 || res.status === 429) {
    const err = new Error('GitHub rate limit reached. Try again in a few minutes.');
    err.status = 429;
    throw err;
  }
  if (res.status === 404) {
    const err = new Error('Not found on GitHub. Is the repository public, and is the link right?');
    err.status = 404;
    throw err;
  }
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return res.json();
}

async function checkLink(rawUrl, task) {
  const ref = parseGithubUrl(rawUrl);
  if (!ref) return { ok: false, type: 'invalid', url: rawUrl, error: 'Use a link to github.com.' };
  const key = `${ref.type}:${task || ''}:${rawUrl}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value;
  try {
    value = await check(ref, rawUrl, task);
  } catch (error) {
    value = { ok: false, type: ref.type, url: rawUrl, error: error.message };
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * With a GITHUB_TOKEN the server could read private repositories the token can see. Only the
 * owners listed in GITHUB_PRIVATE_OWNERS (comma-separated, e.g. the course organisation) may be
 * private; any other private repository is refused, so students cannot read through the token.
 */
async function privateRepoRefused(ref, url) {
  if (!process.env.GITHUB_TOKEN) return null;
  const repo = await gh(`/repos/${ref.owner}/${ref.repo}`);
  if (!repo.private) return null;
  const allowed = String(process.env.GITHUB_PRIVATE_OWNERS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (allowed.includes(String(ref.owner).toLowerCase())) return null;
  return { ok: false, type: ref.type, url, error: 'This repository is private. Make it visible to the course, or ask your teacher.' };
}

async function check(ref, url, task) {
  const repoPath = `/repos/${ref.owner}/${ref.repo}`;
  const refused = await privateRepoRefused(ref, url);
  if (refused) return refused;
  if (ref.type === 'file') {
    const commit = await gh(`${repoPath}/commits/${encodeURIComponent(ref.ref)}`);
    const sha = commit.sha;
    const res = await fetch(`${RAW}/${ref.owner}/${ref.repo}/${sha}/${ref.path.split('/').map(encodeURIComponent).join('/')}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { ok: false, type: 'file', url, error: `${ref.path} was not found at ${sha.slice(0, 7)}.` };
    let text = await res.text();
    const truncated = text.length > MAX_FILE;
    if (truncated) text = text.slice(0, MAX_FILE);
    return {
      ok: true, type: 'file', url, repo: ref.url, path: ref.path, sha, short: sha.slice(0, 7),
      pinnedUrl: `${ref.url}/blob/${sha}/${ref.path}`, title: ref.path,
      facts: fileFacts(text), text, truncated, checks: [{ label: `Found at ${sha.slice(0, 7)}`, ok: true }],
    };
  }
  if (ref.type === 'commit') {
    const c = await gh(`${repoPath}/commits/${ref.sha}`);
    return {
      ok: true, type: 'commit', url, repo: ref.url, sha: c.sha, short: c.sha.slice(0, 7),
      title: (c.commit?.message || '').split('\n')[0],
      facts: [`${(c.files || []).length} files changed`, `by ${c.commit?.author?.name || 'unknown'}`, (c.commit?.author?.date || '').slice(0, 10)].filter(Boolean),
      checks: [{ label: 'Commit exists', ok: true }],
    };
  }
  if (ref.type === 'pull') {
    const pr = await gh(`${repoPath}/pulls/${ref.number}`);
    let planApproved = false;
    const issues = linkedIssues(pr.body).filter((n) => n !== ref.number);
    for (const n of issues) {
      const comments = await gh(`${repoPath}/issues/${n}/comments?per_page=100`).catch(() => []);
      if (comments.some((c) => /\bplan approved\b/i.test(c.body || ''))) {
        planApproved = true;
        break;
      }
    }
    const runs = await gh(`${repoPath}/commits/${pr.head.sha}/check-runs`).catch(() => null);
    const status = runs?.check_runs?.length ? null : await gh(`${repoPath}/commits/${pr.head.sha}/status`).catch(() => null);
    const ci = ciState(runs, status);
    const files = task === '2.3' ? (await gh(`${repoPath}/pulls/${ref.number}/files?per_page=100`).catch(() => [])).map((f) => f.filename) : [];
    const checks = pullChecks(pr, planApproved, ci, task, files);
    return {
      ok: true, type: 'pull', url, repo: ref.url, number: ref.number, title: pr.title,
      sha: pr.merge_commit_sha || pr.head.sha, short: (pr.merge_commit_sha || pr.head.sha || '').slice(0, 7),
      facts: [pr.merged_at ? `merged ${pr.merged_at.slice(0, 10)}` : `state ${pr.state}`, issues.length ? `links #${issues.join(', #')}` : 'no linked issue', `CI ${ci}`],
      checks,
    };
  }
  if (ref.type === 'issue') {
    const issue = await gh(`${repoPath}/issues/${ref.number}`);
    return {
      ok: true, type: 'issue', url, repo: ref.url, number: ref.number, title: issue.title,
      facts: [issue.state, issue.pull_request ? 'is a pull request' : 'issue', `${issue.comments} comments`],
      checks: [{ label: 'Issue exists', ok: true }],
    };
  }
  if (ref.type === 'issues') {
    const list = await gh(`${repoPath}/issues?state=all&per_page=100`);
    const issues = list.filter((i) => !i.pull_request);
    return {
      ok: true, type: 'issues', url, repo: ref.url, title: `${issues.length} issues`,
      facts: [`${issues.length} issues`, `${issues.filter((i) => i.state === 'open').length} open`],
      checks: [{ label: 'Issues found', ok: issues.length > 0 }],
    };
  }
  if (ref.type === 'repo' || ref.type === 'tree') {
    const repo = await gh(repoPath);
    return {
      ok: true, type: ref.type, url, repo: ref.url, title: repo.full_name,
      facts: [`default branch ${repo.default_branch}`, repo.private ? 'private' : 'public'],
      checks: [{ label: 'Repository found', ok: true }],
    };
  }
  return { ok: false, type: ref.type, url, error: 'Link to a file, commit, pull request or issue.' };
}

const KINDS = new Set(['tool', 'file', 'links', 'text']);
const clip = (value, n) => (typeof value === 'string' ? value.slice(0, n) : undefined);
const cleanCheck = (c) => ({ label: clip(c?.label, 120) || '', ok: Boolean(c?.ok) });

/** Keep what the portal sends to known keys and sane sizes. Text lives in `submission`, not here. */
function normalizeParts(parts) {
  if (!Array.isArray(parts)) return undefined;
  return parts.slice(0, 20).map((p) => ({
    id: clip(p?.id, 40) || 'part',
    label: clip(p?.label, 120) || 'Part',
    kind: KINDS.has(p?.kind) ? p.kind : 'text',
    tool: clip(p?.tool, 40),
    required: Boolean(p?.required),
    status: ['ready', 'warning', 'missing'].includes(p?.status) ? p.status : 'missing',
    fileName: clip(p?.fileName, 200),
    chars: Number.isFinite(p?.chars) ? Math.max(0, Math.floor(p.chars)) : undefined,
    summary: clip(p?.summary, 500),
    links: Array.isArray(p?.links)
      ? p.links.slice(0, 30).map((l) => ({
          url: clip(l?.url, 500) || '',
          type: clip(l?.type, 20),
          title: clip(l?.title, 200),
          short: clip(l?.short, 40),
          pinnedUrl: clip(l?.pinnedUrl, 600),
          ok: Boolean(l?.ok),
          error: clip(l?.error, 300),
          facts: Array.isArray(l?.facts) ? l.facts.slice(0, 8).map((f) => clip(String(f), 120)) : [],
          checks: Array.isArray(l?.checks) ? l.checks.slice(0, 8).map(cleanCheck) : [],
        }))
      : [],
  }));
}

/** A short block for the feedback agents: what was handed in, and what the link checks found. */
function partsBlock(parts, missingNote) {
  if (!Array.isArray(parts) || !parts.length) return '';
  const lines = parts.map((p, i) => {
    const head = `${i + 1}. ${p.label} (${p.kind}${p.tool ? `: ${p.tool}` : ''}${p.required ? ', required' : ''}) — ${p.status}`;
    const extra = [];
    if (p.summary) extra.push(`   ${p.summary}`);
    if (p.fileName) extra.push(`   file: ${p.fileName}`);
    for (const l of p.links || []) {
      const checks = (l.checks || []).map((c) => `${c.ok ? '✓' : '✗'} ${c.label}`).join('; ');
      extra.push(`   - ${l.title ? `${l.title} ` : ''}${l.url}${l.short ? ` @ ${l.short}` : ''}${l.error ? ` (error: ${l.error})` : ''}${checks ? ` [${checks}]` : ''}${l.facts?.length ? ` {${l.facts.join(', ')}}` : ''}`);
    }
    return [head, ...extra].join('\n');
  });
  const note = missingNote ? `\nStudent's note on missing parts: ${missingNote}` : '';
  return `<handin_parts>\nThe hand-in has these parts. Link checks were done automatically on GitHub when the student handed in.\n${lines.join('\n')}${note}\n</handin_parts>`;
}

module.exports = { parseGithubUrl, fileFacts, pullChecks, linkedIssues, ciState, checkLink, normalizeParts, partsBlock };
