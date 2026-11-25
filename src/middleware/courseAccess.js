/**
 * Course-scoped access to hand-ins and tasks.
 *
 * - A student may read and act on their own hand-ins only.
 * - A teacher may act on hand-ins and tasks of courses they teach: their username, e-mail
 *   or user id is in the course's teacherIds (or the legacy course.teacherId / project.teacherId).
 * - An admin may act on everything.
 *
 * A course with no teacher listed at all is a legacy course: any staff account may act on it,
 * as before, and a warning is logged once so it can be fixed.
 */
const mongoose = require('mongoose');
const Submission = require('../models/Submission');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Course = require('../models/Course');
const Role = require('../models/Role');
const { actingUsername, actingRole, isStaffRole } = require('./requestIdentity');

const TTL = 60 * 1000;
const staffCache = new Map(); // projectId -> { at, staff: Set<string> | null }
const warned = new Set();

const norm = (v) => String(v || '').trim().toLowerCase();

function identities(req) {
  const ids = [req.user?.username, req.session?.username, req.user?.email, req.session?.userEmail, req.session?.userId, req.user?.id];
  return new Set(ids.filter(Boolean).map(norm));
}

/** The staff of a project's course, or null when none is listed (legacy course). */
async function projectStaff(projectId) {
  const key = String(projectId);
  const hit = staffCache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.staff;
  let staff = null;
  const project = mongoose.Types.ObjectId.isValid(key) ? await Project.findById(key).lean() : null;
  if (project) {
    const course = project.courseId && mongoose.Types.ObjectId.isValid(String(project.courseId)) ? await Course.findById(project.courseId).lean() : null;
    const list = [...(course?.teacherIds || []), course?.teacherId, project.teacherId].filter(Boolean).map(norm);
    staff = list.length ? new Set(list) : null;
    if (!staff && !warned.has(key)) {
      warned.add(key);
      console.warn(`⚠️ Project ${key} has no teachers listed on its course; any staff account can act on it.`);
    }
  }
  staffCache.set(key, { at: Date.now(), staff });
  return staff;
}

async function canStaffProject(req, projectId) {
  const role = actingRole(req);
  if (role === 'admin') return true;
  if (!isStaffRole(role) || !projectId) return false;
  const staff = await projectStaff(projectId);
  if (staff === null) return true;
  for (const id of identities(req)) if (staff.has(id)) return true;
  return false;
}

async function projectOfTask(taskOrId) {
  if (!taskOrId) return null;
  if (taskOrId.projectId) return taskOrId.projectId;
  if (!mongoose.Types.ObjectId.isValid(String(taskOrId))) return null;
  const task = await Task.findById(taskOrId).select('projectId').lean();
  return task?.projectId || null;
}

async function canStaffTask(req, taskOrId) {
  return canStaffProject(req, await projectOfTask(taskOrId));
}

async function canStaffSubmission(req, submission) {
  return submission ? canStaffTask(req, submission.taskId) : false;
}

const isOwner = (req, submission) => {
  const self = actingUsername(req);
  return !!self && !!submission && submission.studentId === self;
};

/** The student who handed it in, or a teacher of its course. */
async function canReadSubmission(req, submission) {
  if (!submission) return false;
  if (isOwner(req, submission)) return true;
  return canStaffSubmission(req, submission);
}

const forbidden = (res) => res.status(403).json({ success: false, message: 'Forbidden' });

async function loadSubmission(req, res, param) {
  const id = req.params[param];
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ success: false, message: 'Invalid submission ID format' });
    return null;
  }
  const submission = await Submission.findById(id);
  if (!submission) {
    res.status(404).json({ success: false, message: 'Submission not found' });
    return null;
  }
  return submission;
}

/**
 * Middleware. `who` is 'staff' (a teacher of the course) or 'owner-or-staff'.
 * The scope is a hand-in (`submission: 'id'`), a task, a project or a stakeholder role,
 * taken from req.params.
 */
function requireAccess(who, scope) {
  return async (req, res, next) => {
    try {
      if (scope.submission) {
        const submission = await loadSubmission(req, res, scope.submission);
        if (!submission) return;
        const ok = who === 'owner-or-staff' ? await canReadSubmission(req, submission) : await canStaffSubmission(req, submission);
        if (!ok) return forbidden(res);
        req.loadedSubmission = submission;
        return next();
      }
      let projectId = null;
      if (scope.task) projectId = await projectOfTask(req.params[scope.task]);
      if (scope.project) projectId = req.params[scope.project];
      if (scope.stakeholder) {
        const id = req.params[scope.stakeholder];
        const role = mongoose.Types.ObjectId.isValid(id) ? await Role.findById(id).select('projectId').lean() : null;
        projectId = role?.projectId || null;
      }
      if (!projectId) return res.status(404).json({ success: false, message: 'Not found' });
      if (!(await canStaffProject(req, projectId))) return forbidden(res);
      return next();
    } catch (error) {
      console.error('❌ Access check failed:', error.message);
      return res.status(500).json({ success: false, message: 'Access check failed' });
    }
  };
}

const requireCourseStaff = (scope) => requireAccess('staff', scope);
const requireOwnerOrCourseStaff = (scope) => requireAccess('owner-or-staff', scope);

/** Each of these task ids must belong to a course the user teaches. */
async function canStaffTasks(req, taskIds) {
  for (const id of taskIds) if (!(await canStaffTask(req, id))) return false;
  return true;
}

/**
 * What a student sees of their own hand-in: no automated assessment and no AI drafts.
 * Before a decision, nothing from feedbackHistory; after it, only the entries the teacher sent.
 */
function studentView(item) {
  if (!item || typeof item !== 'object' || !('feedbackHistory' in item || 'assessment' in item)) return item;
  const out = { ...item, assessment: null };
  const decided = item.decision?.status === 'approved' || item.decision?.status === 'returned';
  // The decision route writes its feedback entry a few milliseconds before it stamps decidedAt,
  // so an entry belongs to a decision when it was written within 250 ms of one.
  const times = [item.decision?.decidedAt, ...(item.decision?.log || []).map((e) => e.at)].filter(Boolean).map((t) => new Date(t).getTime());
  if ('feedbackHistory' in item) {
    out.feedbackHistory = !decided ? [] : (item.feedbackHistory || []).filter((f) => {
      const at = f.createdAt ? new Date(f.createdAt).getTime() : NaN;
      return times.some((t) => Math.abs(at - t) <= 250);
    });
  }
  return out;
}

/** Router middleware: strip AI-only fields from every hand-in in a response to a non-staff user. */
function hideAiFromStudents(req, res, next) {
  if (isStaffRole(actingRole(req))) return next();
  const json = res.json.bind(res);
  res.json = (body) => {
    if (body && body.data !== undefined) {
      const data = body.data;
      const mapOne = (x) => (x && typeof x === 'object' && Array.isArray(x.submissions) ? { ...x, submissions: x.submissions.map(studentView) } : studentView(x));
      body = { ...body, data: Array.isArray(data) ? data.map(mapOne) : mapOne(data) };
    }
    return json(body);
  };
  return next();
}

module.exports = {
  canStaffProject,
  canStaffTask,
  canStaffTasks,
  canStaffSubmission,
  canReadSubmission,
  isOwner,
  requireCourseStaff,
  requireOwnerOrCourseStaff,
  studentView,
  hideAiFromStudents,
  projectOfTask,
  _staffCache: staffCache,
};
