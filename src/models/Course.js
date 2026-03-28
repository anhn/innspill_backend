const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    required: false,
    trim: true
  },
  academicYear: {
    type: String,
    required: true,
    trim: true
  },
  university: {
    type: String,
    required: true,
    trim: true
  },
  // Support for multiple teachers (array)
  teacherIds: {
    type: [String],
    required: true,
    default: [],
    index: true
  },
  // Keep teacherId for backward compatibility (deprecated, but still indexed for queries)
  teacherId: {
    type: String,
    required: false,
    trim: true,
    index: true
  }
}, {
  collection: 'courses',
  timestamps: true // Automatically adds createdAt and updatedAt
});

// Compound indexes for efficient querying
courseSchema.index({ teacherId: 1, academicYear: 1, university: 1 }); // Backward compatibility
courseSchema.index({ teacherIds: 1, academicYear: 1, university: 1 }); // New multi-teacher support

const Course = mongoose.model('Course', courseSchema);

module.exports = Course;

