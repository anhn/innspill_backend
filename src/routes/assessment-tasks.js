const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Task = require('../models/Task');
const Project = require('../models/Project');
const { isOptionalAuth } = require('../middleware/auth');
const Joi = require('joi');

// Validation schemas
const createTaskSchema = Joi.object({
  projectId: Joi.string().required().trim().min(1),
  taskTitle: Joi.string().optional().allow('', null).trim(),
  description: Joi.string().required().trim().min(1),
  outcome: Joi.string().optional().allow('', null).trim(),
  instruction: Joi.string().optional().allow('', null).trim(),
  keyword: Joi.string().required().trim().min(1),
  submissionDeadline: Joi.date().required().iso(),
  evaluationCriteria: Joi.string().optional().allow('', null).trim(),
  enabledAIGuideline: Joi.boolean().optional().default(false),
  lockOnSubmissionQuestion: Joi.boolean().optional().default(false),
  lockOnFeedbackReceivedQuestion: Joi.boolean().optional().default(false),
  submissionQuestion: Joi.string().when('lockOnSubmissionQuestion', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow('', null)
  }).trim(),
  feedbackReceivedQuestion: Joi.string().when('lockOnFeedbackReceivedQuestion', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow('', null)
  }).trim(),
  submissionQuestionTimer: Joi.number().integer().min(1).optional().default(5),
  feedbackReceivedQuestionTimer: Joi.number().integer().min(1).optional().default(5),
  attachments: Joi.array().items(Joi.string()).optional().default([]),
  status: Joi.string().optional().valid('published', 'unpublished').default('unpublished'),
  additionalInfo: Joi.object().optional().default({})
});

const updateTaskSchema = Joi.object({
  projectId: Joi.string().required().trim().min(1),
  taskTitle: Joi.string().optional().allow('', null).trim(),
  description: Joi.string().optional().allow('', null).trim(),
  outcome: Joi.string().optional().allow('', null).trim(),
  instruction: Joi.string().optional().allow('', null).trim(),
  keyword: Joi.string().optional().allow('', null).trim(),
  submissionDeadline: Joi.date().optional().iso(),
  evaluationCriteria: Joi.string().optional().allow('', null).trim(),
  enabledAIGuideline: Joi.boolean().optional(),
  lockOnSubmissionQuestion: Joi.boolean().optional(),
  lockOnFeedbackReceivedQuestion: Joi.boolean().optional(),
  submissionQuestion: Joi.string().optional().allow('', null).trim(),
  feedbackReceivedQuestion: Joi.string().optional().allow('', null).trim(),
  submissionQuestionTimer: Joi.number().integer().min(1).optional(),
  feedbackReceivedQuestionTimer: Joi.number().integer().min(1).optional(),
  attachments: Joi.array().items(Joi.string()).optional(),
  status: Joi.string().optional().valid('published', 'unpublished'),
  additionalInfo: Joi.object().optional()
}).min(1);

/**
 * POST /api/v1/assessment-tasks
 * Create a new task
 */
