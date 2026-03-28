const mongoose = require('mongoose');

const loMappingSchema = new mongoose.Schema({
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true,
    unique: true // One mapping per project
  },
  mappings: [{
    learningObjective: {
      type: String,
      required: true,
      trim: true
    },
    taskIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task'
    }],
    roleIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role'
    }],
    quizQuestionIds: [{
      type: String, // Quiz question IDs are strings in the Quiz model
      required: true
    }]
  }]
}, {
  collection: 'lo_mappings',
  timestamps: true
});

loMappingSchema.index({ projectId: 1 });

const LOMapping = mongoose.model('LOMapping', loMappingSchema);

module.exports = LOMapping;

