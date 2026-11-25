jest.mock('../src/services/openaiClient', () => ({ llmConfigured: () => false, getOpenAIClient: () => null, defaultChatModel: () => 'none', parseJsonFromModel: JSON.parse }));
const { assess, assessmentBlock } = require('../src/assessment');
const { partText, tables, listItems } = require('../src/assessment/text');
const { vagueWords, identityIssues, referenceIssues } = require('../src/assessment/rules');
const { findSource } = require('../src/assessment/ex1');

const logs = JSON.stringify({ interviews: [{ persona: 'kari', name: 'Kari S.', messages: [{ who: 'you', text: 'Can you open past papers off campus wifi?', at: '09:44' }, { who: 'persona', text: 'Only on campus wifi.', at: '09:45' }] }] });
const handin = (spec, transcript = '1 Interviewer: Hi\n2 Student A: Hello') => ({
  text: ['# Task 1.1 · version 1', '', '## Interview logs from RE Studio', '', 'logs', '', '## SPEC.md', 'File: SPEC.md', '', spec, '', '## Real-student transcript', 'File: t.md', '', transcript].join('\n'),
  parts: [{ label: 'Interview logs from RE Studio' }, { label: 'SPEC.md' }, { label: 'Real-student transcript' }],
  conversationLog: logs,
});

describe('assessment helpers', () => {
  test('splits a portal hand-in into parts', () => {
    const t = '# T\n\n## SPEC.md\nFile: SPEC.md\n\n# Spec\n## User stories\n1. A\n\n## Real-student transcript\nhi';
    expect(partText(t, 'SPEC.md', ['SPEC.md', 'Real-student transcript'])).toBe('# Spec\n## User stories\n1. A');
  });
  test('reads tables and lists', () => {
    expect(tables('| NFR | Target |\n|---|---|\n| NFR1 | 800 ms |')[0].rows[0].target).toBe('800 ms');
    expect(listItems('1. one\n- two')).toHaveLength(2);
  });
  test('flags vague words, identity and undefined references', () => {
    expect(vagueWords('The app should be fast and user friendly')).toEqual(expect.arrayContaining(['fast', 'user-friendly']));
    expect(identityIssues('Interview with Emma Hansen. Phone: 912 34 567').map((i) => i.message)).toEqual(expect.arrayContaining(['Contains a phone number.']));
    expect(referenceIssues('see US9', 2, new Set(['US1', 'US2']))[0].message).toMatch(/not defined/);
  });
  test('finds the interview line a source points to', () => {
    const found = findSource('Kari S. 09:45', JSON.parse(logs).interviews, '');
    expect(found.text).toBe('Only on campus wifi.');
    expect(findSource('Kari S. 10:00', JSON.parse(logs).interviews, '').missing).toMatch(/no answer at 10:00/);
    expect(findSource('real-student interview, line 2', [], '1 Q\n2 Student A: yes').text).toBe('Student A: yes');
  });
});

describe('task 1.1', () => {
  test('stories without a source or template fail, traced ones pass', async () => {
    const spec = '## User stories\n1. As a student off campus, I want past papers outside the campus wifi, so that I can practise at home. (Source: Kari S. 09:45)\n2. The app should be fast.\n\n## Use case UC1: Get a hint\nPrimary actor: Student\nPreconditions: signed in\nMain success scenario:\n1. a\n2. b\n3. c\nExtensions: 2a. offline\nPostconditions: stored';
    const a = await assess('1.1', handin(spec));
    const [us1, us2] = a.sections[0].items;
    expect(us1.status).toBe('ok');
    expect(us1.evidence[0].text).toBe('Only on campus wifi.');
    expect(us2.status).toBe('fail');
    expect(us2.issues.map((i) => i.rule)).toEqual(expect.arrayContaining(['template', 'vague', 'source']));
    expect(a.criteria.find((c) => c.id === 'usecase').status).toBe('met');
    expect(a.criteria.find((c) => c.id === 'count').status).toBe('not');
    expect(assessmentBlock(a)).toContain('NOT MET');
  });
  test('an identifying transcript caps the score', async () => {
    const a = await assess('1.1', handin('## User stories\n1. As a student, I want x, so that y. (Source: Kari S. 09:45)', 'Interview with Emma Hansen, phone 912 34 567'));
    expect(a.criteria.find((c) => c.id === 'transcript').status).toBe('not');
  });
});

describe('task 1.2', () => {
  test('targets without numbers are not measurable', async () => {
    const t = '# T\n\n## NFR table in SPEC.md\nFile: SPEC.md\n\n| NFR | Quality | Scale | Target | Verification |\n|---|---|---|---|---|\n| NFR1 | Performance | p95 response time | ≤ 800 ms | load test |\n| NFR2 | Usability | ease of use | good | inspection |';
    const a = await assess('1.2', { text: t, parts: [{ label: 'NFR table in SPEC.md' }] });
    expect(a.sections[0].items.map((i) => i.status)).toEqual(['ok', 'fail']);
    expect(a.criteria.find((c) => c.id === 'coverage').reason).toMatch(/Missing: privacy/);
  });
});

describe('exercise 2 and 3', () => {
  test('2.1 pull request checks roll up', async () => {
    const link = (n, ok) => ({ url: `https://github.com/a/b/pull/${n}`, title: `F${n}`, checks: [{ label: 'Merged', ok: true }, { label: 'Approved plan on a linked issue', ok }, { label: 'Decision note in the description', ok }, { label: 'CI green', ok: true }] });
    const a = await assess('2.1', { text: '', parts: [{ label: 'Merged pull requests', links: [link(1, true), link(2, true), link(3, true), link(4, false)] }] });
    expect(a.criteria.find((c) => c.id === 'plans').status).toBe('partly');
    expect(a.criteria.find((c) => c.id === 'merged').status).toBe('met');
  });
  test('3.3 needs five runs each and stated uncertainty', async () => {
    const lab = { setup: { session: 'script', machine: 'laptop' }, baseline: { runs: '1 1 1 1 1' }, after: { runs: '1 1' }, changes: [{ kind: 'code' }, { kind: 'llm' }], quality: { before: 10, after: 10, total: 10 }, uncertainty: '' };
    const a = await assess('3.3', { text: '', parts: [], conversationLog: JSON.stringify({ tool: 'sustainability', lab }) });
    expect(a.criteria.find((c) => c.id === 'comparable').status).toBe('partly');
    expect(a.criteria.find((c) => c.id === 'uncertainty').status).toBe('not');
  });
});
