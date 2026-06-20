'use strict';

const { describe, it } = require('@jest/globals');
const assert = require('node:assert');
const { composeChunkText, parseSubmissionEntry, buildRecord } = require('./composer');

describe('composeChunkText', () => {
  it('formats a full entry with all fields', () => {
    const entry = {
      concept: 'Recursion',
      feedback: 'You explained the base case well.',
      feedforward: 'Try the recursive case next.',
      reflection: 'How does this differ from iteration?',
      criticalThinking: 'Consider edge cases.',
      taskQualityScore: 4,
      reflectionScore: 3,
      criticalthinkingScore: 4,
      conceptMasteryScore: 5,
    };
    const out = composeChunkText(entry);
    assert.strictEqual(out, [
      'Concept: Recursion',
      'Feedback: You explained the base case well.',
      'Feedforward: Try the recursive case next.',
      'Reflection prompt: How does this differ from iteration?',
      'Critical thinking: Consider edge cases.',
      'Scores: taskQuality=4, reflection=3, criticalthinking=4, conceptMastery=5'
    ].join('\n'));
  });

  it('uses (no concept)/(none)/(n/a) for missing fields', () => {
    const out = composeChunkText({});
    assert.strictEqual(out, [
      'Concept: (no concept)',
      'Feedback: (none)',
      'Feedforward: (none)',
      'Reflection prompt: (none)',
      'Critical thinking: (none)',
      'Scores: taskQuality=n/a, reflection=n/a, criticalthinking=n/a, conceptMastery=n/a'
    ].join('\n'));
  });

  it('does not crash on null entry', () => {
    const out = composeChunkText(null);
    assert.ok(out.includes('Concept: (no concept)'));
    assert.ok(out.includes('taskQuality=n/a'));
  });
});

describe('parseSubmissionEntry', () => {
  it('returns null when feedback is empty', () => {
    const sub = { feedbackHistory: [{ feedback: '' }] };
    assert.strictEqual(parseSubmissionEntry(sub, 0), null);
  });

  it('returns null when feedback is whitespace only', () => {
    const sub = { feedbackHistory: [{ feedback: '   \n  ' }] };
    assert.strictEqual(parseSubmissionEntry(sub, 0), null);
  });

  it('returns null when feedback is shorter than 20 chars', () => {
    const sub = { feedbackHistory: [{ feedback: 'Too short' }] };
    assert.strictEqual(parseSubmissionEntry(sub, 0), null);
  });

  it('returns the parsed entry when feedback is long enough', () => {
    const sub = { feedbackHistory: [{ feedback: 'This is a long enough feedback string.' }] };
    const out = parseSubmissionEntry(sub, 0);
    assert.ok(out);
    assert.strictEqual(out.entryIndex, 0);
    assert.strictEqual(out.entry.feedback, 'This is a long enough feedback string.');
  });

  it('returns null when submission has no feedbackHistory', () => {
    assert.strictEqual(parseSubmissionEntry({}, 0), null);
    assert.strictEqual(parseSubmissionEntry({ feedbackHistory: [] }, 0), null);
  });
});

describe('buildRecord', () => {
  it('produces a record with the spec fields', () => {
    const sub = { _id: 'sub1', taskId: 'task1', studentId: 'stu1', feedbackHistory: [{}] };
    const entry = {
      concept: 'Sorting',
      feedback: 'You picked the right algorithm.',
      feedforward: 'Analyze complexity next time.',
      reflection: 'When would merge sort be better?',
      criticalThinking: 'Edge cases on duplicates.',
      taskQualityScore: 5,
      reflectionScore: 4,
      criticalthinkingScore: 4,
      conceptMasteryScore: 5,
      stakeholderId: 'sh1',
      createdAt: new Date('2026-04-12T10:00:00Z'),
    };
    const rec = buildRecord(sub, entry, 0, '2026-06-21');
    assert.strictEqual(rec.id, 'feedback_sub1_0');
    assert.strictEqual(rec.source_type, 'approved_feedback');
    assert.strictEqual(rec.submission_id, 'sub1');
    assert.strictEqual(rec.task_id, 'task1');
    assert.strictEqual(rec.student_id, 'stu1');
    assert.strictEqual(rec.concept, 'Sorting');
    assert.strictEqual(rec.task_quality_score, 5);
    assert.deepStrictEqual(rec.tags, ['approved_feedback']);
    assert.strictEqual(rec.intended_use, 'feedback_example');
    assert.strictEqual(rec.version, '2026-06-21');
    assert.strictEqual(rec.language, 'en');
    assert.strictEqual(rec.embedding_model, 'text-embedding-3-large');
    assert.ok(rec.chunk_text.includes('Concept: Sorting'));
    assert.strictEqual(rec.feedback_created_at, '2026-04-12T10:00:00.000Z');
  });

  it('nulls out missing numeric scores', () => {
    const sub = { _id: 's', feedbackHistory: [{}] };
    const rec = buildRecord(sub, { feedback: 'x'.repeat(30) }, 0, '2026-06-21');
    assert.strictEqual(rec.task_quality_score, null);
    assert.strictEqual(rec.reflection_score, null);
  });
});
