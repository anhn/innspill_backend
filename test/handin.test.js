const { parseGithubUrl, fileFacts, pullChecks, linkedIssues, ciState, normalizeParts, partsBlock } = require('../src/utils/handin');

describe('hand-in parts', () => {
  test('parses GitHub links', () => {
    expect(parseGithubUrl('https://github.com/a/b/blob/main/docs/SPEC.md')).toMatchObject({ type: 'file', ref: 'main', path: 'docs/SPEC.md' });
    expect(parseGithubUrl('https://github.com/a/b/pull/14')).toMatchObject({ type: 'pull', number: 14 });
    expect(parseGithubUrl('https://github.com/a/b/commit/4f2a9c1')).toMatchObject({ type: 'commit', sha: '4f2a9c1' });
    expect(parseGithubUrl('https://github.com/a/b/issues/3')).toMatchObject({ type: 'issue', number: 3 });
    expect(parseGithubUrl('https://github.com/a/b/issues?q=is%3Aissue')).toMatchObject({ type: 'issues' });
    expect(parseGithubUrl('https://github.com/a/b.git')).toMatchObject({ type: 'repo', repo: 'b' });
  });

  test('refuses other hosts', () => {
    expect(parseGithubUrl('https://evil.example/a/b')).toBeNull();
    expect(parseGithubUrl('http://localhost:3000/a/b')).toBeNull();
    expect(parseGithubUrl('file:///etc/passwd')).toBeNull();
  });

  test('finds stories, criteria and tables in a file', () => {
    const facts = fileFacts('# SPEC\nAs a student, I want hints, so that I learn. (Source: Kari 10:02)\n| NFR | Target |\n|---|---|\n| NFR1 | 800 ms |\nGiven a user, when x, then y');
    expect(facts).toEqual(expect.arrayContaining(['1 user stories', '1 Given/When/Then criteria', '2 table rows', '1 headings', '1 NFR ids']));
  });

  test('pull request checks', () => {
    const checks = pullChecks({ merged_at: '2027-03-01', body: 'Closes #12\n\n## Decision note\nAccepted...' }, true, 'success');
    expect(checks.every((c) => c.ok)).toBe(true);
    const bad = pullChecks({ merged_at: null, body: 'stuff' }, false, 'failure');
    expect(bad.filter((c) => c.ok)).toHaveLength(0);
    expect(linkedIssues('Closes #12, see #3')).toEqual([12, 3]);
    expect(ciState({ check_runs: [{ status: 'completed', conclusion: 'success' }] })).toBe('success');
    expect(ciState({ check_runs: [] }, { total_count: 0 })).toBe('none');
  });

  test('pull request checks depend on the task', () => {
    const pr = { merged_at: '2027-03-01', body: '## Root cause\nOff by one in the loop.' };
    const c = pullChecks(pr, false, 'success', '2.3', ['src/a.js', 'tests/a.test.js']);
    expect(c.map((x) => x.label)).toEqual(['Merged', 'Root cause in the description', 'Test changed in the pull request', 'CI green']);
    expect(c.every((x) => x.ok)).toBe(true);
    expect(pullChecks(pr, false, 'success', '2.3', ['src/a.js'])[2].ok).toBe(false);
  });

  test('normalises parts and summarises them for the agent', () => {
    const parts = normalizeParts([{ id: 'prs', label: 'Pull requests', kind: 'links', required: true, status: 'warning', links: [{ url: 'https://github.com/a/b/pull/1', title: 'Hint ladder', short: 'abc1234', ok: true, checks: [{ label: 'Merged', ok: true }, { label: 'CI green', ok: false }], evil: 'x' }] }]);
    expect(parts[0].links[0].evil).toBeUndefined();
    const block = partsBlock(parts, 'Own feature not merged yet');
    expect(block).toContain('✓ Merged');
    expect(block).toContain('✗ CI green');
    expect(block).toContain('Own feature not merged yet');
  });
});
