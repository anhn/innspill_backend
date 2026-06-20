'use strict';

const { describe, it, beforeAll, afterAll } = require('@jest/globals');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const TMP_DIR = path.join(os.tmpdir(), `rebuild-int-${Date.now()}-${process.pid}`);
const NORMALIZED = path.join(TMP_DIR, 'FeedbackEmbeddings.normalized.jsonl');
const EMBEDDINGS = path.join(TMP_DIR, 'FeedbackEmbeddings.json');

beforeAll(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('rebuild-feedback-embeddings.js CLI', () => {
  it('--dry-run does not write any files', () => {
    const harness = path.join(__dirname, 'harness', 'run-rebuild.js');
    const result = spawnSync('node', [harness, '--dry-run', '--limit', '3', '--normalized', NORMALIZED, '--embeddings', EMBEDDINGS], {
      env: { ...process.env, REBUILD_TEST_FAKE_CLIENT: '1' },
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(NORMALIZED), 'normalized file should not be created in dry-run');
    assert.ok(!fs.existsSync(EMBEDDINGS), 'embeddings file should not be created in dry-run');
  });

  it('writes both files with the correct shape on a real run', () => {
    const harness = path.join(__dirname, 'harness', 'run-rebuild.js');
    const result = spawnSync('node', [harness, '--limit', '5', '--normalized', NORMALIZED, '--embeddings', EMBEDDINGS], {
      env: { ...process.env, REBUILD_TEST_FAKE_CLIENT: '1' },
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(NORMALIZED));
    assert.ok(fs.existsSync(EMBEDDINGS));

    const jsonl = fs.readFileSync(NORMALIZED, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(jsonl.length, 5);
    assert.ok(jsonl[0].chunk_text.includes('Concept:'));

    const json = JSON.parse(fs.readFileSync(EMBEDDINGS, 'utf8'));
    assert.strictEqual(json.length, 5);
    assert.strictEqual(json[0].embedding.length, 3072);
  });
});