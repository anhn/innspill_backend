const express = require('express');
const router = express.Router();
const Joi = require('joi');
const actionLogger = require('../services/ActionLogger');
const ActionLog = require('../models/ActionLog');
const User = require('../models/User');
const mongoose = require('mongoose');

// Simple optional auth middleware
const isOptionalAuth = (req, res, next) => {
  // Always pass through, but add user info if available
  if (req.session && req.session.userId) {
    req.user = {
      id: req.session.userId,
      email: req.session.userEmail,
      name: req.session.userName
    };
  }
  next();
};

/**
 * GET /api/v1/logs
 * List available logs endpoints
 */
router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Logs API',
    endpoints: {
      'actions': 'GET /api/v1/logs/actions',
      'stats': 'GET /api/v1/logs/stats',
      'recent': 'GET /api/v1/logs/recent',
      'course-plans': 'GET /api/v1/logs/course-plans',
      'track': 'POST /api/v1/logs/track'
    }
  });
});

/**
 * GET /api/v1/logs/actions
 * Get action items from ActionLog table with pagination and filtering
 * Action type comes from the "action" field in ActionLog
 */
router.get('/actions', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      limit: Joi.number().integer().min(1).max(1000).optional(),
      sortBy: Joi.string().valid('timestamp').optional().default('timestamp'),
      sortOrder: Joi.string().valid('asc', 'desc').optional().default('desc'),
      page: Joi.number().integer().min(1).optional(),
      action: Joi.string().optional(), // Filter by action type from "action" field
      userId: Joi.string().optional().trim(), // Filter by specific userId (optional)
      coursePlanName: Joi.string().optional(),
      startDate: Joi.string().isoDate().optional(),
      endDate: Joi.string().isoDate().optional()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const options = {
      page: parseInt(value.page) || 1,
      limit: parseInt(value.limit) || 50,
      // Don't filter by logged-in user - show all actions for monitoring
      // Only filter by userId if explicitly provided as query parameter
      userId: value.userId || undefined,
      action: value.action, // Filter by action type from ActionLog.action field
      coursePlanName: value.coursePlanName,
      startDate: value.startDate,
      endDate: value.endDate,
      sortBy: value.sortBy,
      sortOrder: value.sortOrder
    };

    // Get action logs from ActionLog table
    const result = await actionLogger.getActionLogs(options);
    
    if (result.success) {
      // Get unique userIds from logs to fetch usernames
      const userIds = [...new Set(result.data.logs.map(log => log.userId).filter(Boolean))];
      const userMap = {};
      
      if (userIds.length > 0) {
        // Try to match userIds as ObjectIds first, then as usernames
        const objectIdArray = userIds.filter(id => mongoose.Types.ObjectId.isValid(id));
        const usernameArray = userIds.filter(id => !mongoose.Types.ObjectId.isValid(id));

        const usersById = await User.find({ _id: { $in: objectIdArray.map(id => new mongoose.Types.ObjectId(id)) } })
          .select('_id username')
          .lean();

        const usersByUsername = await User.find({ username: { $in: usernameArray } })
          .select('_id username')
          .lean();

        usersById.forEach(user => {
          userMap[user._id.toString()] = user.username;
        });
        usersByUsername.forEach(user => {
          userMap[user.username] = user.username;
        });
      }

      // Format action items from ActionLog table
      // Action type comes from the "action" field
      const formattedLogs = result.data.logs.map(log => ({
        _id: log._id,
        userId: log.userId || null,
        username: log.userId ? (userMap[log.userId] || null) : null,
        sessionId: log.sessionId || null,
        timestamp: log.timestamp,
        action: log.action, // Action type from ActionLog.action field
        endpoint: log.endpoint,
        method: log.method,
        success: log.success !== undefined ? log.success : true,
        errorMessage: log.errorMessage || null,
        tokenUsage: log.tokenUsage || log.tokenUsageInternal || null,
        processingTime: log.processingTime || null,
        metadata: log.metadata || null
      }));

      res.status(200).json({
        success: true,
        data: {
          logs: formattedLogs,
          pagination: result.data.pagination
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('❌ Error getting action logs from ActionLog table:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/v1/logs/stats
 * Get usage statistics
 */
router.get('/stats', isOptionalAuth, async (req, res) => {
  try {
    const {
      startDate,
      endDate
    } = req.query;

    const options = {
      userId: req.user?.id,
      startDate,
      endDate
    };

    const result = await actionLogger.getUsageStats(options);
    
    if (result.success) {
      res.status(200).json({
        success: true,
        data: result.data
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('❌ Error getting usage stats:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/v1/logs/recent
 * Get recent actions (last 24 hours)
 */
router.get('/recent', isOptionalAuth, async (req, res) => {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const options = {
      page: 1,
      limit: 100,
      userId: req.user?.id,
      startDate: yesterday.toISOString(),
      sortBy: 'timestamp',
      sortOrder: 'desc'
    };

    const result = await actionLogger.getActionLogs(options);
    
    if (result.success) {
      res.status(200).json({
        success: true,
        data: result.data
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('❌ Error getting recent logs:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/v1/logs/course-plans
 * Get logs for specific course plans
 */
router.get('/course-plans', isOptionalAuth, async (req, res) => {
  try {
    const {
      coursePlanName,
      page = 1,
      limit = 20
    } = req.query;

    if (!coursePlanName) {
      return res.status(400).json({
        success: false,
        error: 'Course plan name is required'
      });
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      userId: req.user?.id,
      coursePlanName,
      sortBy: 'timestamp',
      sortOrder: 'desc'
    };

    const result = await actionLogger.getActionLogs(options);
    
    if (result.success) {
      res.status(200).json({
        success: true,
        data: result.data
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('❌ Error getting course plan logs:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/v1/logs/track
 * Track login/logout actions from frontend
 * Non-blocking: failures don't prevent login/logout
 */
router.post('/track', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      userId: Joi.string().optional().allow(null, ''),
      sessionId: Joi.string().required(),
      userAgent: Joi.string().optional().allow(null, ''),
      timestamp: Joi.string().isoDate().optional(),
      action: Joi.string().valid('login', 'logout').required(),
      endpoint: Joi.string().required(),
      method: Joi.string().valid('GET', 'POST', 'PUT', 'DELETE').required(),
      userInfo: Joi.object().optional().allow(null),
      coursePlanName: Joi.string().optional().allow(null, ''),
      requestSize: Joi.number().optional().allow(null),
      responseSize: Joi.number().optional().allow(null),
      tokenUsageInternal: Joi.object().optional().allow(null),
      processingTime: Joi.number().optional().allow(null),
      success: Joi.boolean().required(),
      errorMessage: Joi.string().optional().allow(null, ''),
      metadata: Joi.object().optional().allow(null)
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Extract IP address from request if not provided
    const ipAddress = req.ip || 
                     req.connection.remoteAddress || 
                     req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                     req.socket.remoteAddress ||
                     'unknown';

    // Convert timestamp from ISO string to Date if provided
    const timestamp = value.timestamp ? new Date(value.timestamp) : new Date();

    // Prepare log data
    const logData = {
      userId: value.userId || undefined,
      sessionId: value.sessionId,
      ipAddress: ipAddress,
      userAgent: value.userAgent || req.get('User-Agent') || undefined,
      timestamp: timestamp, // Use converted timestamp (or current date if not provided)
      action: value.action,
      endpoint: value.endpoint,
      method: value.method,
      userInfo: value.userInfo || undefined,
      coursePlanName: value.coursePlanName || undefined,
      requestSize: value.requestSize || undefined,
      responseSize: value.responseSize || undefined,
      tokenUsageInternal: value.tokenUsageInternal || undefined,
      processingTime: value.processingTime || undefined,
      success: value.success,
      errorMessage: value.errorMessage || undefined,
      metadata: value.metadata || {}
    };

    // Log the action (non-blocking - don't fail if logging fails)
    try {
      const result = await actionLogger.logAction(logData);
      if (!result.success) {
        console.error('⚠️ Failed to log action:', result.error);
      }
    } catch (logError) {
      // Log error but don't fail the request
      console.error('⚠️ Error logging action (non-blocking):', logError.message);
    }

    // Always return success to frontend (non-blocking)
    return res.status(200).json({
      success: true,
      message: 'Action logged successfully'
    });
  } catch (error) {
    // Even if validation fails, return success (non-blocking)
    console.error('⚠️ Error in track endpoint (non-blocking):', error.message);
    return res.status(200).json({
      success: true,
      message: 'Action logged successfully'
    });
  }
});

module.exports = router;
