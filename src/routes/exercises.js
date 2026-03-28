const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Exercise = require('../models/Exercise');
const Course = require('../models/Course');
const { isOptionalAuth } = require('../middleware/auth');
const Joi = require('joi');

// Validation schemas
const exerciseCreateSchema = Joi.object({
  courseId: Joi.string().required(),
  lectureLabel: Joi.string().required().trim(),
  title: Joi.string().required().trim(),
  description: Joi.string().required().trim(),
  learningObjective: Joi.string().optional().allow('', null).trim(),
  evaluationRank: Joi.string().valid('1-10', 'A-F', 'Pass-Failed', '1-4', '100%').optional().allow('', null),
  evaluationCriteria: Joi.string().optional().allow('', null).trim(),
  references: Joi.string().optional().allow('', null).trim(),
  goodExamples: Joi.string().optional().allow('', null).trim(),
  badExamples: Joi.string().optional().allow('', null).trim(),
  aiSupportingStyles: Joi.array().items(
    Joi.string().valid('Guiding Questions', 'Task Breakdown', 'Suggest Prompts', 'Detail Feedback', 'Reflection')
  ).optional().default([])
});

const exerciseUpdateSchema = Joi.object({
  lectureLabel: Joi.string().optional().trim(),
  title: Joi.string().optional().trim(),
  description: Joi.string().optional().trim(),
  learningObjective: Joi.string().optional().allow('', null).trim(),
  evaluationRank: Joi.string().valid('1-10', 'A-F', 'Pass-Failed', '1-4', '100%').optional().allow('', null),
  evaluationCriteria: Joi.string().optional().allow('', null).trim(),
  references: Joi.string().optional().allow('', null).trim(),
  goodExamples: Joi.string().optional().allow('', null).trim(),
  badExamples: Joi.string().optional().allow('', null).trim(),
  aiSupportingStyles: Joi.array().items(
    Joi.string().valid('Guiding Questions', 'Task Breakdown', 'Suggest Prompts', 'Detail Feedback', 'Reflection')
  ).optional()
}).min(1); // At least one field must be provided

/**
 * GET /api/v1/exercises
 * Get exercises filtered by courseId
 */
