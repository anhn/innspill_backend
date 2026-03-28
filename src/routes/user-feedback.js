const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const UserFeedback = require('../models/UserFeedback');
const { isOptionalAuth } = require('../middleware/auth');
const Joi = require('joi');

// Validation schemas
const createFeedbackSchema = Joi.object({
  experienceRating: Joi.number().integer().min(1).max(5).required()
    .messages({
      'number.base': 'Experience rating must be a number',
      'number.integer': 'Experience rating must be an integer',
      'number.min': 'Experience rating must be between 1 and 5',
      'number.max': 'Experience rating must be between 1 and 5',
      'any.required': 'Experience rating is required'
    }),
  aiCompetenceRating: Joi.number().integer().min(1).max(5).required()
    .messages({
      'number.base': 'AI competence rating must be a number',
      'number.integer': 'AI competence rating must be an integer',
      'number.min': 'AI competence rating must be between 1 and 5',
      'number.max': 'AI competence rating must be between 1 and 5',
      'any.required': 'AI competence rating is required'
    }),
  learningRating: Joi.number().integer().min(1).max(5).required()
    .messages({
      'number.base': 'Learning rating must be a number',
      'number.integer': 'Learning rating must be an integer',
      'number.min': 'Learning rating must be between 1 and 5',
      'number.max': 'Learning rating must be between 1 and 5',
      'any.required': 'Learning rating is required'
    }),
  openEndedReflections: Joi.string().optional().allow('', null).trim(),
  projectId: Joi.string().optional().trim(),
  courseId: Joi.string().optional().trim(),
  username: Joi.string().optional().trim()
});

/**
 * POST /api/v1/user-feedback
 * Submit user feedback and ratings
 */
