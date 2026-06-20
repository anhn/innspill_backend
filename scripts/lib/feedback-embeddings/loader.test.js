'use strict';

const { describe, it } = require('@jest/globals');
const assert = require('node:assert');
const { loadFeedbackRecords } = require('./loader');

function makeFakeModel(submissions) {
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

describe('loadFeedbackRecords', () => {
  it('returns a record for each valid feedbackHistory entry', async () => {
    const subs = [
      {
        _id: 's1',
        taskId: 't1',
        studentId: 'u1',
        feedbackHistory: [
          { feedback: 'A perfectly valid feedback string here.' },
          { feedback: 'Another valid feedback string here.' },
        ],
      },
    ];
    const { records, submissionsScanned } = await loadFeedbackRecords({
      today: '2026-06-21',
      limit: null,
      SubmissionModel: makeFakeModel(subs),
    });
    assert.strictEqual(submissionsScanned, 1);
    assert.strictEqual(records.length, 2);
    assert.strictEqual(records[0].id, 'feedback_s1_0');
    assert.strictEqual(records[1].id, 'feedback_s1_1');
  });

  it('skips entries with empty or short feedback', async () => {
    const subs = [
      {
        _id: 's1',
        feedbackHistory: [
          { feedback: '' },
          { feedback: '   ' },
          { feedback: 'Too short' },
          { feedback: 'This is a long enough feedback string.' },
        ],
      },
    ];
    const { records } = await loadFeedbackRecords({
      today: '2026-06-21',
      limit: null,
      SubmissionModel: makeFakeModel(subs),
    });
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].id, 'feedback_s1_3');
  });

  it('skips submissions with no feedbackHistory', async () => {
    const subs = [
      { _id: 's1' },
      { _id: 's2', feedbackHistory: [] },
    ];
    const { records, submissionsScanned } = await loadFeedbackRecords({
      today: '2026-06-21',
      limit: null,
      SubmissionModel: makeFakeModel(subs),
    });
    assert.strictEqual(records.length, 0);
    assert.strictEqual(submissionsScanned, 2);
  });

  it('respects the limit', async () => {
    const subs = [
      { _id: 's1', feedbackHistory: [{ feedback: 'x'.repeat(30) }] },
      { _id: 's2', feedbackHistory: [{ feedback: 'y'.repeat(30) }] },
      { _id: 's3', feedbackHistory: [{ feedback: 'z'.repeat(30) }] },
    ];
    const { records } = await loadFeedbackRecords({
      today: '2026-06-21',
      limit: 2,
      SubmissionModel: makeFakeModel(subs),
    });
    assert.strictEqual(records.length, 2);
  });
});
