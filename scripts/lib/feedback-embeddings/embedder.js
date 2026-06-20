'use strict';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_THROTTLE_MS = 350;

function isRetryableStatus(status) {
  return status === 429 || (typeof status === 'number' && status >= 500 && status < 600);
}

async function embedBatch(texts, { client, model, maxAttempts = DEFAULT_MAX_ATTEMPTS, baseDelayMs = DEFAULT_BASE_DELAY_MS }) {
  if (!client || !client.embeddings || typeof client.embeddings.create !== 'function') {
    throw new Error('embedBatch: client with embeddings.create is required');
  }
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await client.embeddings.create({ model, input: texts });
      if (!response || !Array.isArray(response.data)) {
        throw new Error('embedBatch: invalid OpenAI response shape');
      }
      return response.data.map((d) => d.embedding);
    } catch (err) {
      lastError = err;
      const status = err && (err.status || (err.response && err.response.status));
      if (!isRetryableStatus(status) || attempt >= maxAttempts) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }
  throw lastError;
}

async function embedAll(records, options = {}) {
  const client = options.client;
  const model = options.model;
  const batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
  const throttleMs = options.throttleMs !== undefined ? options.throttleMs : DEFAULT_THROTTLE_MS;
  const maxAttempts = options.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs !== undefined ? options.baseDelayMs : DEFAULT_BASE_DELAY_MS;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  const embedded = [];
  const failed = [];

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const texts = batch.map((r) => r.chunk_text);
    try {
      const vectors = await embedBatch(texts, { client, model, maxAttempts, baseDelayMs });
      for (let j = 0; j < batch.length; j += 1) {
        embedded.push({ id: batch[j].id, text: batch[j].chunk_text, embedding: vectors[j] });
      }
    } catch (err) {
      const reason = (err && err.message) || 'unknown error';
      for (let j = 0; j < batch.length; j += 1) {
        failed.push({ id: batch[j].id, reason });
      }
    }
    if (onProgress) {
      onProgress({ processed: Math.min(i + batchSize, records.length), total: records.length, embedded: embedded.length, failed: failed.length });
    }
    if (i + batchSize < records.length && throttleMs > 0) {
      await sleep(throttleMs);
    }
  }
  return { embedded, failed };
}

module.exports = { embedBatch, embedAll, DEFAULT_BATCH_SIZE, DEFAULT_THROTTLE_MS };
