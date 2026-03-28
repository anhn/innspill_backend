const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const Joi = require('joi');
const User = require('../models/User');
const ActionLog = require('../models/ActionLog');
const Course = require('../models/Course');
const { isOptionalAuth } = require('../middleware/auth');

// Validation schemas
const createUserSchema = Joi.object({
  username: Joi.string().trim().required(),
  email: Joi.string().email().trim().required(),
  fullName: Joi.string().trim().optional().allow('', null),
  password: Joi.string().min(6).required(),
  type: Joi.string().valid('teacher', 'student', 'admin').required(),
  remark: Joi.string().optional().allow('', null) // for courseId assignment
});

const updateUserSchema = Joi.object({
  email: Joi.string().email().trim().optional(),
  fullName: Joi.string().trim().optional().allow('', null),
  password: Joi.string().min(6).optional(),
  type: Joi.string().valid('teacher', 'student', 'admin').optional(),
  remark: Joi.string().optional().allow('', null)
}).min(1);

// List users (optional filters by type or courseId via remark)
router.get('/', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      type: Joi.string().valid('teacher', 'student', 'admin').optional(),
      courseId: Joi.string().optional().trim(), // matches remark
      userName: Joi.string().optional().trim(),
      limit: Joi.number().integer().min(1).max(1000).optional(),
      sortBy: Joi.string().valid('lastActive', 'date_created').optional().default('date_created'),
      sortOrder: Joi.string().valid('asc', 'desc').optional().default('desc')
    });
    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({ success: false, message: 'Invalid query parameters', error: error.details[0].message });
    }

    const filter = {};
    if (value.type) filter.type = value.type;
    if (value.courseId) filter.remark = value.courseId;

    // Get all users (or filtered)
    let users = await User.find(filter).select('-password').lean();

    // Build course map for student users whose remark contains a courseId
    const studentCourseIds = users
      .filter(u => u.type === 'student' && u.remark && mongoose.Types.ObjectId.isValid(u.remark))
      .map(u => u.remark);

    let courseMap = {};
    if (studentCourseIds.length > 0) {
      const courses = await Course.find({ _id: { $in: studentCourseIds } }).lean();
      courseMap = courses.reduce((acc, course) => {
        acc[course._id.toString()] = course;
        return acc;
      }, {});
    }

    // Build maps for matching userIds and usernames
    const userIds = users.map(u => u._id.toString());
    const usernames = users.map(u => u.username);
    const userIdToUsername = {};
    const usernameToId = {};
    users.forEach(u => {
      const id = u._id.toString();
      userIdToUsername[id] = u.username;
      usernameToId[u.username] = id;
    });

    // Query ActionLog for last activity per user
    // Match by both ObjectId strings and usernames
    const lastActivityMap = {};
    const lastActivityAggregation = await ActionLog.aggregate([
      {
        $match: {
          userId: { $in: [...userIds, ...usernames] }
        }
      },
      {
        $group: {
          _id: '$userId',
          lastActive: { $max: '$timestamp' }
        }
      }
    ]);

    // Build map of userId -> lastActive
    // Map both ObjectId strings and usernames to the user's ObjectId
    lastActivityAggregation.forEach(item => {
      if (item._id) {
        // If it's an ObjectId string, use it directly
        if (userIds.includes(item._id)) {
          lastActivityMap[item._id] = item.lastActive;
        }
        // If it's a username, map it to the user's ObjectId
        else if (usernames.includes(item._id) && usernameToId[item._id]) {
          lastActivityMap[usernameToId[item._id]] = item.lastActive;
        }
      }
    });

    // Format users with lastActive
    let formatted = users.map(u => {
      const userId = u._id.toString();
      const username = u.username;
      // Try to find lastActive by userId or username
      const lastActive = lastActivityMap[userId] || lastActivityMap[username] || null;

      const course =
        u.type === 'student' && u.remark && mongoose.Types.ObjectId.isValid(u.remark)
          ? courseMap[u.remark] || null
          : null;

      return {
        id: userId,
        username: u.username,
        email: u.email || '',
        fullName: u.fullName || '',
        type: u.type,
        remark: u.remark || '',
        courseId: u.type === 'student' ? u.remark || '' : '',
        courseName: course ? course.name : '',
        lastActive: lastActive,
        date_created: u.date_created
      };
    });

    // Sort by sortBy field
    const sortField = value.sortBy === 'lastActive' ? 'lastActive' : 'date_created';
    const sortDirection = value.sortOrder === 'asc' ? 1 : -1;
    
    formatted.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      
      // Handle null/undefined values (put them at the end for desc, at the start for asc)
      if (!aVal && !bVal) return 0;
      if (!aVal) return sortDirection === 1 ? 1 : -1;
      if (!bVal) return sortDirection === 1 ? -1 : 1;
      
      if (aVal < bVal) return -sortDirection;
      if (aVal > bVal) return sortDirection;
      return 0;
    });

    // Apply limit if specified
    if (value.limit) {
      formatted = formatted.slice(0, value.limit);
    }

    return res.status(200).json({ success: true, data: formatted });
  } catch (err) {
    console.error('❌ Error listing users:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to list users', error: err.message });
  }
});

