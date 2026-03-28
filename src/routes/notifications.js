const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const User = require('../models/User');
const { isOptionalAuth, isAuthenticated } = require('../middleware/auth');
const Joi = require('joi');

/**
 * GET /api/v1/notifications/student/:username
 * Get notifications by student username
 */
router.get('/student/:username', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      userName: Joi.string().optional().trim(),
      read: Joi.boolean().optional(),
      important: Joi.boolean().optional()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const username = req.params.username;

    // Build query - filter by studentId and recipientType
    const query = { 
      studentId: username,
      recipientType: 'student'
    };
    if (value.read !== undefined) {
      query.read = value.read;
    }
    if (value.important !== undefined) {
      query.important = value.important;
    }

    // Find notifications
    const notifications = await Notification.find(query)
      .sort({ datetime: -1 });

    // Format response
    const formattedNotifications = notifications.map(notification => ({
      id: notification._id.toString(),
      recipientType: notification.recipientType,
      studentId: notification.studentId,
      teacherId: notification.teacherId || null,
      title: notification.title,
      message: notification.message,
      summary: notification.summary || null,
      datetime: notification.datetime,
      read: notification.read,
      readAt: notification.readAt || null,
      important: notification.important,
      type: notification.type || null,
      taskId: notification.taskId || null,
      taskTitle: notification.taskTitle || null,
      link: notification.link || null,
      metadata: notification.metadata || {},
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt
    }));

    res.status(200).json({
      success: true,
      data: formattedNotifications
    });
  } catch (error) {
    console.error('❌ Error fetching notifications:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/notifications/teacher/:username
 * Get notifications by teacher username
 */
router.get('/teacher/:username', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      userName: Joi.string().optional().trim(),
      read: Joi.boolean().optional(),
      important: Joi.boolean().optional()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const username = req.params.username;

    // Build query - filter by teacherId and recipientType
    const query = { 
      teacherId: username,
      recipientType: 'teacher'
    };
    if (value.read !== undefined) {
      query.read = value.read;
    }
    if (value.important !== undefined) {
      query.important = value.important;
    }

    // Find notifications
    const notifications = await Notification.find(query)
      .sort({ datetime: -1 });

    // Format response
    const formattedNotifications = notifications.map(notification => ({
      id: notification._id.toString(),
      recipientType: notification.recipientType,
      studentId: notification.studentId || null,
      teacherId: notification.teacherId,
      title: notification.title,
      message: notification.message,
      summary: notification.summary || null,
      datetime: notification.datetime,
      read: notification.read,
      readAt: notification.readAt || null,
      important: notification.important,
      type: notification.type || null,
      taskId: notification.taskId || null,
      taskTitle: notification.taskTitle || null,
      link: notification.link || null,
      metadata: notification.metadata || {},
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt
    }));

    res.status(200).json({
      success: true,
      data: formattedNotifications
    });
  } catch (error) {
    console.error('❌ Error fetching teacher notifications:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/notifications
 * Get notifications by userName query parameter (for backward compatibility)
 */
router.get('/', isOptionalAuth, async (req, res) => {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/121bb795-66ba-4714-b528-2bbf010585d7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'notifications.js:157',message:'GET /notifications entry',data:{userName:req.query.userName,hasSession:!!req.session,hasUser:!!req.user},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    
    const schema = Joi.object({
      userName: Joi.string().required().trim(),
      read: Joi.boolean().optional(),
      important: Joi.boolean().optional()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    // Determine if userName is a student or teacher by checking User collection
    const user = await User.findOne({
      $or: [
        { username: value.userName },
        { email: value.userName }
      ]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Build query based on user type
    const query = {};
    if (user.type === 'student') {
      query.studentId = value.userName;
      query.recipientType = 'student';
    } else if (user.type === 'teacher' || user.type === 'school' || user.type === 'admin') {
      query.teacherId = value.userName;
      query.recipientType = 'teacher';
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid user type'
      });
    }

    if (value.read !== undefined) {
      query.read = value.read;
    }
    if (value.important !== undefined) {
      query.important = value.important;
    }

    // Find notifications
    const notifications = await Notification.find(query)
      .sort({ datetime: -1 });

    // Format response
    const formattedNotifications = notifications.map(notification => ({
      id: notification._id.toString(),
      recipientType: notification.recipientType,
      studentId: notification.studentId || null,
      teacherId: notification.teacherId || null,
      title: notification.title,
      message: notification.message,
      summary: notification.summary || null,
      datetime: notification.datetime,
      read: notification.read,
      readAt: notification.readAt || null,
      important: notification.important,
      type: notification.type || null,
      taskId: notification.taskId || null,
      taskTitle: notification.taskTitle || null,
      link: notification.link || null,
      metadata: notification.metadata || {},
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt
    }));

    res.status(200).json({
      success: true,
      data: formattedNotifications
    });
  } catch (error) {
    console.error('❌ Error fetching notifications:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/notifications
 * Create a new notification
 */
router.post('/', isAuthenticated, async (req, res) => {
  try {
    const schema = Joi.object({
      recipientType: Joi.string().valid('student', 'teacher').required(),
      studentId: Joi.string().when('recipientType', {
        is: 'student',
        then: Joi.required(),
        otherwise: Joi.optional().allow(null, '')
      }).trim(),
      teacherId: Joi.string().when('recipientType', {
        is: 'teacher',
        then: Joi.required(),
        otherwise: Joi.optional().allow(null, '')
      }).trim(),
      title: Joi.string().required().trim(),
      message: Joi.string().required().trim(),
      summary: Joi.string().optional().trim().allow('', null),
      type: Joi.string().optional().trim().allow('', null),
      taskId: Joi.string().optional().trim().allow('', null),
      taskTitle: Joi.string().optional().trim().allow('', null),
      link: Joi.string().optional().trim().allow('', null),
      important: Joi.boolean().optional(),
      datetime: Joi.date().optional(),
      metadata: Joi.object().optional()
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Create notification
    const notificationData = {
      recipientType: value.recipientType,
      title: value.title,
      message: value.message,
      summary: value.summary || null,
      type: value.type || null,
      taskId: value.taskId || null,
      taskTitle: value.taskTitle || null,
      link: value.link || null,
      important: value.important || false,
      datetime: value.datetime || new Date(),
      metadata: value.metadata || {}
    };

    // Set the appropriate ID field based on recipientType
    if (value.recipientType === 'student') {
      notificationData.studentId = value.studentId;
    } else if (value.recipientType === 'teacher') {
      notificationData.teacherId = value.teacherId;
    }

    const notification = new Notification(notificationData);

    await notification.save();

    res.status(201).json({
      success: true,
      message: 'Notification created successfully',
      data: {
        id: notification._id.toString(),
        recipientType: notification.recipientType,
        studentId: notification.studentId || null,
        teacherId: notification.teacherId || null,
        title: notification.title,
        message: notification.message,
        summary: notification.summary || null,
        datetime: notification.datetime,
        read: notification.read,
        readAt: notification.readAt || null,
        important: notification.important,
        type: notification.type || null,
        taskId: notification.taskId || null,
        taskTitle: notification.taskTitle || null,
        link: notification.link || null,
        metadata: notification.metadata || {},
        createdAt: notification.createdAt,
        updatedAt: notification.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error creating notification:', error.message);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: Object.values(error.errors).map(e => e.message).join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create notification',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * PUT /api/v1/notifications/:id/read
 * Mark a notification as read
 */
router.put('/:id/read', isAuthenticated, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const username = req.session.username;

    if (!username) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required - username not found in session'
      });
    }

    // Validate notification ID format (MongoDB ObjectId is 24 hex characters)
    if (!notificationId || notificationId.length !== 24) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID format'
      });
    }

    // Find the notification
    const notification = await Notification.findById(notificationId);

    // Check if notification exists
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Verify the notification belongs to the authenticated user
    const isOwner = (notification.recipientType === 'student' && notification.studentId === username) ||
                    (notification.recipientType === 'teacher' && notification.teacherId === username);
    
    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized - notification does not belong to you'
      });
    }

    // Update notification to mark as read
    notification.read = true;
    notification.readAt = new Date();
    await notification.save();

    res.status(200).json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('❌ Error marking notification as read:', error.message);
    
    // Handle invalid ObjectId
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID format'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * PUT /api/v1/notifications/:id/important
 * Toggle the important status of a notification
 */
router.put('/:id/important', isAuthenticated, async (req, res) => {
  try {
    const notificationId = req.params.id;
    const username = req.session.username;

    if (!username) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required - username not found in session'
      });
    }

    // Validate notification ID format (MongoDB ObjectId is 24 hex characters)
    if (!notificationId || notificationId.length !== 24) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID format'
      });
    }

    // Find the notification
    const notification = await Notification.findById(notificationId);

    // Check if notification exists
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Verify the notification belongs to the authenticated user
    const isOwner = (notification.recipientType === 'student' && notification.studentId === username) ||
                    (notification.recipientType === 'teacher' && notification.teacherId === username);
    
    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized - notification does not belong to you'
      });
    }

    // Toggle important status
    notification.important = !notification.important;
    await notification.save();

    res.status(200).json({
      success: true,
      data: {
        important: notification.important
      },
      message: 'Notification important status updated'
    });
  } catch (error) {
    console.error('❌ Error toggling notification important status:', error.message);
    
    // Handle invalid ObjectId
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID format'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update notification important status',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

