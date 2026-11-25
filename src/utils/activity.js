/**
 * Activity logging for the 2027 course (see models/ToolEvent.js).
 *
 * logEvent(req, {...})       write one event for the logged-in user; never throws, never blocks.
 * trackRoute(event, pick)    middleware: log an event once the route answered 2xx.
 * courseOfTask(taskId)       backend course id of a task (cached), so server events carry a course.
 */
const mongoose = require('mongoose');
const ToolEvent = require('../models/ToolEvent');
const Task = require('../models/Task');
const Project = require('../models/Project');

const MAX_STRING = 20000;
const MAX_BYTES = 200000;
const cache = new Map();

function actor(req) {
  return {
    username: req.user?.username || req.session?.username || null,
    userId: req.session?.userId || req.user?.id || null,
    role: req.user?.role || req.session?.userRole || null,
  };
}

/** Cap long strings and very large payloads so one event can't fill the database. */
function capData(data) {
  if (data === undefined || data === null) return { data: undefined, bytes: 0 };
  const seen = new WeakSet();
  const walk = (v, depth) => {
    if (typeof v === 'string') return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}… [${v.length - MAX_STRING} more characters]` : v;
    if (typeof v !== 'object' || v === null) return v;
    if (seen.has(v) || depth > 8) return '[…]';
    seen.add(v);
    if (Array.isArray(v)) return v.slice(0, 500).map((x) => walk(x, depth + 1));
    const out = {};
    for (const [k, x] of Object.entries(v).slice(0, 200)) {
      if (/password|token|secret|cookie/i.test(k)) continue;
      out[k] = walk(x, depth + 1);
    }
    return out;
  };
  let capped = walk(data, 0);
  let bytes = Buffer.byteLength(JSON.stringify(capped) || '');
  if (bytes > MAX_BYTES) {
    capped = { truncated: true, bytes, preview: JSON.stringify(capped).slice(0, MAX_STRING) };
    bytes = Buffer.byteLength(JSON.stringify(capped));
  }
  return { data: capped, bytes };
}

async function courseOfTask(taskId) {
  const key = String(taskId || '');
  if (!mongoose.Types.ObjectId.isValid(key)) return { course: null, task: null };
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value;
  let value = { course: null, task: null };
  const task = await Task.findById(key).select('projectId order taskTitle').lean();
  if (task) {
    const project = task.projectId ? await Project.findById(task.projectId).select('courseId').lean() : null;
    value = { course: project?.courseId ? String(project.courseId) : null, task: task.order || (task.taskTitle || '').match(/(\d\.\d)/)?.[1] || null };
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Write one event. Fire and forget: logging must never break or slow the request. */
function logEvent(req, fields) {
  setImmediate(async () => {
    try {
      // The user as they were when the request started (logout ends the session before we log).
      const who = req._activityWho?.username ? req._activityWho : actor(req);
      const { data, bytes } = capData(fields.data);
      let { course, task } = fields;
      if (fields.taskId && (!course || !task)) {
        const found = await courseOfTask(fields.taskId);
        course = course || found.course;
        task = task || found.task;
      }
      await ToolEvent.create({
        at: fields.at || new Date(),
        ...who,
        source: fields.source || 'server',
        event: String(fields.event).slice(0, 80),
        course: course || undefined,
        taskId: fields.taskId ? String(fields.taskId) : undefined,
        task: task || undefined,
        tool: fields.tool || undefined,
        submissionId: fields.submissionId ? String(fields.submissionId) : undefined,
        page: fields.page || undefined,
        session: fields.session || req.sessionID || undefined,
        durationMs: Number.isFinite(fields.durationMs) ? fields.durationMs : undefined,
        data,
        bytes,
      });
    } catch (error) {
      console.error('❌ Activity log failed:', error.message);
    }
  });
}

/**
 * Middleware: once the route has answered with 2xx, log `event`.
 * pick(req, body) returns the extra fields (tool, taskId, submissionId, data…); body is the JSON sent.
 */
function trackRoute(event, pick = () => ({})) {
  return (req, res, next) => {
    req._activityWho = actor(req);
    let sent;
    const json = res.json.bind(res);
    res.json = (body) => {
      sent = body;
      return json(body);
    };
    const started = Date.now();
    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      try {
        const extra = pick(req, sent) || {};
        logEvent(req, { event, durationMs: Date.now() - started, ...extra, data: { ...(extra.data || {}), ms: Date.now() - started } });
      } catch (error) {
        console.error('❌ Activity tracking failed:', error.message);
      }
    });
    next();
  };
}

module.exports = { logEvent, trackRoute, courseOfTask, capData, actor };
