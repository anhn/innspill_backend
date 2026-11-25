const express = require('express');
const mongoose = require('mongoose');
const Submission = require('../../models/Submission');
const Task = require('../../models/Task');
const { requireRole } = require('../../middleware/auth');
const { assess } = require('../../assessment');
const { requireCourseStaff } = require('../../middleware/courseAccess');
const actionLoggingMiddleware = require('../../middleware/actionLogging');
const { trackRoute } = require('../../utils/activity');
const onSubmission = (event, data = () => ({})) => trackRoute(event, (req, body) => ({ taskId: req.loadedSubmission?.taskId ? String(req.loadedSubmission.taskId) : undefined, submissionId: req.params.id, data: { student: req.loadedSubmission?.studentId, attempt: req.loadedSubmission?.attemptNumber, ...data(req, body) } }));

/**
 * POST /:id/assess — run the automated assessment for one hand-in and keep it on the submission.
 * Hand-ins are also assessed in the background when they arrive (see assessInBackground).
 */
const router = express.Router();

function orderOf(task) {
  return task?.order || (task?.taskTitle || '').match(/(\d\.\d)/)?.[1] || null;
}

async function assessSubmission(submission) {
  const task = await Task.findById(submission.taskId);
  const order = orderOf(task);
  if (!order) return null;
  const related = {};
  if (order === '2.3') {
    // Bug fixing is checked against the true problems the group labelled in 2.2.
    const t22 = await Task.findOne({ projectId: task.projectId, order: '2.2' });
    if (t22) {
      const prior = await Submission.findOne({ taskId: t22._id, studentId: submission.studentId }).sort({ attemptNumber: -1, createdAt: -1 });
      if (prior) related['2.2'] = { conversationLog: prior.conversationLog };
    }
  }
  const result = await assess(order, {
    text: submission.submission || '',
    parts: submission.parts || [],
    conversationLog: submission.conversationLog || '',
    related,
    task: { order, criteria: task.evaluationCriteria || '' },
  });
  if (!result) return null;
  submission.assessment = result;
  submission.markModified('assessment');
  await submission.save();
  return result;
}

function assessInBackground(id) {
  setImmediate(async () => {
    try {
      const submission = await Submission.findById(id);
      if (submission) await assessSubmission(submission);
    } catch (error) {
      console.error('❌ Background assessment failed:', error.message);
    }
  });
}

router.post('/:id/assess', requireRole('teacher', 'admin', 'school'), requireCourseStaff({ submission: 'id' }), onSubmission('run-checks', (req, body) => ({ score: body?.data?.suggested?.score, tokens: body?.data?.tokens, flags: (body?.data?.flags || []).length })), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid submission ID format' });
    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });
    const result = await assessSubmission(submission);
    if (!result) return res.status(400).json({ success: false, message: 'This task has no automated assessment.' });
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ Error assessing submission:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to assess the hand-in', error: process.env.NODE_ENV !== 'production' ? error.message : undefined });
  }
});

/**
 * POST /:id/reset-review — start the review of a hand-in over: remove the automated
 * assessment and, while no decision is sent, the AI drafts, the comments and the
 * draft feedback. A decided hand-in keeps what the student has already received.
 */
router.post('/:id/reset-review', requireRole('teacher', 'admin', 'school'), requireCourseStaff({ submission: 'id' }), actionLoggingMiddleware('reset-review'), onSubmission('reset-review'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid submission ID format' });
    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });
    const decided = submission.decisionStatus === 'approved' || submission.decisionStatus === 'returned';
    submission.assessment = undefined;
    if (!decided) {
      submission.feedbackHistory = [];
      submission.reviewComments = [];
      submission.feedbackHtml = '';
    }
    await submission.save();
    return res.json({ success: true, data: { decided } });
  } catch (error) {
    console.error('❌ Error resetting review:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to reset the review' });
  }
});

module.exports = router;
module.exports.assessSubmission = assessSubmission;
module.exports.assessInBackground = assessInBackground;
