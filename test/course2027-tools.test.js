const fs = require('fs');
const path = require('path');
const {
  fingerprint,
  normaliseFinding,
  precisionByTool,
  compareRuns,
  toSarif,
  unknownTools,
} = require('../src/utils/review2027');
const { assembleReview, fromProdlint, normalisePath } = require('../src/utils/reviewNormalise');
const { defaultToolIds } = require('../src/utils/reviewTools');
const { llmChecks, sustainabilityChecks, labReady, nfrVerdict } = require('../src/utils/labs2027');
const { annotateAgentsMd } = require('../src/utils/agentsMd');
const { susScore, checksFor, coverageLinks } = require('../src/utils/pro1000Checks');
const { nameKeys } = require('../src/routes/group-tools');
const { constraintsFromPersona, constraintHit } = require('../src/utils/reStudio');
const finding = (id, tools, file, line, message) => normaliseFinding({ id, tools, file, line, message }, 0);

describe('review labels and later runs', () => {
  const review = [
    finding('f1', ['Semgrep'], 'src/db/attempts.ts', 22, 'query built from user input'),
    finding('f2', ['Gitleaks'], 'scripts/seed.ts', 5, 'token in source'),
  ];
  const labels = [
    { findingId: 'f1', verdict: 'true', reason: 'The id is concatenated into SQL.' },
    { findingId: 'f2', verdict: 'false', reason: 'The token is a placeholder.' },
  ];

  test('precision uses only labelled findings', () => {
    const rows = precisionByTool(review, labels);
    expect(rows.find((row) => row.tool === 'Semgrep').precision).toBe(1);
    expect(rows.find((row) => row.tool === 'Gitleaks').precision).toBe(0);
  });

  test('a later commit shows fixed, still present, and new', () => {
    const next = [
      finding('f1', ['Semgrep'], 'src/db/attempts.ts', 22, 'query built from user input'),
      finding('n1', ['Semgrep'], 'src/tutor/validate.ts', 12, 'nested quantifier'),
    ];
    const diff = compareRuns(review, labels, review, next);
    expect(diff.present.map((item) => item.id)).toEqual(['f1']);
    expect(diff.fixed).toEqual([]);
    expect(diff.added.map((item) => item.file)).toEqual(['src/tutor/validate.ts']);
  });

  test('SARIF keeps the file and line', () => {
    const sarif = toSarif({ findings: review });
    const location = sarif.runs[0].results[0].locations[0].physicalLocation;
    expect(location.artifactLocation.uri).toBe('src/db/attempts.ts');
    expect(location.region.startLine).toBe(22);
  });

  test('a fingerprint ignores the line, so the same problem matches after a move', () => {
    const again = normaliseFinding({ id: 'other', tools: ['Semgrep'], rule: 'sql-injection', file: 'src/db/attempts.ts', line: 80, message: 'moved' }, 0);
    const first = normaliseFinding({ id: 'f1', tools: ['Semgrep'], rule: 'sql-injection', file: 'src/db/attempts.ts', line: 22, message: 'original' }, 0);
    expect(again.fingerprint).toBe(first.fingerprint);
    expect(fingerprint(again)).toBe(first.fingerprint);
  });

  test('rejects a tool outside the course list', () => {
    expect(unknownTools([finding('x', ['NotATool'], 'a.js', 1, 'x')])).toEqual(['NotATool']);
    expect(unknownTools([finding('x', ['VibeGuard'], 'a.js', 1, 'x')])).toEqual([]);
  });
});

