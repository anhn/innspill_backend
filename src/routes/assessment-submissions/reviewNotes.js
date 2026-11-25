const express = require('express');
const mongoose = require('mongoose');
const Joi = require('joi');
const Submission = require('../../models/Submission');
const { isOptionalAuth, requireRole } = require('../../middleware/auth');
const { actingUsername, actingRole, isStaffRole } = require('../../middleware/requestIdentity');
const { sanitizeFeedbackHtml, notesView, commentView } = require('../../utils/reviewNotes');
const { requireCourseStaff, canReadSubmission } = require('../../middleware/courseAccess');
const { trackRoute } = require('../../utils/activity');
const note = (event, data = () => ({})) => trackRoute(event, (req, body) => ({ taskId: req.loadedSubmission?.taskId ? String(req.loadedSubmission.taskId) : undefined, submissionId: req.params.id, data: { student: req.loadedSubmission?.studentId, ...data(req, body) } }));

/**
 * Review notes on one submission (2027 teacher review page).
 *   GET    /:id/review-notes                 teacher, or the student who handed in
 *   PUT    /:id/review-notes                 teacher: { feedbackHtml }
 *   POST   /:id/comments                     teacher: { quote, prefix, suffix, text }
 *   PATCH  /:id/comments/:commentId          teacher: { text?, resolved? }
 *   DELETE /:id/comments/:commentId          teacher
 *   POST   /:id/comments/:commentId/replies  teacher or the student: { text }
 */
const router = express.Router();
// A teacher of the hand-in's course (or an admin).
const staffOnly = [requireRole('teacher', 'admin', 'school'), requireCourseStaff({ submission: 'id' })];

async function load(req, res) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(400).json({ success: false, message: 'Invalid submission ID format' });
    return null;
  }
  const submission = await Submission.findById(req.params.id);
  if (!submission) {
    res.status(404).json({ success: false, message: 'Submission not found' });
    return null;
  }
  return submission;
}

/** The student who handed it in, or a teacher of its course. */
function canRead(req, submission) {
  return canReadSubmission(req, submission);
}

function findComment(submission, commentId, res) {
  const comment = (submission.reviewComments || []).find((item) => item._id.toString() === commentId);
  if (!comment) res.status(404).json({ success: false, message: 'Comment not found' });
  return comment;
}

function bad(res, error) {
  return res.status(400).json({ success: false, message: 'Invalid request body', error: error.details[0].message });
}

function fail(res, error, what) {
  console.error(`❌ Error ${what}:`, error.message);
  return res.status(500).json({
    success: false,
    message: `Failed ${what}`,
    error: process.env.NODE_ENV !== 'production' ? error.message : undefined,
  });
}

router.get('/:id/review-notes', isOptionalAuth, note('view-comments'), async (req, res) => {
  try {
    const submission = await load(req, res);
    if (!submission) return;
    if (!(await canRead(req, submission))) return res.status(403).json({ success: false, message: 'Forbidden' });
    // Students see the notes once the teacher has sent a decision; until then they are a draft.
    const decided = submission.decisionStatus === 'approved' || submission.decisionStatus === 'returned';
    if (!isStaffRole(actingRole(req)) && !decided) {
      return res.json({ success: true, data: { id: submission._id.toString(), comments: [], feedbackHtml: '' } });
    }
    return res.json({ success: true, data: notesView(submission) });
  } catch (error) {
    return fail(res, error, 'loading review notes');
  }
});

router.put('/:id/review-notes', staffOnly, note('feedback-edit', (req) => ({ chars: String(req.body.feedbackHtml || '').length })), async (req, res) => {
  try {
    const { error, value } = Joi.object({ feedbackHtml: Joi.string().allow('').max(100000).required() }).validate(req.body);
    if (error) return bad(res, error);
    const submission = await load(req, res);
    if (!submission) return;
    submission.feedbackHtml = sanitizeFeedbackHtml(value.feedbackHtml);
    await submission.save();
    return res.json({ success: true, data: notesView(submission) });
  } catch (error) {
    return fail(res, error, 'saving feedback');
  }
});

