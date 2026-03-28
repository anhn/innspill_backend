const mongoose = require('mongoose');

const quizSubmissionSchema = new mongoose.Schema({
  quizId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true,
    index: true
  },
  studentId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  courseId: {
    type: String,
    required: false,
    trim: true,
    index: true
  },
  currentQuestionIndex: {
    type: Number,
    required: false,
    default: 0
  },
  lockedAnswers: {
    type: mongoose.Schema.Types.Mixed,
    required: false,
    default: {}
  },
  answers: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    default: {}
  },
  comments: {
    type: mongoose.Schema.Types.Mixed,
    required: false,
    default: {}
  },
  score: {
    type: Number,
    required: function () {
      return this.isSubmitted === true;
    },
    min: 0,
    max: 100,
    default: null
  },
  isSubmitted: {
    type: Boolean,
    required: true,
    default: false
  },
  submittedAt: {
    type: Date,
    required: false
  },
  startedAt: {
    type: Date,
    required: true,
    default: Date.now
  }
}, {
  collection: 'quiz_submissions',
  timestamps: true // This adds createdAt and updatedAt automatically
});

// Compound index for efficient queries
quizSubmissionSchema.index({ quizId: 1, studentId: 1 }, { unique: true });
quizSubmissionSchema.index({ quizId: 1, score: -1 }); // For leaderboard sorting
quizSubmissionSchema.index({ studentId: 1 });

// Virtual for lastUpdated (using updatedAt from timestamps)
quizSubmissionSchema.virtual('lastUpdated').get(function() {
  return this.updatedAt;
});

// Ensure virtuals are included in JSON output
quizSubmissionSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    ret.id = ret._id.toString();
    ret.lastUpdated = ret.updatedAt;
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

const QuizSubmission = mongoose.model('QuizSubmission', quizSubmissionSchema);

module.exports = QuizSubmission;

