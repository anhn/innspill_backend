const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Prompt = require('../models/Prompt');
const AgentManager = require('../agents/AgentManager');
const PromptRevisionAgent = require('../agents/PromptRevisionAgent');
const OpenAI = require('openai');
const { isOptionalAuth } = require('../middleware/auth');
const actionLoggingMiddleware = require('../middleware/actionLogging');
const Joi = require('joi');

// Initialize OpenAI client and agent manager
let openaiClient;
let agentManager;
let promptRevisionAgent;

try {
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not set');
  } else {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 120000,
      maxRetries: 1
    });
    
    agentManager = new AgentManager(openaiClient);
    promptRevisionAgent = new PromptRevisionAgent(openaiClient);
    console.log('✅ Prompt Revision Agent initialized');
  }
} catch (error) {
  console.error('❌ Error initializing OpenAI:', error.message);
}

// Validation schemas
const revisePromptSchema = Joi.object({
  prompt: Joi.string().required().trim().min(1),
  userName: Joi.string().required().trim().min(1)
});

const createPromptSchema = Joi.object({
  originalPrompt: Joi.string().required().trim().min(1),
  revisedPrompt: Joi.string().required().trim().min(1),
  analysis: Joi.string().required().trim().min(1),
  topic: Joi.string().optional().allow('', null).trim(),
  userName: Joi.string().required().trim().min(1)
});

const updatePromptSchema = Joi.object({
  originalPrompt: Joi.string().optional().trim().min(1),
  revisedPrompt: Joi.string().optional().trim().min(1),
  analysis: Joi.string().optional().trim().min(1),
  topic: Joi.string().optional().allow('', null).trim(),
  userName: Joi.string().required().trim().min(1)
}).min(2); // At least userName and one other field

const deletePromptSchema = Joi.object({
  userName: Joi.string().required().trim().min(1)
});

/**
 * POST /api/v1/prompts/revise
 * Analyze and revise a user's prompt
 */
