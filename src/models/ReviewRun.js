const mongoose = require('mongoose');

const findingSchema = new mongoose.Schema({
  id: { type: String, required: true },
  fingerprint: { type: String, required: true },
  tools: { type: [String], default: [] },
  file: { type: String, default: '' },
  line: { type: Number, default: 0 },
  message: { type: String, default: '' },
  rule: { type: String, default: '' },
  snippet: { type: String, default: '' },
  severity: { type: String, enum: ['critical', 'high', 'medium', 'low', 'info'], required: false },
  category: { type: String, default: '' },
}, { _id: false });

const toolRunSchema = new mongoose.Schema({
  id: { type: String, required: true },
  status: { type: String, required: true, enum: ['done', 'failed', 'skipped'] },
  message: { type: String, default: '' },
}, { _id: false });

const labelSchema = new mongoose.Schema({
  findingId: { type: String, required: true },
  verdict: { type: String, required: true, enum: ['tp', 'fp'] },
  reason: { type: String, required: true, trim: true },
}, { _id: false });

/**
 * One quality-check run. Findings are normalised and merged here.
 * The Docker runner image is not started by this process.
 */
const reviewRunSchema = new mongoose.Schema({
  courseId: { type: String, required: true, trim: true },
  groupId: { type: String, required: true, trim: true },
  purpose: { type: String, required: true, enum: ['review', 'fix'] },
  repo: { type: String, required: true, trim: true },
  commit: { type: String, required: true, trim: true },
  status: { type: String, required: true, enum: ['queued', 'running', 'done', 'failed'], default: 'queued' },
  findings: { type: [findingSchema], default: [] },
  toolRuns: { type: [toolRunSchema], default: [] },
  labels: { type: [labelSchema], default: [] },
  submittedAt: { type: Date, required: false },
}, {
  collection: 'reviewruns',
  timestamps: true,
});

reviewRunSchema.index({ courseId: 1, groupId: 1, purpose: 1, createdAt: -1 });

module.exports = mongoose.model('ReviewRun', reviewRunSchema);
