const mongoose = require('mongoose');

const worksheetSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    required: true,
    trim: true
  },
  educationLevel: {
    type: String,
    required: true,
    enum: ['elementary', 'high-school', 'higher-education'],
    index: true
  },
  year: {
    type: String,
    required: true,
    trim: true
  },
  language: {
    type: String,
    required: false,
    trim: true
  },
  subjectArea: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  learningObjective: {
    type: String,
    required: true,
    trim: true
  },
  difficultyLevel: {
    type: String,
    required: true,
    enum: ['easy', 'medium', 'hard'],
    index: true
  },
  formatDescription: {
    type: String,
    required: false,
    trim: true
  },
  examples: {
    type: String,
    required: false,
    trim: true
  },
  references: {
    type: String,
    required: false,
    trim: true
  },
  userName: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  generatedAt: {
    type: Date,
    required: false,
    default: null
  },
  printoutLayoutOptions: {
    type: mongoose.Schema.Types.Mixed,
    required: false,
    default: null
  },
  instructionPage: {
    type: String,
    required: false,
    trim: true
  },
  answerSheet: {
    type: String,
    required: false,
    trim: true
  }
}, {
  collection: 'worksheets',
  timestamps: true // Automatically adds createdAt and updatedAt
});

// Indexes for efficient querying
worksheetSchema.index({ userName: 1, createdAt: -1 });
worksheetSchema.index({ educationLevel: 1, subjectArea: 1 });

const Worksheet = mongoose.model('Worksheet', worksheetSchema);

module.exports = Worksheet;