// Create user
router.post('/', isOptionalAuth, async (req, res) => {
  try {
    const { error, value } = createUserSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: 'Invalid request body', error: error.details[0].message });
    }

    const existing = await User.findOne({
      $or: [{ email: value.email.toLowerCase() }, { username: value.username.toLowerCase() }]
    });
    if (existing) {
      return res.status(409).json({ success: false, message: 'User with this email or username already exists' });
    }

    const hashedPassword = await bcrypt.hash(value.password, 10);
    const user = new User({
      username: value.username.toLowerCase(),
      email: value.email.toLowerCase(),
      fullName: value.fullName || '',
      password: hashedPassword,
      type: value.type,
      remark: value.remark || '',
      date_created: new Date()
    });
    await user.save();

    return res.status(201).json({
      success: true,
      data: {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        type: user.type,
        remark: user.remark || '',
        date_created: user.date_created
      }
    });
  } catch (err) {
    console.error('❌ Error creating user:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to create user', error: err.message });
  }
});

// Update user
router.put('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID format' });
    }

    const { error, value } = updateUserSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: 'Invalid request body', error: error.details[0].message });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (value.email !== undefined) user.email = value.email.toLowerCase();
    if (value.fullName !== undefined) user.fullName = value.fullName || '';
    if (value.type !== undefined) user.type = value.type;
    if (value.remark !== undefined) user.remark = value.remark || '';
    if (value.password !== undefined) {
      user.password = await bcrypt.hash(value.password, 10);
    }

    await user.save();

    return res.status(200).json({
      success: true,
      data: {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        type: user.type,
        remark: user.remark || '',
        date_created: user.date_created
      }
    });
  } catch (err) {
    console.error('❌ Error updating user:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update user', error: err.message });
  }
});

// Delete user
router.delete('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID format' });
    }

    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({ success: true, message: 'User deleted' });
  } catch (err) {
    console.error('❌ Error deleting user:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to delete user', error: err.message });
  }
});

// Assign or unassign a course to a user (uses remark field to store courseId)
router.post('/:id/assign-course', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID format' });
    }

    const schema = Joi.object({
      courseId: Joi.string().allow('', null).optional(), // empty/null to unassign
      userName: Joi.string().optional().trim()
    });
    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: 'Invalid request body', error: error.details[0].message });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (value.courseId && !mongoose.Types.ObjectId.isValid(value.courseId)) {
      return res.status(400).json({ success: false, message: 'Invalid courseId format' });
    }

    user.remark = value.courseId || '';
    await user.save();

    return res.status(200).json({
      success: true,
      data: {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        type: user.type,
        remark: user.remark || '',
        date_created: user.date_created
      }
    });
  } catch (err) {
    console.error('❌ Error assigning course:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to assign course', error: err.message });
  }
});

module.exports = router;