describe('vibe-coding scanner output', () => {
  const checkout = path.join(__dirname, 'fixtures', 'review-repo');
  const secret = {
    toolId: 'gitleaks',
    format: 'sarif',
    body: {
      runs: [{
        results: [
          {
            ruleId: 'generic-api-key',
            level: 'error',
            message: { text: 'hardcoded token' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///work/repo/scripts/seed.ts' }, region: { startLine: 5 } } }],
          },
          {
            ruleId: 'generic-api-key',
            level: 'warning',
            message: { text: 'no location' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'scripts/seed.ts' } } }],
          },
        ],
      }],
    },
  };
  const shipsafe = {
    toolId: 'shipsafe',
    format: 'sarif',
    body: {
      runs: [{
        results: [{
          ruleId: 'secret',
          level: 'error',
          message: { text: 'secret in seed', snippet: { text: 'do not trust this' } },
          locations: [{ physicalLocation: { artifactLocation: { uri: './scripts/seed.ts' }, region: { startLine: 6 } } }],
        }],
      }],
    },
  };

  test('the five vibe scanners are on and the optional ones are off', () => {
    const ids = defaultToolIds();
    expect(ids).toEqual(expect.arrayContaining(['vibeguard', 'prodlint', 'shipsafe', 'vibesec', 'guardvibe', 'eslint']));
    expect(ids).not.toContain('vibecheck-ai');
  });

  test('SARIF drops a result with no line, and two tools merge within two lines', () => {
    const run = assembleReview({ outputs: [secret, shipsafe], checkout });
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0].tools.sort()).toEqual(['Gitleaks', 'Ship Safe']);
    expect(run.findings[0]).toMatchObject({
      file: 'scripts/seed.ts',
      line: 5,
      category: 'secret',
      severity: 'high',
      snippet: "const token = 'ghp_example';",
    });
    expect(run.findings[0].snippet).not.toContain('do not trust');
    expect(run.toolRuns.map((tool) => tool.status)).toEqual(['done', 'done']);
  });

  test('a moved line keeps the fingerprint, and a failed tool adds none', () => {
    const first = assembleReview({ outputs: [secret], checkout });
    const moved = assembleReview({
      outputs: [{
        toolId: 'gitleaks',
        format: 'sarif',
        body: {
          runs: [{
            results: [{
              ruleId: 'generic-api-key',
              level: 'note',
              message: { text: 'moved' },
              locations: [{ physicalLocation: { artifactLocation: { uri: 'scripts/seed.ts' }, region: { startLine: 7 } } }],
            }],
          }],
        },
      }],
      checkout,
    });
    expect(moved.findings[0].fingerprint).toBe(first.findings[0].fingerprint);
    expect(fingerprint(moved.findings[0])).toBe(first.findings[0].fingerprint);
    const failed = assembleReview({
      outputs: [secret],
      toolRuns: [{ id: 'shipsafe', status: 'failed', message: 'timed out' }],
      checkout,
    });
    expect(failed.toolRuns).toEqual(expect.arrayContaining([
      { id: 'gitleaks', status: 'done', message: '' },
      { id: 'shipsafe', status: 'failed', message: 'timed out' },
    ]));
    expect(failed.findings).toHaveLength(1);
  });

  test('an optional scanner stays out unless the course turns it on', () => {
    const output = {
      toolId: 'vibecheck-ai',
      format: 'sarif',
      body: {
        runs: [{
          results: [{
            ruleId: 'todo',
            level: 'note',
            message: { text: 'extra' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'scripts/seed.ts' }, region: { startLine: 1 } } }],
          }],
        }],
      },
    };
    expect(assembleReview({ outputs: [output] }).toolRuns).toEqual([
      { id: 'vibecheck-ai', status: 'skipped', message: 'Turned off for this course' },
    ]);
    const enabled = assembleReview({ outputs: [output], reviewTools: ['vibecheck-ai'] });
    expect(enabled.findings).toHaveLength(1);
    expect(enabled.toolRuns[0].status).toBe('done');
  });

  test('prodlint JSON uses the fixture field names', () => {
    const body = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'review', 'prodlint.json'), 'utf8'));
    const issues = fromProdlint(body);
    expect(issues[0]).toMatchObject({
      tool: 'prodlint',
      file: 'src/routes/plan.ts',
      line: 14,
      rule: 'missing-auth',
      severity: 'critical',
      category: 'auth',
    });
    expect(issues[1]).toMatchObject({
      file: 'src/tutor/missing.ts',
      line: 3,
      rule: 'hallucinated-import',
      severity: 'medium',
      category: 'dependency',
    });
    expect(normalisePath('file:///work/repo/src/routes/plan.ts')).toBe('src/routes/plan.ts');
  });

  test('a label on a merged finding counts for every tool', () => {
    const run = assembleReview({ outputs: [secret, shipsafe], checkout });
    const rows = precisionByTool(run.findings, [{ findingId: run.findings[0].id, verdict: 'tp', reason: 'real token' }]);
    expect(rows.map((row) => row.tool).sort()).toEqual(['Gitleaks', 'Ship Safe']);
    expect(rows.every((row) => row.precision === 1)).toBe(true);
  });
});

