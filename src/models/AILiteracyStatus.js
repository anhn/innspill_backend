const mongoose = require('mongoose');

const aiLiteracyStatusSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  status: {
    type: String,
    enum: ['not_started', 'in_progress', 'completed'],
    default: 'not_started',
    required: true
  },
  progress: {
    type: Number,
    min: 0,
    max: 100,
    default: 0,
    required: true
  },
  lastAccessed: {
    type: Date,
    default: Date.now
  },
  completionDate: {
    type: Date,
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  collection: 'ai_literacy_status',
  timestamps: true // Automatically adds createdAt and updatedAt
});

// Index for efficient querying
aiLiteracyStatusSchema.index({ userId: 1 });

const AILiteracyStatus = mongoose.model('AILiteracyStatus', aiLiteracyStatusSchema);

module.exports = AILiteracyStatus;

