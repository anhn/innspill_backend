const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ChatSession = require('../models/ChatSession');
const Role = require('../models/Role');
const Project = require('../models/Project');
const User = require('../models/User');
const StakeholderChatAgent = require('../agents/StakeholderChatAgent');
const OpenAI = require('openai');
const { isOptionalAuth } = require('../middleware/auth');
const actionLoggingMiddleware = require('../middleware/actionLogging');
const Joi = require('joi');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MAX_BATCH_PAIRS = 20;

// Shared formatter to keep response shapes consistent
const formatSessionWithChatItems = (session) => {
  const chatItems = session.chatItems.map(item => ({
    id: item._id.toString(),
    sessionId: session._id.toString(),
    sender: item.sender,
    message: item.message,
    timestamp: item.timestamp,
    openAIMetrics: item.openAIMetrics || null
  }));

  return {
    session: {
      id: session._id.toString(),
      title: session.title,
      sender: session.sender,
      stakeholderId: session.stakeholderId ? session.stakeholderId.toString() : null,
      projectId: session.projectId ? session.projectId.toString() : null,
      participants: session.participants,
      startTime: session.startTime,
      endTime: session.endTime
    },
    chatItems
  };
};

/**
 * GET /api/v1/chat-messages/student/:username/stakeholder/:stakeholderId
 * Get chat sessions by student and stakeholder, with all chat items
 */
router.get('/student/:username/stakeholder/:stakeholderId', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      userName: Joi.string().optional().trim(),
      limit: Joi.number().integer().min(1).max(100).optional().default(50),
      offset: Joi.number().integer().min(0).optional().default(0),
      sessionId: Joi.string().optional().trim() // Optional: get specific session
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
    const stakeholderId = req.params.stakeholderId;

    // Validate stakeholderId format
    if (!mongoose.Types.ObjectId.isValid(stakeholderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid stakeholderId format'
      });
    }

    // Verify stakeholder exists
    const stakeholder = await Role.findById(stakeholderId);
    if (!stakeholder) {
      return res.status(404).json({
        success: false,
        message: 'Stakeholder not found'
      });
    }

    // Build query - find sessions where student is sender or participant
    let query = {
      stakeholderId: stakeholderId,
      $or: [
        { sender: username },
        { participants: username }
      ]
    };

    // If specific session requested
    if (value.sessionId) {
      if (!mongoose.Types.ObjectId.isValid(value.sessionId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid sessionId format'
        });
      }
      query._id = value.sessionId;
    }

    const total = await ChatSession.countDocuments(query);
    const sessions = await ChatSession.find(query)
      .sort({ startTime: -1 }) // Most recent first
      .skip(value.offset)
      .limit(value.limit);

    // Format response - flatten chat items from all sessions
    const allChatItems = [];
    const formattedSessions = sessions.map(session => {
      const formatted = formatSessionWithChatItems(session);
      const sessionData = {
        ...formatted.session,
        chatItems: formatted.chatItems,
        metadata: session.metadata || {},
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      };

      // Collect all chat items for flat list
      formatted.chatItems.forEach(item => {
        allChatItems.push({
          id: item.id,
          sessionId: item.sessionId,
          sender: item.sender,
          message: item.message,
          timestamp: item.timestamp,
          openAIMetrics: item.openAIMetrics || null
        });
      });
      
      return sessionData;
    });

    // Sort chat items by timestamp
    allChatItems.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.status(200).json({
      success: true,
      data: {
        sessions: formattedSessions,
        chatItems: allChatItems // Flat list of all items across sessions
      },
      pagination: {
        total: total,
        limit: value.limit,
        offset: value.offset,
        hasMore: (value.offset + value.limit) < total
      }
    });
  } catch (error) {
    console.error('❌ Error fetching chat sessions:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch chat sessions',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/chat-messages/batch
 * Fetch chat messages for multiple student/stakeholder pairs in one call
 */
router.post('/batch', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      pairs: Joi.array()
        .items(Joi.object({
          studentId: Joi.string().required().trim(),
          stakeholderId: Joi.string().required().trim()
        }))
        .min(1)
        .max(MAX_BATCH_PAIRS)
        .required()
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const errors = [];
    const validPairs = [];
    const stakeholderIdSet = new Set();

    // Validate stakeholderId format up front
    value.pairs.forEach(pair => {
      if (!mongoose.Types.ObjectId.isValid(pair.stakeholderId)) {
        errors.push({
          studentId: pair.studentId,
          stakeholderId: pair.stakeholderId,
          error: 'Invalid stakeholderId format'
        });
        return;
      }
      validPairs.push(pair);
      stakeholderIdSet.add(pair.stakeholderId);
    });

    // Early exit if nothing to process
    if (validPairs.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'All pairs failed validation',
        errors
      });
    }

    // Verify stakeholders exist (single query)
    const stakeholders = await Role.find({
      _id: { $in: Array.from(stakeholderIdSet) }
    }).select('_id');
    const existingStakeholderIds = new Set(stakeholders.map(s => s._id.toString()));

    validPairs.forEach(pair => {
      if (!existingStakeholderIds.has(pair.stakeholderId)) {
        errors.push({
          studentId: pair.studentId,
          stakeholderId: pair.stakeholderId,
          error: 'Stakeholder not found'
        });
      }
    });

    const queryablePairs = validPairs.filter(pair => existingStakeholderIds.has(pair.stakeholderId));

    let sessions = [];
    if (queryablePairs.length > 0) {
      const orClauses = queryablePairs.map(pair => ({
        stakeholderId: pair.stakeholderId,
        $or: [
          { sender: pair.studentId },
          { participants: pair.studentId }
        ]
      }));

      sessions = await ChatSession.find({ $or: orClauses });
    }

    // Group sessions per pair
    const data = queryablePairs.map(pair => {
      const matchedSessions = sessions.filter(session =>
        session.stakeholderId && session.stakeholderId.toString() === pair.stakeholderId &&
        (session.sender === pair.studentId || session.participants.includes(pair.studentId))
      );

      const formattedSessions = matchedSessions.map(session => formatSessionWithChatItems(session));

      // Flatten chat items and sort chronologically
      const allChatItems = formattedSessions.flatMap(s => s.chatItems);
      allChatItems.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      return {
        studentId: pair.studentId,
        stakeholderId: pair.stakeholderId,
        messages: allChatItems
      };
    });

    const hasSuccess = data.length > 0;
    const responseStatus = hasSuccess ? 200 : 400;

    res.status(responseStatus).json({
      success: hasSuccess,
      data,
      errors: errors.length > 0 ? errors : undefined,
      meta: {
        requested: value.pairs.length,
        processed: queryablePairs.length,
        maxBatchSize: MAX_BATCH_PAIRS
      }
    });
  } catch (err) {
    console.error('❌ Error in batch chat fetch:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch chat messages batch',
      error: process.env.NODE_ENV !== 'production' ? err.message : undefined
    });
  }
});

