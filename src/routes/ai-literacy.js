const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AILiteracyStatus = require('../models/AILiteracyStatus');
const User = require('../models/User');
const { isOptionalAuth } = require('../middleware/auth');
const Joi = require('joi');

// Validation schemas
const updateStatusSchema = Joi.object({
  userId: Joi.string().optional().trim(), // Optional if from session
  status: Joi.string().valid('not_started', 'in_progress', 'completed').optional(),
  progress: Joi.number().min(0).max(100).optional(),
  metadata: Joi.object().optional()
});

/**
 * POST /api/v1/ai-literacy/status
 * Create or update AI literacy status for a user
 */
router.post('/status', isOptionalAuth, async (req, res) => {
  try {
    const { error, value } = updateStatusSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Get userId from request body or session
    let userId = value.userId;
    if (!userId && req.session && req.session.userId) {
      userId = req.session.userId;
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required. Provide userId in request body or ensure user is logged in.'
      });
    }

    // Validate userId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid userId format'
      });
    }

    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prepare update data
    const updateData = {
      lastAccessed: new Date()
    };

    if (value.status !== undefined) {
      updateData.status = value.status;
      
      // Set completionDate if status is 'completed'
      if (value.status === 'completed') {
        updateData.completionDate = new Date();
        updateData.progress = 100; // Ensure progress is 100 when completed
      } else if (value.status === 'not_started') {
        updateData.progress = 0;
        updateData.completionDate = null;
      }
    }

    if (value.progress !== undefined) {
      updateData.progress = value.progress;
      
      // Auto-update status based on progress
      if (updateData.progress === 0 && !value.status) {
        updateData.status = 'not_started';
      } else if (updateData.progress === 100 && !value.status) {
        updateData.status = 'completed';
        updateData.completionDate = new Date();
      } else if (updateData.progress > 0 && updateData.progress < 100 && !value.status) {
        updateData.status = 'in_progress';
      }
    }

    if (value.metadata !== undefined) {
      updateData.metadata = value.metadata;
    }

    // Use findOneAndUpdate with upsert to create or update
    const status = await AILiteracyStatus.findOneAndUpdate(
      { userId: userId },
      updateData,
      { 
        new: true, 
        upsert: true,
        setDefaultsOnInsert: true
      }
    );

    console.log(`✅ AI Literacy status updated for user ${userId}: ${status.status} (${status.progress}%)`);

    return res.status(200).json({
      success: true,
      data: {
        id: status._id.toString(),
        userId: status.userId.toString(),
        status: status.status,
        progress: status.progress,
        lastAccessed: status.lastAccessed,
        completionDate: status.completionDate,
        metadata: status.metadata || {},
        createdAt: status.createdAt,
        updatedAt: status.updatedAt
      },
      message: 'AI literacy status saved successfully'
    });
  } catch (error) {
    console.error('❌ Error saving AI literacy status:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to save AI literacy status',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/ai-literacy/status/:userId
 * Get AI literacy status for a specific user
 */
router.get('/status/:userId', isOptionalAuth, async (req, res) => {
  try {
    const userId = req.params.userId;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid userId format'
      });
    }

    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find AI literacy status
    const status = await AILiteracyStatus.findOne({ userId: userId });

    if (!status) {
      // Return default status if not found
      return res.status(200).json({
        success: true,
        data: {
          userId: userId,
          status: 'not_started',
          progress: 0,
          lastAccessed: null,
          completionDate: null,
          metadata: {}
        },
        message: 'AI literacy status not found, returning default'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: status._id.toString(),
        userId: status.userId.toString(),
        status: status.status,
        progress: status.progress,
        lastAccessed: status.lastAccessed,
        completionDate: status.completionDate,
        metadata: status.metadata || {},
        createdAt: status.createdAt,
        updatedAt: status.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error fetching AI literacy status:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch AI literacy status',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/ai-literacy/status
 * Get AI literacy status for current user (from session)
 */
router.get('/status', isOptionalAuth, async (req, res) => {
  try {
    // Get userId from session
    let userId = null;
    if (req.session && req.session.userId) {
      userId = req.session.userId;
    }

    // Also check query parameter as fallback
    if (!userId && req.query.userId) {
      userId = req.query.userId;
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required. Please log in or provide userId as query parameter.'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid userId format'
      });
    }

    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find AI literacy status
    const status = await AILiteracyStatus.findOne({ userId: userId });

    if (!status) {
      // Return default status if not found
      return res.status(200).json({
        success: true,
        data: {
          userId: userId,
          status: 'not_started',
          progress: 0,
          lastAccessed: null,
          completionDate: null,
          metadata: {}
        },
        message: 'AI literacy status not found, returning default'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: status._id.toString(),
        userId: status.userId.toString(),
        status: status.status,
        progress: status.progress,
        lastAccessed: status.lastAccessed,
        completionDate: status.completionDate,
        metadata: status.metadata || {},
        createdAt: status.createdAt,
        updatedAt: status.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error fetching AI literacy status:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch AI literacy status',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/ai-literacy/stats
 * Get statistics about AI literacy completion (for admin/analytics)
 * Optional query params: status, minProgress, maxProgress
 */
router.get('/stats', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      status: Joi.string().valid('not_started', 'in_progress', 'completed').optional(),
      minProgress: Joi.number().min(0).max(100).optional(),
      maxProgress: Joi.number().min(0).max(100).optional()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    // Build query filter
    const filter = {};
    if (value.status) {
      filter.status = value.status;
    }
    if (value.minProgress !== undefined || value.maxProgress !== undefined) {
      filter.progress = {};
      if (value.minProgress !== undefined) {
        filter.progress.$gte = value.minProgress;
      }
      if (value.maxProgress !== undefined) {
        filter.progress.$lte = value.maxProgress;
      }
    }

    // Get all statuses matching filter
    const statuses = await AILiteracyStatus.find(filter);

    // Calculate statistics
    const total = statuses.length;
    const notStarted = statuses.filter(s => s.status === 'not_started').length;
    const inProgress = statuses.filter(s => s.status === 'in_progress').length;
    const completed = statuses.filter(s => s.status === 'completed').length;
    const averageProgress = total > 0 
      ? statuses.reduce((sum, s) => sum + s.progress, 0) / total 
      : 0;

    return res.status(200).json({
      success: true,
      data: {
        total,
        notStarted,
        inProgress,
        completed,
        averageProgress: Math.round(averageProgress * 100) / 100,
        completionRate: total > 0 ? Math.round((completed / total) * 100 * 100) / 100 : 0
      }
    });
  } catch (error) {
    console.error('❌ Error fetching AI literacy stats:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch AI literacy statistics',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

