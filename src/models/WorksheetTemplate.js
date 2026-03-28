const mongoose = require('mongoose');

const worksheetTemplateSchema = new mongoose.Schema({
  template_id: {
    type: String,
    required: false,
    trim: true,
    index: true
  },
  education_level: {
    type: String,
    required: true,
    enum: ['elementary', 'high-school', 'higher-education'],
    index: true
  },
  year: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  subject: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  learning_objectives: {
    type: [String],
    required: true,
    default: []
  },
  format_description: {
    type: String,
    required: true,
    trim: true
  },
  examples: {
    type: [String],
    required: true,
    default: []
  }
}, {
  collection: 'worksheet_template',
  timestamps: true
});

// Compound index for efficient querying
worksheetTemplateSchema.index({ education_level: 1, year: 1, subject: 1 });

const WorksheetTemplate = mongoose.model('WorksheetTemplate', worksheetTemplateSchema);

module.exports = WorksheetTemplate;

