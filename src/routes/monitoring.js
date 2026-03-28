const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ActionLog = require('../models/ActionLog');
const User = require('../models/User');
const UserFeedback = require('../models/UserFeedback');
const AILiteracyStatus = require('../models/AILiteracyStatus');
const ChatSession = require('../models/ChatSession');
const QuizSubmission = require('../models/QuizSubmission');
const Prompt = require('../models/Prompt');
const { isOptionalAuth } = require('../middleware/auth');
const Joi = require('joi');

// Module mapping: action types to modules
const MODULE_MAPPING = {
  aiLiteracy: [
    'create-course-plan',
    'update-course-plan',
    'create-lecture-plan',
    'revise-course-plan',
    'analyze-course-plan',
    'analyze-feedback',
    'general-chat'
  ],
  prompting: [
    'revise-prompt',
    'generate-learning-objectives',
    'generate-format-description',
    'generate-examples'
  ],
  assessment: [
    'generate-feedback',
    'generate-feedback-batch',
    'generate-quiz',
    'stakeholder-chat'
  ],
  worksheets: [
    'generate-worksheet'
  ]
};

// Helper function to get module from action
function getModuleFromAction(action) {
  for (const [module, actions] of Object.entries(MODULE_MAPPING)) {
    if (actions.includes(action)) {
      return module;
    }
  }
  return null;
}

// Helper function to get date range for period
function getDateRange(period, startDate, endDate) {
  const now = new Date();
  let start, end;

  if (startDate && endDate) {
    start = new Date(startDate);
    end = new Date(endDate);
  } else if (period === 'weekly') {
    end = endDate ? new Date(endDate) : new Date(now);
    start = startDate ? new Date(startDate) : new Date(now);
    start.setDate(start.getDate() - 7);
  } else if (period === 'monthly') {
    end = endDate ? new Date(endDate) : new Date(now);
    start = startDate ? new Date(startDate) : new Date(now);
    start.setMonth(start.getMonth() - 1);
  } else {
    throw new Error('Invalid period');
  }

  // Set to start/end of day
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

// Helper function to generate daily breakdown
function generateDailyBreakdown(start, end, dataMap) {
  const breakdown = [];
  const current = new Date(start);
  
  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    breakdown.push({
      date: dateStr,
      ...(dataMap[dateStr] || {})
    });
    current.setDate(current.getDate() + 1);
  }
  
  return breakdown;
}

/**
 * GET /api/v1/monitoring/platform-usage
 * Get platform usage metrics (active users, new registrations, session duration, feedback ratings)
 */
