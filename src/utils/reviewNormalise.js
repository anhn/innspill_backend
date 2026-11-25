const fs = require('fs');
const path = require('path');
const categories = require('./rule-categories.json');
const { toolByRef, toolName, defaultToolIds } = require('./reviewTools');
const { fingerprint } = require('./review2027');

function normalisePath(file) {
  let value = String(file || '').trim().replace(/\\/g, '/');
  value = value.replace(/^file:\/\//, '');
  const marker = '/work/repo/';
  const at = value.toLowerCase().indexOf(marker);
  if (at >= 0) value = value.slice(at + marker.length);
  value = value.replace(/^\.?\//, '');
  return value;
}

function sarifLevel(level) {
  if (level === 'error') return 'high';
  if (level === 'warning') return 'medium';
  if (level === 'note') return 'low';
  return 'info';
}

function prodlintSeverity(value) {
  const text = String(value || '').toLowerCase();
  if (text === 'critical') return 'critical';
  if (text === 'warning' || text === 'high') return 'medium';
  if (text === 'info' || text === 'low') return 'info';
  return 'info';
}

function categoryFor(tool, rule) {
  const known = toolByRef(tool);
  const table = (known && categories[known.id]) || {};
  return table[rule] || categories.default || 'quality';
}

/**
 * SARIF results without a file and a line stay out of the review.
 * Snippets in the SARIF file are ignored. The checkout is the source.
 */
function fromSarif(toolId, sarif) {
  const tool = toolName(toolId);
  return (sarif && sarif.runs ? sarif.runs : []).flatMap((run) =>
    (run.results || []).flatMap((result) => {
      const location = result.locations && result.locations[0] && result.locations[0].physicalLocation;
      const file = location && location.artifactLocation && location.artifactLocation.uri;
      const line = location && location.region && location.region.startLine;
      if (!file || !line) return [];
      const rule = result.ruleId || 'unknown';
      return [{
        tool,
        rule,
        message: (result.message && result.message.text) || '',
        file: normalisePath(file),
        line: Number(line),
        severity: sarifLevel(result.level),
        category: categoryFor(toolId, rule),
      }];
    })
  );
}

/**
 * prodlint --json is not SARIF. This maps the fields in
 * test/fixtures/review/prodlint.json. Confirm them against a real
 * `prodlint --json` dump before pinning the CLI in the image.
 */
function fromProdlint(body) {
  const issues = Array.isArray(body) ? body : (body && (body.issues || body.findings || body.results)) || [];
  return issues.flatMap((issue) => {
    const file = issue.file || issue.path || issue.filename;
    const line = issue.line || issue.lineNumber || issue.startLine;
    if (!file || !line) return [];
    const rule = issue.rule || issue.ruleId || 'unknown';
    return [{
      tool: toolName('prodlint'),
      rule,
      message: issue.message || issue.msg || '',
      file: normalisePath(file),
      line: Number(line),
      severity: prodlintSeverity(issue.severity),
      category: categoryFor('prodlint', rule),
    }];
  });
}

function snippetAt(checkout, file, line) {
  if (!checkout || !file || !line) return '';
  const root = path.resolve(checkout);
  const full = path.resolve(root, file);
  if (full !== root && !full.startsWith(root + path.sep)) return '';
  if (!fs.existsSync(full)) return '';
  const rows = fs.readFileSync(full, 'utf8').split(/\r?\n/);
  return (rows[line - 1] || '').trim();
}

/**
 * One row per category + file + line, with lines within ±2 counted together.
 * Fingerprint ignores the line: category, file, and the first tool's rule.
 */
function mergeFindings(rawFindings, checkout) {
  const merged = [];
  for (const raw of rawFindings || []) {
    const file = normalisePath(raw.file);
    const line = Number(raw.line) || 0;
    if (!file || !line) continue;
    const name = toolName(raw.tool || (raw.tools && raw.tools[0]));
    const category = raw.category || categoryFor(name, raw.rule || '');
    const hit = merged.find((item) => item.category === category && item.file === file && Math.abs(item.line - line) <= 2);
    if (hit) {
      if (name && !hit.tools.includes(name)) hit.tools.push(name);
      if (!hit.message && raw.message) hit.message = raw.message;
      continue;
    }
    const snippet = checkout ? snippetAt(checkout, file, line) : (raw.snippet || '');
    merged.push({
      tools: name ? [name] : [],
      rule: raw.rule || 'unknown',
      message: raw.message || '',
      file,
      line,
      snippet,
      severity: raw.severity || 'info',
      category,
    });
  }
  return merged.map((finding, index) => {
    const stored = {
      id: `f${index + 1}`,
      tools: finding.tools,
      rule: finding.rule,
      message: finding.message,
      file: finding.file,
      line: finding.line,
      snippet: finding.snippet,
      severity: finding.severity,
      category: finding.category,
    };
    stored.fingerprint = fingerprint(stored);
    return stored;
  });
}

function assembleReview({ outputs, findings, toolRuns, reviewTools, checkout }) {
  const enabled = new Set(enabledToolIds(reviewTools));
  const raw = [];
  const results = [];
  for (const output of outputs || []) {
    const tool = toolByRef(output.toolId);
    if (!tool) {
      results.push({ id: String(output.toolId || ''), status: 'failed', message: 'Unknown tool' });
      continue;
    }
    if (!enabled.has(tool.id)) {
      results.push({ id: tool.id, status: 'skipped', message: 'Turned off for this course' });
      continue;
    }
    try {
      const parsed = output.format === 'prodlint' ? fromProdlint(output.body) : fromSarif(tool.id, output.body || {});
      raw.push(...parsed);
      results.push({ id: tool.id, status: 'done', message: '' });
    } catch (error) {
      results.push({ id: tool.id, status: 'failed', message: 'Output could not be parsed' });
    }
  }
  for (const reported of toolRuns || []) {
    const tool = toolByRef(reported.id || reported.toolId);
    const id = tool ? tool.id : String(reported.id || reported.toolId || '');
    if (!id || results.some((row) => row.id === id)) continue;
    const status = reported.status === 'done' || reported.status === 'skipped' ? reported.status : 'failed';
    results.push({ id, status, message: reported.message || '' });
  }
  for (const finding of findings || []) {
    const names = finding.tools && finding.tools.length ? finding.tools : [finding.tool];
    for (const name of names.filter(Boolean)) {
      raw.push({
        tool: name,
        rule: finding.rule,
        message: finding.message || finding.code,
        file: finding.file,
        line: finding.line,
        severity: finding.severity,
        category: finding.category,
        snippet: finding.snippet || finding.code,
      });
    }
  }
  return { findings: mergeFindings(raw, checkout), toolRuns: results };
}

function enabledToolIds(reviewTools) {
  if (!Array.isArray(reviewTools) || reviewTools.length === 0) return defaultToolIds();
  return reviewTools.map((value) => {
    const tool = toolByRef(value);
    return tool ? tool.id : null;
  }).filter(Boolean);
}

module.exports = {
  normalisePath,
  sarifLevel,
  fromSarif,
  fromProdlint,
  snippetAt,
  mergeFindings,
  categoryFor,
  enabledToolIds,
  assembleReview,
};
