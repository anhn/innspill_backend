const express = require('express');
const router = express.Router();
const AgentManager = require('../agents/AgentManager');
const OpenAI = require('openai');
const Joi = require('joi');
const { isOptionalAuth } = require('../middleware/auth');
const actionLoggingMiddleware = require('../middleware/actionLogging');

// Initialize OpenAI client
let openaiClient;
let agentManager;

try {
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not set');
  } else {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 120000, // 120 second timeout per API call
      maxRetries: 1 // Reduced retries to avoid compounding delays
    });
    
    // Initialize Agent Manager
    agentManager = new AgentManager(openaiClient);
    console.log('✅ Agent Manager initialized');
  }
} catch (error) {
  console.error('❌ Error initializing OpenAI:', error.message);
}

// Validation schemas - Frontend context structure only
const requestSchema = Joi.object({
  message: Joi.string().required().min(1).max(5000),
  context: Joi.object({
    currentContent: Joi.string().optional(),
    searchAIApplications: Joi.string().optional(),
    userName: Joi.string().optional(),
    teacherInfo: Joi.object({
      educationLevel: Joi.string().valid('Primary', 'Secondary', 'High School', 'University', 'Graduate', 'Professional').required(),
      subjectArea: Joi.string().required(),
      country: Joi.string().required(),
      academicYear: Joi.string().required(),
      organization: Joi.string().required(),
      language: Joi.string().required()
    }).required()
  }).required()
});

/**
 * GET /api/v1/chatbot
 * List available chatbot endpoints
 */
router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Chatbot API',
    endpoints: {
      'create-course-plan': 'POST /api/v1/chatbot/create-course-plan',
      'update-course-plan': 'POST /api/v1/chatbot/update-course-plan',
      'create-lecture-plan': 'POST /api/v1/chatbot/create-lecture-plan',
      'analyze-feedback': 'POST /api/v1/chatbot/analyze-feedback',
      'analyze-course-plan': 'POST /api/v1/chatbot/analyze-a-course-plan',
      'revise-course-plan': 'POST /api/v1/chatbot/revise-a-course-plan',
      'general-chat': 'POST /api/v1/chatbot/asks',
      'agents': 'GET /api/v1/chatbot/agents',
      'health': 'GET /api/v1/chatbot/health',
      'performance': 'GET /api/v1/chatbot/performance'
    }
  });
});

/**
 * GET /api/v1/chatbot/performance
 * Check server performance capabilities
 */
router.get('/performance', (req, res) => {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  
  res.status(200).json({
    success: true,
    server: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: `${Math.floor(uptime / 60)} minutes`,
      pid: process.pid
    },
    memory: {
      heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      rss: `${(mem.rss / 1024 / 1024).toFixed(2)} MB`,
      external: `${(mem.external / 1024 / 1024).toFixed(2)} MB`
    },
    openai: {
      configured: !!openaiClient,
      timeout: '120000ms',
      maxRetries: 1
    },
    agents: {
      initialized: !!agentManager
    },
    warnings: []
  });
});

/**
 * POST /api/v1/chatbot/create-course-plan
 * Create a new course plan
 */
