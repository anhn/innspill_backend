'use strict';

const { describe, it } = require('@jest/globals');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { validateOutput, atomicWrite, writeOutput } = require('./writer');

const TMP_DIR = path.join(os.tmpdir(), `writer-test-${Date.now()}-${process.pid}`);
const NORMALIZED = path.join(TMP_DIR, 'FeedbackEmbeddings.normalized.jsonl');
const EMBEDDINGS = path.join(TMP_DIR, 'FeedbackEmbeddings.json');

function fakeVector(seed) {
  return new Array(3072).fill(0).map((_, i) => (seed + i) % 1);
}

fs.mkdirSync(TMP_DIR, { recursive: true });
process.on('exit', () => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('validateOutput', () => {
  it('passes for a valid set', () => {
    const records = [{ id: 'a' }, { id: 'b' }];
    const embedded = [
      { id: 'a', text: 't1', embedding: fakeVector(1) },
      { id: 'b', text: 't2', embedding: fakeVector(2) },
    ];
    validateOutput(records, embedded);
  });

  it('throws on duplicate record IDs', () => {
    const records = [{ id: 'a' }, { id: 'a' }];
    const embedded = [{ id: 'a', embedding: fakeVector(1) }];
    assert.throws(() => validateOutput(records, embedded), /Duplicate/);
  });

  it('throws on wrong embedding length', () => {
    const records = [{ id: 'a' }];
    const embedded = [{ id: 'a', text: 't', embedding: [0.1, 0.2] }];
    assert.throws(() => validateOutput(records, embedded), /Invalid embedding length/);
  });

  it('throws on ID set mismatch', () => {
    const records = [{ id: 'a' }, { id: 'b' }];
    const embedded = [
      { id: 'a', embedding: fakeVector(1) },
      { id: 'c', embedding: fakeVector(3) },
    ];
    assert.throws(() => validateOutput(records, embedded), /ID mismatch/);
  });
});

describe('atomicWrite', () => {
  it('writes content to the target file', () => {
    const target = path.join(TMP_DIR, 'atomic.txt');
    atomicWrite(target, 'hello');
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'hello');
    assert.ok(!fs.existsSync(target + '.tmp'));
  });
});

describe('writeOutput', () => {
  it('writes both files and they parse correctly', () => {
    const records = [
      { id: 'x', chunk_text: 'A', submission_id: 's' },
      { id: 'y', chunk_text: 'B', submission_id: 't' },
    ];
    const embedded = [
      { id: 'x', text: 'A', embedding: fakeVector(1) },
      { id: 'y', text: 'B', embedding: fakeVector(2) },
    ];
    writeOutput(records, embedded, { normalized: NORMALIZED, embeddings: EMBEDDINGS });

    const jsonl = fs.readFileSync(NORMALIZED, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(jsonl.length, 2);
    assert.strictEqual(jsonl[0].id, 'x');

    const json = JSON.parse(fs.readFileSync(EMBEDDINGS, 'utf8'));
    assert.strictEqual(json.length, 2);
    assert.strictEqual(json[0].embedding.length, 3072);
  });

  it('leaves previous files in place when validation fails', () => {
    const target1 = path.join(TMP_DIR, 'prev.normalized.jsonl');
    const target2 = path.join(TMP_DIR, 'prev.embeddings.json');
    fs.writeFileSync(target1, 'old\n');
    fs.writeFileSync(target2, '[]');

    const records = [{ id: 'dup' }, { id: 'dup' }];
    const embedded = [{ id: 'dup', embedding: fakeVector(1) }];
    assert.throws(() => writeOutput(records, embedded, { normalized: target1, embeddings: target2 }), /Duplicate/);

    assert.strictEqual(fs.readFileSync(target1, 'utf8'), 'old\n');
    assert.strictEqual(fs.readFileSync(target2, 'utf8'), '[]');
  });
});