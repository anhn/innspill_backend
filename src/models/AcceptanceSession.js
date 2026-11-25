const mongoose = require('mongoose');

const criterionSchema = new mongoose.Schema({
  id: { type: String, required: true },
  text: { type: String, required: true },
  result: { type: String, enum: ['pass', 'fail', 'blocked', ''], default: '' },
  evidence: { type: String, default: '' },
  sourceGroupId: { type: String, default: '' },
}, { _id: false });

const issueSchema = new mongoose.Schema({
  title: { type: String, required: true },
  steps: { type: String, default: '' },
  expected: { type: String, default: '' },
  actual: { type: String, default: '' },
  useful: { type: Number, min: 0, max: 5, default: 0 },
  externalUrl: { type: String, default: '' },
}, { _id: true });

const participantSchema = new mongoose.Schema({
  code: { type: String, required: true },
  consent: { type: Boolean, required: true },
  script: { type: String, default: '' },
  notes: { type: String, default: '' },
}, { _id: false });

/**
 * Acceptance testing for a partner group.
 * Participants are P1, P2, and so on. Names are not a field.
 */
const acceptanceSessionSchema = new mongoose.Schema({
  courseId: { type: String, required: true, trim: true },
  groupId: { type: String, required: true, trim: true },
  partnerGroupId: { type: String, required: false, trim: true, default: '' },
  criteria: { type: [criterionSchema], default: [] },
  issues: { type: [issueSchema], default: [] },
  participants: { type: [participantSchema], default: [] },
  load: {
    type: {
      p95ms: { type: Number, required: false },
      limit: { type: String, default: '' },
      raw: { type: String, default: '' },
    },
    required: false,
  },
  status: { type: String, enum: ['draft', 'submitted'], default: 'draft' },
}, {
  collection: 'acceptancesessions',
  timestamps: true,
});

acceptanceSessionSchema.index({ courseId: 1, groupId: 1 });

module.exports = mongoose.model('AcceptanceSession', acceptanceSessionSchema);
