const actionLogger = require('../services/ActionLogger');

/**
 * Action Logging Middleware - Automatically logs all requests
 */
const actionLoggingMiddleware = (actionType) => {
  return async (req, res, next) => {
    const startTime = Date.now();
    const sessionId = req.sessionID || req.ip + '-' + Date.now();
    
    // Start tracking
    actionLogger.startAction(sessionId, actionType);
    
    // Store original response methods
    const originalSend = res.send;
    const originalJson = res.json;
    
    let responseBody = '';
    let success = true;
    let errorMessage = null;
    let internalTokenUsage = null;
    
    // Override res.json to capture response
    res.json = function(body) {
      responseBody = JSON.stringify(body);
      
      // Extract internal token usage if present
      if (body && body.usageInternal) {
        internalTokenUsage = body.usageInternal;
      }
      
      // Determine success
      success = body && body.success !== false;
      if (!success && body && body.error) {
        errorMessage = body.error;
      }
      
      return originalJson.call(this, body);
    };
    
    // Override res.send to capture response
    res.send = function(body) {
      responseBody = typeof body === 'string' ? body : JSON.stringify(body);
      return originalSend.call(this, body);
    };
    
    // Log the action after response is sent
    res.on('finish', async () => {
      try {
        const requestSize = JSON.stringify(req.body).length;
        const responseSize = responseBody.length;
        
      // Extract course plan name from request body
      const coursePlanName = actionLogger.extractCoursePlanName(
        req.body?.context?.currentContent || 
        req.body?.context?.searchAIApplications ||
        req.body?.message ||
        req.body?.prompt ||
        req.body?.text ||
        req.body?.title
      );
      
      // Extract user info
      const userInfo = req.body?.context?.teacherInfo || null;
      
      // Extract userName from context or direct body to use as userId
      const userName = req.body?.context?.userName || req.body?.userName || null;
        
        const logData = {
          userId: req.user?.id || userName || null,
          sessionId: sessionId,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent'),
          action: actionType,
          endpoint: req.originalUrl,
          method: req.method,
          userInfo: userInfo,
          coursePlanName: coursePlanName,
          requestSize: requestSize,
          responseSize: responseSize,
          tokenUsageInternal: internalTokenUsage,
          success: success,
          errorMessage: errorMessage,
          metadata: {
            statusCode: res.statusCode,
            userAgent: req.get('User-Agent'),
            referer: req.get('Referer'),
          userName: userName
        }
      };
      
      await actionLogger.logAction(logData);
    } catch (error) {
      console.error('❌ Error in action logging:', error.message);
    }
    });
    
    next();
  };
};

module.exports = actionLoggingMiddleware;
