#!/usr/bin/env node
'use strict';

const path = require('node:path');
const OpenAI = require('openai');
const { connectDB, mongoose } = require('../src/config/database');
const Submission = require('../src/models/Submission');
const { loadFeedbackRecords } = require('./lib/feedback-embeddings/loader');
const { embedAll } = require('./lib/feedback-embeddings/embedder');
const { writeOutput } = require('./lib/feedback-embeddings/writer');

const EMBEDDING_MODEL = process.env.RAG_EMBEDDING_MODEL || 'text-embedding-3-large';
const MODELS_DIR = path.join(__dirname, '..', 'src', 'models');
const DEFAULT_NORMALIZED = path.join(MODELS_DIR, 'FeedbackEmbeddings.normalized.jsonl');
const DEFAULT_EMBEDDINGS = path.join(MODELS_DIR, 'FeedbackEmbeddings.json');

function parseArgs(argv) {
  const args = argv.slice(2);
  const valueAfter = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0 || i + 1 >= args.length) return null;
    return args[i + 1];
  };
  return {
    dryRun: args.includes('--dry-run'),
    limit: (() => {
      const v = valueAfter('--limit');
      return v ? Number.parseInt(v, 10) : null;
    })(),
  };
}

async function main() {
  const startMs = Date.now();
  const { dryRun, limit } = parseArgs(process.argv);
  const today = new Date().toISOString().slice(0, 10);

  console.log(`[rebuild] model=${EMBEDDING_MODEL} dryRun=${dryRun} limit=${limit === null ? 'none' : limit}`);

  await connectDB();
  console.log('[rebuild] Connected to MongoDB');

  const { records, submissionsScanned } = await loadFeedbackRecords({ today, limit, SubmissionModel: Submission });
  console.log(`[rebuild] Scanned ${submissionsScanned} submissions, kept ${records.length} records`);

  if (records.length === 0) {
    console.log(JSON.stringify({ ok: true, scanned: submissionsScanned, kept: 0, embedded: 0, failed: 0, durationMs: Date.now() - startMs }));
    try { await mongoose.connection.close(); } catch (_) { /* ignore */ }
    return;
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { embedded, failed } = await embedAll(records, {
    client,
    model: EMBEDDING_MODEL,
    onProgress: ({ processed, total }) => {
      console.log(`[rebuild] Progress ${processed}/${total}`);
    },
  });
  console.log(`[rebuild] Embedded: ${embedded.length}, Failed: ${failed.length}`);

  if (dryRun) {
    console.log('[rebuild] Dry run, not writing files');
  } else {
    writeOutput(records, embedded, { normalized: DEFAULT_NORMALIZED, embeddings: DEFAULT_EMBEDDINGS });
    console.log(`[rebuild] Wrote ${DEFAULT_NORMALIZED}`);
    console.log(`[rebuild] Wrote ${DEFAULT_EMBEDDINGS}`);
  }

  console.log(JSON.stringify({
    ok: true,
    scanned: submissionsScanned,
    kept: records.length,
    embedded: embedded.length,
    failed: failed.length,
    durationMs: Date.now() - startMs,
  }));
  try { await mongoose.connection.close(); } catch (_) { /* ignore */ }
}

main().catch(async (err) => {
  console.error('[rebuild] Fatal:', err.stack || err.message);
  try { await mongoose.connection.close(); } catch (_) { /* ignore */ }
  process.exit(1);
});