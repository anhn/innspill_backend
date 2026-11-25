const mongoose = require('mongoose');

/**
 * One thing a student or teacher did in the 2027 course: a page view, a click in a tool,
 * a snapshot of work in progress, an interview turn, a hand-in, a decision…
 *
 * source 'client' events come from the browser (POST /api/v1/activity); 'server' events are
 * written by the API itself and cannot be skipped by the browser.
 * Set ACTIVITY_RETENTION_DAYS to delete events after that many days (TTL index).
 */
const toolEventSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now, index: true },
    username: { type: String, index: true },
    userId: { type: String },
    role: { type: String, index: true },
    source: { type: String, enum: ['client', 'server'], default: 'client', index: true },
    event: { type: String, required: true, index: true },
    /** Backend course id when known. */
    course: { type: String, index: true },
    /** Backend task id and the task number (1.1 … 3.4). */
    taskId: { type: String, index: true },
    task: { type: String, index: true },
    tool: { type: String, index: true },
    submissionId: { type: String, index: true },
    /** Page (route) the event happened on, and the browser session. */
    page: { type: String },
    session: { type: String, index: true },
    durationMs: { type: Number },
    data: { type: mongoose.Schema.Types.Mixed },
    bytes: { type: Number },
  },
  { versionKey: false, collection: 'toolevents' },
);

toolEventSchema.index({ course: 1, username: 1, at: -1 });
toolEventSchema.index({ username: 1, task: 1, at: -1 });

const days = parseInt(process.env.ACTIVITY_RETENTION_DAYS, 10);
if (Number.isFinite(days) && days > 0) toolEventSchema.index({ at: 1 }, { expireAfterSeconds: days * 86400, name: 'retention' });

module.exports = mongoose.models.ToolEvent || mongoose.model('ToolEvent', toolEventSchema);
