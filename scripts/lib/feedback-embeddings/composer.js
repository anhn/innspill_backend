'use strict';

const MIN_FEEDBACK_LENGTH = 20;

function safeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function composeChunkText(entry) {
  const concept = safeText(entry?.concept) || '(no concept)';
  const feedback = safeText(entry?.feedback) || '(none)';
  const feedforward = safeText(entry?.feedforward) || '(none)';
  const reflection = safeText(entry?.reflection) || '(none)';
  const criticalThinking = safeText(entry?.criticalThinking) || '(none)';
  const score = (n) => (typeof n === 'number' && !Number.isNaN(n)) ? String(n) : 'n/a';
  return [
    `Concept: ${concept}`,
    `Feedback: ${feedback}`,
    `Feedforward: ${feedforward}`,
    `Reflection prompt: ${reflection}`,
    `Critical thinking: ${criticalThinking}`,
    `Scores: taskQuality=${score(entry?.taskQualityScore)}, reflection=${score(entry?.reflectionScore)}, criticalthinking=${score(entry?.criticalthinkingScore)}, conceptMastery=${score(entry?.conceptMasteryScore)}`
  ].join('\n');
}

function parseSubmissionEntry(submission, entryIndex) {
  const entry = submission?.feedbackHistory?.[entryIndex];
  if (!entry || typeof entry.feedback !== 'string') return null;
  const trimmed = entry.feedback.trim();
  if (!trimmed || trimmed.length < MIN_FEEDBACK_LENGTH) return null;
  return { submission, entryIndex, entry };
}

function buildRecord(submission, entry, entryIndex, today) {
  const submissionId = submission._id ? String(submission._id) : null;
  const taskId = submission.taskId ? String(submission.taskId) : null;
  const stakeholderId = entry.stakeholderId ? String(entry.stakeholderId) : null;
  const createdAt = entry.createdAt ? new Date(entry.createdAt).toISOString() : null;
  const scoreOrNull = (n) => (typeof n === 'number' && !Number.isNaN(n)) ? n : null;
  return {
    id: `feedback_${submissionId}_${entryIndex}`,
    source_type: 'approved_feedback',
    submission_id: submissionId,
    task_id: taskId,
    student_id: submission.studentId ? String(submission.studentId) : null,
    concept: safeText(entry.concept),
    task_quality_score: scoreOrNull(entry.taskQualityScore),
    reflection_score: scoreOrNull(entry.reflectionScore),
    criticalthinking_score: scoreOrNull(entry.criticalthinkingScore),
    concept_mastery_score: scoreOrNull(entry.conceptMasteryScore),
    stakeholder_id: stakeholderId,
    feedback_created_at: createdAt,
    tags: ['approved_feedback'],
    intended_use: 'feedback_example',
    version: today,
    language: 'en',
    chunk_text: composeChunkText(entry),
    embedding_model: process.env.RAG_EMBEDDING_MODEL || 'text-embedding-3-large',
  };
}

module.exports = { composeChunkText, parseSubmissionEntry, buildRecord };