router.post('/', isOptionalAuth, async (req, res) => {
  try {
    const { error, value } = createFeedbackSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Validate projectId if provided
    if (value.projectId && !mongoose.Types.ObjectId.isValid(value.projectId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid projectId format'
      });
    }

    // Validate courseId if provided
    if (value.courseId && !mongoose.Types.ObjectId.isValid(value.courseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid courseId format'
      });
    }

    // Create feedback document
    const feedbackData = {
      experienceRating: value.experienceRating,
      aiCompetenceRating: value.aiCompetenceRating,
      learningRating: value.learningRating,
      openEndedReflections: value.openEndedReflections || '',
      projectId: value.projectId ? new mongoose.Types.ObjectId(value.projectId) : null,
      courseId: value.courseId ? new mongoose.Types.ObjectId(value.courseId) : null,
      userId: req.user?.id || null,
      username: value.username || req.user?.username || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    };

    const feedback = new UserFeedback(feedbackData);
    await feedback.save();

    res.status(201).json({
      success: true,
      message: 'Feedback submitted successfully',
      data: {
        id: feedback._id.toString(),
        experienceRating: feedback.experienceRating,
        aiCompetenceRating: feedback.aiCompetenceRating,
        learningRating: feedback.learningRating,
        openEndedReflections: feedback.openEndedReflections,
        projectId: feedback.projectId ? feedback.projectId.toString() : null,
        courseId: feedback.courseId ? feedback.courseId.toString() : null,
        userId: feedback.userId,
        username: feedback.username,
        createdAt: feedback.createdAt,
        updatedAt: feedback.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error submitting feedback:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to submit feedback',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/user-feedback
 * Get user feedback (with optional filters)
 */
router.get('/', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      userId: Joi.string().optional().trim(),
      username: Joi.string().optional().trim(),
      projectId: Joi.string().optional().trim(),
      courseId: Joi.string().optional().trim(),
      limit: Joi.number().integer().min(1).max(100).optional().default(50),
      offset: Joi.number().integer().min(0).optional().default(0)
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    // Build query
    const query = {};
    
    if (value.userId) {
      query.userId = value.userId;
    }
    
    if (value.username) {
      query.username = value.username;
    }
    
    if (value.projectId) {
      if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid projectId format'
        });
      }
      query.projectId = new mongoose.Types.ObjectId(value.projectId);
    }
    
    if (value.courseId) {
      if (!mongoose.Types.ObjectId.isValid(value.courseId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid courseId format'
        });
      }
      query.courseId = new mongoose.Types.ObjectId(value.courseId);
    }

    // Get total count for pagination
    const totalCount = await UserFeedback.countDocuments(query);

    // Fetch feedback with pagination
    const feedbacks = await UserFeedback.find(query)
      .sort({ createdAt: -1 })
      .limit(value.limit)
      .skip(value.offset);

    // Format response
    const formattedFeedbacks = feedbacks.map(feedback => ({
      id: feedback._id.toString(),
      experienceRating: feedback.experienceRating,
      aiCompetenceRating: feedback.aiCompetenceRating,
      learningRating: feedback.learningRating,
      openEndedReflections: feedback.openEndedReflections,
      projectId: feedback.projectId ? feedback.projectId.toString() : null,
      courseId: feedback.courseId ? feedback.courseId.toString() : null,
      userId: feedback.userId,
      username: feedback.username,
      createdAt: feedback.createdAt,
      updatedAt: feedback.updatedAt
    }));

    res.status(200).json({
      success: true,
      data: formattedFeedbacks,
      pagination: {
        total: totalCount,
        limit: value.limit,
        offset: value.offset,
        hasMore: value.offset + value.limit < totalCount
      }
    });
  } catch (error) {
    console.error('❌ Error fetching feedback:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch feedback',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/user-feedback/stats
 * Get aggregated statistics for feedback
 */
router.get('/stats', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      projectId: Joi.string().optional().trim(),
      courseId: Joi.string().optional().trim()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    // Build query
    const query = {};
    
    if (value.projectId) {
      if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid projectId format'
        });
      }
      query.projectId = new mongoose.Types.ObjectId(value.projectId);
    }
    
    if (value.courseId) {
      if (!mongoose.Types.ObjectId.isValid(value.courseId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid courseId format'
        });
      }
      query.courseId = new mongoose.Types.ObjectId(value.courseId);
    }

    // Get all feedback matching query
    const feedbacks = await UserFeedback.find(query);

    // Calculate statistics
    const totalCount = feedbacks.length;
    
    if (totalCount === 0) {
      return res.status(200).json({
        success: true,
        data: {
          totalCount: 0,
          averageExperienceRating: 0,
          averageAiCompetenceRating: 0,
          averageLearningRating: 0,
          ratingDistribution: {
            experienceRating: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
            aiCompetenceRating: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
            learningRating: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
          }
        }
      });
    }

    // Calculate averages
    const sumExperience = feedbacks.reduce((sum, f) => sum + f.experienceRating, 0);
    const sumAiCompetence = feedbacks.reduce((sum, f) => sum + f.aiCompetenceRating, 0);
    const sumLearning = feedbacks.reduce((sum, f) => sum + f.learningRating, 0);

    const averageExperienceRating = (sumExperience / totalCount).toFixed(2);
    const averageAiCompetenceRating = (sumAiCompetence / totalCount).toFixed(2);
    const averageLearningRating = (sumLearning / totalCount).toFixed(2);

    // Calculate rating distribution
    const distribution = {
      experienceRating: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      aiCompetenceRating: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      learningRating: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    };

    feedbacks.forEach(feedback => {
      distribution.experienceRating[feedback.experienceRating]++;
      distribution.aiCompetenceRating[feedback.aiCompetenceRating]++;
      distribution.learningRating[feedback.learningRating]++;
    });

    res.status(200).json({
      success: true,
      data: {
        totalCount,
        averageExperienceRating: parseFloat(averageExperienceRating),
        averageAiCompetenceRating: parseFloat(averageAiCompetenceRating),
        averageLearningRating: parseFloat(averageLearningRating),
        ratingDistribution: distribution
      }
    });
  } catch (error) {
    console.error('❌ Error fetching feedback statistics:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch feedback statistics',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

