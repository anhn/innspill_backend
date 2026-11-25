const mongoose = require('mongoose');

const turnSchema = new mongoose.Schema({
  at: { type: Date, required: true, default: Date.now },
  speaker: { type: String, required: true, enum: ['student', 'persona'] },
  text: { type: String, required: true, trim: true },
  constraintId: { type: String, required: false, trim: true },
}, { _id: true });

/**
 * One RE Studio interview per group and persona.
 * New collection. Existing chat sessions are not modified.
 */
const reStudioSessionSchema = new mongoose.Schema({
  courseId: { type: String, required: true, trim: true },
  groupId: { type: String, required: true, trim: true },
  persona: { type: String, required: true, trim: true },
  open: { type: Boolean, required: true, default: true },
  turns: { type: [turnSchema], default: [] },
  pins: { type: [String], default: [] },
  constraintHits: { type: [String], default: [] },
  hits: {
    type: [{
      constraintId: String,
      turnId: String,
      at: Date,
    }],
    default: [],
  },
  markers: {
    type: [{
      kind: { type: String, enum: ['F', 'H', 'P'] },
      at: Date,
    }],
    default: [],
  },
  concludedAt: { type: Date, required: false },
  reopenedAt: { type: Date, required: false },
}, {
  collection: 'restudiosessions',
  timestamps: true,
});

reStudioSessionSchema.index({ courseId: 1, groupId: 1, persona: 1 }, { unique: true });

module.exports = mongoose.model('ReStudioSession', reStudioSessionSchema);
