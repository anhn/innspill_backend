const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true
  },
  taskTitle: {
    type: String,
    required: false,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  outcome: {
    type: String,
    required: false,
    trim: true
  },
  instruction: {
    type: String,
    required: false,
    trim: true
  },
  keyword: {
    type: String,
    required: true,
    trim: true
  },
  submissionDeadline: {
    type: Date,
    required: true
  },
  evaluationCriteria: {
    type: String,
    required: false,
    trim: true
  },
  enabledAIGuideline: {
    type: Boolean,
    required: false,
    default: false
  },
  lockOnSubmissionQuestion: {
    type: Boolean,
    required: false,
    default: false
  },
  lockOnFeedbackReceivedQuestion: {
    type: Boolean,
    required: false,
    default: false
  },
  submissionQuestion: {
    type: String,
    required: false,
    trim: true
  },
  feedbackReceivedQuestion: {
    type: String,
    required: false,
    trim: true
  },
  submissionQuestionTimer: {
    type: Number,
    required: false,
    default: 5 // minutes
  },
  feedbackReceivedQuestionTimer: {
    type: Number,
    required: false,
    default: 5 // minutes
  },
  attachments: {
    type: [String],
    required: false,
    default: []
  },
  status: {
    type: String,
    required: false,
    enum: ['published', 'unpublished'],
    default: 'unpublished',
    index: true
  },
  additionalInfo: {
    type: mongoose.Schema.Types.Mixed,
    required: false,
    default: {}
  }
}, {
  collection: 'tasks',
  timestamps: true
});

taskSchema.index({ projectId: 1 });
taskSchema.index({ submissionDeadline: 1 });

const Task = mongoose.model('Task', taskSchema);

module.exports = Task;