router.post('/', isOptionalAuth, async (req, res) => {
  try {
    const { error, value } = createTaskSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Validate projectId exists
    if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid projectId format'
      });
    }

    const project = await Project.findById(value.projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const taskData = {
      projectId: value.projectId,
      taskTitle: value.taskTitle || null,
      description: value.description,
      outcome: value.outcome || null,
      instruction: value.instruction || null,
      keyword: value.keyword,
      submissionDeadline: new Date(value.submissionDeadline),
      evaluationCriteria: value.evaluationCriteria || null,
      enabledAIGuideline: value.enabledAIGuideline || false,
      lockOnSubmissionQuestion: value.lockOnSubmissionQuestion || false,
      lockOnFeedbackReceivedQuestion: value.lockOnFeedbackReceivedQuestion || false,
      submissionQuestion: value.submissionQuestion || null,
      feedbackReceivedQuestion: value.feedbackReceivedQuestion || null,
      submissionQuestionTimer: value.submissionQuestionTimer || 5,
      feedbackReceivedQuestionTimer: value.feedbackReceivedQuestionTimer || 5,
      attachments: value.attachments || [],
      status: value.status || 'unpublished',
      additionalInfo: value.additionalInfo || {}
    };

    const task = new Task(taskData);
    await task.save();

    res.status(201).json({
      success: true,
      data: {
        id: task._id.toString(),
        projectId: task.projectId.toString(),
        taskTitle: task.taskTitle,
        description: task.description,
        outcome: task.outcome,
        instruction: task.instruction,
        keyword: task.keyword,
        submissionDeadline: task.submissionDeadline,
        evaluationCriteria: task.evaluationCriteria,
        enabledAIGuideline: task.enabledAIGuideline,
        lockOnSubmissionQuestion: task.lockOnSubmissionQuestion,
        lockOnFeedbackReceivedQuestion: task.lockOnFeedbackReceivedQuestion,
        submissionQuestion: task.submissionQuestion,
        feedbackReceivedQuestion: task.feedbackReceivedQuestion,
        submissionQuestionTimer: task.submissionQuestionTimer,
        feedbackReceivedQuestionTimer: task.feedbackReceivedQuestionTimer,
        attachments: task.attachments,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error creating task:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to create task',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-tasks/:id
 * Get task by ID
 */
router.get('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID format'
      });
    }

    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: task._id.toString(),
        projectId: task.projectId.toString(),
        taskTitle: task.taskTitle,
        description: task.description,
        outcome: task.outcome,
        instruction: task.instruction,
        keyword: task.keyword,
        submissionDeadline: task.submissionDeadline,
        evaluationCriteria: task.evaluationCriteria,
        enabledAIGuideline: task.enabledAIGuideline,
        lockOnSubmissionQuestion: task.lockOnSubmissionQuestion,
        lockOnFeedbackReceivedQuestion: task.lockOnFeedbackReceivedQuestion,
        submissionQuestion: task.submissionQuestion,
        feedbackReceivedQuestion: task.feedbackReceivedQuestion,
        submissionQuestionTimer: task.submissionQuestionTimer,
        feedbackReceivedQuestionTimer: task.feedbackReceivedQuestionTimer,
        attachments: task.attachments,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error fetching task:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch task',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-tasks/project/:projectId
 * Get tasks by project
 */
router.get('/project/:projectId', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.projectId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid project ID format'
      });
    }

    const tasks = await Task.find({ projectId: req.params.projectId }).sort({ createdAt: -1 });

    const formattedTasks = tasks.map(task => ({
      id: task._id.toString(),
      projectId: task.projectId.toString(),
      taskTitle: task.taskTitle,
      description: task.description,
      outcome: task.outcome,
      instruction: task.instruction,
      keyword: task.keyword,
      submissionDeadline: task.submissionDeadline,
      evaluationCriteria: task.evaluationCriteria,
      enabledAIGuideline: task.enabledAIGuideline,
      lockOnSubmissionQuestion: task.lockOnSubmissionQuestion,
      lockOnFeedbackReceivedQuestion: task.lockOnFeedbackReceivedQuestion,
      submissionQuestion: task.submissionQuestion,
      feedbackReceivedQuestion: task.feedbackReceivedQuestion,
      submissionQuestionTimer: task.submissionQuestionTimer,
      feedbackReceivedQuestionTimer: task.feedbackReceivedQuestionTimer,
      attachments: task.attachments,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }));

    res.status(200).json({
      success: true,
      data: formattedTasks
    });
  } catch (error) {
    console.error('❌ Error fetching tasks by project:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tasks',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-tasks
 * List all tasks
 */
router.get('/', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      userName: Joi.string().optional().trim(),
      projectId: Joi.string().optional().trim()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const query = {};
    if (value.projectId) {
      if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid projectId format'
        });
      }
      query.projectId = value.projectId;
    }

    const tasks = await Task.find(query).sort({ createdAt: -1 });

    const formattedTasks = tasks.map(task => ({
      id: task._id.toString(),
      projectId: task.projectId.toString(),
      taskTitle: task.taskTitle,
      description: task.description,
      outcome: task.outcome,
      instruction: task.instruction,
      keyword: task.keyword,
      submissionDeadline: task.submissionDeadline,
      evaluationCriteria: task.evaluationCriteria,
      enabledAIGuideline: task.enabledAIGuideline,
      lockOnSubmissionQuestion: task.lockOnSubmissionQuestion,
      lockOnFeedbackReceivedQuestion: task.lockOnFeedbackReceivedQuestion,
      submissionQuestion: task.submissionQuestion,
      feedbackReceivedQuestion: task.feedbackReceivedQuestion,
      submissionQuestionTimer: task.submissionQuestionTimer,
      feedbackReceivedQuestionTimer: task.feedbackReceivedQuestionTimer,
      attachments: task.attachments,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }));

    res.status(200).json({
      success: true,
      data: formattedTasks
    });
  } catch (error) {
    console.error('❌ Error fetching tasks:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tasks',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * PUT /api/v1/assessment-tasks/:id
 * Update task
 */
router.put('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID format'
      });
    }

    const { error, value } = updateTaskSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Validate projectId if provided
    if (value.projectId) {
      if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid projectId format'
        });
      }
      const project = await Project.findById(value.projectId);
      if (!project) {
        return res.status(404).json({
          success: false,
          message: 'Project not found'
        });
      }
    }

    // Update fields
    if (value.projectId !== undefined) task.projectId = value.projectId;
    if (value.taskTitle !== undefined) task.taskTitle = value.taskTitle;
    if (value.description !== undefined) task.description = value.description;
    if (value.outcome !== undefined) task.outcome = value.outcome;
    if (value.instruction !== undefined) task.instruction = value.instruction;
    if (value.keyword !== undefined) task.keyword = value.keyword;
    if (value.submissionDeadline !== undefined) task.submissionDeadline = new Date(value.submissionDeadline);
    if (value.evaluationCriteria !== undefined) task.evaluationCriteria = value.evaluationCriteria;
    if (value.enabledAIGuideline !== undefined) task.enabledAIGuideline = value.enabledAIGuideline;
    if (value.lockOnSubmissionQuestion !== undefined) task.lockOnSubmissionQuestion = value.lockOnSubmissionQuestion;
    if (value.lockOnFeedbackReceivedQuestion !== undefined) task.lockOnFeedbackReceivedQuestion = value.lockOnFeedbackReceivedQuestion;
    if (value.submissionQuestion !== undefined) task.submissionQuestion = value.submissionQuestion;
    if (value.feedbackReceivedQuestion !== undefined) task.feedbackReceivedQuestion = value.feedbackReceivedQuestion;
    if (value.submissionQuestionTimer !== undefined) task.submissionQuestionTimer = value.submissionQuestionTimer;
    if (value.feedbackReceivedQuestionTimer !== undefined) task.feedbackReceivedQuestionTimer = value.feedbackReceivedQuestionTimer;
    if (value.attachments !== undefined) task.attachments = value.attachments;
    if (value.status !== undefined) task.status = value.status;
    if (value.additionalInfo !== undefined) task.additionalInfo = value.additionalInfo;

    await task.save();

    res.status(200).json({
      success: true,
      data: {
        id: task._id.toString(),
        projectId: task.projectId.toString(),
        taskTitle: task.taskTitle,
        description: task.description,
        outcome: task.outcome,
        instruction: task.instruction,
        keyword: task.keyword,
        submissionDeadline: task.submissionDeadline,
        evaluationCriteria: task.evaluationCriteria,
        enabledAIGuideline: task.enabledAIGuideline,
        lockOnSubmissionQuestion: task.lockOnSubmissionQuestion,
        lockOnFeedbackReceivedQuestion: task.lockOnFeedbackReceivedQuestion,
        submissionQuestion: task.submissionQuestion,
        feedbackReceivedQuestion: task.feedbackReceivedQuestion,
        submissionQuestionTimer: task.submissionQuestionTimer,
        feedbackReceivedQuestionTimer: task.feedbackReceivedQuestionTimer,
        attachments: task.attachments,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error updating task:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update task',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/v1/assessment-tasks/:id
 * Delete task
 */
router.delete('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID format'
      });
    }

    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Note: In a production system, you might want to handle cascading deletes
    // for associated submissions here
    await Task.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Task deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting task:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete task',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

