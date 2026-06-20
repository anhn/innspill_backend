'use strict';

const fs = require('node:fs');

const EXPECTED_EMBEDDING_LENGTH = 3072;

function validateOutput(records, embedded) {
  if (!Array.isArray(records) || !Array.isArray(embedded)) {
    throw new Error('validateOutput: records and embedded must be arrays');
  }
  const recordIds = records.map((r) => r.id);
  if (new Set(recordIds).size !== recordIds.length) {
    throw new Error('validateOutput: Duplicate IDs in records');
  }
  const embedIds = embedded.map((e) => e.id);
  if (new Set(embedIds).size !== embedIds.length) {
    throw new Error('validateOutput: Duplicate IDs in embedded');
  }
  for (const e of embedded) {
    if (!Array.isArray(e.embedding) || e.embedding.length !== EXPECTED_EMBEDDING_LENGTH) {
      throw new Error(`validateOutput: Invalid embedding length for ${e.id}: ${e.embedding && e.embedding.length}`);
    }
  }
  const recordSet = new Set(recordIds);
  const embedSet = new Set(embedIds);
  if (recordSet.size !== embedSet.size) {
    throw new Error(`validateOutput: ID set size mismatch (records=${recordSet.size}, embedded=${embedSet.size})`);
  }
  for (const id of recordSet) {
    if (!embedSet.has(id)) {
      throw new Error(`validateOutput: ID mismatch: ${id} present in records but not embedded`);
    }
  }
}

function atomicWrite(filePath, content) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

function writeOutput(records, embedded, paths) {
  if (!paths || !paths.normalized || !paths.embeddings) {
    throw new Error('writeOutput: paths.normalized and paths.embeddings are required');
  }
  validateOutput(records, embedded);
  const jsonl = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const json = JSON.stringify(embedded);
  atomicWrite(paths.normalized, jsonl);
  atomicWrite(paths.embeddings, json);
}

module.exports = { validateOutput, atomicWrite, writeOutput, EXPECTED_EMBEDDING_LENGTH };