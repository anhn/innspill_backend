/**
 * Activity log API (2027 course).
 *
 *   POST /api/v1/activity           any logged-in user: { events: [{ event, tool?, task?, taskId?, course?, page?, session?, at?, durationMs?, data? }] }
 *   GET  /api/v1/activity/mine      the user's own events (what is stored about you)
 *   GET  /api/v1/activity           staff: events of a course  (?course=&username=&task=&tool=&event=&from=&to=&limit=)
 *   GET  /api/v1/activity/summary   staff: per student (and task): counts, time on pages, interview turns, snapshots…
 *   GET  /api/v1/activity/export    staff: the same events as CSV or JSON (?format=csv|json)
 *
 * The user always comes from the session, never from the body.
 */
const express = require('express');
const mongoose = require('mongoose');
const Joi = require('joi');
const ToolEvent = require('../models/ToolEvent');
const Course = require('../models/Course');
const { isOptionalAuth } = require('../middleware/auth');
const { actingRole, isStaffRole, actingUsername } = require('../middleware/requestIdentity');
const { capData, actor } = require('../utils/activity');
const { limit } = require('../middleware/aiLimits');

const router = express.Router();

const eventSchema = Joi.object({
  event: Joi.string().trim().max(80).required(),
  tool: Joi.string().trim().max(60).allow('', null),
  task: Joi.string().trim().max(10).allow('', null),
  taskId: Joi.string().trim().max(40).allow('', null),
  course: Joi.string().trim().max(60).allow('', null),
  submissionId: Joi.string().trim().max(40).allow('', null),
  page: Joi.string().trim().max(300).allow('', null),
  session: Joi.string().trim().max(80).allow('', null),
  at: Joi.date().iso().allow(null),
  durationMs: Joi.number().min(0).max(7 * 86400000).allow(null),
  data: Joi.any(),
});

router.post('/', isOptionalAuth, limit('activity'), async (req, res) => {
  const who = actor(req);
  if (!who.username) return res.status(401).json({ success: false, message: 'Log in first.' });
  const { error, value } = Joi.object({ events: Joi.array().items(eventSchema).min(1).max(200).required() }).validate(req.body, { stripUnknown: true });
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });
  const now = Date.now();
  const docs = value.events.map((e) => {
    const { data, bytes } = capData(e.data);
    // Client clocks drift and can be set by hand: keep the client's time only within a day of ours.
    const at = e.at && Math.abs(new Date(e.at).getTime() - now) < 86400000 ? new Date(e.at) : new Date(now);
    return {
      at, ...who, source: 'client', event: e.event,
      tool: e.tool || undefined, task: e.task || undefined, taskId: e.taskId || undefined, course: e.course || undefined,
      submissionId: e.submissionId || undefined, page: e.page || undefined, session: e.session || undefined,
      durationMs: Number.isFinite(e.durationMs) ? e.durationMs : undefined, data, bytes,
    };
  });
  try {
    await ToolEvent.insertMany(docs, { ordered: false });
    return res.status(201).json({ success: true, data: { stored: docs.length } });
  } catch (err) {
    console.error('❌ Storing activity failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not store the activity.' });
  }
});