router.get('/', isOptionalAuth, async (req, res) => {
  try {
    // Validate query parameters
    const schema = Joi.object({
      courseId: Joi.string().required()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const { courseId } = value;

    // Validate courseId format
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid course ID format'
      });
    }

    // Verify course exists
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    // Query exercises (convert courseId to ObjectId)
    const exercises = await Exercise.find({ 
      courseId: mongoose.Types.ObjectId(courseId) 
    }).sort({ createdAt: -1 });

    // Format response
    const formattedExercises = exercises.map(exercise => ({
      id: exercise._id.toString(),
      courseId: exercise.courseId.toString(),
      lectureLabel: exercise.lectureLabel,
      title: exercise.title,
      description: exercise.description,
      learningObjective: exercise.learningObjective || '',
      evaluationRank: exercise.evaluationRank || '',
      evaluationCriteria: exercise.evaluationCriteria || '',
      references: exercise.references || '',
      goodExamples: exercise.goodExamples || '',
      badExamples: exercise.badExamples || '',
      aiSupportingStyles: exercise.aiSupportingStyles || [],
      createdAt: exercise.createdAt,
      updatedAt: exercise.updatedAt
    }));

    res.status(200).json({
      success: true,
      data: formattedExercises
    });
  } catch (error) {
    console.error('❌ Error fetching exercises:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exercises',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/exercises/:exerciseId
 * Get a single exercise by ID
 */
router.get('/:exerciseId', isOptionalAuth, async (req, res) => {
  try {
    const { exerciseId } = req.params;

    if (!exerciseId || !mongoose.Types.ObjectId.isValid(exerciseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exercise ID'
      });
    }

    const exercise = await Exercise.findById(exerciseId);
    
    if (!exercise) {
      return res.status(404).json({
        success: false,
        message: 'Exercise not found'
      });
    }

    // Format response
    const formattedExercise = {
      id: exercise._id.toString(),
      courseId: exercise.courseId.toString(),
      lectureLabel: exercise.lectureLabel,
      title: exercise.title,
      description: exercise.description,
      learningObjective: exercise.learningObjective || '',
      evaluationRank: exercise.evaluationRank || '',
      evaluationCriteria: exercise.evaluationCriteria || '',
      references: exercise.references || '',
      goodExamples: exercise.goodExamples || '',
      badExamples: exercise.badExamples || '',
      aiSupportingStyles: exercise.aiSupportingStyles || [],
      createdAt: exercise.createdAt,
      updatedAt: exercise.updatedAt
    };

    res.status(200).json({
      success: true,
      data: formattedExercise
    });
  } catch (error) {
    console.error('❌ Error fetching exercise:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exercise',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/exercises
 * Create a new exercise
 */
router.post('/', isOptionalAuth, async (req, res) => {
  try {
    // Validate request body
    const { error, value } = exerciseCreateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const { courseId, ...exerciseData } = value;

    // Verify course exists
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid course ID format'
      });
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    // Clean up empty strings to null for optional fields
    const cleanedData = {
      courseId: mongoose.Types.ObjectId(courseId),
      lectureLabel: exerciseData.lectureLabel,
      title: exerciseData.title,
      description: exerciseData.description,
      learningObjective: exerciseData.learningObjective || null,
      evaluationRank: exerciseData.evaluationRank || null,
      evaluationCriteria: exerciseData.evaluationCriteria || null,
      references: exerciseData.references || null,
      goodExamples: exerciseData.goodExamples || null,
      badExamples: exerciseData.badExamples || null,
      aiSupportingStyles: exerciseData.aiSupportingStyles || []
    };

    // Create exercise
    const exercise = new Exercise(cleanedData);
    await exercise.save();

    // Format response
    const formattedExercise = {
      id: exercise._id.toString(),
      courseId: exercise.courseId.toString(),
      lectureLabel: exercise.lectureLabel,
      title: exercise.title,
      description: exercise.description,
      learningObjective: exercise.learningObjective || '',
      evaluationRank: exercise.evaluationRank || '',
      evaluationCriteria: exercise.evaluationCriteria || '',
      references: exercise.references || '',
      goodExamples: exercise.goodExamples || '',
      badExamples: exercise.badExamples || '',
      aiSupportingStyles: exercise.aiSupportingStyles || [],
      createdAt: exercise.createdAt,
      updatedAt: exercise.updatedAt
    };

    res.status(201).json({
      success: true,
      data: formattedExercise
    });
  } catch (error) {
    console.error('❌ Error creating exercise:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to create exercise',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * PUT /api/v1/exercises/:exerciseId
 * Update an existing exercise
 */
router.put('/:exerciseId', isOptionalAuth, async (req, res) => {
  try {
    const { exerciseId } = req.params;

    if (!exerciseId || !mongoose.Types.ObjectId.isValid(exerciseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exercise ID'
      });
    }

    // Validate request body
    const { error, value } = exerciseUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Find exercise
    const exercise = await Exercise.findById(exerciseId);
    if (!exercise) {
      return res.status(404).json({
        success: false,
        message: 'Exercise not found'
      });
    }

    // Clean up empty strings to null for optional fields
    const updateData = {};
    if (value.lectureLabel !== undefined) updateData.lectureLabel = value.lectureLabel;
    if (value.title !== undefined) updateData.title = value.title;
    if (value.description !== undefined) updateData.description = value.description;
    if (value.learningObjective !== undefined) updateData.learningObjective = value.learningObjective || null;
    if (value.evaluationRank !== undefined) updateData.evaluationRank = value.evaluationRank || null;
    if (value.evaluationCriteria !== undefined) updateData.evaluationCriteria = value.evaluationCriteria || null;
    if (value.references !== undefined) updateData.references = value.references || null;
    if (value.goodExamples !== undefined) updateData.goodExamples = value.goodExamples || null;
    if (value.badExamples !== undefined) updateData.badExamples = value.badExamples || null;
    if (value.aiSupportingStyles !== undefined) updateData.aiSupportingStyles = value.aiSupportingStyles || [];

    // Update exercise
    Object.assign(exercise, updateData);
    await exercise.save();

    // Format response
    const formattedExercise = {
      id: exercise._id.toString(),
      courseId: exercise.courseId.toString(),
      lectureLabel: exercise.lectureLabel,
      title: exercise.title,
      description: exercise.description,
      learningObjective: exercise.learningObjective || '',
      evaluationRank: exercise.evaluationRank || '',
      evaluationCriteria: exercise.evaluationCriteria || '',
      references: exercise.references || '',
      goodExamples: exercise.goodExamples || '',
      badExamples: exercise.badExamples || '',
      aiSupportingStyles: exercise.aiSupportingStyles || [],
      createdAt: exercise.createdAt,
      updatedAt: exercise.updatedAt
    };

    res.status(200).json({
      success: true,
      data: formattedExercise
    });
  } catch (error) {
    console.error('❌ Error updating exercise:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update exercise',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/v1/exercises/:exerciseId
 * Delete an exercise
 */
router.delete('/:exerciseId', isOptionalAuth, async (req, res) => {
  try {
    const { exerciseId } = req.params;

    if (!exerciseId || !mongoose.Types.ObjectId.isValid(exerciseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exercise ID'
      });
    }

    const exercise = await Exercise.findByIdAndDelete(exerciseId);
    
    if (!exercise) {
      return res.status(404).json({
        success: false,
        message: 'Exercise not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Exercise deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting exercise:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete exercise',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

