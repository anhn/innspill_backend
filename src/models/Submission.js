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

// Margin comments on a submission, anchored to a quoted passage.
const reviewReplySchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true },
  author: { type: String, required: true, trim: true },
  authorRole: { type: String, enum: ['teacher', 'student'], required: true },
  createdAt: { type: Date, default: Date.now }
});

const reviewCommentSchema = new mongoose.Schema({
  quote: { type: String, required: true },
  prefix: { type: String, default: '' },
  suffix: { type: String, default: '' },
  text: { type: String, required: true, trim: true },
  author: { type: String, required: true, trim: true },
  authorRole: { type: String, enum: ['teacher', 'student'], required: true },
  resolved: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  replies: { type: [reviewReplySchema], default: [] }
});

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
  repoUrl: {
    type: String,
    required: false,
    trim: true
  },
  codebase: {
    type: new mongoose.Schema({
      fileId: { type: String, required: true },
      fileName: { type: String, required: true },
      fileSize: { type: Number, required: true },
      fileUrl: { type: String, required: true },
    }, { _id: false }),
    required: false
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
  },
  // Optional teacher decision for the 2027 queue. No defaults.
  // Existing submissions keep their scores inside feedbackHistory.
  // AI scores stay a suggestion until a teacher calls the decision route.
  decisionStatus: {
    type: String,
    required: false,
    enum: ['waiting', 'approved', 'returned']
  },
  score: {
    type: Number,
    required: false,
    min: 0,
    max: 5
  },
  reflection: {
    type: Number,
    required: false,
    min: 0,
    max: 5
  },
  decidedAt: {
    type: Date,
    required: false
  },
  decidedBy: {
    type: String,
    required: false,
    trim: true
  },
  // Teacher review page: margin comments and formatted feedback (sanitised HTML).
  reviewComments: {
    type: [reviewCommentSchema],
    default: undefined
  },
  feedbackHtml: {
    type: String,
    required: false
  },
  // Hand-in portal: the parts handed in and what the link checks found (text is in `submission`).
  parts: {
    type: [mongoose.Schema.Types.Mixed],
    default: undefined
  },
  missingNote: {
    type: String,
    required: false
  },
  // Every decision sent to the student: status, scores, who, when and the general comment as sent.
  decisionLog: {
    type: [mongoose.Schema.Types.Mixed],
    default: undefined
  },
  // Automated assessment: items, rule and AI findings, criteria roll-up and a suggested score.
  assessment: {
    type: mongoose.Schema.Types.Mixed,
    required: false
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