router.post('/:id/comments', staffOnly, note('comment-add', (req) => ({ quote: req.body.quote, text: req.body.text })), async (req, res) => {
  try {
    const { error, value } = Joi.object({
      quote: Joi.string().trim().min(1).max(2000).required(),
      prefix: Joi.string().allow('').max(200).default(''),
      suffix: Joi.string().allow('').max(200).default(''),
      text: Joi.string().trim().min(1).max(5000).required(),
    }).validate(req.body);
    if (error) return bad(res, error);
    const submission = await load(req, res);
    if (!submission) return;
    if (!submission.reviewComments) submission.reviewComments = [];
    submission.reviewComments.push({
      ...value,
      author: actingUsername(req) || 'teacher',
      authorRole: 'teacher',
      createdAt: new Date(),
      replies: [],
    });
    await submission.save();
    const created = submission.reviewComments[submission.reviewComments.length - 1];
    return res.status(201).json({ success: true, data: commentView(created) });
  } catch (error) {
    return fail(res, error, 'adding comment');
  }
});

router.patch('/:id/comments/:commentId', staffOnly, note('comment-edit', (req) => ({ comment: req.params.commentId, text: req.body.text, resolved: req.body.resolved })), async (req, res) => {
  try {
    const { error, value } = Joi.object({
      text: Joi.string().trim().min(1).max(5000),
      resolved: Joi.boolean(),
    }).min(1).validate(req.body);
    if (error) return bad(res, error);
    const submission = await load(req, res);
    if (!submission) return;
    const comment = findComment(submission, req.params.commentId, res);
    if (!comment) return;
    if (value.text !== undefined) comment.text = value.text;
    if (value.resolved !== undefined) comment.resolved = value.resolved;
    await submission.save();
    return res.json({ success: true, data: commentView(comment) });
  } catch (error) {
    return fail(res, error, 'updating comment');
  }
});

router.delete('/:id/comments/:commentId', staffOnly, note('comment-delete', (req) => ({ comment: req.params.commentId })), async (req, res) => {
  try {
    const submission = await load(req, res);
    if (!submission) return;
    const comment = findComment(submission, req.params.commentId, res);
    if (!comment) return;
    submission.reviewComments = submission.reviewComments.filter((item) => item !== comment);
    await submission.save();
    return res.json({ success: true, data: notesView(submission) });
  } catch (error) {
    return fail(res, error, 'deleting comment');
  }
});

router.post('/:id/comments/:commentId/replies', isOptionalAuth, note('comment-reply', (req) => ({ comment: req.params.commentId, text: req.body.text })), async (req, res) => {
  try {
    const { error, value } = Joi.object({ text: Joi.string().trim().min(1).max(5000).required() }).validate(req.body);
    if (error) return bad(res, error);
    const submission = await load(req, res);
    if (!submission) return;
    if (!(await canRead(req, submission))) return res.status(403).json({ success: false, message: 'Forbidden' });
    const decided = submission.decisionStatus === 'approved' || submission.decisionStatus === 'returned';
    if (!isStaffRole(actingRole(req)) && !decided) return res.status(403).json({ success: false, message: 'Forbidden' });
    const comment = findComment(submission, req.params.commentId, res);
    if (!comment) return;
    if (!comment.replies) comment.replies = [];
    comment.replies.push({
      text: value.text,
      author: actingUsername(req) || 'unknown',
      authorRole: isStaffRole(actingRole(req)) ? 'teacher' : 'student',
      createdAt: new Date(),
    });
    await submission.save();
    return res.status(201).json({ success: true, data: commentView(comment) });
  } catch (error) {
    return fail(res, error, 'adding reply');
  }
});

module.exports = router;
