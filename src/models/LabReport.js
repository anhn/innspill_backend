const mongoose = require('mongoose');

/**
 * LLM lab, sustainability lab, or AGENTS.md draft.
 * Submit freezes the report. A later save is refused until it is returned.
 */
const labReportSchema = new mongoose.Schema({
  courseId: { type: String, required: true, trim: true },
  groupId: { type: String, required: true, trim: true },
  studentId: { type: String, required: false, trim: true, default: '' },
  kind: { type: String, required: true, enum: ['llm', 'sustainability', 'agents-md'] },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  checks: { type: [mongoose.Schema.Types.Mixed], default: [] },
  status: { type: String, required: true, enum: ['draft', 'submitted', 'returned'], default: 'draft' },
  submittedAt: { type: Date, required: false },
  taskId: { type: String, required: false, default: '' },
  submissionId: { type: String, required: false, default: '' },
}, {
  collection: 'labreports',
  timestamps: true,
});

labReportSchema.index({ courseId: 1, groupId: 1, kind: 1 }, { unique: true });

module.exports = mongoose.model('LabReport', labReportSchema);
