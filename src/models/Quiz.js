const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  id: {
    type: String,
    required: false,
    trim: true
  },
  question: {
    type: String,
    required: true,
    trim: true
  },
  options: {
    type: [String],
    required: true,
    validate: {
      validator: function(v) {
        return v && v.length >= 2;
      },
      message: 'At least 2 options are required'
    }
  },
  correctAnswer: {
    type: Number,
    required: true,
    min: 0
  }
}, { _id: false });

const historyItemSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    trim: true
  },
  questions: {
    type: [questionSchema],
    required: true
  },
  createdAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  updatedBy: {
    type: String,
    required: true,
    trim: true
  }
}, { _id: false });

const quizSchema = new mongoose.Schema({
  name: {
    type: String,
    required: false,
    trim: true
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true
  },
  questions: {
    type: [questionSchema],
    required: true,
    default: []
  },
  history: {
    type: [historyItemSchema],
    required: false,
    default: []
  }
}, {
  collection: 'quizzes',
  timestamps: true
});

quizSchema.index({ projectId: 1 });

const Quiz = mongoose.model('Quiz', quizSchema);

module.exports = Quiz;

