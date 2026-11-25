const fs = require('fs');
const os = require('os');
const path = require('path');
const { githubRepoUrl, exerciseSource, MAX_CODEBASE_BYTES } = require('../src/utils/exerciseSubmission');

describe('exercise submission source', () => {
  test('accepts a github repository link', () => {
    expect(githubRepoUrl('https://github.com/octocat/Hello-World')).toBe('https://github.com/octocat/Hello-World');
    expect(githubRepoUrl('https://github.com/octocat/Hello-World.git')).toBe('https://github.com/octocat/Hello-World.git');
    expect(githubRepoUrl('https://github.com/octocat/Hello-World/tree/main')).toBe('https://github.com/octocat/Hello-World/tree/main');
  });

  test('rejects a link that is not a github repository', () => {
    expect(githubRepoUrl('http://github.com/octocat/Hello-World')).toBeNull();
    expect(githubRepoUrl('https://gitlab.com/group/project')).toBeNull();
    expect(githubRepoUrl('https://github.com/octocat')).toBeNull();
    expect(githubRepoUrl('https://evil.github.com.attacker.test/octocat/Hello-World')).toBeNull();
    const source = exerciseSource({ repoUrl: 'https://example.com/repo' });
    expect(source.error).toMatch(/github.com/);
  });

  test('a github link is enough when the essay text is empty', () => {
    const source = exerciseSource({ submission: '   ', repoUrl: 'https://github.com/octocat/Hello-World' });
    expect(source.submission).toBe('https://github.com/octocat/Hello-World');
    expect(source.repoUrl).toBe('https://github.com/octocat/Hello-World');
    expect(source.codebase).toBeNull();
  });

  test('whitespace text with no link and no file is rejected', () => {
    expect(exerciseSource({ submission: '   ' }).error).toMatch(/GitHub link/);
  });

  test('a codebase must be an uploaded zip under 10 MB', () => {
    const missing = exerciseSource({ codebase: { fileId: '../secret.zip', fileName: 'secret.zip' } });
    expect(missing.error).toMatch(/not uploaded/);
    const loose = exerciseSource({ codebase: { fileId: 'app.js', fileName: 'app.js' } });
    expect(loose.error).toMatch(/\.zip/);
    expect(MAX_CODEBASE_BYTES).toBe(10 * 1024 * 1024);

    const dir = path.join(__dirname, '..', 'uploads', 'assessment');
    fs.mkdirSync(dir, { recursive: true });
    const fileId = `exercise-unit-${Date.now()}.zip`;
    const full = path.join(dir, fileId);
    fs.writeFileSync(full, Buffer.from('PK'));
    const source = exerciseSource({ codebase: { fileId, fileName: 'group.zip' } });
    expect(source.codebase).toMatchObject({ fileId, fileName: 'group.zip', fileSize: 2 });
    fs.unlinkSync(full);
    expect(os.tmpdir()).toBeTruthy();
  });
});