/**
 * POST /api/v1/chat-messages
 * Send a chat message from student to stakeholder and receive AI-generated response
 * Creates a new session or adds to existing active session
 */
router.post('/', isOptionalAuth, actionLoggingMiddleware('stakeholder-chat'), async (req, res) => {
  try {
    const schema = Joi.object({
      studentId: Joi.string().required().trim().min(1),
      stakeholderId: Joi.string().required().trim().min(1),
      message: Joi.string().required().trim().min(1),
      sender: Joi.string().optional().trim(), // Optional: sender label from frontend
      projectId: Joi.string().optional().trim(),
      sessionId: Joi.string().optional().trim(), // Optional: add to existing session
      title: Joi.string().optional().trim() // Optional: title for new session
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Validate stakeholderId format
    if (!mongoose.Types.ObjectId.isValid(value.stakeholderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid stakeholderId format'
      });
    }

    // Get stakeholder to retrieve persona
    const stakeholder = await Role.findById(value.stakeholderId);
    if (!stakeholder) {
      return res.status(404).json({
        success: false,
        message: 'Stakeholder not found'
      });
    }

    // Validate projectId if provided
    let project = null;
    if (value.projectId) {
      if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid projectId format'
        });
      }
      project = await Project.findById(value.projectId);
      if (!project) {
        return res.status(404).json({
          success: false,
          message: 'Project not found'
        });
      }
    }

    // Find or create chat session
    let session;
    if (value.sessionId && mongoose.Types.ObjectId.isValid(value.sessionId)) {
      // Add to existing session
      session = await ChatSession.findOne({
        _id: value.sessionId,
        stakeholderId: value.stakeholderId,
        $or: [
          { sender: value.studentId },
          { participants: value.studentId }
        ],
        endTime: null // Only active sessions
      });

      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Active chat session not found'
        });
      }
    } else {
      // Create new session
      session = new ChatSession({
        title: value.title || `Chat with ${stakeholder.name || 'Stakeholder'}`,
        sender: value.studentId,
        stakeholderId: value.stakeholderId,
        projectId: value.projectId || null,
        participants: [value.studentId],
        startTime: new Date(),
        chatItems: []
      });
      await session.save();
    }

    // Resolve user display name for sender label
    let senderLabel = value.sender; // Use provided sender if available
    if (!senderLabel) {
      // If not provided, resolve from user's display name
      const user = await User.findOne({ username: value.studentId }).select('fullName username').lean();
      senderLabel = user?.fullName || value.studentId;
    }

    // Add student message to session
    const studentChatItem = {
      sender: senderLabel,
      message: value.message,
      timestamp: new Date()
    };
    session.chatItems.push(studentChatItem);
    await session.save();

    // Get conversation history from current session
    // Map items with sender labels and role indicators for the agent
    const stakeholderName = stakeholder.name || 'Stakeholder';
    const conversationHistory = session.chatItems
      .slice(-20) // Last 20 items for context
      .map(item => {
        // Determine if this is a student message or stakeholder message
        // Student messages: sender is NOT the stakeholder name
        const isStudentMessage = item.sender !== stakeholderName && item.sender !== 'stakeholder';
        return {
          sender: item.sender, // Display name/label for UI
          message: item.message,
          role: isStudentMessage ? 'student' : 'stakeholder' // Role for agent processing
        };
      });

    // Generate AI response using stakeholder persona
    const agent = new StakeholderChatAgent(openai, stakeholder.persona);
    const request = {
      message: value.message,
      context: {
        projectContext: project ? project.courseDescription || '' : '',
        taskContext: project ? project.keyMilestones || '' : '',
        conversationHistory: conversationHistory
      }
    };

    const startTime = Date.now();
    const response = await agent.process(request);
    const responseTime = Date.now() - startTime;

    if (!response.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate stakeholder response',
        error: response.error
      });
    }

    // Extract token usage from response
    const tokenUsage = response.usage || response.usageInternal || {};
    const responseSize = response.response ? response.response.length : 0;

    // Use stakeholder name for sender label
    const stakeholderLabel = stakeholder.name || 'Stakeholder';

    // Add stakeholder response with OpenAI metrics
    const stakeholderChatItem = {
      sender: stakeholderLabel,
      message: response.response,
      timestamp: new Date(),
      openAIMetrics: {
        responseSize: responseSize,
        tokenUsage: {
          promptTokens: tokenUsage.prompt_tokens || tokenUsage.promptTokens || 0,
          completionTokens: tokenUsage.completion_tokens || tokenUsage.completionTokens || 0,
          totalTokens: tokenUsage.total_tokens || tokenUsage.totalTokens || 0
        },
        responseTime: responseTime
      }
    };
    session.chatItems.push(stakeholderChatItem);
    await session.save();

    // Get the saved chat items (with their IDs)
    const savedStudentItem = session.chatItems[session.chatItems.length - 2];
    const savedStakeholderItem = session.chatItems[session.chatItems.length - 1];

    res.status(201).json({
      success: true,
      data: {
        session: {
          id: session._id.toString(),
          title: session.title,
          sender: session.sender,
          stakeholderId: session.stakeholderId ? session.stakeholderId.toString() : null,
          projectId: session.projectId ? session.projectId.toString() : null,
          participants: session.participants,
          startTime: session.startTime,
          endTime: session.endTime
        },
        studentMessage: {
          id: savedStudentItem._id.toString(),
          sessionId: session._id.toString(),
          sender: savedStudentItem.sender,
          message: savedStudentItem.message,
          timestamp: savedStudentItem.timestamp
        },
        stakeholderResponse: {
          id: savedStakeholderItem._id.toString(),
          sessionId: session._id.toString(),
          sender: savedStakeholderItem.sender,
          message: savedStakeholderItem.message,
          timestamp: savedStakeholderItem.timestamp,
          openAIMetrics: savedStakeholderItem.openAIMetrics
        }
      },
      usage: response.usage,
      usageInternal: response.usageInternal,
      processingTime: responseTime
    });
  } catch (error) {
    console.error('❌ Error sending chat message:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to send chat message',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * PUT /api/v1/chat-messages/session/:sessionId/end
 * End/close a chat session
 */
router.put('/session/:sessionId/end', isOptionalAuth, async (req, res) => {
  try {
    const sessionId = req.params.sessionId;

    // Validate sessionId format
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid sessionId format'
      });
    }

    // Find the session
    const session = await ChatSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Chat session not found'
      });
    }

    // Check if session is already ended
    if (session.endTime) {
      return res.status(400).json({
        success: false,
        message: 'Chat session is already ended'
      });
    }

    // End the session
    session.endTime = new Date();
    await session.save();

    res.status(200).json({
      success: true,
      message: 'Chat session ended successfully',
      data: {
        id: session._id.toString(),
        title: session.title,
        sender: session.sender,
        stakeholderId: session.stakeholderId ? session.stakeholderId.toString() : null,
        projectId: session.projectId ? session.projectId.toString() : null,
        participants: session.participants,
        startTime: session.startTime,
        endTime: session.endTime,
        chatItemsCount: session.chatItems.length
      }
    });
  } catch (error) {
    console.error('❌ Error ending chat session:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to end chat session',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

