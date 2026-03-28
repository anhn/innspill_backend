const mongoose = require('mongoose');

// Schema for a single question answer entry
const questionAnswerSchema = new mongoose.Schema({
  answer: {
    type: String,
    required: true,
    trim: true
  },
  answeredAt: {
    type: Date,
    required: true,
    default: Date.now
  }
}, { _id: false });

// Schema for a single feedback entry (comprehensive feedback structure)
const feedbackEntrySchema = new mongoose.Schema({
  feedback: {
    type: String,
    required: true,
    trim: true
  },
  feedforward: {
    type: String,
    required: false,
    trim: true,
    default: ''
  },
  concept: {
    type: String,
    required: false,
    trim: true,
    default: ''
  },
  reflection: {
    type: String,
    required: false,
    trim: true,
    default: ''
  },
  criticalThinking: {
    type: String,
    required: false,
    trim: true,
    default: ''
  },
  // Scores (0-5 or "not applicable" for taskQualityScore)
  taskQualityScore: {
    type: mongoose.Schema.Types.Mixed, // Can be Number (0-5) or String ("not applicable")
    required: false,
    default: null
  },
  reflectionScore: {
    type: Number,
    required: false,
    min: 0,
    max: 5,
    default: null
  },
  criticalthinkingScore: {
    type: Number,
    required: false,
    min: 0,
    max: 5,
    default: null
  },
  conceptMasteryScore: {
    type: Number,
    required: false,
    min: 0,
    max: 5,
    default: null
  },
  stakeholderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role',
    required: false
  },
  createdAt: {
    type: Date,
    required: true,
    default: Date.now
  }
}, { _id: false });

// Schema for a single star score entry (0-5)
const starScoreEntrySchema = new mongoose.Schema({
  score: {
    type: Number,
    required: true,
    min: 0,
    max: 5
  },
  stakeholderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role',
    required: false
  },
  createdAt: {
    type: Date,
    required: true,
    default: Date.now
  }
}, { _id: false });

const submissionSchema = new mongoose.Schema({
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
    index: true
  },
  studentId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  studentName: {
    type: String,
    required: true,
    trim: true
  },
  datetime: {
    type: Date,
    required: false,
    default: Date.now
  },
  attemptNumber: {
    type: Number,
    required: false,
    default: 1
  },
  submission: {
    type: String,
    required: true,
    trim: true
  },
  attachments: {
    type: [String],
    required: false,
    default: []
  },
  conversationLog: {
    type: String,
    required: false,
    trim: true
  },
  // Question answers with history
  submissionQuestionAnswers: {
    type: [questionAnswerSchema],
    required: false,
    default: []
  },
  feedbackReceivedQuestionAnswers: {
    type: [questionAnswerSchema],
    required: false,
    default: []
  },
  // Feedback history (multiple feedback entries)
  feedbackHistory: {
    type: [feedbackEntrySchema],
    required: false,
    default: []
  },
  // Star score history (multiple scores, 0-5)
  starScoreHistory: {
    type: [starScoreEntrySchema],
    required: false,
    default: []
  },
  stakeholderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role',
    required: false,
    index: true
  }
}, {
  collection: 'submissions',
  timestamps: true
});

submissionSchema.index({ taskId: 1, studentId: 1 });
submissionSchema.index({ studentId: 1 });
submissionSchema.index({ stakeholderId: 1 });

// Virtual to get latest feedback (for backward compatibility)
submissionSchema.virtual('feedback').get(function() {
  return this.feedbackHistory && this.feedbackHistory.length > 0
    ? this.feedbackHistory[this.feedbackHistory.length - 1].feedback
    : null;
});

// Virtual to get latest star score (for backward compatibility)
submissionSchema.virtual('starScore').get(function() {
  return this.starScoreHistory && this.starScoreHistory.length > 0
    ? this.starScoreHistory[this.starScoreHistory.length - 1].score
    : null;
});

// Ensure virtuals are included in JSON output
submissionSchema.set('toJSON', {
  virtuals: true
});

const Submission = mongoose.model('Submission', submissionSchema);

module.exports = Submission;