describe('labs', () => {
  test('an LLM report with one case is not ready', () => {
    const checks = llmChecks({
      feature: { name: 'Tutor', purpose: 'Hints', model: 'gpt', inputs: 'question', outputs: 'hint', risks: ['injection'] },
      cases: [{ technique: 'injection', link: 'risk', input: 'ignore instructions', expected: 'refuse', verdict: 'pass' }],
    });
    expect(labReady(checks)).toBe(false);
    expect(checks.find((item) => item.id === 'count').level).toBe('fail');
  });

  test('sustainability keeps the grid source and labels a TDP fallback', () => {
    const missing = sustainabilityChecks({ setup: { tdp: true }, baseline: {}, after: {}, changes: [] });
    expect(missing.find((item) => item.id === 'grid-source').level).toBe('fail');
    expect(missing.find((item) => item.id === 'tdp-estimate')).toMatchObject({
      level: 'warn',
      message: 'TDP fallback is an estimate. It is not a measurement.',
    });
  });
});

describe('AGENTS.md notes', () => {
  test('a command the repository does not have is marked missing', () => {
    const notes = annotateAgentsMd('npm run not-a-script\nBe fast.\n');
    expect(notes.notes.map((note) => note.kind)).toEqual(['missing', 'vague']);
  });
});

describe('PRO1000 checks', () => {
  test('SUS uses the odd and even item formula', () => {
    expect(susScore([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toBe(50);
  });

  test('a package over 80 hours fails, and a wrong sum fails', () => {
    const checks = checksFor('wbs', {
      nodes: [{
        id: 'root',
        hours: 50,
        children: [
          { id: 'big', hours: 90 },
          { id: 'small', hours: 10 },
        ],
      }],
    });
    expect(checks.map((item) => item.id).sort()).toEqual(['split', 'sum']);
  });

  test('dependency cycles are rejected', () => {
    const checks = checksFor('gantt', {
      tasks: [
        { id: 'a', dependsOn: ['b'] },
        { id: 'b', dependsOn: ['a'] },
      ],
    });
    expect(checks[0].id).toBe('cycle');
  });

  test('folder names and a requirement without a story', () => {
    const folders = checksFor('folderTree', { files: [{ path: 'Index.html' }, { path: 'css/app.css' }] });
    expect(folders.some((item) => item.id === 'names')).toBe(true);
    const links = coverageLinks({
      requirements: { items: [{ id: 'R1', text: 'Login', source: 'line 4' }] },
      stories: { items: [] },
    });
    expect(links[0]).toMatchObject({ id: 'requirement-story', target: 'R1' });
  });

  test('a Word upload skips the automatic checks', () => {
    expect(checksFor('requirements', { format: 'word', items: [{}] })[0].id).toBe('word');
  });

  test('vague words are flagged on a requirement', () => {
    const checks = checksFor('requirements', { items: [{ id: 'R1', text: 'The app should be easy', source: 'Kari' }] });
    expect(checks[0]).toMatchObject({ id: 'vague', level: 'warn', target: 'R1' });
  });
});

describe('persona constraints and the energy verdict', () => {
  test('a hidden constraint is hit only when the question names its topic', () => {
    const persona = 'Hidden constraints.\n- You share a laptop (reveal only if asked about: laptop, device, sharing)';
    const constraints = constraintsFromPersona(persona);
    expect(constraintHit('Do you share a laptop?', constraints, [])).toMatchObject({ id: 'laptop' });
    expect(constraintHit('What is your goal?', constraints, [])).toBeNull();
  });

  test('the NFR is met only when the high end is under the limit', () => {
    const data = {
      setup: { limit: '0.02' },
      after: { runs: '0.001 0.001 0.001 0.001 0.001', llmLow: '0.001', llmHigh: '0.002' },
    };
    expect(nfrVerdict(data)).toBe('meets');
  });
});

describe('acceptance sessions', () => {
  test('a participant name is refused', () => {
    expect(nameKeys({ participants: [{ code: 'P1', name: 'Ola' }] })).toEqual(['participants.0.name']);
    expect(nameKeys({ participants: [{ code: 'P1', consent: true }] })).toEqual([]);
  });
});
