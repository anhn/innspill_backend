'use strict';

const { describe, it } = require('@jest/globals');
const assert = require('node:assert');
const { embedBatch, embedAll } = require('./embedder');

function fakeVector(seed) {
  return new Array(3072).fill(0).map((_, i) => (seed + i) % 1);
}

function makeClient(behavior) {
  return {
    embeddings: {
      async create({ input }) {
        return behavior(input);
      },
    },
  };
}

describe('embedBatch', () => {
  it('returns vectors in order on first success', async () => {
    const client = makeClient((inputs) => ({
      data: inputs.map((_, i) => ({ embedding: fakeVector(i) })),
    }));
    const out = await embedBatch(['a', 'b', 'c'], { client, model: 'text-embedding-3-large', maxAttempts: 3, baseDelayMs: 1 });
    assert.strictEqual(out.length, 3);
    assert.strictEqual(out[0][0], 0 % 1);
    assert.strictEqual(out[1][0], 1 % 1);
  });

  it('retries on 429 and eventually succeeds', async () => {
    let calls = 0;
    const client = makeClient((inputs) => {
      calls += 1;
      if (calls < 2) {
        const err = new Error('rate limit');
        err.status = 429;
        throw err;
      }
      return { data: inputs.map((_, i) => ({ embedding: fakeVector(i) })) };
    });
    const out = await embedBatch(['x'], { client, model: 'm', maxAttempts: 3, baseDelayMs: 1 });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(calls, 2);
  });

  it('throws the last error after maxAttempts', async () => {
    const client = makeClient(() => {
      const err = new Error('server down');
      err.status = 500;
      throw err;
    });
    await assert.rejects(
      () => embedBatch(['x'], { client, model: 'm', maxAttempts: 3, baseDelayMs: 1 }),
      /server down/
    );
  });

  it('does not retry on 400 (client error)', async () => {
    let calls = 0;
    const client = makeClient(() => {
      calls += 1;
      const err = new Error('bad request');
      err.status = 400;
      throw err;
    });
    await assert.rejects(
      () => embedBatch(['x'], { client, model: 'm', maxAttempts: 3, baseDelayMs: 1 }),
      /bad request/
    );
    assert.strictEqual(calls, 1);
  });
});

describe('embedAll', () => {
  const recs = (n) => Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    chunk_text: `text ${i}`,
  }));

  it('embeds all records across batches', async () => {
    const client = makeClient((inputs) => ({
      data: inputs.map((_, i) => ({ embedding: fakeVector(i) })),
    }));
    const { embedded, failed } = await embedAll(recs(5), {
      client,
      model: 'm',
      batchSize: 2,
      throttleMs: 0,
    });
    assert.strictEqual(embedded.length, 5);
    assert.strictEqual(failed.length, 0);
    assert.strictEqual(embedded[0].id, 'r0');
    assert.ok(embedded[0].embedding.length === 3072);
  });

  it('skips a failing batch and continues', async () => {
    let callIndex = 0;
    const client = makeClient((inputs) => {
      callIndex += 1;
      if (callIndex === 1) {
        const err = new Error('boom');
        err.status = 500;
        throw err;
      }
      return { data: inputs.map((_, i) => ({ embedding: fakeVector(i) })) };
    });
    const records = recs(4);
    const { embedded, failed } = await embedAll(records, {
      client,
      model: 'm',
      batchSize: 2,
      throttleMs: 0,
      maxAttempts: 1,
    });
    assert.strictEqual(embedded.length, 2);
    assert.strictEqual(failed.length, 2);
    assert.strictEqual(failed[0].id, 'r0');
    assert.ok(failed[0].reason.includes('boom'));
  });
});
