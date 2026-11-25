const RISK_TECHNIQUES = {
  hallucination: ['example', 'judge', 'human'],
  injection: ['injection'],
  privacy: ['privacy'],
  bias: ['metamorphic', 'robustness'],
  inconsistency: ['consistency', 'metamorphic'],
  overhelp: ['safety'],
};

function check(id, ok, message) {
  return { id, level: ok ? 'ok' : 'fail', message };
}

function llmChecks(data) {
  const feature = data.feature || {};
  const cases = Array.isArray(data.cases) ? data.cases : [];
  const techniques = new Set(cases.map((item) => item.technique).filter(Boolean));
  const risks = Array.isArray(feature.risks) ? feature.risks : [];
  const uncovered = risks.filter((risk) => !(RISK_TECHNIQUES[risk] || []).some((technique) => techniques.has(technique)));
  const featureReady = [feature.name, feature.purpose, feature.model, feature.inputs, feature.outputs]
    .every((value) => String(value || '').trim());
  return [
    check('feature', featureReady, 'Name the feature, who it is for, the model, and its inputs and outputs.'),
    check('count', cases.length >= 10, `At least 10 test cases (${cases.length}).`),
    check('techniques', techniques.size >= 4, `At least four techniques (${techniques.size}).`),
    check('injection', techniques.has('injection') && techniques.has('metamorphic'), 'Include metamorphic testing and prompt injection.'),
    check('linked', cases.length > 0 && cases.every((item) => String(item.link || '').trim()), 'Every case names the requirement, rule, or risk it tests.'),
    check('oracle', cases.length > 0 && cases.every((item) => String(item.input || '').trim() && String(item.expected || '').trim()), 'Every case has an input and an expected behaviour.'),
    check('risks', risks.length > 0 && uncovered.length === 0, uncovered.length ? `Uncovered risks: ${uncovered.join(', ')}` : 'Every listed risk has a case.'),
    check('results', cases.length > 0 && cases.every((item) => item.verdict), 'Every case has a verdict.'),
    check('notes', cases.every((item) => item.verdict === 'pass' || !item.verdict || String(item.notes || '').trim()), 'Every failure is explained.'),
  ];
}

function parseRuns(text) {
  return String(text || '')
    .split(/[;\s]+/)
    .flatMap((token) => (token.includes('.') ? token.split(',') : [token.replace(',', '.')]))
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
}

function sustainabilityChecks(data) {
  const setup = data.setup || {};
  const changes = Array.isArray(data.changes) ? data.changes : [];
  const baselineRuns = parseRuns(data.baseline && data.baseline.runs);
  const afterRuns = parseRuns(data.after && data.after.runs);
  const source = String(setup.gridSource || '').trim();
  const checks = [
    check('grid-source', source.length > 0, 'Name the grid-intensity source.'),
    check('baseline-runs', baselineRuns.length >= 5, `Baseline needs at least five runs (${baselineRuns.length}).`),
    check('after-runs', afterRuns.length >= 5, `The optimised session needs at least five runs (${afterRuns.length}).`),
    check('code-change', changes.some((change) => change.kind === 'code' && String(change.title || change.what || '').trim()), 'Include at least one change to your own code.'),
    check('llm-change', changes.some((change) => change.kind === 'llm' && String(change.title || change.what || '').trim()), 'Include at least one change to how the app uses the LLM.'),
  ];
  const before = Number(data.quality && data.quality.before);
  const after = Number(data.quality && data.quality.after);
  if (Number.isFinite(before) && Number.isFinite(after) && after < before) {
    checks.push(check('quality-notes', String((data.quality && data.quality.notes) || '').trim().length > 0, 'Explain why fewer cases passed after the change.'));
  }
  if (setup.tdp) {
    checks.push({
      id: 'tdp-estimate',
      level: 'warn',
      message: 'TDP fallback is an estimate. It is not a measurement.',
    });
  }
  return checks;
}

function labChecks(kind, data) {
  if (kind === 'llm') return llmChecks(data || {});
  if (kind === 'sustainability') return sustainabilityChecks(data || {});
  return [];
}

function labReady(checks) {
  return checks.every((item) => item.level !== 'fail');
}

function measurementSummary(measurement) {
  const values = parseRuns(measurement && measurement.runs);
  const n = values.length;
  const mean = n ? values.reduce((sum, value) => sum + value, 0) / n : 0;
  const sd = n > 1
    ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1))
    : 0;
  const llmLow = measurement && measurement.llmLow !== '' ? Number(String(measurement.llmLow).replace(',', '.')) : null;
  const llmHigh = measurement && measurement.llmHigh !== '' ? Number(String(measurement.llmHigh).replace(',', '.')) : null;
  const low = n && Number.isFinite(llmLow) ? mean - sd + llmLow : null;
  const high = n && Number.isFinite(llmHigh) ? mean + sd + llmHigh : null;
  return { n, mean, sd, low, high };
}

/** meets, meets-low, or misses, from the after range and the NFR limit. */
function nfrVerdict(data) {
  const after = measurementSummary(data.after);
  const limit = Number(String((data.setup && data.setup.limit) || '').replace(',', '.'));
  if (!Number.isFinite(limit) || after.low == null || after.high == null) return null;
  if (after.high <= limit) return 'meets';
  if (after.low <= limit) return 'meets-low';
  return 'misses';
}

function sustainabilityView(data) {
  const setup = (data && data.setup) || {};
  return {
    baseline: measurementSummary(data && data.baseline),
    after: measurementSummary(data && data.after),
    nfr: nfrVerdict(data || {}),
    estimateLabel: setup.tdp ? 'TDP fallback is an estimate. It is not a measurement.' : null,
    gridSource: setup.gridSource || '',
  };
}

module.exports = {
  llmChecks,
  sustainabilityChecks,
  labChecks,
  labReady,
  parseRuns,
  measurementSummary,
  nfrVerdict,
  sustainabilityView,
};
