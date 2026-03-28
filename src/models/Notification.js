const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipientType: {
    type: String,
    required: true,
    enum: ['student', 'teacher'],
    index: true
  },
  studentId: {
    type: String,
    required: false,
    trim: true,
    index: true
  },
  teacherId: {
    type: String,
    required: false,
    trim: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  datetime: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },
  read: {
    type: Boolean,
    required: false,
    default: false,
    index: true
  },
  readAt: {
    type: Date,
    required: false,
    default: null
  },
  important: {
    type: Boolean,
    required: false,
    default: false,
    index: true
  },
  summary: {
    type: String,
    required: false,
    trim: true
  },
  taskId: {
    type: String,
    required: false,
    trim: true
  },
  taskTitle: {
    type: String,
    required: false,
    trim: true
  },
  type: {
    type: String,
    required: false,
    trim: true
  },
  link: {
    type: String,
    required: false,
    trim: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    required: false,
    default: {}
  }
}, {
  collection: 'notifications',
  timestamps: true
});

// Indexes for student notifications
notificationSchema.index({ studentId: 1, datetime: -1 });
notificationSchema.index({ studentId: 1, read: 1 });
notificationSchema.index({ studentId: 1, recipientType: 1, datetime: -1 });

// Indexes for teacher notifications
notificationSchema.index({ teacherId: 1, datetime: -1 });
notificationSchema.index({ teacherId: 1, read: 1 });
notificationSchema.index({ teacherId: 1, recipientType: 1, datetime: -1 });

// General indexes
notificationSchema.index({ recipientType: 1, datetime: -1 });
notificationSchema.index({ recipientType: 1, read: 1 });

// Validation: Ensure correct ID field is set based on recipientType
notificationSchema.pre('save', function(next) {
  if (this.recipientType === 'student' && !this.studentId) {
    return next(new Error('studentId is required when recipientType is "student"'));
  }
  if (this.recipientType === 'teacher' && !this.teacherId) {
    return next(new Error('teacherId is required when recipientType is "teacher"'));
  }
  next();
});

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;

