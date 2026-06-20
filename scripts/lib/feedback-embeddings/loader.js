'use strict';

const { parseSubmissionEntry, buildRecord } = require('./composer');

async function loadFeedbackRecords({ today, limit = null, SubmissionModel }) {
  if (!SubmissionModel) {
    throw new Error('loadFeedbackRecords: SubmissionModel is required');
  }
  const cursor = SubmissionModel.find(
    { 'feedbackHistory.0': { $exists: true } },
    'taskId studentId feedbackHistory'
  ).lean().cursor();

  const records = [];
  let submissionsScanned = 0;
  for await (const submission of cursor) {
    submissionsScanned += 1;
    const history = submission.feedbackHistory || [];
    for (let i = 0; i < history.length; i += 1) {
      if (limit !== null && records.length >= limit) {
        return { records, submissionsScanned };
      }
      const parsed = parseSubmissionEntry(submission, i);
      if (!parsed) continue;
      records.push(buildRecord(submission, parsed.entry, i, today));
    }
  }
  return { records, submissionsScanned };
}

module.exports = { loadFeedbackRecords };
