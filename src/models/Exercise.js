const mongoose = require('mongoose');

const exerciseSchema = new mongoose.Schema({
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true,
    index: true
  },
  lectureLabel: {
    type: String,
    required: true,
    trim: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  learningObjective: {
    type: String,
    required: false,
    trim: true
  },
  evaluationRank: {
    type: String,
    required: false,
    enum: ['1-10', 'A-F', 'Pass-Failed', '1-4', '100%'],
    default: null
  },
  evaluationCriteria: {
    type: String,
    required: false,
    trim: true
  },
  references: {
    type: String,
    required: false,
    trim: true
  },
  goodExamples: {
    type: String,
    required: false,
    trim: true
  },
  badExamples: {
    type: String,
    required: false,
    trim: true
  },
  aiSupportingStyles: {
    type: [String],
    required: false,
    default: [],
    validate: {
      validator: function(v) {
        const validStyles = ['Guiding Questions', 'Task Breakdown', 'Suggest Prompts', 'Detail Feedback', 'Reflection'];
        return v.every(style => validStyles.includes(style));
      },
      message: 'aiSupportingStyles must contain only valid values: Guiding Questions, Task Breakdown, Suggest Prompts, Detail Feedback, Reflection'
    }
  }
}, {
  collection: 'exercises',
  timestamps: true // Automatically adds createdAt and updatedAt
});

// Index for efficient querying by courseId
exerciseSchema.index({ courseId: 1 });

const Exercise = mongoose.model('Exercise', exerciseSchema);

module.exports = Exercise;