router.post('/create-course-plan', isOptionalAuth, actionLoggingMiddleware('create-course-plan'), async (req, res) => {
  try {
    // Validate request
    const { error, value } = requestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request format',
        details: error.details[0].message
      });
    }

    // Route to appropriate agent
    const response = await agentManager.routeRequest('create-course-plan', value);
    
    if (response.success) {
      res.status(200).json({
        success: true,
        agent: response.agent,
        response: response.response,
        usage: response.usage,
        usageInternal: response.usageInternal
      });
    } else {
      res.status(500).json({
        success: false,
        error: response.error,
        agent: response.agent
      });
    }
  } catch (error) {
    console.error('❌ Error in create-course-plan:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/v1/chatbot/update-course-plan
 * Update an existing course plan
 */
router.post('/update-course-plan', isOptionalAuth, actionLoggingMiddleware('update-course-plan'), async (req, res) => {
  try {
    // Validate request
    const { error, value } = requestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request format',
        details: error.details[0].message
      });
    }

    // Route to appropriate agent
    const response = await agentManager.routeRequest('update-course-plan', value);
    
    if (response.success) {
      res.status(200).json({
        success: true,
        agent: response.agent,
        response: response.response,
        usage: response.usage,
        usageInternal: response.usageInternal
      });
    } else {
      res.status(500).json({
        success: false,
        error: response.error,
        agent: response.agent
      });
    }
  } catch (error) {
    console.error('❌ Error in update-course-plan:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/v1/chatbot/create-lecture-plan
 * Create a new lecture plan
 */
router.post('/create-lecture-plan', isOptionalAuth, actionLoggingMiddleware('create-lecture-plan'), async (req, res) => {
  try {
    // Validate request
    const { error, value } = requestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request format',
        details: error.details[0].message
      });
    }

    // Route to appropriate agent
    const response = await agentManager.routeRequest('create-lecture-plan', value);
    
    if (response.success) {
      res.status(200).json({
        success: true,
        agent: response.agent,
        response: response.response,
        usage: response.usage,
        usageInternal: response.usageInternal
      });
    } else {
      res.status(500).json({
        success: false,
        error: response.error,
        agent: response.agent
      });
    }
  } catch (error) {
    console.error('❌ Error in create-lecture-plan:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/v1/chatbot/revise-a-course-plan
 * Generate a revised course plan based on analysis and original plan
 */
router.post('/revise-a-course-plan', isOptionalAuth, actionLoggingMiddleware('revise-course-plan'), async (req, res) => {
  try {
    // Check if agent manager is initialized
    if (!agentManager) {
      console.error('❌ Agent Manager not initialized');
      return res.status(503).json({
        success: false,
        error: 'AI service not available - configuration error',
        errorType: 'service_unavailable'
      });
    }
    
    // Validate request
    const { error, value } = requestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request format',
        details: error.details[0].message
      });
    }
    
    // Add timeout wrapper - 3 minutes for complex AI processing
    const TIMEOUT_MS = 180000; // 180 seconds (3 minutes)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout - AI processing took too long')), TIMEOUT_MS);
    });
    
    const startTime = Date.now();
    const response = await Promise.race([
      agentManager.routeRequest('revise-course-plan', value),
      timeoutPromise
    ]);
    
    const processingTime = Date.now() - startTime;
    
    if (response.success) {
      res.status(200).json({
        success: true,
        agent: response.agent,
        response: response.response,
        usage: response.usage,
        usageInternal: response.usageInternal,  // ← Added for middleware to capture
        processingTime: processingTime
      });
    } else {
      console.error('❌ Revision failed:', response.error);
      res.status(500).json({
        success: false,
        error: response.error,
        agent: response.agent
      });
    }
  } catch (error) {
    console.error('❌ Error in revise-a-course-plan:', error.message);
    
    if (error.message.includes('timeout')) {
      return res.status(504).json({
        success: false,
        error: 'Request timeout - The revision is taking longer than expected. Please try again.',
        errorType: 'timeout'
      });
    }
    
    if (error.message.includes('API') || error.message.includes('rate limit')) {
      return res.status(503).json({
        success: false,
        error: 'AI service temporarily unavailable. Please try again in a moment.',
        errorType: 'service_unavailable'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      errorType: error.name
    });
  }
});

/**
 * POST /api/v1/chatbot/analyze-a-course-plan
 * Analyze course plan for AI impact and provide detailed feedback
 */
