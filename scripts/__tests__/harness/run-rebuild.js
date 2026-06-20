'use strict';

// Test harness: runs the same code path as scripts/rebuild-feedback-embeddings.js
// but with dependency-injected fakes. Used by integration tests only.

const path = require('node:path');
const { loadFeedbackRecords } = require('../../lib/feedback-embeddings/loader');
const { embedAll } = require('../../lib/feedback-embeddings/embedder');
const { writeOutput } = require('../../lib/feedback-embeddings/writer');

function fakeVector(seed) {
  return new Array(3072).fill(0).map((_, i) => (seed + i) % 1);
}

function makeFakeSubmissionModel() {
  const submissions = [
    {
      _id: 'sub1',
      taskId: 'task1',
      studentId: 'stu1',
      feedbackHistory: [
        { feedback: 'You explained the base case very clearly. Good job!', concept: 'Recursion', taskQualityScore: 4, conceptMasteryScore: 5 },
        { feedback: 'Try to articulate the time complexity next time.', concept: 'Complexity', taskQualityScore: 3 },
      ],
    },
    {
      _id: 'sub2',
      taskId: 'task2',
      studentId: 'stu2',
      feedbackHistory: [
        { feedback: 'Great analysis of sorting algorithms overall.', concept: 'Sorting' },
        { feedback: 'Too short', taskQualityScore: 5 }, // skipped (too short)
        { feedback: '', taskQualityScore: 1 }, // skipped (empty)
      ],
    },
    {
      _id: 'sub3',
      taskId: 'task3',
      studentId: 'stu3',
      feedbackHistory: [
        { feedback: 'Consider using a heap for priority queue operations.', concept: 'Heaps', reflectionScore: 4 },
        { feedback: 'Your BFS traversal implementation was correct and efficient.', concept: 'BFS' },
        { feedback: 'Try dynamic programming for the optimization problem.', concept: 'DP', taskQualityScore: 5 },
      ],
    },
  ];
  return {
    find() {
      return {
        lean() {
          return {
            cursor() {
              return {
                async *[Symbol.asyncIterator]() {
                  for (const s of submissions) yield s;
                },
              };
            },
          };
        },
      };
    },
  };
}

function makeFakeOpenAIClient() {
  return {
    embeddings: {
      async create({ input }) {
        return { data: input.map((_, i) => ({ embedding: fakeVector(i) })) };
      },
    },
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  return {
    dryRun: args.includes('--dry-run'),
    limit: get('--limit') ? Number.parseInt(get('--limit'), 10) : null,
    normalized: get('--normalized'),
    embeddings: get('--embeddings'),
  };
}

async function main() {
  const { dryRun, limit, normalized, embeddings } = parseArgs();
  const today = new Date().toISOString().slice(0, 10);

  const SubmissionModel = makeFakeSubmissionModel();
  const { records, submissionsScanned } = await loadFeedbackRecords({ today, limit, SubmissionModel });
  if (records.length === 0) {
    console.log(JSON.stringify({ ok: true, kept: 0 }));
    return;
  }
  const client = makeFakeOpenAIClient();
  const { embedded, failed } = await embedAll(records, { client, model: 'text-embedding-3-large', batchSize: 100, throttleMs: 0 });
  if (dryRun) {
    console.log(JSON.stringify({ ok: true, kept: records.length, embedded: embedded.length, failed: failed.length, dryRun: true }));
    return;
  }
  writeOutput(records, embedded, { normalized, embeddings });
  console.log(JSON.stringify({ ok: true, kept: records.length, embedded: embedded.length, failed: failed.length }));
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});