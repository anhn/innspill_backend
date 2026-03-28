const mongoose = require('mongoose');

/**
 * Course Plan Document Schema - Stores individual document versions (original, analysis, revision)
 * Each document is saved separately and linked by sessionId
 */
const coursePlanDocSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: false, // Optional for anonymous users
    index: true
  },
  userName: {
    type: String,
    required: false,
    index: true
  },
  coursePlanName: {
    type: String,
    required: true,
    index: true
  },
  sessionId: {
    type: String,
    required: true,
    index: true // Links related documents (original, analysis, revision)
  },
  versionType: {
    type: String,
    required: true,
    enum: ['original', 'analysis', 'revision'],
    index: true
  },
  versionNumber: {
    type: Number,
    required: true,
    default: 1,
    index: true // Allows multiple analyses/revisions
  },
  title: {
    type: String,
    required: true // e.g., "Analysis", "Revised plan", "Original plan"
  },
  content: {
    type: String,
    required: true
  },
  teacherInfo: {
    educationLevel: String,
    subjectArea: String,
    country: String,
    academicYear: String,
    organization: String,
    language: String
  },
  tags: [{
    type: String
  }],
  metadata: {
    notes: String,
    frontend_version_id: String,
    agent: String, // Agent that generated this document
    tokenUsage: mongoose.Schema.Types.Mixed, // Token usage for AI-generated docs
    processingTime: Number, // Processing time in milliseconds
    fileSize: Number // Size in characters
  }
}, {
  timestamps: true // Adds createdAt and updatedAt
});

// Compound indexes for better query performance
coursePlanDocSchema.index({ sessionId: 1, versionType: 1, versionNumber: -1 }); // Get latest version by type
coursePlanDocSchema.index({ userId: 1, createdAt: -1 });
coursePlanDocSchema.index({ userName: 1, createdAt: -1 });
coursePlanDocSchema.index({ coursePlanName: 1, createdAt: -1 });
coursePlanDocSchema.index({ sessionId: 1, createdAt: -1 }); // Get all docs in session
coursePlanDocSchema.index({ versionType: 1, createdAt: -1 });
coursePlanDocSchema.index({ 'teacherInfo.country': 1 });
coursePlanDocSchema.index({ 'teacherInfo.organization': 1 });

// Bind to 'ai4edu_database' database and 'course_plan_docs' collection
const coursePlanDocDb = mongoose.connection.useDb('ai4edu_database');
const CoursePlanDoc = coursePlanDocDb.model('CoursePlanDoc', coursePlanDocSchema, 'course_plan_docs');

module.exports = CoursePlanDoc;

