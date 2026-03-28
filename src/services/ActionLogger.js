const ActionLog = require('../models/ActionLog');

/**
 * Action Logging Service - Centralized logging for all user actions
 */
class ActionLogger {
  constructor() {
    this.startTimes = new Map(); // Track processing start times
  }

  /**
   * Start tracking an action
   * @param {string} sessionId - Session identifier
   * @param {string} actionId - Unique action identifier
   */
  startAction(sessionId, actionId) {
    const key = `${sessionId}-${actionId}`;
    this.startTimes.set(key, Date.now());
  }

  /**
   * Log a user action
   * @param {Object} logData - Log data object
   * @returns {Promise<Object>} - Log result
   */
  async logAction(logData) {
    try {
      const {
        userId,
        sessionId,
        ipAddress,
        userAgent,
        timestamp,
        action,
        endpoint,
        method,
        userInfo,
        coursePlanName,
        requestSize,
        responseSize,
        tokenUsageInternal,
        success = true,
        errorMessage,
        metadata = {}
      } = logData;

      // Calculate processing time if start time exists
      const key = `${sessionId}-${action}`;
      const startTime = this.startTimes.get(key);
      const processingTime = startTime ? Date.now() - startTime : null;
      
      // Clear start time
      if (startTime) {
        this.startTimes.delete(key);
      }

      const actionLog = new ActionLog({
        userId,
        sessionId,
        ipAddress,
        userAgent,
        timestamp: timestamp || undefined, // Use provided timestamp or let default handle it
        action,
        endpoint,
        method,
        userInfo,
        coursePlanName,
        requestSize,
        responseSize,
        tokenUsageInternal,
        processingTime,
        success,
        errorMessage,
        metadata
      });

      const savedLog = await actionLog.save();
      
      return {
        success: true,
        logId: savedLog._id,
        message: 'Action logged successfully'
      };
    } catch (error) {
      console.error('❌ Error logging action:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Extract course plan name from content
   * @param {string} content - Course plan content
   * @returns {string} - Extracted course plan name
   */
  extractCoursePlanName(content) {
    if (!content) return null;
    
    // Try to extract course name from various patterns
    const patterns = [
      /Course[:\s]+([^\n]+)/i,
      /Plan[:\s]+([^\n]+)/i,
      /Introduction to ([^\n]+)/i,
      /#\s*([^\n]+)/i,
      /##\s*([^\n]+)/i
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        return match[1].trim().substring(0, 100); // Limit length
      }
    }

    return null;
  }

  /**
   * Get action logs with pagination and filtering
   * @param {Object} options - Query options
   * @returns {Promise<Object>} - Paginated logs
   */
  async getActionLogs(options = {}) {
    try {
      const {
        page = 1,
        limit = 50,
        userId,
        action,
        coursePlanName,
        startDate,
        endDate,
        sortBy = 'timestamp',
        sortOrder = 'desc'
      } = options;

      // Build query
      const query = {};
      
      if (userId) query.userId = userId;
      if (action) query.action = action;
      if (coursePlanName) query.coursePlanName = new RegExp(coursePlanName, 'i');
      
      if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) query.timestamp.$gte = new Date(startDate);
        if (endDate) query.timestamp.$lte = new Date(endDate);
      }

      // Calculate pagination
      const skip = (page - 1) * limit;
      const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

      // Execute query
      const [rawLogs, total] = await Promise.all([
        ActionLog.find(query)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        ActionLog.countDocuments(query)
      ]);

      // Ensure frontend compatibility: expose tokenUsage aliasing tokenUsageInternal
      const logs = rawLogs.map((log) => ({
        ...log,
        tokenUsage: log.tokenUsageInternal ?? null
      }));

      return {
        success: true,
        data: {
          logs,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit)
          }
        }
      };
    } catch (error) {
      console.error('❌ Error getting action logs:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get usage statistics
   * @param {Object} options - Query options
   * @returns {Promise<Object>} - Usage statistics
   */
  async getUsageStats(options = {}) {
    try {
      const { userId, startDate, endDate } = options;

      const query = {};
      if (userId) query.userId = userId;
      if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) query.timestamp.$gte = new Date(startDate);
        if (endDate) query.timestamp.$lte = new Date(endDate);
      }

      const stats = await ActionLog.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalActions: { $sum: 1 },
            totalTokens: { $sum: '$tokenUsageInternal.totalTokens' },
            totalPromptTokens: { $sum: '$tokenUsageInternal.promptTokens' },
            totalCompletionTokens: { $sum: '$tokenUsageInternal.completionTokens' },
            avgProcessingTime: { $avg: '$processingTime' },
            successRate: {
              $avg: { $cond: ['$success', 1, 0] }
            }
          }
        }
      ]);

      const actionBreakdown = await ActionLog.aggregate([
        { $match: query },
        {
          $group: {
            _id: '$action',
            count: { $sum: 1 },
            totalTokens: { $sum: '$tokenUsageInternal.totalTokens' }
          }
        },
        { $sort: { count: -1 } }
      ]);

      return {
        success: true,
        data: {
          overall: stats[0] || {
            totalActions: 0,
            totalTokens: 0,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            avgProcessingTime: 0,
            successRate: 0
          },
          actionBreakdown
        }
      };
    } catch (error) {
      console.error('❌ Error getting usage stats:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Create singleton instance
const actionLogger = new ActionLogger();

module.exports = actionLogger;
