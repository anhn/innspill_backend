/**
 * 2027 course-home rules.
 *
 * New fields are optional and have no defaults. Loading or saving a 2026
 * document does not write them. Late and the review queue are computed
 * in the response. They are not stored on old rows.
 */

const Joi = require('joi');

const OSLO = 'Europe/Oslo';

const courseConfigSchema = Joi.object({
  id: Joi.string().trim().required(),
  title: Joi.string().trim().required(),
  language: Joi.string().valid('en', 'nb').required(),
  structure: Joi.object({
    kind: Joi.string().valid('exercises', 'phases').required(),
    groups: Joi.array().items(
      Joi.object({
        id: Joi.string().trim().required(),
        title: Joi.string().trim().required(),
        taskIds: Joi.array().items(Joi.string().trim()).required(),
      }).unknown(true)
    ).required(),
  }).unknown(true).required(),
  tools: Joi.array().items(Joi.string().trim()).required(),
  personas: Joi.array().items(Joi.string().trim()).default([]),
  grading: Joi.string().valid('approve', 'score').required(),
  about: Joi.array().items(Joi.string().allow('')).default([]),
}).unknown(true);

function osloParts(instant) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: OSLO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Milliseconds to add to a UTC instant to get the Europe/Oslo wall clock. */
function osloOffsetMs(instant) {
  const parts = osloParts(instant);
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return wallAsUtc - instant.getTime();
}

/**
 * 23:59:59.999 on the Europe/Oslo calendar day that contains `instant`.
 * A deadline today is not late until that instant has passed.
 */
function endOfOsloDay(instant) {
  const parts = osloParts(instant);
  const noonUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
  const offset = osloOffsetMs(noonUtc);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 23, 59, 59, 999) - offset);
}

/**
 * Late only when nothing has been submitted and the deadline day
 * (or the revised day) has ended in Europe/Oslo.
 * A submitted task stays submitted, approved, or returned.
 */
function deriveTaskStatus(task, now = new Date()) {
  if (task.submittedAt) {
    if (task.approval === 'approved') return 'approved';
    if (task.approval === 'returned') return 'returned';
    return 'submitted';
  }
  const due = task.revisedDeadline || task.deadline;
  if (!due) return 'open';
  const dueDate = new Date(due);
  if (Number.isNaN(dueDate.getTime())) return 'open';
  if (now.getTime() > endOfOsloDay(dueDate).getTime()) return 'late';
  return 'open';
}

function daysWaiting(from, now = new Date()) {
  if (!from) return 0;
  const start = new Date(from).getTime();
  if (Number.isNaN(start)) return 0;
  const elapsed = now.getTime() - start;
  if (elapsed <= 0) return 0;
  return Math.floor(elapsed / 86400000);
}

function hasLegacyGrade(submission) {
  const history = submission.feedbackHistory || [];
  const latest = history.length ? history[history.length - 1] : null;
  const scored = latest && (
    (latest.taskQualityScore !== null && latest.taskQualityScore !== undefined && latest.taskQualityScore !== '') ||
    (latest.reflectionScore !== null && latest.reflectionScore !== undefined)
  );
  const starred = Array.isArray(submission.starScoreHistory) && submission.starScoreHistory.length > 0;
  return Boolean(scored || starred);
}

/**
 * Queue view for one submission. Stored decision wins.
 * A 2026 submission that already has a feedback score is left as null
 * so it is not relabelled "waiting". An ungraded submission is waiting.
 * Nothing is written back.
 */
/** The decisions sent so far, oldest first. Decisions from before the log existed get one entry. */
function decisionLog(submission, stored) {
  const log = (submission.decisionLog || []).map((e) => ({
    status: e.status, score: e.score ?? null, reflection: e.reflection ?? null, at: e.at || null, by: e.by || null,
    comment: e.comment || '', feedbackHtml: e.feedbackHtml || '', comments: e.comments ?? null,
  }));
  if (log.length || (stored !== 'approved' && stored !== 'returned')) return log;
  const last = [...(submission.feedbackHistory || [])].reverse().find((f) => !submission.decidedAt || !f.createdAt || new Date(f.createdAt) >= new Date(submission.decidedAt) - 5000);
  return [{
    status: stored, score: submission.score ?? null, reflection: submission.reflection ?? null, at: submission.decidedAt || null, by: submission.decidedBy || null,
    comment: last?.feedback || '', feedbackHtml: submission.feedbackHtml || '', comments: (submission.reviewComments || []).length,
  }];
}

function decisionFields(submission, now = new Date()) {
  const empty = {
    decision: {
      status: null,
      score: null,
      reflection: null,
      daysWaiting: null,
      decidedAt: null,
      decidedBy: null,
    },
  };
  if (!submission) return empty;

  const stored = submission.decisionStatus;
  if (stored === 'approved' || stored === 'returned' || stored === 'waiting') {
    return {
      decision: {
        status: stored,
        score: submission.score ?? null,
        reflection: submission.reflection ?? null,
        daysWaiting: stored === 'waiting'
          ? daysWaiting(submission.datetime || submission.createdAt, now)
          : 0,
        decidedAt: submission.decidedAt || null,
        decidedBy: submission.decidedBy || null,
        log: decisionLog(submission, stored),
      },
    };
  }

  if (hasLegacyGrade(submission)) return empty;

  return {
    decision: {
      status: 'waiting',
      score: null,
      reflection: null,
      daysWaiting: daysWaiting(submission.datetime || submission.createdAt, now),
      decidedAt: null,
      decidedBy: null,
    },
  };
}

/**
 * One status per task for a group. Submissions already stored without a
 * decision stay submitted, never late. `publishStatus` is the draft flag
 * already on the task. It is not the student-facing status.
 */
function buildGroupTaskStatuses(tasks, submissions, progressRows, now = new Date()) {
  const latestByTask = new Map();
  for (const submission of submissions || []) {
    const taskId = submission.taskId ? String(submission.taskId) : '';
    if (!taskId) continue;
    const at = new Date(submission.datetime || submission.createdAt || 0).getTime();
    const previous = latestByTask.get(taskId);
    if (!previous || at >= previous.at) latestByTask.set(taskId, { at, submission });
  }

  const started = new Set((progressRows || []).map((row) => String(row.taskId)));

  return (tasks || []).map((task) => {
    const taskId = String(task._id);
    const hit = latestByTask.get(taskId);
    const submittedAt = hit ? (hit.submission.datetime || hit.submission.createdAt || null) : null;
    const stored = hit ? hit.submission.decisionStatus : null;
    const approval = stored === 'approved' || stored === 'returned' ? stored : null;
    const status = deriveTaskStatus({
      submittedAt,
      deadline: task.submissionDeadline,
      revisedDeadline: task.revisedDeadline,
      approval,
    }, now);

    return {
      taskId,
      order: task.order || null,
      why: task.why || null,
      tool: task.tool || null,
      deadline: task.submissionDeadline || null,
      revisedDeadline: task.revisedDeadline || null,
      submittedAt,
      publishStatus: task.status || null,
      status,
      inProgress: Boolean(!submittedAt && started.has(taskId)),
      score: hit && hit.submission.score != null ? hit.submission.score : null,
      reflection: hit && hit.submission.reflection != null ? hit.submission.reflection : null,
      daysWaiting: status === 'submitted' ? daysWaiting(submittedAt, now) : 0,
    };
  });
}

module.exports = {
  courseConfigSchema,
  endOfOsloDay,
  deriveTaskStatus,
  daysWaiting,
  decisionFields,
  buildGroupTaskStatuses,
};
