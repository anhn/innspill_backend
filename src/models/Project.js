const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true,
    index: true,
    unique: true // Each course can have only one project
  },
  projectTitle: {
    type: String,
    required: true,
    trim: true
  },
  courseDescription: {
    type: String,
    required: false,
    trim: true
  },
  learningOutcome: {
    type: String,
    required: false,
    trim: true
  },
  keyMilestones: {
    type: String,
    required: false,
    trim: true
  },
  attachments: {
    type: [String],
    required: false,
    default: []
  },
  availableStakeholders: {
    type: [String],
    required: false,
    default: []
  },
  teacherId: {
    type: String,
    required: false,
    trim: true,
    index: true
  },
  coverPhoto: {
    type: {
      fileId: { type: String, required: true },
      fileName: { type: String, required: true },
      fileUrl: { type: String, required: true },
      fileSize: { type: Number, required: true },
      mimeType: { type: String, required: true },
      uploadedAt: { type: Date, required: true }
    },
    required: false,
  },
  additionalInfo: {
    type: mongoose.Schema.Types.Mixed,
    required: false,
    default: {}
  }
}, {
  collection: 'projects',
  timestamps: true
});

projectSchema.index({ courseId: 1 });
projectSchema.index({ teacherId: 1 });

const Project = mongoose.model('Project', projectSchema);

module.exports = Project;

