const crypto = require('crypto');
const { REVIEW_CATALOG, toolByRef, toolName } = require('./reviewTools');

const REVIEW_TOOLS = REVIEW_CATALOG.map((tool) => tool.name);

function findingTools(finding) {
  const listed = Array.isArray(finding.tools) ? finding.tools : [];
  if (finding.tool) listed.push(finding.tool);
  return [...new Set(listed.map((tool) => String(tool).trim()).filter(Boolean))];
}

/**
 * Stable across commits for a merged finding: category, file, and the
 * first tool's rule. The line is not part of the key.
 */
function fingerprint(finding) {
  const basis = [
    String(finding.category || 'quality').trim(),
    String(finding.file || '').trim().replace(/\\/g, '/'),
    String(finding.rule || '').trim(),
  ].join('\n');
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 16);
}

function normaliseFinding(finding, index) {
  const tools = findingTools(finding).map((tool) => toolName(tool)).filter(Boolean);
  const stored = {
    id: finding.id ? String(finding.id) : `f${index + 1}`,
    tools,
    file: String(finding.file || '').trim().replace(/\\/g, '/'),
    line: Number(finding.line) || 0,
    message: String(finding.message || finding.code || '').trim(),
    rule: String(finding.rule || '').trim(),
    snippet: String(finding.snippet || finding.code || '').trim(),
    severity: finding.severity || undefined,
    category: finding.category || 'quality',
  };
  stored.fingerprint = finding.fingerprint || fingerprint(stored);
  return stored;
}

function unknownTools(findings) {
  return findings.flatMap((finding) => findingTools(finding).filter((tool) => !toolByRef(tool)));
}

/**
 * Precision is true labels divided by labelled findings for that tool.
 * Unlabelled findings are left out. A tool with no labels has no precision.
 */
function precisionByTool(findings, labels) {
  const byId = new Map((labels || []).map((label) => [label.findingId, label]));
  const counts = new Map();
  for (const finding of findings || []) {
    const label = byId.get(finding.id);
    const verdict = label && (label.verdict === 'tp' || label.verdict === 'true')
      ? 'tp'
      : label && (label.verdict === 'fp' || label.verdict === 'false')
        ? 'fp'
        : null;
    if (!verdict) continue;
    for (const tool of finding.tools) {
      const row = counts.get(tool) || { tool, tp: 0, fp: 0 };
      row[verdict] += 1;
      counts.set(tool, row);
    }
  }
  return [...counts.values()].map((row) => ({
    ...row,
    precision: (row.tp + row.fp) === 0 ? null : row.tp / (row.tp + row.fp),
  }));
}

function trueFindings(findings, labels) {
  const trueIds = new Set((labels || []).filter((label) => label.verdict === 'tp' || label.verdict === 'true').map((label) => label.findingId));
  return (findings || []).filter((finding) => trueIds.has(finding.id));
}

/**
 * Match a later run to the true problems from the group's review labels.
 * fixed: a true problem whose fingerprint is absent.
 * present: a true problem that is still in this run.
 * added: a finding in this run that was not in the previous run.
 */
function compareRuns(reviewFindings, reviewLabels, previousFindings, nextFindings) {
  const problems = trueFindings(reviewFindings, reviewLabels);
  const previous = new Set((previousFindings || reviewFindings || []).map((finding) => finding.fingerprint));
  const next = new Set((nextFindings || []).map((finding) => finding.fingerprint));
  return {
    fixed: problems.filter((finding) => !next.has(finding.fingerprint)),
    present: problems.filter((finding) => next.has(finding.fingerprint)),
    added: (nextFindings || []).filter((finding) => !previous.has(finding.fingerprint)),
  };
}

function toCsv(findings, labels) {
  const byId = new Map((labels || []).map((label) => [label.findingId, label]));
  const lines = ['tool,file,line,message,verdict,reason'];
  for (const finding of findings || []) {
    const label = byId.get(finding.id);
    const cells = [
      finding.tools.join('|'),
      finding.file,
      finding.line,
      finding.message,
      label ? label.verdict : '',
      label ? label.reason : '',
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`);
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}

function toMarkdown(run) {
  const lines = [
    `# Review ${run.commit || ''}`.trim(),
    '',
    `Repository: ${run.repo || run.repoUrl || ''}`,
    '',
    '| Tool | File | Line | Message |',
    '|---|---|---|---|',
  ];
  for (const finding of run.findings || []) {
    lines.push(`| ${finding.tools.join(', ')} | ${finding.file} | ${finding.line} | ${finding.message.replace(/\|/g, '\\|')} |`);
  }
  return lines.join('\n');
}

function toSarif(run) {
  return {
    version: '2.1.0',
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    runs: [{
      tool: { driver: { name: 'InnSpill review', rules: [] } },
      results: (run.findings || []).map((finding) => ({
        ruleId: finding.tools[0] || 'review',
        message: { text: finding.message || finding.file },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: finding.file },
            region: { startLine: finding.line > 0 ? finding.line : 1 },
          },
        }],
      })),
    }],
  };
}

/** A one-page text PDF. Enough for the export button. Not a layout engine. */
function toPdf(text) {
  const safe = String(text).replace(/[^\x20-\x7E\n]/g, '?');
  const wrapped = [];
  for (const raw of safe.split('\n')) {
    const line = raw.slice(0, 90) || ' ';
    wrapped.push(line);
    if (wrapped.length === 48) break;
  }
  while (wrapped.length < 1) wrapped.push(' ');
  const commands = ['BT', '/F1 10 Tf', '50 780 Td', '14 TL'];
  wrapped.forEach((line, index) => {
    const escaped = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    commands.push(index === 0 ? `(${escaped}) Tj` : `T* (${escaped}) Tj`);
  });
  commands.push('ET');
  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

module.exports = {
  REVIEW_TOOLS,
  fingerprint,
  normaliseFinding,
  unknownTools,
  precisionByTool,
  trueFindings,
  compareRuns,
  toCsv,
  toMarkdown,
  toSarif,
  toPdf,
};
