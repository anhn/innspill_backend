const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  email: {
    type: String,
    required: false,
    unique: true,
    sparse: true, // Allows null values while maintaining uniqueness for non-null values
    trim: true,
    lowercase: true
  },
  fullName: {
    type: String,
    required: false,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  date_created: {
    type: Date,
    default: Date.now
  },
  type: {
    type: String,
    required: true,
    enum: ['teacher', 'student', 'admin'],
    default: 'teacher'
  },
  remark: {
    type: String,
    default: ''
  }
}, {
  collection: 'ai4edu_user',
  timestamps: false
});

const User = mongoose.model('User', userSchema);

module.exports = User;