/** What is stored about the logged-in user. */
router.get('/mine', isOptionalAuth, async (req, res) => {
  const username = actingUsername(req);
  if (!username) return res.status(401).json({ success: false, message: 'Log in first.' });
  const limitN = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 1000));
  const [events, total, byEvent] = await Promise.all([
    ToolEvent.find({ username }).sort({ at: -1 }).limit(limitN).lean(),
    ToolEvent.countDocuments({ username }),
    ToolEvent.aggregate([{ $match: { username } }, { $group: { _id: '$event', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
  ]);
  return res.json({ success: true, data: { total, byEvent: byEvent.map((x) => ({ event: x._id, n: x.n })), events: events.map(view) } });
});

const view = (e) => ({
  at: e.at, username: e.username, role: e.role, source: e.source, event: e.event, course: e.course, task: e.task, taskId: e.taskId,
  tool: e.tool, submissionId: e.submissionId, page: e.page, session: e.session, durationMs: e.durationMs, data: e.data, bytes: e.bytes,
});

/** Staff may read a course they teach; admins any. Teachers must name the course. */
async function staffScope(req, res) {
  const role = actingRole(req);
  if (!isStaffRole(role)) {
    res.status(403).json({ success: false, message: 'Forbidden' });
    return null;
  }
  const course = String(req.query.course || '').trim();
  if (!course) {
    if (role === 'admin') return {};
    res.status(400).json({ success: false, message: 'Give a course.' });
    return null;
  }
  if (role !== 'admin') {
    const doc = mongoose.Types.ObjectId.isValid(course) ? await Course.findById(course).lean() : null;
    const me = new Set([req.user?.username, req.session?.username, req.session?.userEmail, req.session?.userId].filter(Boolean).map((x) => String(x).toLowerCase()));
    const staff = [...(doc?.teacherIds || []), doc?.teacherId].filter(Boolean).map((x) => String(x).toLowerCase());
    if (!doc || (staff.length && !staff.some((s) => me.has(s)))) {
      res.status(403).json({ success: false, message: 'Forbidden' });
      return null;
    }
  }
  return { course };
}

function filters(req, base) {
  const q = { ...base };
  for (const k of ['username', 'task', 'taskId', 'tool', 'event', 'source', 'submissionId', 'session']) if (req.query[k]) q[k] = String(req.query[k]);
  if (req.query.role) q.role = String(req.query.role);
  if (req.query.from || req.query.to) {
    q.at = {};
    if (req.query.from) q.at.$gte = new Date(req.query.from);
    if (req.query.to) q.at.$lte = new Date(req.query.to);
  }
  return q;
}

router.get('/', isOptionalAuth, async (req, res) => {
  try {
    const scope = await staffScope(req, res);
    if (!scope) return;
    const limitN = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 500));
    const q = filters(req, scope);
    const [events, total] = await Promise.all([ToolEvent.find(q).sort({ at: -1 }).limit(limitN).lean(), ToolEvent.countDocuments(q)]);
    return res.json({ success: true, data: { total, events: events.map(view) } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not read the activity.' });
  }
});

router.get('/summary', isOptionalAuth, async (req, res) => {
  try {
    const scope = await staffScope(req, res);
    if (!scope) return;
    const q = filters(req, scope);
    const byTask = req.query.byTask !== '0';
    const groupId = byTask ? { username: '$username', task: '$task' } : { username: '$username' };
    const rows = await ToolEvent.aggregate([
      { $match: q },
      {
        $group: {
          _id: groupId,
          events: { $sum: 1 },
          first: { $min: '$at' },
          last: { $max: '$at' },
          activeMs: { $sum: { $cond: [{ $eq: ['$event', 'page-time'] }, { $ifNull: ['$durationMs', 0] }, 0] } },
          sessions: { $addToSet: '$session' },
          pageViews: { $sum: { $cond: [{ $eq: ['$event', 'page-view'] }, 1, 0] } },
          clicks: { $sum: { $cond: [{ $eq: ['$event', 'click'] }, 1, 0] } },
          snapshots: { $sum: { $cond: [{ $eq: ['$event', 'work-snapshot'] }, 1, 0] } },
          interviewTurns: { $sum: { $cond: [{ $eq: ['$event', 'interview-turn'] }, 1, 0] } },
          handIns: { $sum: { $cond: [{ $in: ['$event', ['hand-in', 'send-from-tool']] }, 1, 0] } },
          linkChecks: { $sum: { $cond: [{ $eq: ['$event', 'link-check'] }, 1, 0] } },
          videos: { $sum: { $cond: [{ $eq: ['$event', 'video-play'] }, 1, 0] } },
          tools: { $addToSet: '$tool' },
        },
      },
      { $sort: { '_id.username': 1, '_id.task': 1 } },
    ]);
    return res.json({
      success: true,
      data: rows.map((r) => ({
        username: r._id.username, task: r._id.task ?? null, events: r.events, first: r.first, last: r.last, activeMinutes: Math.round(r.activeMs / 600) / 100,
        sessions: r.sessions.filter(Boolean).length, pageViews: r.pageViews, clicks: r.clicks, snapshots: r.snapshots, interviewTurns: r.interviewTurns,
        handIns: r.handIns, linkChecks: r.linkChecks, videos: r.videos, tools: r.tools.filter(Boolean),
      })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not summarise the activity.' });
  }
});

const CSV_COLS = ['at', 'username', 'role', 'source', 'event', 'course', 'task', 'tool', 'submissionId', 'page', 'session', 'durationMs', 'data'];
const csvCell = (v) => {
  const s = v === undefined || v === null ? '' : typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

router.get('/export', isOptionalAuth, async (req, res) => {
  try {
    const scope = await staffScope(req, res);
    if (!scope) return;
    const q = filters(req, scope);
    const events = await ToolEvent.find(q).sort({ at: 1 }).limit(200000).lean();
    const stamp = new Date().toISOString().slice(0, 10);
    if (req.query.format === 'json') {
      res.set('Content-Disposition', `attachment; filename="activity-${stamp}.json"`);
      return res.json(events.map(view));
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="activity-${stamp}.csv"`);
    const lines = [CSV_COLS.join(','), ...events.map((e) => CSV_COLS.map((c) => csvCell(view(e)[c])).join(','))];
    return res.send(lines.join('\n'));
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Could not export the activity.' });
  }
});

module.exports = router;
