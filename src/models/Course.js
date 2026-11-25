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
    required: false,
    default: '',
    trim: true
  },
  university: {
    type: String,
    required: false,
    default: '',
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
  },
  // Optional 2027 course-home config. Absent on existing courses.
  // No default, so saving a 2026 course does not write this field.
  config: {
    type: mongoose.Schema.Types.Mixed,
    required: false
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