router.post('/analyze-a-course-plan', isOptionalAuth, actionLoggingMiddleware('analyze-course-plan'), async (req, res) => {
  try {
    // Check if agent manager is initialized
    if (!agentManager) {
      console.error('❌ Agent Manager not initialized');
      return res.status(503).json({
        success: false,
        error: 'AI service not available - configuration error',
        errorType: 'service_unavailable'
      });
    }
    
    // Validate request
    const { error, value } = requestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request format',
        details: error.details[0].message
      });
    }
    
    // Add timeout wrapper - 3 minutes for complex AI processing
    // Note: Course plan analysis involves 30-50+ OpenAI API calls
    const TIMEOUT_MS = 180000; // 180 seconds (3 minutes)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout - AI processing took too long')), TIMEOUT_MS);
    });
    
    // Race between the agent request and timeout
    const startTime = Date.now();
    const response = await Promise.race([
      agentManager.routeRequest('analyze-course-plan', value),
      timeoutPromise
    ]);
    
    const processingTime = Date.now() - startTime;
    
    if (response.success) {
      res.status(200).json({
        success: true,
        agent: response.agent,
        response: response.response,
        usage: response.usage,
        usageInternal: response.usageInternal,  // ← Added for middleware to capture
        processingTime: processingTime
      });
    } else {
      console.error('❌ Analysis failed:', response.error);
      res.status(500).json({
        success: false,
        error: response.error,
        agent: response.agent
      });
    }
  } catch (error) {
    console.error('❌ Error in analyze-a-course-plan:', error.message);
    
    // Check if it's a timeout error
    if (error.message.includes('timeout')) {
      return res.status(504).json({
        success: false,
        error: 'Request timeout - The analysis is taking longer than expected. Please try again or simplify your course plan.',
        errorType: 'timeout'
      });
    }
    
    // Check if it's an OpenAI API error
    if (error.message.includes('API') || error.message.includes('rate limit')) {
      return res.status(503).json({
        success: false,
        error: 'AI service temporarily unavailable. Please try again in a moment.',
        errorType: 'service_unavailable'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      errorType: error.name
    });
  }
});

/**
 * POST /api/v1/chatbot/analyze-feedback
 * Analyze educational feedback
 */
router.post('/analyze-feedback', isOptionalAuth, actionLoggingMiddleware('analyze-feedback'), async (req, res) => {
  try {
    // Validate request
    const { error, value } = requestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request format',
        details: error.details[0].message
      });
    }

    // Route to appropriate agent
    const response = await agentManager.routeRequest('analyze-feedback', value);
    
    if (response.success) {
      res.status(200).json({
        success: true,
        agent: response.agent,
        response: response.response,
        usage: response.usage,
        usageInternal: response.usageInternal
      });
    } else {
      res.status(500).json({
        success: false,
        error: response.error,
        agent: response.agent
      });
    }
  } catch (error) {
    console.error('❌ Error in analyze-feedback:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// analysis-explainer endpoint removed per request

/**
 * POST /api/v1/chatbot/asks
 * General chatbot endpoint for various queries
 */
router.post('/asks', isOptionalAuth, actionLoggingMiddleware('general-chat'), async (req, res) => {
  try {
    // Validate request
    const { error, value } = requestSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request format',
        details: error.details[0].message
      });
    }

    // Route to general agent
    const response = await agentManager.routeRequest('general', value);
    
    if (response.success) {
      res.status(200).json({
        success: true,
        agent: response.agent,
        response: response.response,
        usage: response.usage,
        usageInternal: response.usageInternal
      });
    } else {
      res.status(500).json({
        success: false,
        error: response.error,
        agent: response.agent
      });
    }
  } catch (error) {
    console.error('❌ Error in asks endpoint:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/v1/chatbot/agents
 * Get information about available agents
 */
router.get('/agents', (req, res) => {
  try {
    const agentInfo = agentManager.getAgentInfo();
    res.status(200).json({
      success: true,
      agents: agentInfo
    });
  } catch (error) {
    console.error('❌ Error getting agent info:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/v1/chatbot/test-token-usage
 * Test endpoint without middleware to debug token usage
 */
router.post('/test-token-usage', async (req, res) => {
  try {
    // Route to general agent
    const response = await agentManager.routeRequest('general', req.body);
    
    console.log('🔍 Test endpoint - Agent response:', JSON.stringify(response, null, 2));
    
    if (response.success) {
      res.status(200).json({
        success: true,
        agent: response.agent,
        response: response.response,
        usage: response.usage
      });
    } else {
      res.status(500).json({
        success: false,
        error: response.error,
        agent: response.agent
      });
    }
  } catch (error) {
    console.error('❌ Error in test-token-usage:', error.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/v1/chatbot/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Chatbot service is healthy',
    timestamp: new Date().toISOString(),
    agents: agentManager.getAgentInfo().length
  });
});

module.exports = router;
