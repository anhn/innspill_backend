const mongoose = require('mongoose');

const studentGroupSchema = new mongoose.Schema({
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true,
    index: true
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: false,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: false,
    trim: true,
    default: ''
  },
  studentIds: {
    type: [String],
    required: true,
    validate: {
      validator: function(v) {
        return Array.isArray(v) && v.length >= 2;
      },
      message: 'Group must have at least 2 students'
    }
  },
  createdBy: {
    type: String,
    required: true,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  collection: 'student_groups',
  timestamps: true // Automatically adds createdAt and updatedAt
});

// Compound index for unique group names within a course
studentGroupSchema.index({ courseId: 1, name: 1 }, { unique: true });

// Index for querying active groups by course and project
studentGroupSchema.index({ courseId: 1, projectId: 1, isActive: 1 });

// Index for finding groups by student ID
studentGroupSchema.index({ studentIds: 1 });

const StudentGroup = mongoose.model('StudentGroup', studentGroupSchema);

module.exports = StudentGroup;