router.get('/platform-usage', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      period: Joi.string().valid('weekly', 'monthly').required(),
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

    const { start, end } = getDateRange(value.period, value.startDate, value.endDate);

    // Get active users (users who have action logs in the period)
    const activeUsersQuery = await ActionLog.aggregate([
      {
        $match: {
          timestamp: { $gte: start, $lte: end },
          userId: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$userId',
          lastActivity: { $max: '$timestamp' }
        }
      }
    ]);
    const activeUsers = activeUsersQuery.length;

    // Get new registrations
    const newRegistrations = await User.countDocuments({
      date_created: { $gte: start, $lte: end }
    });

    // Calculate average session duration
    // Group by sessionId and calculate duration between first and last action
    const sessionDurations = await ActionLog.aggregate([
      {
        $match: {
          timestamp: { $gte: start, $lte: end },
          sessionId: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$sessionId',
          firstAction: { $min: '$timestamp' },
          lastAction: { $max: '$timestamp' }
        }
      },
      {
        $project: {
          duration: {
            $divide: [
              { $subtract: ['$lastAction', '$firstAction'] },
              1000 // Convert to seconds
            ]
          }
        }
      }
    ]);

    const totalDuration = sessionDurations.reduce((sum, s) => sum + (s.duration || 0), 0);
    const averageSessionDuration = sessionDurations.length > 0
      ? Math.round(totalDuration / sessionDurations.length)
      : 0;

    // Get average feedback ratings
    const feedbackStats = await UserFeedback.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: null,
          avgExperience: { $avg: '$experienceRating' },
          avgAiCompetence: { $avg: '$aiCompetenceRating' },
          avgLearning: { $avg: '$learningRating' }
        }
      }
    ]);

    // Handle null/undefined values from aggregation
    const stats = feedbackStats && feedbackStats[0] ? feedbackStats[0] : null;
    const averageFeedbackRatings = {
      experienceRating: stats && stats.avgExperience !== null && stats.avgExperience !== undefined
        ? Math.round(stats.avgExperience * 100) / 100
        : 0,
      aiCompetenceRating: stats && stats.avgAiCompetence !== null && stats.avgAiCompetence !== undefined
        ? Math.round(stats.avgAiCompetence * 100) / 100
        : 0,
      learningRating: stats && stats.avgLearning !== null && stats.avgLearning !== undefined
        ? Math.round(stats.avgLearning * 100) / 100
        : 0
    };

    // Daily breakdown
    const dailyActiveUsers = await ActionLog.aggregate([
      {
        $match: {
          timestamp: { $gte: start, $lte: end },
          userId: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            userId: '$userId'
          }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          activeUsers: { $sum: 1 }
        }
      }
    ]);

    const dailyRegistrations = await User.aggregate([
      {
        $match: {
          date_created: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date_created' } },
          newRegistrations: { $sum: 1 }
        }
      }
    ]);

    const dailySessions = await ActionLog.aggregate([
      {
        $match: {
          timestamp: { $gte: start, $lte: end },
          sessionId: { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            sessionId: '$sessionId'
          },
          firstAction: { $min: '$timestamp' },
          lastAction: { $max: '$timestamp' }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          avgDuration: {
            $avg: {
              $divide: [
                { $subtract: ['$lastAction', '$firstAction'] },
                1000
              ]
            }
          }
        }
      }
    ]);

    const dailyMap = {};
    dailyActiveUsers.forEach(item => {
      dailyMap[item._id] = { ...dailyMap[item._id], activeUsers: item.activeUsers };
    });
    dailyRegistrations.forEach(item => {
      dailyMap[item._id] = { ...dailyMap[item._id], newRegistrations: item.newRegistrations };
    });
    dailySessions.forEach(item => {
      dailyMap[item._id] = {
        ...dailyMap[item._id],
        averageSessionDuration: Math.round(item.avgDuration || 0)
      };
    });

    const dailyBreakdown = generateDailyBreakdown(start, end, dailyMap);

    res.status(200).json({
      success: true,
      data: {
        period: value.period,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        activeUsers,
        newRegistrations,
        averageSessionDuration,
        averageFeedbackRatings,
        dailyBreakdown
      }
    });
  } catch (error) {
    console.error('❌ Error fetching platform usage:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch platform usage metrics',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/monitoring/module-usage
 * Get module usage by users
 */
router.get('/module-usage', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      period: Joi.string().valid('weekly', 'monthly').required(),
      startDate: Joi.string().isoDate().optional(),
      endDate: Joi.string().isoDate().optional(),
      userId: Joi.string().optional().trim()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const { start, end } = getDateRange(value.period, value.startDate, value.endDate);

    // Build query
    const matchQuery = {
      timestamp: { $gte: start, $lte: end }
    };
    if (value.userId) {
      matchQuery.userId = value.userId;
    }

    // Get module usage - fetch all actions and map in JavaScript
    const allActions = await ActionLog.find(matchQuery)
      .select('action userId')
      .lean();

    // Map actions to modules in JavaScript
    const moduleStatsMap = {};
    allActions.forEach(log => {
      const module = getModuleFromAction(log.action);
      if (!module) return;

      if (!moduleStatsMap[module]) {
        moduleStatsMap[module] = {
          totalActions: 0,
          uniqueUsers: new Set(),
          actionsByUser: {}
        };
      }

      moduleStatsMap[module].totalActions++;
      if (log.userId) {
        moduleStatsMap[module].uniqueUsers.add(log.userId);
        if (!moduleStatsMap[module].actionsByUser[log.userId]) {
          moduleStatsMap[module].actionsByUser[log.userId] = 0;
        }
        moduleStatsMap[module].actionsByUser[log.userId]++;
      }
    });

    // Convert to array format
    const moduleStats = Object.entries(moduleStatsMap).map(([module, stats]) => ({
      _id: module,
      totalActions: stats.totalActions,
      uniqueUsers: Array.from(stats.uniqueUsers),
      actionsByUser: Object.entries(stats.actionsByUser).map(([userId, count]) => ({
        userId,
        count
      }))
    }));

    // Format module data
    const modules = {};
    const moduleNames = ['aiLiteracy', 'prompting', 'assessment', 'worksheets'];
    
    moduleNames.forEach(moduleName => {
      const stats = moduleStats.find(s => s._id === moduleName);
      if (stats) {
        modules[moduleName] = {
          totalActions: stats.totalActions,
          uniqueUsers: stats.uniqueUsers.filter(u => u).length,
          actionsByUser: stats.actionsByUser
            .filter(a => a.userId)
            .sort((a, b) => b.count - a.count)
            .slice(0, 20) // Top 20 users
        };
      } else {
        modules[moduleName] = {
          totalActions: 0,
          uniqueUsers: 0,
          actionsByUser: []
        };
      }
    });

    // Get user usernames for actionsByUser
    const userIds = new Set();
    Object.values(modules).forEach(module => {
      module.actionsByUser.forEach(item => {
        if (item.userId) userIds.add(item.userId);
      });
    });

    // Try to match userIds as ObjectIds first, then as usernames
    const userIdArray = Array.from(userIds);
    const objectIdArray = userIdArray.filter(id => mongoose.Types.ObjectId.isValid(id));
    const usernameArray = userIdArray.filter(id => !mongoose.Types.ObjectId.isValid(id));

    const usersById = await User.find({ _id: { $in: objectIdArray.map(id => new mongoose.Types.ObjectId(id)) } })
      .select('_id username')
      .lean();

    const usersByUsername = await User.find({ username: { $in: usernameArray } })
      .select('_id username')
      .lean();

    const userMap = {};
    usersById.forEach(user => {
      userMap[user._id.toString()] = user.username;
    });
    usersByUsername.forEach(user => {
      userMap[user.username] = user.username;
    });

    // Add usernames to actionsByUser
    Object.values(modules).forEach(module => {
      module.actionsByUser.forEach(item => {
        item.username = userMap[item.userId] || null;
      });
    });

    // Daily breakdown - fetch and process in JavaScript
    const dailyActions = await ActionLog.find(matchQuery)
      .select('action timestamp')
      .lean();

    const dailyModuleUsageMap = {};
    dailyActions.forEach(log => {
      const module = getModuleFromAction(log.action);
      if (!module) return;

      const date = new Date(log.timestamp).toISOString().split('T')[0];
      if (!dailyModuleUsageMap[date]) {
        dailyModuleUsageMap[date] = {
          aiLiteracy: 0,
          prompting: 0,
          assessment: 0,
          worksheets: 0
        };
      }
      if (dailyModuleUsageMap[date][module] !== undefined) {
        dailyModuleUsageMap[date][module]++;
      }
    });

    const dailyBreakdown = generateDailyBreakdown(start, end, dailyModuleUsageMap);

    // Convert modules object to array format for frontend
    const modulesArray = Object.entries(modules).map(([moduleName, moduleData]) => ({
      name: moduleName,
      ...moduleData
    }));

    res.status(200).json({
      success: true,
      data: {
        period: value.period,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        modules: modulesArray, // Return as array instead of object
        modulesObject: modules, // Keep object format as well for backward compatibility
        dailyBreakdown
      }
    });
  } catch (error) {
    console.error('❌ Error fetching module usage:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch module usage metrics',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/monitoring/llm-usage
 * Get LLM usage metrics (tokens, processing time) by module and user
 */
router.get('/llm-usage', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      period: Joi.string().valid('weekly', 'monthly').required(),
      startDate: Joi.string().isoDate().optional(),
      endDate: Joi.string().isoDate().optional(),
      userId: Joi.string().optional().trim(),
      module: Joi.string().valid('aiLiteracy', 'prompting', 'assessment', 'worksheets').optional()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const { start, end } = getDateRange(value.period, value.startDate, value.endDate);

    // Build query
    const matchQuery = {
      timestamp: { $gte: start, $lte: end },
      tokenUsageInternal: { $exists: true, $ne: null }
    };
    if (value.userId) {
      matchQuery.userId = value.userId;
    }

    // Filter by module if specified
    if (value.module) {
      const moduleActions = MODULE_MAPPING[value.module] || [];
      matchQuery.action = { $in: moduleActions };
    }

    // Get LLM usage by module - fetch and process in JavaScript
    const llmLogs = await ActionLog.find(matchQuery)
      .select('action tokenUsageInternal processingTime')
      .lean();

    const moduleUsageMap = {};
    llmLogs.forEach(log => {
      const module = getModuleFromAction(log.action);
      if (!module) return;

      if (!moduleUsageMap[module]) {
        moduleUsageMap[module] = {
          totalRequestSize: 0,
          totalResponseSize: 0,
          totalProcessingTime: 0,
          requestCount: 0
        };
      }

      const tokens = log.tokenUsageInternal || {};
      const requestTokens = tokens.promptTokens || 0;
      const responseTokens = tokens.completionTokens || 0;
      const processingTime = (log.processingTime || 0) / 1000; // Convert to seconds

      moduleUsageMap[module].totalRequestSize += requestTokens;
      moduleUsageMap[module].totalResponseSize += responseTokens;
      moduleUsageMap[module].totalProcessingTime += processingTime;
      moduleUsageMap[module].requestCount++;
    });

    const moduleUsage = Object.entries(moduleUsageMap).map(([module, stats]) => ({
      _id: module,
      totalRequestSize: stats.totalRequestSize,
      totalResponseSize: stats.totalResponseSize,
      totalProcessingTime: stats.totalProcessingTime,
      requestCount: stats.requestCount,
      avgRequestSize: stats.requestCount > 0 ? stats.totalRequestSize / stats.requestCount : 0,
      avgResponseSize: stats.requestCount > 0 ? stats.totalResponseSize / stats.requestCount : 0,
      avgProcessingTime: stats.requestCount > 0 ? stats.totalProcessingTime / stats.requestCount : 0
    }));

    // Format by module
    const byModule = {};
    const moduleNames = ['aiLiteracy', 'prompting', 'assessment', 'worksheets'];
    
    moduleNames.forEach(moduleName => {
      const stats = moduleUsage.find(s => s._id === moduleName);
      if (stats) {
        byModule[moduleName] = {
          totalRequestSize: stats.totalRequestSize,
          totalResponseSize: stats.totalResponseSize,
          totalProcessingTime: Math.round(stats.totalProcessingTime),
          averageRequestSize: Math.round(stats.avgRequestSize),
          averageResponseSize: Math.round(stats.avgResponseSize),
          averageProcessingTime: Math.round(stats.avgProcessingTime),
          requestCount: stats.requestCount
        };
      } else {
        byModule[moduleName] = {
          totalRequestSize: 0,
          totalResponseSize: 0,
          totalProcessingTime: 0,
          averageRequestSize: 0,
          averageResponseSize: 0,
          averageProcessingTime: 0,
          requestCount: 0
        };
      }
    });

    // Get LLM usage by user - fetch and process in JavaScript
    const userLlmLogs = await ActionLog.find({
      ...matchQuery,
      userId: { $exists: true, $ne: null }
    })
      .select('action userId tokenUsageInternal processingTime')
      .lean();

    const userUsageMap = {};
    userLlmLogs.forEach(log => {
      const module = getModuleFromAction(log.action);
      if (!module || !log.userId) return;

      if (!userUsageMap[log.userId]) {
        userUsageMap[log.userId] = {
          totalRequestSize: 0,
          totalResponseSize: 0,
          totalProcessingTime: 0,
          moduleBreakdown: {}
        };
      }

      const tokens = log.tokenUsageInternal || {};
      const requestTokens = tokens.promptTokens || 0;
      const responseTokens = tokens.completionTokens || 0;
      const processingTime = (log.processingTime || 0) / 1000; // Convert to seconds

      userUsageMap[log.userId].totalRequestSize += requestTokens;
      userUsageMap[log.userId].totalResponseSize += responseTokens;
      userUsageMap[log.userId].totalProcessingTime += processingTime;

      if (!userUsageMap[log.userId].moduleBreakdown[module]) {
        userUsageMap[log.userId].moduleBreakdown[module] = {
          requestSize: 0,
          responseSize: 0,
          processingTime: 0
        };
      }

      userUsageMap[log.userId].moduleBreakdown[module].requestSize += requestTokens;
      userUsageMap[log.userId].moduleBreakdown[module].responseSize += responseTokens;
      userUsageMap[log.userId].moduleBreakdown[module].processingTime += processingTime;
    });

    const userUsage = Object.entries(userUsageMap)
      .map(([userId, stats]) => ({
        _id: userId,
        totalRequestSize: stats.totalRequestSize,
        totalResponseSize: stats.totalResponseSize,
        totalProcessingTime: stats.totalProcessingTime,
        moduleBreakdown: stats.moduleBreakdown
      }))
      .sort((a, b) => b.totalRequestSize - a.totalRequestSize)
      .slice(0, 50); // Top 50 users

    // Get usernames - try ObjectId first, then username
    const userIds = userUsage.map(u => u._id).filter(Boolean);
    const objectIdArray = userIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    const usernameArray = userIds.filter(id => !mongoose.Types.ObjectId.isValid(id));

    const usersById = await User.find({ _id: { $in: objectIdArray.map(id => new mongoose.Types.ObjectId(id)) } })
      .select('_id username')
      .lean();

    const usersByUsername = await User.find({ username: { $in: usernameArray } })
      .select('_id username')
      .lean();

    const userMap = {};
    usersById.forEach(user => {
      userMap[user._id.toString()] = user.username;
    });
    usersByUsername.forEach(user => {
      userMap[user.username] = user.username;
    });

    const byUser = userUsage.map(item => {
      // moduleBreakdown is already an object, just round the processingTime values
      const roundedModuleBreakdown = {};
      Object.entries(item.moduleBreakdown || {}).forEach(([module, data]) => {
        roundedModuleBreakdown[module] = {
          requestSize: data.requestSize,
          responseSize: data.responseSize,
          processingTime: Math.round(data.processingTime)
        };
      });

      return {
        userId: item._id,
        username: userMap[item._id] || null,
        totalRequestSize: item.totalRequestSize,
        totalResponseSize: item.totalResponseSize,
        totalProcessingTime: Math.round(item.totalProcessingTime),
        moduleBreakdown: roundedModuleBreakdown
      };
    });

    // Daily breakdown - fetch and process in JavaScript
    const dailyLlmLogs = await ActionLog.find(matchQuery)
      .select('action timestamp tokenUsageInternal processingTime')
      .lean();

    const dailyUsageMap = {};
    dailyLlmLogs.forEach(log => {
      const module = getModuleFromAction(log.action);
      if (!module) return;

      const date = new Date(log.timestamp).toISOString().split('T')[0];
      if (!dailyUsageMap[date]) {
        dailyUsageMap[date] = {
          totalRequestSize: 0,
          totalResponseSize: 0,
          totalProcessingTime: 0,
          byModule: {
            aiLiteracy: { requestSize: 0, responseSize: 0, processingTime: 0 },
            prompting: { requestSize: 0, responseSize: 0, processingTime: 0 },
            assessment: { requestSize: 0, responseSize: 0, processingTime: 0 },
            worksheets: { requestSize: 0, responseSize: 0, processingTime: 0 }
          }
        };
      }

      const tokens = log.tokenUsageInternal || {};
      const requestTokens = tokens.promptTokens || 0;
      const responseTokens = tokens.completionTokens || 0;
      const processingTime = (log.processingTime || 0) / 1000; // Convert to seconds

      dailyUsageMap[date].totalRequestSize += requestTokens;
      dailyUsageMap[date].totalResponseSize += responseTokens;
      dailyUsageMap[date].totalProcessingTime += processingTime;

      if (dailyUsageMap[date].byModule[module]) {
        dailyUsageMap[date].byModule[module].requestSize += requestTokens;
        dailyUsageMap[date].byModule[module].responseSize += responseTokens;
        dailyUsageMap[date].byModule[module].processingTime += processingTime;
      }
    });

    const dailyBreakdown = generateDailyBreakdown(start, end, dailyUsageMap).map(day => ({
      ...day,
      totalProcessingTime: Math.round(day.totalProcessingTime || 0),
      byModule: day.byModule || {
        aiLiteracy: { requestSize: 0, responseSize: 0, processingTime: 0 },
        prompting: { requestSize: 0, responseSize: 0, processingTime: 0 },
        assessment: { requestSize: 0, responseSize: 0, processingTime: 0 },
        worksheets: { requestSize: 0, responseSize: 0, processingTime: 0 }
      }
    }));

    // Convert byModule object to array format for frontend
    const byModuleArray = Object.entries(byModule).map(([moduleName, moduleData]) => ({
      name: moduleName,
      ...moduleData
    }));

    // Calculate summary totals
    const summary = {
      totalRequestSize: byModuleArray.reduce((sum, m) => sum + (m.totalRequestSize || 0), 0),
      totalResponseSize: byModuleArray.reduce((sum, m) => sum + (m.totalResponseSize || 0), 0),
      totalProcessingTime: byModuleArray.reduce((sum, m) => sum + (m.totalProcessingTime || 0), 0),
      totalRequestCount: byModuleArray.reduce((sum, m) => sum + (m.requestCount || 0), 0),
      averageRequestSize: byModuleArray.length > 0 
        ? Math.round(byModuleArray.reduce((sum, m) => sum + (m.averageRequestSize || 0), 0) / byModuleArray.length)
        : 0,
      averageResponseSize: byModuleArray.length > 0
        ? Math.round(byModuleArray.reduce((sum, m) => sum + (m.averageResponseSize || 0), 0) / byModuleArray.length)
        : 0,
      averageProcessingTime: byModuleArray.length > 0
        ? Math.round(byModuleArray.reduce((sum, m) => sum + (m.averageProcessingTime || 0), 0) / byModuleArray.length)
        : 0
    };

    res.status(200).json({
      success: true,
      data: {
        period: value.period,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        summary,
        byModule: byModuleArray, // Return as array instead of object
        byModuleObject: byModule, // Keep object format as well for backward compatibility
        byUser,
        dailyBreakdown
      }
    });
  } catch (error) {
    console.error('❌ Error fetching LLM usage:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch LLM usage metrics',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/monitoring/dashboard
 * Get all monitoring metrics in one response
 */
router.get('/dashboard', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      period: Joi.string().valid('weekly', 'monthly').required(),
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

    // For now, return a message directing to use individual endpoints
    // In production, you could refactor the logic into shared functions
    // and call them here to aggregate all data
    
    res.status(200).json({
      success: true,
      message: 'Dashboard endpoint - use individual endpoints for detailed data',
      endpoints: {
        platformUsage: `/api/v1/monitoring/platform-usage?period=${value.period}`,
        moduleUsage: `/api/v1/monitoring/module-usage?period=${value.period}`,
        llmUsage: `/api/v1/monitoring/llm-usage?period=${value.period}`
      },
      note: 'For aggregated dashboard data, call the three endpoints above in parallel and combine the results on the frontend.'
    });
  } catch (error) {
    console.error('❌ Error fetching dashboard:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard metrics',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/monitoring/activity/ai-literacy
 * Get list of users with AI literacy progress (top 50)
 */
router.get('/activity/ai-literacy', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      limit: Joi.number().integer().min(1).max(1000).optional().default(50),
      sortBy: Joi.string().valid('progress', 'timestamp', 'level').optional().default('progress'),
      sortOrder: Joi.string().valid('asc', 'desc').optional().default('desc')
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    // Get AI literacy status records directly from MongoDB collection
    let query = AILiteracyStatus.find().populate('userId', 'username');

    // Sort by the specified field
    const sortOrder = value.sortOrder === 'asc' ? 1 : -1;
    if (value.sortBy === 'progress') {
      query = query.sort({ progress: sortOrder, lastAccessed: -1 });
    } else if (value.sortBy === 'timestamp') {
      query = query.sort({ lastAccessed: sortOrder });
    } else if (value.sortBy === 'level') {
      query = query.sort({ 'metadata.level': sortOrder, lastAccessed: -1 });
    }

    // Limit results
    query = query.limit(value.limit);

    const literacyStatuses = await query.lean();

    // Format response directly from AILiteracyStatus collection
    const data = literacyStatuses.map(status => {
      const userId = status.userId?._id?.toString() || status.userId?.toString() || null;
      const username = status.userId?.username || null;
      const lastActivity = status.lastAccessed || status.updatedAt || status.createdAt;

      // Calculate level from progress (assuming 25% per level: 0-24=1, 25-49=2, 50-74=3, 75-100=4)
      const level = Math.min(4, Math.max(1, Math.floor((status.progress || 0) / 25) + 1));
      // Completed levels array
      const completedLevels = [];
      for (let i = 1; i < level; i++) {
        completedLevels.push(i);
      }

      return {
        userId: userId,
        username: username,
        progress: status.progress || 0,
        level: status.metadata?.level || level,
        timestamp: lastActivity ? new Date(lastActivity).toISOString() : new Date().toISOString(),
        completedLevels: status.metadata?.completedLevels || completedLevels
      };
    });

    // Final sort if needed
    if (value.sortBy === 'timestamp') {
      data.sort((a, b) => {
        const aTime = new Date(a.timestamp).getTime();
        const bTime = new Date(b.timestamp).getTime();
        return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
      });
    }

    res.status(200).json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('❌ Error fetching AI literacy activity:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch AI literacy activity',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/monitoring/activity/prompt-revision
 * Get list of users who use prompt revision feature (top 50 most recent)
 */
router.get('/activity/prompt-revision', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      limit: Joi.number().integer().min(1).max(1000).optional().default(50),
      sortBy: Joi.string().valid('timestamp').optional().default('timestamp'),
      sortOrder: Joi.string().valid('asc', 'desc').optional().default('desc')
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    // Query action logs for prompt-related actions
    const promptActions = await ActionLog.find({
      $or: [
        { action: /prompt/i },
        { endpoint: /\/api\/v1\/prompts/i }
      ]
    })
      .sort({ timestamp: value.sortOrder === 'asc' ? 1 : -1 })
      .limit(value.limit * 2) // Get more to group by user
      .select('userId endpoint action timestamp metadata')
      .lean();

    // Group by userId to get latest per user
    const userMap = new Map();
    for (const log of promptActions) {
      const userId = log.userId?.toString();
      if (!userId) continue;

      if (!userMap.has(userId)) {
        userMap.set(userId, log);
      } else {
        const existing = userMap.get(userId);
        const logTime = new Date(log.timestamp).getTime();
        const existingTime = new Date(existing.timestamp).getTime();
        if (logTime > existingTime) {
          userMap.set(userId, log);
        }
      }
    }

    // Get usernames
    const userIds = Array.from(userMap.keys());
    const objectIdArray = userIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    const usernameArray = userIds.filter(id => !mongoose.Types.ObjectId.isValid(id));

    const usersById = await User.find({ _id: { $in: objectIdArray.map(id => new mongoose.Types.ObjectId(id)) } })
      .select('_id username')
      .lean();

    const usersByUsername = await User.find({ username: { $in: usernameArray } })
      .select('_id username')
      .lean();

    const userMap2 = {};
    usersById.forEach(user => {
      userMap2[user._id.toString()] = user.username;
    });
    usersByUsername.forEach(user => {
      userMap2[user.username] = user.username;
    });

    // Format response
    const data = Array.from(userMap.values())
      .sort((a, b) => {
        const aTime = new Date(a.timestamp).getTime();
        const bTime = new Date(b.timestamp).getTime();
        return value.sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
      })
      .slice(0, value.limit)
      .map(log => ({
        userId: log.userId?.toString() || null,
        username: userMap2[log.userId?.toString()] || null,
        timestamp: new Date(log.timestamp).toISOString(),
        action: log.action || 'prompt-revise',
        promptId: log.metadata?.promptId || null,
        endpoint: log.endpoint || '/api/v1/prompts/revise'
      }));

    res.status(200).json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('❌ Error fetching prompt revision activity:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch prompt revision activity',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/monitoring/activity/management-tools
 * Get list of users who use management toolkit (SWOT, Planning Poker, etc.)
 */
router.get('/activity/management-tools', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      limit: Joi.number().integer().min(1).max(1000).optional().default(50),
      toolType: Joi.string().valid('all', 'swot', 'planning-poker').optional().default('all'),
      sortBy: Joi.string().valid('timestamp').optional().default('timestamp'),
      sortOrder: Joi.string().valid('asc', 'desc').optional().default('desc')
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    // Build query for action logs
    let query = {
      $or: []
    };

    if (value.toolType === 'all' || value.toolType === 'swot') {
      query.$or.push(
        { endpoint: /\/api\/v1\/swot-analysis/i },
        { action: /swot/i }
      );
    }
    if (value.toolType === 'all' || value.toolType === 'planning-poker') {
      query.$or.push(
        { endpoint: /\/api\/v1\/planning-poker/i },
        { action: /planning-poker/i }
      );
    }

    if (query.$or.length === 0) {
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    const toolActions = await ActionLog.find(query)
      .sort({ timestamp: value.sortOrder === 'asc' ? 1 : -1 })
      .limit(value.limit * 2) // Get more to group by user
      .select('userId endpoint action timestamp metadata')
      .lean();

    // Group by userId and toolType to get latest per user/tool
    const userToolMap = new Map();
    for (const log of toolActions) {
      const userId = log.userId?.toString();
      if (!userId) continue;

      // Determine tool type
      let toolType = 'Management Tool';
      if (log.endpoint && log.endpoint.includes('swot-analysis')) {
        toolType = 'SWOT';
      } else if (log.endpoint && log.endpoint.includes('planning-poker')) {
        toolType = 'Planning Poker';
      } else if (log.action && log.action.toLowerCase().includes('swot')) {
        toolType = 'SWOT';
      } else if (log.action && log.action.toLowerCase().includes('planning-poker')) {
        toolType = 'Planning Poker';
      }

      const key = `${userId}_${toolType}`;
      if (!userToolMap.has(key)) {
        userToolMap.set(key, { ...log, toolType });
      } else {
        const existing = userToolMap.get(key);
        const logTime = new Date(log.timestamp).getTime();
        const existingTime = new Date(existing.timestamp).getTime();
        if (logTime > existingTime) {
          userToolMap.set(key, { ...log, toolType });
        }
      }
    }

    // Get usernames
    const userIds = Array.from(userToolMap.values()).map(item => item.userId?.toString()).filter(Boolean);
    const uniqueUserIds = [...new Set(userIds)];
    const objectIdArray = uniqueUserIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    const usernameArray = uniqueUserIds.filter(id => !mongoose.Types.ObjectId.isValid(id));

    const usersById = await User.find({ _id: { $in: objectIdArray.map(id => new mongoose.Types.ObjectId(id)) } })
      .select('_id username')
      .lean();

    const usersByUsername = await User.find({ username: { $in: usernameArray } })
      .select('_id username')
      .lean();

    const userMap = {};
    usersById.forEach(user => {
      userMap[user._id.toString()] = user.username;
    });
    usersByUsername.forEach(user => {
      userMap[user.username] = user.username;
    });

    // Format response
    const data = Array.from(userToolMap.values())
      .sort((a, b) => {
        const aTime = new Date(a.timestamp).getTime();
        const bTime = new Date(b.timestamp).getTime();
        return value.sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
      })
      .slice(0, value.limit)
      .map(log => ({
        userId: log.userId?.toString() || null,
        username: userMap[log.userId?.toString()] || null,
        toolType: log.toolType || 'Management Tool',
        timestamp: new Date(log.timestamp).toISOString(),
        groupId: log.metadata?.groupId || null,
        projectId: log.metadata?.projectId || null
      }));

    res.status(200).json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('❌ Error fetching management tools activity:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch management tools activity',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/monitoring/activity/chat-sessions
 * Get list of users with most recent chat sessions (top 50)
 */
router.get('/activity/chat-sessions', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      limit: Joi.number().integer().min(1).max(1000).optional().default(50),
      sortBy: Joi.string().valid('timestamp').optional().default('timestamp'),
      sortOrder: Joi.string().valid('asc', 'desc').optional().default('desc')
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    // Query chat sessions, get latest per user
    const sortOrder = value.sortOrder === 'asc' ? 1 : -1;
    const chatSessions = await ChatSession.find()
      .sort({ startTime: sortOrder })
      .limit(value.limit * 2) // Get more to group by user
      .select('sender _id startTime chatItems')
      .lean();

    // Group by sender (userId/username) to get latest session per user
    const userSessionMap = new Map();
    for (const session of chatSessions) {
      const userId = session.sender?.toString();
      if (!userId) continue;

      if (!userSessionMap.has(userId)) {
        userSessionMap.set(userId, session);
      } else {
        const existing = userSessionMap.get(userId);
        const sessionTime = new Date(session.startTime).getTime();
        const existingTime = new Date(existing.startTime).getTime();
        if (sessionTime > existingTime) {
          userSessionMap.set(userId, session);
        }
      }
    }

    // Get usernames
    const userIds = Array.from(userSessionMap.keys());
    const objectIdArray = userIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    const usernameArray = userIds.filter(id => !mongoose.Types.ObjectId.isValid(id));

    const usersById = await User.find({ _id: { $in: objectIdArray.map(id => new mongoose.Types.ObjectId(id)) } })
      .select('_id username')
      .lean();

    const usersByUsername = await User.find({ username: { $in: usernameArray } })
      .select('_id username')
      .lean();

    const userMap = {};
    usersById.forEach(user => {
      userMap[user._id.toString()] = user.username;
    });
    usersByUsername.forEach(user => {
      userMap[user.username] = user.username;
    });

    // Format response
    const data = Array.from(userSessionMap.values())
      .sort((a, b) => {
        const aTime = new Date(a.startTime).getTime();
        const bTime = new Date(b.startTime).getTime();
        return value.sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
      })
      .slice(0, value.limit)
      .map(session => {
        // Get last message timestamp
        const chatItems = session.chatItems || [];
        const lastMessageTime = chatItems.length > 0
          ? chatItems.reduce((latest, item) => {
              const itemTime = new Date(item.timestamp).getTime();
              const latestTime = latest ? new Date(latest.timestamp).getTime() : 0;
              return itemTime > latestTime ? item : latest;
            }, null)?.timestamp || session.startTime
          : session.startTime;

        return {
          userId: session.sender?.toString() || null,
          username: userMap[session.sender?.toString()] || session.sender || null,
          sessionId: session._id?.toString() || null,
          timestamp: new Date(lastMessageTime).toISOString(),
          messageCount: chatItems.length || 0
        };
      });

    res.status(200).json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('❌ Error fetching chat sessions activity:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch chat sessions activity',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/monitoring/activity/quiz-completions
 * Get list of users with most recent quiz completions (top 50)
 */
router.get('/activity/quiz-completions', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      limit: Joi.number().integer().min(1).max(1000).optional().default(50),
      sortBy: Joi.string().valid('timestamp').optional().default('timestamp'),
      sortOrder: Joi.string().valid('asc', 'desc').optional().default('desc')
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    // Query quiz submissions, filter by isSubmitted = true
    const sortOrder = value.sortOrder === 'asc' ? 1 : -1;
    const quizSubmissions = await QuizSubmission.find({
      isSubmitted: true
    })
      .sort({ submittedAt: sortOrder, createdAt: sortOrder })
      .limit(value.limit * 2) // Get more to group by user
      .populate('quizId', 'title')
      .select('studentId quizId submittedAt score')
      .lean();

    // Group by studentId to get latest completion per user
    const userSubmissionMap = new Map();
    for (const submission of quizSubmissions) {
      const userId = submission.studentId?.toString();
      if (!userId) continue;

      if (!userSubmissionMap.has(userId)) {
        userSubmissionMap.set(userId, submission);
      } else {
        const existing = userSubmissionMap.get(userId);
        const subTime = new Date(submission.submittedAt || submission.createdAt).getTime();
        const existingTime = new Date(existing.submittedAt || existing.createdAt).getTime();
        if (subTime > existingTime) {
          userSubmissionMap.set(userId, submission);
        }
      }
    }

    // Format response
    const data = Array.from(userSubmissionMap.values())
      .sort((a, b) => {
        const aTime = new Date(a.submittedAt || a.createdAt).getTime();
        const bTime = new Date(b.submittedAt || b.createdAt).getTime();
        return value.sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
      })
      .slice(0, value.limit)
      .map(submission => ({
        userId: submission.studentId?.toString() || null,
        username: submission.studentId?.toString() || null, // Will be populated below if possible
        quizId: submission.quizId?._id?.toString() || submission.quizId?.toString() || null,
        quizTitle: submission.quizId?.title || null,
        timestamp: new Date(submission.submittedAt || submission.createdAt).toISOString(),
        score: submission.score || null
      }));

    // Get usernames
    const userIds = data.map(item => item.userId).filter(Boolean);
    const uniqueUserIds = [...new Set(userIds)];
    const objectIdArray = uniqueUserIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    const usernameArray = uniqueUserIds.filter(id => !mongoose.Types.ObjectId.isValid(id));

    const usersById = await User.find({ _id: { $in: objectIdArray.map(id => new mongoose.Types.ObjectId(id)) } })
      .select('_id username')
      .lean();

    const usersByUsername = await User.find({ username: { $in: usernameArray } })
      .select('_id username')
      .lean();

    const userMap = {};
    usersById.forEach(user => {
      userMap[user._id.toString()] = user.username;
    });
    usersByUsername.forEach(user => {
      userMap[user.username] = user.username;
    });

    // Update usernames in data
    data.forEach(item => {
      item.username = userMap[item.userId] || null;
    });

    res.status(200).json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('❌ Error fetching quiz completions activity:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch quiz completions activity',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

