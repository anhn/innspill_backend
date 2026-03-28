const mongoose = require('mongoose');

/**
 * User Feedback Schema - Stores user ratings and feedback about the platform
 */
const userFeedbackSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: false, // Optional for anonymous users
    index: true,
    trim: true
  },
  username: {
    type: String,
    required: false, // Optional for anonymous users
    index: true,
    trim: true
  },
  // Likert scale ratings (1-5)
  experienceRating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
    validate: {
      validator: Number.isInteger,
      message: 'Experience rating must be an integer'
    }
  },
  aiCompetenceRating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
    validate: {
      validator: Number.isInteger,
      message: 'AI competence rating must be an integer'
    }
  },
  learningRating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
    validate: {
      validator: Number.isInteger,
      message: 'Learning rating must be an integer'
    }
  },
  // Open-ended reflections comment
  openEndedReflections: {
    type: String,
    required: false,
    trim: true,
    default: ''
  },
  // Optional metadata
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: false,
    index: true
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: false,
    index: true
  },
  ipAddress: {
    type: String,
    required: false
  },
  userAgent: {
    type: String,
    required: false
  }
}, {
  collection: 'user_feedback',
  timestamps: true
});

// Indexes for better query performance
userFeedbackSchema.index({ userId: 1, createdAt: -1 });
userFeedbackSchema.index({ username: 1, createdAt: -1 });
userFeedbackSchema.index({ createdAt: -1 });

const UserFeedback = mongoose.model('UserFeedback', userFeedbackSchema);

module.exports = UserFeedback;