router.post('/revise', isOptionalAuth, actionLoggingMiddleware('revise-prompt'), async (req, res) => {
  try {
    // Validate request body
    const { error, value } = revisePromptSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const { prompt, userName } = value;

    // Check if agent is initialized
    if (!promptRevisionAgent) {
      return res.status(503).json({
        success: false,
        message: 'AI service not available - configuration error',
        errorType: 'service_unavailable'
      });
    }

    const startTime = Date.now();
    
    // Process prompt revision
    const response = await promptRevisionAgent.process({ prompt });
    
    const processingTime = Date.now() - startTime;

    if (response.success && response.response) {
      res.status(200).json({
        success: true,
        data: {
          analysis: response.response.analysis || response.response,
          revisedPrompt: response.response.revisedPrompt || response.response
        },
        usage: response.usage,
        usageInternal: response.usageInternal,
        processingTime: processingTime
      });
    } else {
      console.error('❌ Prompt revision failed:', response.error);
      res.status(500).json({
        success: false,
        message: 'Failed to revise prompt',
        error: response.error || 'Unknown error'
      });
    }
  } catch (error) {
    console.error('❌ Error in revise prompt:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to revise prompt',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/prompts
 * Create/save a prompt
 */
router.post('/', isOptionalAuth, async (req, res) => {
  try {
    // Validate request body
    const { error, value } = createPromptSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const { originalPrompt, revisedPrompt, analysis, topic, userName } = value;

    // Create prompt
    const prompt = new Prompt({
      originalPrompt,
      revisedPrompt,
      analysis,
      topic: topic || null,
      userName
    });

    await prompt.save();

    // Format response
    const formattedPrompt = {
      id: prompt._id.toString(),
      originalPrompt: prompt.originalPrompt,
      revisedPrompt: prompt.revisedPrompt,
      analysis: prompt.analysis,
      topic: prompt.topic || '',
      userName: prompt.userName,
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt
    };

    res.status(201).json({
      success: true,
      data: formattedPrompt
    });
  } catch (error) {
    console.error('❌ Error creating prompt:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to save prompt',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/prompts
 * List all prompts for a specific user
 */
router.get('/', isOptionalAuth, async (req, res) => {
  try {
    // Validate query parameters
    const schema = Joi.object({
      userName: Joi.string().required().trim().min(1)
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'userName parameter is required',
        error: error.details[0].message
      });
    }

    const { userName } = value;

    // Query prompts
    const prompts = await Prompt.find({ userName }).sort({ createdAt: -1 });

    // Format response
    const formattedPrompts = prompts.map(prompt => ({
      id: prompt._id.toString(),
      originalPrompt: prompt.originalPrompt,
      revisedPrompt: prompt.revisedPrompt,
      analysis: prompt.analysis,
      topic: prompt.topic || '',
      userName: prompt.userName,
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt
    }));

    res.status(200).json({
      success: true,
      data: formattedPrompts
    });
  } catch (error) {
    console.error('❌ Error fetching prompts:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve prompts',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/prompts/:id
 * Get a single prompt by ID
 */
router.get('/:id', isOptionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid prompt ID'
      });
    }

    const prompt = await Prompt.findById(id);
    
    if (!prompt) {
      return res.status(404).json({
        success: false,
        message: 'Prompt not found'
      });
    }

    // Format response
    const formattedPrompt = {
      id: prompt._id.toString(),
      originalPrompt: prompt.originalPrompt,
      revisedPrompt: prompt.revisedPrompt,
      analysis: prompt.analysis,
      topic: prompt.topic || '',
      userName: prompt.userName,
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt
    };

    res.status(200).json({
      success: true,
      data: formattedPrompt
    });
  } catch (error) {
    console.error('❌ Error fetching prompt:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve prompt',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * PUT /api/v1/prompts/:id
 * Update an existing prompt
 */
router.put('/:id', isOptionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid prompt ID'
      });
    }

    // Validate request body
    const { error, value } = updatePromptSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const { userName, ...updateData } = value;

    // Find prompt
    const prompt = await Prompt.findById(id);
    if (!prompt) {
      return res.status(404).json({
        success: false,
        message: 'Prompt not found'
      });
    }

    // Verify ownership
    if (prompt.userName !== userName) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this prompt'
      });
    }

    // Clean up empty strings to null for optional fields
    const cleanedData = {};
    if (updateData.originalPrompt !== undefined) cleanedData.originalPrompt = updateData.originalPrompt;
    if (updateData.revisedPrompt !== undefined) cleanedData.revisedPrompt = updateData.revisedPrompt;
    if (updateData.analysis !== undefined) cleanedData.analysis = updateData.analysis;
    if (updateData.topic !== undefined) cleanedData.topic = updateData.topic || null;

    // Update prompt
    Object.assign(prompt, cleanedData);
    await prompt.save();

    // Format response
    const formattedPrompt = {
      id: prompt._id.toString(),
      originalPrompt: prompt.originalPrompt,
      revisedPrompt: prompt.revisedPrompt,
      analysis: prompt.analysis,
      topic: prompt.topic || '',
      userName: prompt.userName,
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt
    };

    res.status(200).json({
      success: true,
      data: formattedPrompt
    });
  } catch (error) {
    console.error('❌ Error updating prompt:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update prompt',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/v1/prompts/:id
 * Delete a prompt
 */
router.delete('/:id', isOptionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid prompt ID'
      });
    }

    // Validate request body
    const { error, value } = deletePromptSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'userName is required',
        error: error.details[0].message
      });
    }

    const { userName } = value;

    // Find prompt
    const prompt = await Prompt.findById(id);
    if (!prompt) {
      return res.status(404).json({
        success: false,
        message: 'Prompt not found'
      });
    }

    // Verify ownership
    if (prompt.userName !== userName) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this prompt'
      });
    }

    // Delete prompt
    await Prompt.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Prompt deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting prompt:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete prompt',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

