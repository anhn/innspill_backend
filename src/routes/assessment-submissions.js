const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const Submission = require('../models/Submission');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Course = require('../models/Course');
const Role = require('../models/Role');
const StudentGroup = require('../models/StudentGroup');
const User = require('../models/User');
const FeedbackGenerationAgent = require('../agents/FeedbackGenerationAgent');
const OpenAI = require('openai');
const { isOptionalAuth } = require('../middleware/auth');
const actionLoggingMiddleware = require('../middleware/actionLogging');
const Joi = require('joi');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Validation schemas
const createSubmissionSchema = Joi.object({
  taskId: Joi.string().required().trim().min(1),
  studentId: Joi.string().required().trim().min(1),
  studentName: Joi.string().required().trim().min(1),
  submission: Joi.string().required().trim().min(1),
  attachments: Joi.array().items(Joi.string().trim()).optional().default([]),
  conversationLog: Joi.string().optional().allow('', null).trim(),
  attemptNumber: Joi.number().integer().min(1).optional().default(1),
  stakeholderId: Joi.string().optional().trim(),
  // New fields for question answers
  submissionQuestionAnswer: Joi.string().optional().trim().min(1),
  feedbackReceivedQuestionAnswer: Joi.string().optional().trim().min(1)
});

const updateSubmissionSchema = Joi.object({
  submission: Joi.string().optional().trim().min(1),
  attachments: Joi.array().items(Joi.string().trim()).optional(),
  conversationLog: Joi.string().optional().allow('', null).trim(),
  // Updated: single score (0-5) that gets added to history
  starScore: Joi.number().integer().min(0).max(5).optional(),
  // Updated: comprehensive feedback that gets added to history
  feedback: Joi.string().optional().allow('', null).trim(),
  feedforward: Joi.string().optional().allow('', null).trim(),
  concept: Joi.string().optional().allow('', null).trim(),
  reflection: Joi.string().optional().allow('', null).trim(),
  criticalThinking: Joi.string().optional().allow('', null).trim(),
  taskQualityScore: Joi.alternatives().try(
    Joi.number().integer().min(0).max(5),
    Joi.string().valid('not applicable')
  ).optional().allow(null),
  reflectionScore: Joi.number().integer().min(0).max(5).optional().allow(null),
  criticalthinkingScore: Joi.number().integer().min(0).max(5).optional().allow(null),
  conceptMasteryScore: Joi.number().integer().min(0).max(5).optional().allow(null),
  stakeholderId: Joi.string().optional().trim(),
  // New fields for adding question answers
  submissionQuestionAnswer: Joi.string().optional().trim().min(1),
  feedbackReceivedQuestionAnswer: Joi.string().optional().trim().min(1)
}).min(1);

const generateFeedbackSchema = Joi.object({
  stakeholderId: Joi.string().optional().trim(), // Can be ObjectId or "learn-from-human"
  useAIGuideline: Joi.boolean().optional().default(true),
  updateStakeholderId: Joi.boolean().optional().default(false), // Only update submission's stakeholderId if explicitly requested
  feedbackMode: Joi.string().valid('fewshot', 'rule-based', 'revision', 'framework', 'student-involving', 'general').optional().default('general'),
  instruction: Joi.string().optional().trim(), // For rule-based mode
  // Optional override text for experiments; when provided and non-empty,
  // this will be used instead of the stored submission text
  experimentInputText: Joi.string().optional().allow('', null).trim()
});

const generateFeedbackBatchSchema = Joi.object({
  submissionIds: Joi.array().items(Joi.string()).required().min(1),
  stakeholderId: Joi.string().optional().trim(),
  useAIGuideline: Joi.boolean().optional().default(true),
  updateStakeholderId: Joi.boolean().optional().default(false), // Only update submission's stakeholderId if explicitly requested
  feedbackMode: Joi.string().valid('fewshot', 'rule-based', 'revision', 'framework', 'student-involving', 'general').optional().default('general'),
  instruction: Joi.string().optional().trim() // For rule-based mode
});

const saveFeedbackSchema = Joi.object({
  feedback: Joi.string().required().trim().min(1),
  feedforward: Joi.string().optional().allow('', null).trim(),
  concept: Joi.string().optional().allow('', null).trim(),
  reflection: Joi.string().optional().allow('', null).trim(),
  criticalThinking: Joi.string().optional().allow('', null).trim(),
  taskQualityScore: Joi.alternatives().try(
    Joi.number().integer().min(0).max(5),
    Joi.string().valid('not applicable')
  ).optional().allow(null),
  reflectionScore: Joi.number().integer().min(0).max(5).optional().allow(null),
  criticalthinkingScore: Joi.number().integer().min(0).max(5).optional().allow(null),
  conceptMasteryScore: Joi.number().integer().min(0).max(5).optional().allow(null),
  starScore: Joi.number().integer().min(0).max(5).optional(), // Keep for backward compatibility
  stakeholderId: Joi.string().optional().trim(),
  updateStakeholderId: Joi.boolean().optional().default(false) // Only update submission's stakeholderId if explicitly requested
});

const MAX_BATCH_TASKS = 30;

/**
 * Helper function to fetch the 5 most recent submissions with complete feedback data
 * for few-shot learning. Returns submissions that have:
 * - feedback, feedforward, concept, reflection, criticalThinking
 * - All scores (taskQualityScore, reflectionScore, criticalthinkingScore, conceptMasteryScore)
 */
async function fetchFewShotExamples(excludeSubmissionId = null, taskId = null, projectId = null) {
  try {
    // Build query to find submissions with complete feedback
    const query = {
      // Must have feedback history with complete data
      'feedbackHistory.0': { $exists: true },
      // Exclude the current submission if provided
      ...(excludeSubmissionId && { _id: { $ne: new mongoose.Types.ObjectId(excludeSubmissionId) } })
    };

    // Optionally filter by task or project
    if (taskId) {
      query.taskId = new mongoose.Types.ObjectId(taskId);
    } else if (projectId) {
      // Get all tasks for this project
      const tasks = await Task.find({ projectId: new mongoose.Types.ObjectId(projectId) });
      const taskIds = tasks.map(t => t._id);
      if (taskIds.length > 0) {
        query.taskId = { $in: taskIds };
      } else {
        return []; // No tasks in project
      }
    }

    // Fetch submissions with feedback history
    const submissions = await Submission.find(query)
      .sort({ datetime: -1 })
      .limit(50); // Get more to filter for complete ones

    // Filter for submissions with complete feedback data
    const completeSubmissions = submissions
      .filter(sub => {
        if (!sub.feedbackHistory || sub.feedbackHistory.length === 0) return false;
        
        const latestFeedback = sub.feedbackHistory[sub.feedbackHistory.length - 1];
        
        // Check if feedback has all required fields
        const hasFeedback = latestFeedback.feedback && latestFeedback.feedback.trim().length > 0;
        const hasFeedforward = latestFeedback.feedforward !== undefined;
        const hasConcept = latestFeedback.concept !== undefined;
        const hasReflection = latestFeedback.reflection !== undefined;
        const hasCriticalThinking = latestFeedback.criticalThinking !== undefined;
        
        // Check if scores exist (can be null, but field must exist)
        const hasScores = (
          latestFeedback.taskQualityScore !== undefined &&
          latestFeedback.reflectionScore !== undefined &&
          latestFeedback.criticalthinkingScore !== undefined &&
          latestFeedback.conceptMasteryScore !== undefined
        );

        return hasFeedback && hasFeedforward && hasConcept && hasReflection && 
               hasCriticalThinking && hasScores;
      })
      .slice(0, 5); // Take top 5 most recent complete submissions

    return completeSubmissions;
  } catch (error) {
    console.error('❌ Error fetching few-shot examples:', error.message);
    return [];
  }
}

/**
 * Helper function to build a few-shot learning prompt from example submissions
 */
function buildFewShotPrompt(examples) {
  if (!examples || examples.length === 0) {
    return '';
  }

  let prompt = `\n\n=== FEW-SHOT LEARNING EXAMPLES ===\n`;
  prompt += `Below are ${examples.length} examples of high-quality feedback that you should learn from and emulate in style, tone, and structure:\n\n`;

  examples.forEach((submission, index) => {
    const latestFeedback = submission.feedbackHistory[submission.feedbackHistory.length - 1];
    
    prompt += `--- EXAMPLE ${index + 1} ---\n`;
    prompt += `Submission: ${submission.submission ? submission.submission.substring(0, 500) : 'N/A'}${submission.submission && submission.submission.length > 500 ? '...' : ''}\n\n`;
    
    prompt += `Feedback:\n${latestFeedback.feedback || ''}\n\n`;
    prompt += `Feedforward:\n${latestFeedback.feedforward || ''}\n\n`;
    prompt += `Concept:\n${latestFeedback.concept || ''}\n\n`;
    prompt += `Reflection:\n${latestFeedback.reflection || ''}\n\n`;
    prompt += `Critical Thinking:\n${latestFeedback.criticalThinking || ''}\n\n`;
    
    prompt += `Scores:\n`;
    prompt += `- Task Quality: ${latestFeedback.taskQualityScore !== null && latestFeedback.taskQualityScore !== undefined ? latestFeedback.taskQualityScore : 'N/A'}\n`;
    prompt += `- Reflection: ${latestFeedback.reflectionScore !== null && latestFeedback.reflectionScore !== undefined ? latestFeedback.reflectionScore : 'N/A'}\n`;
    prompt += `- Critical Thinking: ${latestFeedback.criticalthinkingScore !== null && latestFeedback.criticalthinkingScore !== undefined ? latestFeedback.criticalthinkingScore : 'N/A'}\n`;
    prompt += `- Concept Mastery: ${latestFeedback.conceptMasteryScore !== null && latestFeedback.conceptMasteryScore !== undefined ? latestFeedback.conceptMasteryScore : 'N/A'}\n\n`;
    
    prompt += `---\n\n`;
  });

  prompt += `IMPORTANT: Use these examples as a reference for the style, depth, and structure of your feedback. `;
  prompt += `Match the tone, level of detail, and scoring approach demonstrated in these examples.\n\n`;

  return prompt;
}

/**
 * Helper function to aggregate submissions by group
 */
async function aggregateSubmissionsByGroup(submissions, taskId, courseId, projectId = null) {
  if (!submissions || submissions.length === 0) return [];

  if (!courseId) {
    console.warn('⚠️ No courseId provided for group aggregation');
    return [];
  }

  // Get all active groups for this course/project
  const groupQuery = {
    courseId: mongoose.Types.ObjectId.isValid(courseId) 
      ? new mongoose.Types.ObjectId(courseId) 
      : courseId,
    isActive: true
  };
  
  if (projectId) {
    groupQuery.projectId = mongoose.Types.ObjectId.isValid(projectId)
      ? new mongoose.Types.ObjectId(projectId)
      : projectId;
  } else {
    groupQuery.$or = [
      { projectId: null },
      { projectId: { $exists: false } }
    ];
  }

  const groups = await StudentGroup.find(groupQuery);
  const groupedSubmissions = [];

  // Process each group
  for (const group of groups) {
    // Find submissions from students in this group
    const groupSubmissions = submissions.filter(sub => {
      const studentId = sub.studentId;
      return group.studentIds.includes(studentId);
    });

    if (groupSubmissions.length === 0) continue;

    // Aggregate submission data
    const latestSubmission = groupSubmissions.reduce((latest, sub) => {
      return new Date(sub.datetime) > new Date(latest.datetime) ? sub : latest;
    }, groupSubmissions[0]);

    const highestAttempt = Math.max(...groupSubmissions.map(s => s.attemptNumber || 1));

    // Combine submission texts
    const combinedSubmission = groupSubmissions
      .map((sub, idx) => `--- ${sub.studentName || sub.studentId} ---\n${sub.submission || ''}`)
      .join('\n\n');

    // Combine conversation logs
    const combinedConversationLog = groupSubmissions
      .map((sub, idx) => sub.conversationLog || '')
      .filter(log => log && log.trim())
      .join('\n\n---\n\n');

    // Aggregate scores (average for numeric scores)
    const taskQualityScores = groupSubmissions
      .map(s => {
        const latestFeedback = s.feedbackHistory && s.feedbackHistory.length > 0
          ? s.feedbackHistory[s.feedbackHistory.length - 1]
          : null;
        return latestFeedback?.taskQualityScore;
      })
      .filter(score => score !== null && score !== undefined && typeof score === 'number');

    const reflectionScores = groupSubmissions
      .map(s => {
        const latestFeedback = s.feedbackHistory && s.feedbackHistory.length > 0
          ? s.feedbackHistory[s.feedbackHistory.length - 1]
          : null;
        return latestFeedback?.reflectionScore;
      })
      .filter(score => score !== null && score !== undefined);

    const criticalthinkingScores = groupSubmissions
      .map(s => {
        const latestFeedback = s.feedbackHistory && s.feedbackHistory.length > 0
          ? s.feedbackHistory[s.feedbackHistory.length - 1]
          : null;
        return latestFeedback?.criticalthinkingScore;
      })
      .filter(score => score !== null && score !== undefined);

    const conceptMasteryScores = groupSubmissions
      .map(s => {
        const latestFeedback = s.feedbackHistory && s.feedbackHistory.length > 0
          ? s.feedbackHistory[s.feedbackHistory.length - 1]
          : null;
        return latestFeedback?.conceptMasteryScore;
      })
      .filter(score => score !== null && score !== undefined);

    // Calculate averages
    const avgTaskQualityScore = taskQualityScores.length > 0
      ? taskQualityScores.reduce((sum, s) => sum + s, 0) / taskQualityScores.length
      : null;
    const avgReflectionScore = reflectionScores.length > 0
      ? reflectionScores.reduce((sum, s) => sum + s, 0) / reflectionScores.length
      : null;
    const avgCriticalthinkingScore = criticalthinkingScores.length > 0
      ? criticalthinkingScores.reduce((sum, s) => sum + s, 0) / criticalthinkingScores.length
      : null;
    const avgConceptMasteryScore = conceptMasteryScores.length > 0
      ? conceptMasteryScores.reduce((sum, s) => sum + s, 0) / conceptMasteryScores.length
      : null;

    // Merge arrays (deduplicate by content)
    const mergedSubmissionQuestionAnswers = [];
    const mergedFeedbackReceivedQuestionAnswers = [];
    const mergedFeedbackHistory = [];
    const mergedStarScoreHistory = [];

    groupSubmissions.forEach(sub => {
      if (sub.submissionQuestionAnswers) {
        sub.submissionQuestionAnswers.forEach(qa => {
          if (!mergedSubmissionQuestionAnswers.find(existing => 
            existing.answer === qa.answer && 
            new Date(existing.answeredAt).getTime() === new Date(qa.answeredAt).getTime()
          )) {
            mergedSubmissionQuestionAnswers.push(qa);
          }
        });
      }
      if (sub.feedbackReceivedQuestionAnswers) {
        sub.feedbackReceivedQuestionAnswers.forEach(qa => {
          if (!mergedFeedbackReceivedQuestionAnswers.find(existing => 
            existing.answer === qa.answer && 
            new Date(existing.answeredAt).getTime() === new Date(qa.answeredAt).getTime()
          )) {
            mergedFeedbackReceivedQuestionAnswers.push(qa);
          }
        });
      }
      if (sub.feedbackHistory) {
        sub.feedbackHistory.forEach(fh => {
          if (!mergedFeedbackHistory.find(existing => 
            existing.feedback === fh.feedback && 
            new Date(existing.createdAt).getTime() === new Date(fh.createdAt).getTime()
          )) {
            mergedFeedbackHistory.push(fh);
          }
        });
      }
      if (sub.starScoreHistory) {
        sub.starScoreHistory.forEach(ssh => {
          if (!mergedStarScoreHistory.find(existing => 
            existing.score === ssh.score && 
            new Date(existing.createdAt).getTime() === new Date(ssh.createdAt).getTime()
          )) {
            mergedStarScoreHistory.push(ssh);
          }
        });
      }
    });

    // Sort merged arrays by date
    mergedSubmissionQuestionAnswers.sort((a, b) => new Date(a.answeredAt) - new Date(b.answeredAt));
    mergedFeedbackReceivedQuestionAnswers.sort((a, b) => new Date(a.answeredAt) - new Date(b.answeredAt));
    mergedFeedbackHistory.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    mergedStarScoreHistory.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    // Get student names
    const studentNames = groupSubmissions.map(s => s.studentName || s.studentId);

    groupedSubmissions.push({
      groupId: group._id.toString(),
      groupName: group.name,
      taskId: taskId,
      studentIds: group.studentIds,
      studentNames: studentNames,
      datetime: latestSubmission.datetime,
      attemptNumber: highestAttempt,
      submission: combinedSubmission,
      conversationLog: combinedConversationLog,
      taskQualityScore: avgTaskQualityScore,
      reflectionScore: avgReflectionScore,
      criticalthinkingScore: avgCriticalthinkingScore,
      conceptMasteryScore: avgConceptMasteryScore,
      submissionQuestionAnswers: mergedSubmissionQuestionAnswers,
      feedbackReceivedQuestionAnswers: mergedFeedbackReceivedQuestionAnswers,
      feedbackHistory: mergedFeedbackHistory,
      starScoreHistory: mergedStarScoreHistory,
      stakeholderId: latestSubmission.stakeholderId ? latestSubmission.stakeholderId.toString() : null
    });
  }

  return groupedSubmissions;
}

// Shared formatter to keep response shapes consistent
const formatSubmission = (submission) => ({
  id: submission._id.toString(),
  taskId: submission.taskId ? submission.taskId.toString() : null,
  studentId: submission.studentId,
  studentName: submission.studentName,
  datetime: submission.datetime,
  attemptNumber: submission.attemptNumber,
  submission: submission.submission,
  attachments: submission.attachments || [],
  conversationLog: submission.conversationLog,
  submissionQuestionAnswers: submission.submissionQuestionAnswers || [],
  feedbackReceivedQuestionAnswers: submission.feedbackReceivedQuestionAnswers || [],
  feedbackHistory: submission.feedbackHistory ? submission.feedbackHistory.map(entry => ({
    feedback: entry.feedback,
    feedforward: entry.feedforward || '',
    concept: entry.concept || '',
    reflection: entry.reflection || '',
    criticalThinking: entry.criticalThinking || '',
    taskQualityScore: entry.taskQualityScore,
    reflectionScore: entry.reflectionScore,
    criticalthinkingScore: entry.criticalthinkingScore,
    conceptMasteryScore: entry.conceptMasteryScore,
    stakeholderId: entry.stakeholderId ? entry.stakeholderId.toString() : null,
    createdAt: entry.createdAt
  })) : [],
  starScoreHistory: submission.starScoreHistory || [],
  // Backward compatibility virtuals
  starScore: submission.starScore,
  feedback: submission.feedback,
  stakeholderId: submission.stakeholderId ? submission.stakeholderId.toString() : null,
  createdAt: submission.createdAt,
  updatedAt: submission.updatedAt
});

/**
 * POST /api/v1/assessment-submissions
 * Create a new submission
 */
router.post('/', isOptionalAuth, async (req, res) => {
  try {
    const { error, value } = createSubmissionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Validate taskId exists
    if (!mongoose.Types.ObjectId.isValid(value.taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid taskId format'
      });
    }

    const task = await Task.findById(value.taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    // Validate stakeholderId if provided
    let stakeholderId = null;
    if (value.stakeholderId) {
      if (!mongoose.Types.ObjectId.isValid(value.stakeholderId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid stakeholderId format'
        });
      }
      const role = await Role.findById(value.stakeholderId);
      if (!role) {
        return res.status(404).json({
          success: false,
          message: 'Stakeholder role not found'
        });
      }
      stakeholderId = value.stakeholderId;
    }

    const submissionData = {
      taskId: value.taskId,
      studentId: value.studentId,
      studentName: value.studentName,
      submission: value.submission,
      attachments: value.attachments || [],
      conversationLog: value.conversationLog || null,
      attemptNumber: value.attemptNumber || 1,
      stakeholderId: stakeholderId,
      datetime: new Date(),
      submissionQuestionAnswers: [],
      feedbackReceivedQuestionAnswers: [],
      feedbackHistory: [],
      starScoreHistory: []
    };

    // Add initial question answers if provided
    if (value.submissionQuestionAnswer) {
      submissionData.submissionQuestionAnswers.push({
        answer: value.submissionQuestionAnswer,
        answeredAt: new Date()
      });
    }
    if (value.feedbackReceivedQuestionAnswer) {
      submissionData.feedbackReceivedQuestionAnswers.push({
        answer: value.feedbackReceivedQuestionAnswer,
        answeredAt: new Date()
      });
    }

    const submission = new Submission(submissionData);
    await submission.save();

    res.status(201).json({
      success: true,
      data: {
        id: submission._id.toString(),
        taskId: submission.taskId.toString(),
        studentId: submission.studentId,
        studentName: submission.studentName,
        datetime: submission.datetime,
        attemptNumber: submission.attemptNumber,
        submission: submission.submission,
        attachments: submission.attachments || [],
        conversationLog: submission.conversationLog,
        submissionQuestionAnswers: submission.submissionQuestionAnswers || [],
        feedbackReceivedQuestionAnswers: submission.feedbackReceivedQuestionAnswers || [],
        feedbackHistory: submission.feedbackHistory || [],
        starScoreHistory: submission.starScoreHistory || [],
        // Backward compatibility virtuals
        starScore: submission.starScore,
        feedback: submission.feedback,
        stakeholderId: submission.stakeholderId ? submission.stakeholderId.toString() : null,
        createdAt: submission.createdAt,
        updatedAt: submission.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error creating submission:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to create submission',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-submissions/:id
 * Get submission by ID
 */
router.get('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission ID format'
      });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: submission._id.toString(),
        taskId: submission.taskId.toString(),
        studentId: submission.studentId,
        studentName: submission.studentName,
        datetime: submission.datetime,
        attemptNumber: submission.attemptNumber,
        submission: submission.submission,
        attachments: submission.attachments || [],
        conversationLog: submission.conversationLog,
        submissionQuestionAnswers: submission.submissionQuestionAnswers || [],
        feedbackReceivedQuestionAnswers: submission.feedbackReceivedQuestionAnswers || [],
        feedbackHistory: submission.feedbackHistory || [],
        starScoreHistory: submission.starScoreHistory || [],
        // Backward compatibility virtuals
        starScore: submission.starScore,
        feedback: submission.feedback,
        stakeholderId: submission.stakeholderId ? submission.stakeholderId.toString() : null,
        createdAt: submission.createdAt,
        updatedAt: submission.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error fetching submission:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch submission',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-submissions/task/:taskId
 * Get submissions by task
 */
router.get('/task/:taskId', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID format'
      });
    }

    const schema = Joi.object({
      userName: Joi.string().optional().trim(),
      stakeholderId: Joi.string().optional().trim()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const query = { taskId: req.params.taskId };
    if (value.stakeholderId) {
      if (!mongoose.Types.ObjectId.isValid(value.stakeholderId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid stakeholderId format'
        });
      }
      query.stakeholderId = value.stakeholderId;
    }

    const submissions = await Submission.find(query).sort({ createdAt: -1 });

    const formattedSubmissions = submissions.map(submission => formatSubmission(submission));

    res.status(200).json({
      success: true,
      data: formattedSubmissions
    });
  } catch (error) {
    console.error('❌ Error fetching submissions by task:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch submissions',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/assessment-submissions/batch
 * Get submissions for multiple tasks in a single request
 * Body: { "taskIds": ["taskId1", "taskId2", ...], "stakeholderId": "optional" }
 * Response: { "success": true, "data": [{ "taskId": "id1", "submissions": [...] }, ...], "errors": [...] }
 */
router.post('/batch', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      taskIds: Joi.array().items(Joi.string().trim().min(1)).required().min(1).max(MAX_BATCH_TASKS),
      stakeholderId: Joi.string().optional().trim()
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Validate all taskIds
    const validTaskIds = [];
    const invalidTaskIds = [];
    
    for (const taskId of value.taskIds) {
      if (mongoose.Types.ObjectId.isValid(taskId)) {
        validTaskIds.push(taskId);
      } else {
        invalidTaskIds.push(taskId);
      }
    }

    // Validate stakeholderId if provided
    if (value.stakeholderId && !mongoose.Types.ObjectId.isValid(value.stakeholderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid stakeholderId format'
      });
    }

    // Build query for all valid taskIds
    const query = { taskId: { $in: validTaskIds } };
    if (value.stakeholderId) {
      query.stakeholderId = value.stakeholderId;
    }

    // Fetch all submissions in a single query
    const submissions = await Submission.find(query).sort({ createdAt: -1 });

    // Group submissions by taskId
    const submissionsByTask = {};
    submissions.forEach(submission => {
      const taskIdStr = submission.taskId ? submission.taskId.toString() : null;
      if (taskIdStr) {
        if (!submissionsByTask[taskIdStr]) {
          submissionsByTask[taskIdStr] = [];
        }
        submissionsByTask[taskIdStr].push(formatSubmission(submission));
      }
    });

    // Build response data - include all requested taskIds, even if no submissions found
    const data = value.taskIds.map(taskId => ({
      taskId: taskId,
      submissions: submissionsByTask[taskId] || []
    }));

    // Build errors array for invalid taskIds
    const errors = invalidTaskIds.map(taskId => ({
      taskId: taskId,
      error: 'Invalid taskId format'
    }));

    res.status(200).json({
      success: true,
      data: data,
      ...(errors.length > 0 && { errors: errors }),
      meta: {
        requested: value.taskIds.length,
        valid: validTaskIds.length,
        invalid: invalidTaskIds.length,
        totalSubmissions: submissions.length
      }
    });
  } catch (error) {
    console.error('❌ Error fetching batch submissions:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch batch submissions',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-submissions/student/:studentId
 * Get submissions by student
 */
router.get('/student/:studentId', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      userName: Joi.string().optional().trim(),
      taskId: Joi.string().optional().trim()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const query = { studentId: req.params.studentId };
    if (value.taskId) {
      if (!mongoose.Types.ObjectId.isValid(value.taskId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid taskId format'
        });
      }
      query.taskId = value.taskId;
    }

    const submissions = await Submission.find(query).sort({ createdAt: -1 });

    const formattedSubmissions = submissions.map(submission => ({
      id: submission._id.toString(),
      taskId: submission.taskId.toString(),
      studentId: submission.studentId,
      studentName: submission.studentName,
      datetime: submission.datetime,
      attemptNumber: submission.attemptNumber,
      submission: submission.submission,
      attachments: submission.attachments || [],
      conversationLog: submission.conversationLog,
      submissionQuestionAnswers: submission.submissionQuestionAnswers || [],
      feedbackReceivedQuestionAnswers: submission.feedbackReceivedQuestionAnswers || [],
      feedbackHistory: submission.feedbackHistory || [],
      starScoreHistory: submission.starScoreHistory || [],
      // Backward compatibility virtuals
      starScore: submission.starScore,
      feedback: submission.feedback,
      stakeholderId: submission.stakeholderId ? submission.stakeholderId.toString() : null,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt
    }));

    res.status(200).json({
      success: true,
      data: formattedSubmissions
    });
  } catch (error) {
    console.error('❌ Error fetching submissions by student:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch submissions',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-submissions
 * List all submissions
 */
router.get('/', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      userName: Joi.string().optional().trim(),
      taskId: Joi.string().optional().trim(),
      studentId: Joi.string().optional().trim(),
      stakeholderId: Joi.string().optional().trim(),
      // New query parameters for Activity Tab Monitoring
      limit: Joi.number().integer().min(1).max(1000).optional().default(50),
      sortBy: Joi.string().valid('createdAt', 'updatedAt').optional().default('createdAt'),
      sortOrder: Joi.string().valid('asc', 'desc').optional().default('desc'),
      distinctUsers: Joi.boolean().optional().default(false)
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
    if (value.taskId) {
      if (!mongoose.Types.ObjectId.isValid(value.taskId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid taskId format'
        });
      }
      query.taskId = value.taskId;
    }
    if (value.studentId) {
      query.studentId = value.studentId;
    }
    if (value.stakeholderId) {
      if (!mongoose.Types.ObjectId.isValid(value.stakeholderId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid stakeholderId format'
        });
      }
      query.stakeholderId = value.stakeholderId;
    }

    let submissions;
    const sortField = value.sortBy === 'updatedAt' ? 'updatedAt' : 'createdAt';
    const sortOrder = value.sortOrder === 'asc' ? 1 : -1;
    const sortObj = { [sortField]: sortOrder };

    // If distinctUsers is true, get only latest submission per user
    if (value.distinctUsers) {
      // Use aggregation to get latest submission per studentId
      const aggregation = [
        { $match: query },
        { $sort: sortObj },
        {
          $group: {
            _id: '$studentId',
            submission: { $first: '$$ROOT' }
          }
        },
        { $replaceRoot: { newRoot: '$submission' } },
        { $sort: sortObj }
      ];

      if (value.limit) {
        aggregation.push({ $limit: value.limit });
      }

      submissions = await Submission.aggregate(aggregation);
      // Convert aggregation results to Mongoose documents for formatSubmission
      submissions = submissions.map(s => new Submission(s));
    } else {
      // Chain limit() before await
      let queryBuilder = Submission.find(query).sort(sortObj);
      if (value.limit) {
        queryBuilder = queryBuilder.limit(value.limit);
      }
      submissions = await queryBuilder;
    }

    // Get student usernames for formatted submissions
    const studentIds = [...new Set(submissions.map(s => s.studentId).filter(Boolean))];
    const studentUsers = await User.find({
      $or: [
        { _id: { $in: studentIds.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id)) } },
        { username: { $in: studentIds.filter(id => !mongoose.Types.ObjectId.isValid(id)) } }
      ]
    })
      .select('_id username')
      .lean();

    const studentMap = {};
    studentUsers.forEach(user => {
      const key = mongoose.Types.ObjectId.isValid(user._id) ? user._id.toString() : user.username;
      studentMap[key] = { id: user._id?.toString(), username: user.username };
    });

    const formattedSubmissions = submissions.map(submission => {
      const studentInfo = studentMap[submission.studentId] || { id: submission.studentId, username: submission.studentName };
      
      return {
        id: submission._id.toString(),
        taskId: submission.taskId ? submission.taskId.toString() : null,
        studentId: submission.studentId,
        student: {
          id: studentInfo.id || submission.studentId,
          username: studentInfo.username || submission.studentName
        },
        studentName: submission.studentName,
        datetime: submission.datetime,
        attemptNumber: submission.attemptNumber,
        submission: submission.submission,
        attachments: submission.attachments || [],
        conversationLog: submission.conversationLog,
        submissionQuestionAnswers: submission.submissionQuestionAnswers || [],
        feedbackReceivedQuestionAnswers: submission.feedbackReceivedQuestionAnswers || [],
        feedbackHistory: submission.feedbackHistory || [],
        starScoreHistory: submission.starScoreHistory || [],
        // Backward compatibility virtuals
        starScore: submission.starScore,
        feedback: submission.feedback,
        stakeholderId: submission.stakeholderId ? submission.stakeholderId.toString() : null,
        createdAt: submission.createdAt,
        updatedAt: submission.updatedAt
      };
    });

    res.status(200).json({
      success: true,
      data: formattedSubmissions
    });
  } catch (error) {
    console.error('❌ Error fetching submissions:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch submissions',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-submissions/task/:taskId/grouped
 * Get grouped submissions by task
 */
router.get('/task/:taskId/grouped', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task ID format'
      });
    }

    const schema = Joi.object({
      viewType: Joi.string().valid('individual', 'group').optional().default('group'),
      groupId: Joi.string().optional().trim(),
      stakeholderId: Joi.string().optional().trim()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const task = await Task.findById(req.params.taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const project = await Project.findById(task.projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Build query for submissions
    const submissionQuery = { taskId: req.params.taskId };
    if (value.stakeholderId) {
      if (!mongoose.Types.ObjectId.isValid(value.stakeholderId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid stakeholderId format'
        });
      }
      submissionQuery.stakeholderId = value.stakeholderId;
    }

    const submissions = await Submission.find(submissionQuery).sort({ createdAt: -1 });

    if (value.viewType === 'group') {
      // Aggregate by groups
      const groupedSubmissions = await aggregateSubmissionsByGroup(
        submissions,
        req.params.taskId,
        project.courseId ? project.courseId.toString() : null,
        task.projectId ? task.projectId.toString() : null
      );

      // Filter by groupId if provided
      let filteredGroups = groupedSubmissions;
      if (value.groupId) {
        filteredGroups = groupedSubmissions.filter(g => g.groupId === value.groupId);
      }

      res.status(200).json({
        success: true,
        viewType: 'group',
        data: filteredGroups
      });
    } else {
      // Individual view with group info
      const formattedSubmissions = submissions.map(sub => formatSubmission(sub));

      // Add group info to each submission
      const groupQuery = {
        courseId: project.courseId,
        isActive: true,
        studentIds: { $in: formattedSubmissions.map(s => s.studentId).filter(Boolean) }
      };
      if (task.projectId) {
        groupQuery.projectId = task.projectId;
      } else {
        groupQuery.$or = [
          { projectId: null },
          { projectId: { $exists: false } }
        ];
      }

      const groups = await StudentGroup.find(groupQuery);
      const studentToGroupMap = {};
      groups.forEach(group => {
        group.studentIds.forEach(studentId => {
          if (!studentToGroupMap[studentId]) {
            studentToGroupMap[studentId] = {
              groupId: group._id.toString(),
              groupName: group.name
            };
          }
        });
      });

      const submissionsWithGroups = formattedSubmissions.map(sub => {
        const groupInfo = studentToGroupMap[sub.studentId];
        return {
          ...sub,
          groupId: groupInfo ? groupInfo.groupId : null,
          groupName: groupInfo ? groupInfo.groupName : null
        };
      });

      res.status(200).json({
        success: true,
        viewType: 'individual',
        data: submissionsWithGroups
      });
    }
  } catch (error) {
    console.error('❌ Error fetching grouped submissions by task:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch grouped submissions',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-submissions/project/:projectId/grouped
 * Get grouped submissions by project
 */
router.get('/project/:projectId/grouped', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.projectId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid project ID format'
      });
    }

    const schema = Joi.object({
      viewType: Joi.string().valid('individual', 'group').optional().default('group'),
      groupId: Joi.string().optional().trim(),
      stakeholderId: Joi.string().optional().trim()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const project = await Project.findById(req.params.projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Get all tasks for this project
    const tasks = await Task.find({ projectId: req.params.projectId });
    const taskIds = tasks.map(t => t._id);

    // Build query for submissions
    const submissionQuery = { taskId: { $in: taskIds } };
    if (value.stakeholderId) {
      if (!mongoose.Types.ObjectId.isValid(value.stakeholderId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid stakeholderId format'
        });
      }
      submissionQuery.stakeholderId = value.stakeholderId;
    }

    const submissions = await Submission.find(submissionQuery).sort({ createdAt: -1 });

    if (value.viewType === 'group') {
      // Group by task and aggregate
      const groupedByTask = {};
      
      for (const task of tasks) {
        const taskSubmissions = submissions.filter(s => s.taskId.toString() === task._id.toString());
        if (taskSubmissions.length > 0) {
          const grouped = await aggregateSubmissionsByGroup(
            taskSubmissions,
            task._id.toString(),
            project.courseId ? project.courseId.toString() : null,
            req.params.projectId
          );
          
          // Filter by groupId if provided
          if (value.groupId) {
            groupedByTask[task._id.toString()] = grouped.filter(g => g.groupId === value.groupId);
          } else {
            groupedByTask[task._id.toString()] = grouped;
          }
        }
      }

      // Flatten to single array
      const allGroupedSubmissions = Object.values(groupedByTask).flat();

      res.status(200).json({
        success: true,
        viewType: 'group',
        data: allGroupedSubmissions
      });
    } else {
      // Individual view with group info
      const formattedSubmissions = submissions.map(sub => formatSubmission(sub));

      // Add group info
      const groupQuery = {
        courseId: project.courseId,
        isActive: true,
        studentIds: { $in: formattedSubmissions.map(s => s.studentId).filter(Boolean) }
      };
      if (req.params.projectId) {
        groupQuery.projectId = req.params.projectId;
      } else {
        groupQuery.$or = [
          { projectId: null },
          { projectId: { $exists: false } }
        ];
      }

      const groups = await StudentGroup.find(groupQuery);
      const studentToGroupMap = {};
      groups.forEach(group => {
        group.studentIds.forEach(studentId => {
          if (!studentToGroupMap[studentId]) {
            studentToGroupMap[studentId] = {
              groupId: group._id.toString(),
              groupName: group.name
            };
          }
        });
      });

      const submissionsWithGroups = formattedSubmissions.map(sub => {
        const groupInfo = studentToGroupMap[sub.studentId];
        return {
          ...sub,
          groupId: groupInfo ? groupInfo.groupId : null,
          groupName: groupInfo ? groupInfo.groupName : null
        };
      });

      res.status(200).json({
        success: true,
        viewType: 'individual',
        data: submissionsWithGroups
      });
    }
  } catch (error) {
    console.error('❌ Error fetching grouped submissions by project:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch grouped submissions',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-submissions/stakeholder/:stakeholderId/grouped
 * Get grouped stakeholder submissions
 */
router.get('/stakeholder/:stakeholderId/grouped', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.stakeholderId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid stakeholder ID format'
      });
    }

    const schema = Joi.object({
      viewType: Joi.string().valid('individual', 'group').optional().default('group'),
      taskId: Joi.string().optional().trim(),
      projectId: Joi.string().optional().trim(),
      groupId: Joi.string().optional().trim()
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
    const submissionQuery = { stakeholderId: req.params.stakeholderId };
    
    if (value.taskId) {
      if (!mongoose.Types.ObjectId.isValid(value.taskId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid taskId format'
        });
      }
      submissionQuery.taskId = value.taskId;
    } else if (value.projectId) {
      if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid projectId format'
        });
      }
      const tasks = await Task.find({ projectId: value.projectId });
      submissionQuery.taskId = { $in: tasks.map(t => t._id) };
    }

    const submissions = await Submission.find(submissionQuery).sort({ createdAt: -1 });

    if (value.viewType === 'group') {
      // Need to get courseId from task/project
      let courseId = null;
      let projectId = value.projectId || null;

      if (value.taskId) {
        const task = await Task.findById(value.taskId);
        if (task) {
          const project = await Project.findById(task.projectId);
          if (project) {
            courseId = project.courseId ? project.courseId.toString() : null;
            projectId = task.projectId ? task.projectId.toString() : null;
          }
        }
      } else if (value.projectId) {
        const project = await Project.findById(value.projectId);
        if (project) {
          courseId = project.courseId ? project.courseId.toString() : null;
        }
      }

      if (!courseId) {
        return res.status(400).json({
          success: false,
          message: 'Unable to determine course. Please provide taskId or projectId.'
        });
      }

      // Group by task and aggregate
      const taskIds = [...new Set(submissions.map(s => s.taskId.toString()))];
      const groupedByTask = {};

      for (const taskIdStr of taskIds) {
        const taskSubmissions = submissions.filter(s => s.taskId.toString() === taskIdStr);
        if (taskSubmissions.length > 0) {
          const grouped = await aggregateSubmissionsByGroup(
            taskSubmissions,
            taskIdStr,
            courseId,
            projectId
          );
          
          if (value.groupId) {
            groupedByTask[taskIdStr] = grouped.filter(g => g.groupId === value.groupId);
          } else {
            groupedByTask[taskIdStr] = grouped;
          }
        }
      }

      const allGroupedSubmissions = Object.values(groupedByTask).flat();

      res.status(200).json({
        success: true,
        viewType: 'group',
        data: allGroupedSubmissions
      });
    } else {
      // Individual view with group info
      const formattedSubmissions = submissions.map(sub => formatSubmission(sub));

      // Get courseId for group lookup
      let courseId = null;
      if (value.taskId) {
        const task = await Task.findById(value.taskId);
        if (task) {
          const project = await Project.findById(task.projectId);
          if (project) courseId = project.courseId;
        }
      } else if (value.projectId) {
        const project = await Project.findById(value.projectId);
        if (project) courseId = project.courseId;
      }

      if (courseId) {
        const groupQuery = {
          courseId: courseId,
          isActive: true,
          studentIds: { $in: formattedSubmissions.map(s => s.studentId).filter(Boolean) }
        };
        if (value.projectId) {
          groupQuery.projectId = value.projectId;
        }

        const groups = await StudentGroup.find(groupQuery);
        const studentToGroupMap = {};
        groups.forEach(group => {
          group.studentIds.forEach(studentId => {
            if (!studentToGroupMap[studentId]) {
              studentToGroupMap[studentId] = {
                groupId: group._id.toString(),
                groupName: group.name
              };
            }
          });
        });

        const submissionsWithGroups = formattedSubmissions.map(sub => {
          const groupInfo = studentToGroupMap[sub.studentId];
          return {
            ...sub,
            groupId: groupInfo ? groupInfo.groupId : null,
            groupName: groupInfo ? groupInfo.groupName : null
          };
        });

        res.status(200).json({
          success: true,
          viewType: 'individual',
          data: submissionsWithGroups
        });
      } else {
        res.status(200).json({
          success: true,
          viewType: 'individual',
          data: formattedSubmissions
        });
      }
    }
  } catch (error) {
    console.error('❌ Error fetching grouped stakeholder submissions:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch grouped stakeholder submissions',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * PUT /api/v1/assessment-submissions/:id
 * Update submission
 */
router.put('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission ID format'
      });
    }

    const { error, value } = updateSubmissionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    // Validate stakeholderId if provided
    if (value.stakeholderId) {
      if (!mongoose.Types.ObjectId.isValid(value.stakeholderId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid stakeholderId format'
        });
      }
      const role = await Role.findById(value.stakeholderId);
      if (!role) {
        return res.status(404).json({
          success: false,
          message: 'Stakeholder role not found'
        });
      }
    }

    // Initialize arrays if they don't exist (for backward compatibility with old submissions)
    if (!submission.submissionQuestionAnswers) submission.submissionQuestionAnswers = [];
    if (!submission.feedbackReceivedQuestionAnswers) submission.feedbackReceivedQuestionAnswers = [];
    if (!submission.feedbackHistory) submission.feedbackHistory = [];
    if (!submission.starScoreHistory) submission.starScoreHistory = [];

    // Update fields
    if (value.submission !== undefined) submission.submission = value.submission;
    if (value.attachments !== undefined) submission.attachments = value.attachments || [];
    if (value.conversationLog !== undefined) submission.conversationLog = value.conversationLog;
    if (value.stakeholderId !== undefined) submission.stakeholderId = value.stakeholderId || null;

    // Add question answers to history (append, not replace)
    if (value.submissionQuestionAnswer !== undefined) {
      submission.submissionQuestionAnswers.push({
        answer: value.submissionQuestionAnswer,
        answeredAt: new Date()
      });
    }
    if (value.feedbackReceivedQuestionAnswer !== undefined) {
      submission.feedbackReceivedQuestionAnswers.push({
        answer: value.feedbackReceivedQuestionAnswer,
        answeredAt: new Date()
      });
    }

    // Add comprehensive feedback to history (append, not replace)
    if (value.feedback !== undefined && value.feedback !== null && value.feedback.trim() !== '') {
      const feedbackEntry = {
        feedback: value.feedback,
        feedforward: value.feedforward || '',
        concept: value.concept || '',
        reflection: value.reflection || '',
        criticalThinking: value.criticalThinking || '',
        taskQualityScore: value.taskQualityScore !== undefined ? value.taskQualityScore : null,
        reflectionScore: value.reflectionScore !== undefined ? value.reflectionScore : null,
        criticalthinkingScore: value.criticalthinkingScore !== undefined ? value.criticalthinkingScore : null,
        conceptMasteryScore: value.conceptMasteryScore !== undefined ? value.conceptMasteryScore : null,
        stakeholderId: value.stakeholderId ? new mongoose.Types.ObjectId(value.stakeholderId) : submission.stakeholderId || null,
        createdAt: new Date()
      };
      submission.feedbackHistory.push(feedbackEntry);
    }

    // Add star score to history (append, not replace)
    if (value.starScore !== undefined) {
      submission.starScoreHistory.push({
        score: value.starScore,
        stakeholderId: value.stakeholderId ? new mongoose.Types.ObjectId(value.stakeholderId) : submission.stakeholderId || null,
        createdAt: new Date()
      });
    }

    await submission.save();

    res.status(200).json({
      success: true,
      data: {
        id: submission._id.toString(),
        taskId: submission.taskId.toString(),
        studentId: submission.studentId,
        studentName: submission.studentName,
        datetime: submission.datetime,
        attemptNumber: submission.attemptNumber,
        submission: submission.submission,
        attachments: submission.attachments || [],
        conversationLog: submission.conversationLog,
        submissionQuestionAnswers: submission.submissionQuestionAnswers || [],
        feedbackReceivedQuestionAnswers: submission.feedbackReceivedQuestionAnswers || [],
        feedbackHistory: submission.feedbackHistory || [],
        starScoreHistory: submission.starScoreHistory || [],
        // Backward compatibility virtuals
        starScore: submission.starScore,
        feedback: submission.feedback,
        stakeholderId: submission.stakeholderId ? submission.stakeholderId.toString() : null,
        createdAt: submission.createdAt,
        updatedAt: submission.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error updating submission:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update submission',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/v1/assessment-submissions/:id
 * Delete submission
 */
router.delete('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission ID format'
      });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    await Submission.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Submission deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting submission:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete submission',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-submissions/:submissionId/prompt
 * Get the prompt that would be used for feedback generation
 * Query Parameters:
 *   - userName (string, required): Username of the requesting user
 *   - stakeholderId (string, optional): Stakeholder ID or "learn-from-human" for few-shot learning
 *   - useAIGuideline (boolean, optional, default: true): Whether to use AI guideline from task
 */
router.get('/:submissionId/prompt', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.submissionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission ID format'
      });
    }

    const schema = Joi.object({
      userName: Joi.string().required().trim(),
      stakeholderId: Joi.string().optional().trim(),
      useAIGuideline: Joi.boolean().optional().default(true),
      feedbackMode: Joi.string().valid('fewshot', 'rule-based', 'revision', 'framework', 'student-involving', 'general').optional().default('general'),
      instruction: Joi.string().optional().trim() // For rule-based mode
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const submission = await Submission.findById(req.params.submissionId);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    // Fetch related data
    const task = await Task.findById(submission.taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const project = await Project.findById(task.projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Get stakeholder persona - use provided stakeholderId, or fall back to submission's stakeholderId
    let persona = null;
    let attachments = [];
    let stakeholderIdToUse = value.stakeholderId || submission.stakeholderId;
    let fewShotExamples = null;
    let fewShotPrompt = '';
    const feedbackMode = value.feedbackMode || 'general';
    
    // Determine approach name based on feedbackMode
    const approachNames = {
      'fewshot': 'Few-Shot Learning',
      'rule-based': 'Rule-Based Grading',
      'revision': 'Revision Checking',
      'framework': 'Framework Aligning',
      'student-involving': 'Student Involving',
      'general': 'Standard Feedback Generation'
    };
    let approachName = approachNames[feedbackMode] || 'Standard Feedback Generation';
    
    // Check if "Learn from Human" is selected (legacy support)
    const isLearnFromHuman = stakeholderIdToUse === 'learn-from-human';
    
    // For "fewshot" mode or "learn-from-human", fetch few-shot examples
    if (feedbackMode === 'fewshot' || isLearnFromHuman) {
      if (isLearnFromHuman) {
        approachName = 'Learn from Human (Few-Shot Learning)';
      }
      // Fetch few-shot examples for learning from human feedback
      fewShotExamples = await fetchFewShotExamples(
        submission._id.toString(),
        submission.taskId.toString(),
        task.projectId ? task.projectId.toString() : null
      );
      
      if (fewShotExamples.length > 0) {
        fewShotPrompt = buildFewShotPrompt(fewShotExamples);
        console.log(`📚 Using ${fewShotExamples.length} few-shot examples for "${approachName}" mode`);
      } else {
        console.warn(`⚠️ No few-shot examples found for "${approachName}" mode`);
      }
    } else if (stakeholderIdToUse && !isLearnFromHuman) {
      if (!mongoose.Types.ObjectId.isValid(stakeholderIdToUse)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid stakeholderId format'
        });
      }
      const role = await Role.findById(stakeholderIdToUse);
      if (role) {
        persona = role.persona;
        attachments = role.attachments || [];
        approachName = `${approachName} - Stakeholder: ${role.name || 'Custom Persona'}`;
      }
    }

    // Combine attachments from task, role, and submission (match generate-feedback)
    attachments = [...new Set([...(attachments || []), ...(task.attachments || []), ...(submission.attachments || [])])];

    const { attachmentContent } = await readAttachmentContents(attachments);

    // Find previous submission for the same student/task (most recent other submission)
    const previous = await Submission.findOne({
      taskId: submission.taskId,
      studentId: submission.studentId,
      _id: { $ne: submission._id }
    }).sort({ datetime: -1 });

    const previousSubmission = previous ? previous.submission : null;
    const previousFeedback = previous && previous.feedbackHistory && previous.feedbackHistory.length > 0
      ? previous.feedbackHistory[previous.feedbackHistory.length - 1].feedback
      : null;

    // Get latest reflection answers
    const submissionAnswer = submission.submissionQuestionAnswers && submission.submissionQuestionAnswers.length > 0
      ? submission.submissionQuestionAnswers[submission.submissionQuestionAnswers.length - 1].answer
      : null;
    const feedbackReceivedAnswer = submission.feedbackReceivedQuestionAnswers && submission.feedbackReceivedQuestionAnswers.length > 0
      ? submission.feedbackReceivedQuestionAnswers[submission.feedbackReceivedQuestionAnswers.length - 1].answer
      : null;

    // Build the prompt request object (same structure as generate-feedback)
    const agent = new FeedbackGenerationAgent(openai);
    
    const request = {
      // Feedback mode
      feedbackMode: feedbackMode,
      // Current submission + reflections (not included in new modes)
      submission: submission.submission,
      submissionAnswer: (feedbackMode === 'general') ? submissionAnswer : null,
      feedbackReceivedAnswer: (feedbackMode === 'general') ? feedbackReceivedAnswer : null,
      // History context
      previousSubmission,
      previousFeedback,
      submissionHistory: submission.feedbackHistory || [],
      // Evaluation context
      evaluationCriteria: task.evaluationCriteria || '',
      learningObjectives: project.learningOutcome || '',
      persona: persona,
      attachments: attachments,
      attachmentContent: attachmentContent || '',
      conversationLog: submission.conversationLog || '',
      // Task metadata
      id: task._id.toString(),
      projectId: task.projectId ? task.projectId.toString() : null,
      taskTitle: task.taskTitle,
      description: task.description,
      keyword: task.keyword,
      submissionDeadline: task.submissionDeadline,
      enabledAIGuideline: value.useAIGuideline ? task.enabledAIGuideline : false,
      submissionQuestion: (feedbackMode === 'general') ? task.submissionQuestion : null,
      feedbackReceivedQuestion: (feedbackMode === 'general') ? task.feedbackReceivedQuestion : null,
      // Few-shot learning (for "fewshot" mode or "Learn from Human")
      fewShotPrompt: fewShotPrompt,
      isLearnFromHuman: isLearnFromHuman,
      // Rule-based mode
      instruction: value.instruction || null
    };

    // Build the full prompt (system prompt + user message)
    const systemPrompt = agent.getSystemPrompt(feedbackMode);
    const userMessage = agent.formatUserMessage(request);
    const fullPrompt = `${systemPrompt}\n\n${userMessage}`;

    // Prepare response with metadata
    const responseData = {
      submissionId: submission._id.toString(),
      stakeholderId: stakeholderIdToUse || null,
      prompt: fullPrompt,
      approachName: approachName,
      fewShotExamples: isLearnFromHuman && fewShotExamples ? fewShotExamples.map(ex => ({
        submissionId: ex._id.toString(),
        submission: ex.submission ? ex.submission.substring(0, 200) + (ex.submission.length > 200 ? '...' : '') : null,
        feedbackCount: ex.feedbackHistory ? ex.feedbackHistory.length : 0
      })) : null,
      metadata: {
        taskId: task._id.toString(),
        taskTitle: task.taskTitle,
        studentId: submission.studentId,
        submissionText: submission.submission ? submission.submission.substring(0, 200) + (submission.submission.length > 200 ? '...' : '') : '',
        evaluationCriteria: task.evaluationCriteria || '',
        hasPreviousSubmission: !!previousSubmission,
        hasPreviousFeedback: !!previousFeedback,
        useAIGuideline: value.useAIGuideline,
        hasPersona: !!persona,
        attachmentCount: attachments.length,
        attachmentContentLength: attachmentContent ? attachmentContent.length : 0,
        hasFewShotExamples: isLearnFromHuman && fewShotExamples ? fewShotExamples.length > 0 : false
      }
    };

    res.status(200).json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('❌ Error fetching prompt:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch prompt',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/assessment-submissions/:id/generate-feedback
 * Generate feedback for a submission using AI
 */
router.post('/:id/generate-feedback', isOptionalAuth, actionLoggingMiddleware('generate-feedback'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission ID format'
      });
    }

    const { error, value } = generateFeedbackSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    // Fetch related data
    const task = await Task.findById(submission.taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const project = await Project.findById(task.projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Get stakeholder persona - use provided stakeholderId, or fall back to submission's stakeholderId
    let persona = null;
    let attachments = [];
    let stakeholderIdToUse = value.stakeholderId || submission.stakeholderId;
    let fewShotExamples = null;
    let fewShotPrompt = '';
    
    // Check if "Learn from Human" is selected
    const isLearnFromHuman = stakeholderIdToUse === 'learn-from-human';
    
    if (isLearnFromHuman) {
      // Fetch few-shot examples for learning from human feedback
      fewShotExamples = await fetchFewShotExamples(
        submission._id.toString(),
        submission.taskId.toString(),
        task.projectId ? task.projectId.toString() : null
      );
      
      if (fewShotExamples.length > 0) {
        fewShotPrompt = buildFewShotPrompt(fewShotExamples);
        console.log(`📚 Using ${fewShotExamples.length} few-shot examples for "Learn from Human" mode`);
      } else {
        console.warn('⚠️ No few-shot examples found for "Learn from Human" mode');
      }
    } else if (stakeholderIdToUse) {
      if (!mongoose.Types.ObjectId.isValid(stakeholderIdToUse)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid stakeholderId format'
        });
      }
      const role = await Role.findById(stakeholderIdToUse);
      if (role) {
        persona = role.persona;
        attachments = role.attachments || [];
      }
    }

    // Combine attachments from task, role, and submission
    attachments = [...new Set([...(attachments || []), ...(task.attachments || []), ...(submission.attachments || [])])];

    const { attachmentContent } = await readAttachmentContents(attachments);

    // Find previous submission for the same student/task (most recent other submission)
    const previous = await Submission.findOne({
      taskId: submission.taskId,
      studentId: submission.studentId,
      _id: { $ne: submission._id }
    }).sort({ datetime: -1 });

    const previousSubmission = previous ? previous.submission : null;
    const previousFeedback = previous && previous.feedbackHistory && previous.feedbackHistory.length > 0
      ? previous.feedbackHistory[previous.feedbackHistory.length - 1].feedback
      : null;

    // Get latest reflection answers
    const submissionAnswer = submission.submissionQuestionAnswers && submission.submissionQuestionAnswers.length > 0
      ? submission.submissionQuestionAnswers[submission.submissionQuestionAnswers.length - 1].answer
      : null;
    const feedbackReceivedAnswer = submission.feedbackReceivedQuestionAnswers && submission.feedbackReceivedQuestionAnswers.length > 0
      ? submission.feedbackReceivedQuestionAnswers[submission.feedbackReceivedQuestionAnswers.length - 1].answer
      : null;

    // Determine feedback mode - if "learn-from-human" is selected, use "fewshot" mode
    const feedbackMode = isLearnFromHuman ? 'fewshot' : (value.feedbackMode || 'general');

    // Allow overriding the stored submission text with experimentInputText when provided
    const hasExperimentInput =
      typeof value.experimentInputText === 'string' && value.experimentInputText.trim().length > 0;
    const currentSubmissionText = hasExperimentInput
      ? value.experimentInputText.trim()
      : submission.submission;

    // Generate feedback using AI with new comprehensive request structure
    const agent = new FeedbackGenerationAgent(openai);
    const request = {
      // Feedback mode
      feedbackMode: feedbackMode,
      // Current submission + reflections (leave out for new modes)
      // If experimentInputText is provided, use it instead of the stored submission text
      submission: currentSubmissionText,
      submissionAnswer: (feedbackMode === 'general') ? submissionAnswer : null,
      feedbackReceivedAnswer: (feedbackMode === 'general') ? feedbackReceivedAnswer : null,
      // History context
      previousSubmission,
      previousFeedback,
      submissionHistory: submission.feedbackHistory || [],
      // Evaluation context
      evaluationCriteria: task.evaluationCriteria || '',
      learningObjectives: project.learningOutcome || '',
      persona: persona,
      attachments: attachments,
      attachmentContent: attachmentContent || '',
      conversationLog: submission.conversationLog || '',
      // Task metadata
      id: task._id.toString(),
      projectId: task.projectId ? task.projectId.toString() : null,
      taskTitle: task.taskTitle,
      description: task.description,
      keyword: task.keyword,
      submissionDeadline: task.submissionDeadline,
      enabledAIGuideline: task.enabledAIGuideline,
      submissionQuestion: (feedbackMode === 'general') ? task.submissionQuestion : null,
      feedbackReceivedQuestion: (feedbackMode === 'general') ? task.feedbackReceivedQuestion : null,
      // Few-shot learning (for "fewshot" mode or "Learn from Human")
      fewShotPrompt: fewShotPrompt,
      isLearnFromHuman: isLearnFromHuman,
      // Rule-based mode
      instruction: value.instruction || null
    };

    const startTime = Date.now();
    const response = await agent.process(request);
    const processingTime = Date.now() - startTime;

    if (!response.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate feedback',
        error: response.error
      });
    }

    // Parse AI response (new comprehensive JSON structure)
    let feedbackData = {};
    try {
      const responseText = response.response.trim();
      // Remove markdown code blocks if present
      const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleanedText);
      
      feedbackData = {
        feedback: parsed.feedback || '',
        feedforward: parsed.feedforward || '',
        concept: parsed.concept || '',
        reflection: parsed.reflection || '',
        criticalThinking: parsed.criticalThinking || '',
        taskQualityScore: parsed.taskQualityScore,
        reflectionScore: parsed.reflectionScore,
        criticalthinkingScore: parsed.criticalthinkingScore,
        conceptMasteryScore: parsed.conceptMasteryScore
      };
    } catch (parseError) {
      console.error('❌ Error parsing feedback response:', parseError.message);
      // Fallback: use entire response as feedback only
      feedbackData = {
        feedback: response.response,
        feedforward: '',
        concept: '',
        reflection: '',
        criticalThinking: '',
        taskQualityScore: null,
        reflectionScore: null,
        criticalthinkingScore: null,
        conceptMasteryScore: null
      };
    }

    // Return the generated comprehensive feedback (NOT saved to database yet)
    res.status(200).json({
      success: true,
      data: {
        ...feedbackData,
        stakeholderId: value.stakeholderId || (submission.stakeholderId ? submission.stakeholderId.toString() : null)
      },
      usage: response.usage,
      usageInternal: response.usageInternal,
      processingTime
    });
  } catch (error) {
    console.error('❌ Error generating feedback:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to generate feedback',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/assessment-submissions/:id/save-feedback
 * Save feedback and star score to submission history
 */
router.post('/:id/save-feedback', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission ID format'
      });
    }

    const { error, value } = saveFeedbackSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    // Validate stakeholderId if provided
    let stakeholderIdToUse = value.stakeholderId || submission.stakeholderId;
    if (value.stakeholderId) {
      if (!mongoose.Types.ObjectId.isValid(value.stakeholderId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid stakeholderId format'
        });
      }
      const role = await Role.findById(value.stakeholderId);
      if (!role) {
        return res.status(404).json({
          success: false,
          message: 'Stakeholder role not found'
        });
      }
    }

    // Initialize arrays if they don't exist (for backward compatibility)
    if (!submission.feedbackHistory) submission.feedbackHistory = [];
    if (!submission.starScoreHistory) submission.starScoreHistory = [];

    // Add comprehensive feedback to history (append, not replace)
    if (value.feedback && value.feedback.trim() !== '') {
      const feedbackEntry = {
        feedback: value.feedback,
        feedforward: value.feedforward || '',
        concept: value.concept || '',
        reflection: value.reflection || '',
        criticalThinking: value.criticalThinking || '',
        taskQualityScore: value.taskQualityScore !== undefined ? value.taskQualityScore : null,
        reflectionScore: value.reflectionScore !== undefined ? value.reflectionScore : null,
        criticalthinkingScore: value.criticalthinkingScore !== undefined ? value.criticalthinkingScore : null,
        conceptMasteryScore: value.conceptMasteryScore !== undefined ? value.conceptMasteryScore : null,
        stakeholderId: stakeholderIdToUse ? new mongoose.Types.ObjectId(stakeholderIdToUse) : null,
        createdAt: new Date()
      };
      submission.feedbackHistory.push(feedbackEntry);
    }

    // Add star score to history (append, not replace) - keep for backward compatibility
    if (value.starScore !== undefined && value.starScore !== null) {
      submission.starScoreHistory.push({
        score: value.starScore,
        stakeholderId: stakeholderIdToUse ? new mongoose.Types.ObjectId(stakeholderIdToUse) : null,
        createdAt: new Date()
      });
    }

    // Only update stakeholderId if explicitly requested (updateStakeholderId = true)
    if (value.updateStakeholderId && value.stakeholderId) {
      submission.stakeholderId = new mongoose.Types.ObjectId(value.stakeholderId);
    }

    await submission.save();

    // Return full submission data
    res.status(200).json({
      success: true,
      data: {
        id: submission._id.toString(),
        taskId: submission.taskId.toString(),
        studentId: submission.studentId,
        studentName: submission.studentName,
        datetime: submission.datetime,
        attemptNumber: submission.attemptNumber,
        submission: submission.submission,
        attachments: submission.attachments || [],
        conversationLog: submission.conversationLog,
        submissionQuestionAnswers: submission.submissionQuestionAnswers || [],
        feedbackReceivedQuestionAnswers: submission.feedbackReceivedQuestionAnswers || [],
        feedbackHistory: submission.feedbackHistory || [],
        starScoreHistory: submission.starScoreHistory || [],
        // Backward compatibility virtuals
        starScore: submission.starScore,
        feedback: submission.feedback,
        stakeholderId: submission.stakeholderId ? submission.stakeholderId.toString() : null,
        createdAt: submission.createdAt,
        updatedAt: submission.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error saving feedback:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to save feedback',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/v1/assessment-submissions/:id/feedback
 * Delete a feedback entry from submission history by index
 * Query params: index (optional, defaults to most recent/last entry)
 */
router.delete('/:id/feedback', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission ID format'
      });
    }

    const schema = Joi.object({
      index: Joi.number().integer().min(0).optional()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    // Initialize array if it doesn't exist
    if (!submission.feedbackHistory || submission.feedbackHistory.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No feedback found for this submission'
      });
    }

    // Determine index to delete (default to last/most recent)
    const indexToDelete = value.index !== undefined 
      ? value.index 
      : submission.feedbackHistory.length - 1;

    // Validate index
    if (indexToDelete < 0 || indexToDelete >= submission.feedbackHistory.length) {
      return res.status(400).json({
        success: false,
        message: `Invalid index. Must be between 0 and ${submission.feedbackHistory.length - 1}`
      });
    }

    // Get the feedback entry before deletion
    const deletedFeedback = submission.feedbackHistory[indexToDelete];

    // Remove the feedback entry
    submission.feedbackHistory.splice(indexToDelete, 1);

    await submission.save();

    res.status(200).json({
      success: true,
      message: 'Feedback deleted successfully',
      data: {
        deletedFeedback: {
          feedback: deletedFeedback.feedback,
          feedforward: deletedFeedback.feedforward || '',
          concept: deletedFeedback.concept || '',
          reflection: deletedFeedback.reflection || '',
          criticalThinking: deletedFeedback.criticalThinking || '',
          taskQualityScore: deletedFeedback.taskQualityScore,
          reflectionScore: deletedFeedback.reflectionScore,
          criticalthinkingScore: deletedFeedback.criticalthinkingScore,
          conceptMasteryScore: deletedFeedback.conceptMasteryScore,
          stakeholderId: deletedFeedback.stakeholderId ? deletedFeedback.stakeholderId.toString() : null,
          createdAt: deletedFeedback.createdAt
        },
        remainingCount: submission.feedbackHistory.length
      }
    });
  } catch (error) {
    console.error('❌ Error deleting feedback:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete feedback',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/assessment-submissions/generate-feedback-batch
 * Generate feedback for multiple submissions (without saving to database)
 */
router.post('/generate-feedback-batch', isOptionalAuth, actionLoggingMiddleware('generate-feedback-batch'), async (req, res) => {
  try {
    const { error, value } = generateFeedbackBatchSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Get userName from query parameter or request body
    const userName = req.query.userName || req.body.userName || 'anonymous';

    if (!value.submissionIds || !Array.isArray(value.submissionIds) || value.submissionIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'submissionIds array is required'
      });
    }

    const results = [];
    let generated = 0;
    let failed = 0;

    // Process submissions sequentially to avoid rate limits
    for (const submissionId of value.submissionIds) {
      try {
        // Validate submission ID format
        if (!mongoose.Types.ObjectId.isValid(submissionId)) {
          results.push({
            submissionId,
            success: false,
            error: 'Invalid submission ID format'
          });
          failed++;
          continue;
        }

        // Find submission
        const submission = await Submission.findById(submissionId);
        if (!submission) {
          results.push({
            submissionId,
            success: false,
            error: 'Submission not found'
          });
          failed++;
          continue;
        }

        // Check if feedback already exists
        const hasFeedback = (submission.feedbackHistory && submission.feedbackHistory.length > 0) || 
                           (submission.feedback && submission.feedback.trim() !== '');
        if (hasFeedback) {
          results.push({
            submissionId,
            success: false,
            error: 'Feedback already exists'
          });
          failed++;
          continue;
        }

        // Fetch related data
        const task = await Task.findById(submission.taskId);
        if (!task) {
          results.push({
            submissionId,
            success: false,
            error: 'Task not found'
          });
          failed++;
          continue;
        }

        const project = await Project.findById(task.projectId);
        if (!project) {
          results.push({
            submissionId,
            success: false,
            error: 'Project not found'
          });
          failed++;
          continue;
        }

        // Determine if AI guideline should be used
        const shouldUseAIGuideline = value.useAIGuideline !== undefined 
          ? value.useAIGuideline 
          : (task.enabledAIGuideline ?? true);

        // Get stakeholder persona - use provided stakeholderId, or fall back to submission's stakeholderId
        let persona = null;
        let attachments = [];
        let stakeholderIdToUse = value.stakeholderId || submission.stakeholderId;
        let fewShotExamples = null;
        let fewShotPrompt = '';
        
        // Determine feedback mode - if "learn-from-human" is selected, use "fewshot" mode
        const feedbackMode = (stakeholderIdToUse === 'learn-from-human') ? 'fewshot' : (value.feedbackMode || 'general');
        
        // Check if "Learn from Human" is selected (legacy support)
        const isLearnFromHuman = stakeholderIdToUse === 'learn-from-human';
        
        if (feedbackMode === 'fewshot' || isLearnFromHuman) {
          // Fetch few-shot examples for learning from human feedback
          fewShotExamples = await fetchFewShotExamples(
            submission._id.toString(),
            submission.taskId.toString(),
            task.projectId ? task.projectId.toString() : null
          );
          
          if (fewShotExamples.length > 0) {
            fewShotPrompt = buildFewShotPrompt(fewShotExamples);
            console.log(`📚 Using ${fewShotExamples.length} few-shot examples for "Learn from Human" mode (batch)`);
          } else {
            console.warn('⚠️ No few-shot examples found for "Learn from Human" mode (batch)');
          }
        } else if (stakeholderIdToUse) {
          if (!mongoose.Types.ObjectId.isValid(stakeholderIdToUse)) {
            results.push({
              submissionId,
              success: false,
              error: 'Invalid stakeholderId format'
            });
            failed++;
            continue;
          }
          const role = await Role.findById(stakeholderIdToUse);
          if (role) {
            persona = role.persona;
            attachments = role.attachments || [];
          }
        }

        // Combine attachments from task, role, and submission
        attachments = [...new Set([...(attachments || []), ...(task.attachments || []), ...(submission.attachments || [])])];

        const { attachmentContent } = await readAttachmentContents(attachments);

        // Find previous submission for the same student/task (most recent other submission)
        const previous = await Submission.findOne({
          taskId: submission.taskId,
          studentId: submission.studentId,
          _id: { $ne: submission._id }
        }).sort({ datetime: -1 });

        const previousSubmission = previous ? previous.submission : null;
        const previousFeedback = previous && previous.feedbackHistory && previous.feedbackHistory.length > 0
          ? previous.feedbackHistory[previous.feedbackHistory.length - 1].feedback
          : null;

        // Get latest reflection answers
        const submissionAnswer = submission.submissionQuestionAnswers && submission.submissionQuestionAnswers.length > 0
          ? submission.submissionQuestionAnswers[submission.submissionQuestionAnswers.length - 1].answer
          : null;
        const feedbackReceivedAnswer = submission.feedbackReceivedQuestionAnswers && submission.feedbackReceivedQuestionAnswers.length > 0
          ? submission.feedbackReceivedQuestionAnswers[submission.feedbackReceivedQuestionAnswers.length - 1].answer
          : null;

        // Generate feedback using AI with new comprehensive request structure
        const agent = new FeedbackGenerationAgent(openai);
        const request = {
          // Feedback mode
          feedbackMode: feedbackMode,
          // Current submission + reflections (leave out for new modes)
          submission: submission.submission,
          submissionAnswer: (feedbackMode === 'general') ? submissionAnswer : null,
          feedbackReceivedAnswer: (feedbackMode === 'general') ? feedbackReceivedAnswer : null,
          // History context
          previousSubmission,
          previousFeedback,
          submissionHistory: submission.feedbackHistory || [],
          // Evaluation context
          evaluationCriteria: task.evaluationCriteria || '',
          learningObjectives: project.learningOutcome || '',
          persona: persona,
          attachments: attachments,
          attachmentContent: attachmentContent || '',
          conversationLog: submission.conversationLog || '',
          // Task metadata
          id: task._id.toString(),
          projectId: task.projectId ? task.projectId.toString() : null,
          taskTitle: task.taskTitle,
          description: task.description,
          keyword: task.keyword,
          submissionDeadline: task.submissionDeadline,
          enabledAIGuideline: task.enabledAIGuideline,
          submissionQuestion: (feedbackMode === 'general') ? task.submissionQuestion : null,
          feedbackReceivedQuestion: (feedbackMode === 'general') ? task.feedbackReceivedQuestion : null,
          // Few-shot learning (for "fewshot" mode or "Learn from Human")
          fewShotPrompt: fewShotPrompt,
          isLearnFromHuman: isLearnFromHuman,
          // Rule-based mode
          instruction: value.instruction || null
        };

        const response = await agent.process(request);

        if (!response.success) {
          results.push({
            submissionId,
            success: false,
            error: response.error || 'Failed to generate feedback'
          });
          failed++;
          continue;
        }

        // Parse AI response (new comprehensive JSON structure)
        let feedbackData = {};
        try {
          const responseText = response.response.trim();
          // Remove markdown code blocks if present
          const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const parsed = JSON.parse(cleanedText);
          
          feedbackData = {
            feedback: parsed.feedback || '',
            feedforward: parsed.feedforward || '',
            concept: parsed.concept || '',
            reflection: parsed.reflection || '',
            criticalThinking: parsed.criticalThinking || '',
            taskQualityScore: parsed.taskQualityScore,
            reflectionScore: parsed.reflectionScore,
            criticalthinkingScore: parsed.criticalthinkingScore,
            conceptMasteryScore: parsed.conceptMasteryScore
          };
        } catch (parseError) {
          console.error('❌ Error parsing feedback response:', parseError.message);
          // Fallback: use entire response as feedback only
          feedbackData = {
            feedback: response.response,
            feedforward: '',
            concept: '',
            reflection: '',
            criticalThinking: '',
            taskQualityScore: null,
            reflectionScore: null,
            criticalthinkingScore: null,
            conceptMasteryScore: null
          };
        }

        // Return generated comprehensive feedback (NOT saved to database - frontend will save)
        results.push({
          submissionId,
          success: true,
          ...feedbackData
        });
        generated++;

      } catch (error) {
        console.error(`❌ Error generating feedback for submission ${submissionId}:`, error.message);
        results.push({
          submissionId,
          success: false,
          error: error.message || 'Failed to generate feedback'
        });
        failed++;
      }
    }

    res.json({
      success: true,
      data: {
        generated,
        failed,
        results
      }
    });
  } catch (error) {
    console.error('❌ Batch feedback generation error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate batch feedback'
    });
  }
});

/**
 * GET /api/v1/assessment-submissions/heatmap
 * Get submission heatmap data
 */
router.get('/heatmap', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      projectId: Joi.string().required().trim().min(1),
      userName: Joi.string().optional().trim()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid projectId format'
      });
    }

    // Get all tasks for the project
    const tasks = await Task.find({ projectId: value.projectId });
    const taskIds = tasks.map(t => t._id);

    // Get all submissions for these tasks
    const submissions = await Submission.find({ taskId: { $in: taskIds } });

    // Get unique student IDs
    const studentIds = [...new Set(submissions.map(s => s.studentId))];

    // Build heatmap data
    const heatmap = [];
    for (const task of tasks) {
      for (const studentId of studentIds) {
        const submission = submissions.find(
          s => s.taskId.toString() === task._id.toString() && s.studentId === studentId
        );
        heatmap.push({
          taskId: task._id.toString(),
          studentId: studentId,
          hasSubmission: !!submission,
          starScore: submission ? submission.starScore : null
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        tasks: tasks.map(t => ({
          id: t._id.toString(),
          taskTitle: t.taskTitle,
          keyword: t.keyword
        })),
        students: studentIds,
        heatmap: heatmap
      }
    });
  } catch (error) {
    console.error('❌ Error fetching heatmap:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch heatmap data',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-submissions/stakeholder-heatmap
 * Get stakeholder interaction heatmap
 */
router.get('/stakeholder-heatmap', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      projectId: Joi.string().required().trim().min(1),
      userName: Joi.string().optional().trim()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid projectId format'
      });
    }

    // Get all roles for the project
    const stakeholders = await Role.find({ projectId: value.projectId });

    // Get all tasks for the project
    const tasks = await Task.find({ projectId: value.projectId });
    const taskIds = tasks.map(t => t._id);

    // Get all submissions with stakeholder interactions
    const submissions = await Submission.find({
      taskId: { $in: taskIds },
      stakeholderId: { $ne: null }
    });

    // Get unique student IDs
    const studentIds = [...new Set(submissions.map(s => s.studentId))];

    // Build heatmap data
    const heatmap = [];
    for (const stakeholder of stakeholders) {
      for (const studentId of studentIds) {
        const studentSubmissions = submissions.filter(
          s => s.stakeholderId && s.stakeholderId.toString() === stakeholder._id.toString() && s.studentId === studentId
        );
        
        const conversationCount = studentSubmissions.length;
        const totalConversationLength = studentSubmissions.reduce((sum, s) => {
          return sum + (s.conversationLog ? s.conversationLog.length : 0);
        }, 0);

        heatmap.push({
          stakeholderId: stakeholder._id.toString(),
          studentId: studentId,
          conversationCount: conversationCount,
          totalConversationLength: totalConversationLength
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        stakeholders: stakeholders.map(s => ({
          id: s._id.toString(),
          name: s.name
        })),
        students: studentIds,
        heatmap: heatmap
      }
    });
  } catch (error) {
    console.error('❌ Error fetching stakeholder heatmap:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch stakeholder heatmap data',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-submissions/progress
 * Get progress data
 */
router.get('/progress', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      projectId: Joi.string().required().trim().min(1),
      studentId: Joi.string().optional().trim(),
      userName: Joi.string().optional().trim()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid projectId format'
      });
    }

    // Get all tasks for the project
    const tasks = await Task.find({ projectId: value.projectId });
    const taskIds = tasks.map(t => t._id);

    // Build query for submissions
    const submissionQuery = { taskId: { $in: taskIds } };
    if (value.studentId) {
      submissionQuery.studentId = value.studentId;
    }

    // Get all submissions
    const submissions = await Submission.find(submissionQuery);

    // Get unique students
    const studentIds = [...new Set(submissions.map(s => s.studentId))];
    const studentNames = {};
    submissions.forEach(s => {
      if (!studentNames[s.studentId]) {
        studentNames[s.studentId] = s.studentName;
      }
    });

    // Build progress data by date
    const progressData = {};
    for (const studentId of studentIds) {
      progressData[studentId] = {};
      const studentSubmissions = submissions.filter(s => s.studentId === studentId);
      
      // Group by date
      studentSubmissions.forEach(submission => {
        const date = submission.datetime.toISOString().split('T')[0];
        if (!progressData[studentId][date]) {
          progressData[studentId][date] = 0;
        }
        progressData[studentId][date]++;
      });
    }

    // Convert to required format
    const students = studentIds.map(studentId => {
      const progress = Object.keys(progressData[studentId] || {})
        .sort()
        .map(date => {
          // Calculate accumulated count
          const dates = Object.keys(progressData[studentId] || {}).sort();
          const dateIndex = dates.indexOf(date);
          let completedTasks = 0;
          for (let i = 0; i <= dateIndex; i++) {
            completedTasks += progressData[studentId][dates[i]];
          }
          return {
            date: date,
            completedTasks: completedTasks
          };
        });

      return {
        studentId: studentId,
        studentName: studentNames[studentId],
        progress: progress
      };
    });

    res.status(200).json({
      success: true,
      data: {
        students: students
      }
    });
  } catch (error) {
    console.error('❌ Error fetching progress:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch progress data',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-submissions/timeline
 * Get timeline data
 */
router.get('/timeline', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      projectId: Joi.string().required().trim().min(1),
      studentId: Joi.string().optional().trim(),
      userName: Joi.string().optional().trim()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid projectId format'
      });
    }

    // Get all tasks for the project
    const tasks = await Task.find({ projectId: value.projectId });
    const taskMap = {};
    tasks.forEach(t => {
      taskMap[t._id.toString()] = t;
    });
    const taskIds = tasks.map(t => t._id);

    // Build query for submissions
    const submissionQuery = { taskId: { $in: taskIds } };
    if (value.studentId) {
      submissionQuery.studentId = value.studentId;
    }

    // Get all submissions
    const submissions = await Submission.find(submissionQuery).sort({ datetime: 1 });

    const timeline = submissions.map(submission => {
      const task = taskMap[submission.taskId.toString()];
      return {
        id: submission._id.toString(),
        taskId: submission.taskId.toString(),
        taskTitle: task ? task.taskTitle : null,
        taskKeyword: task ? task.keyword : '',
        studentId: submission.studentId,
        studentName: submission.studentName,
        datetime: submission.datetime,
        submissionDeadline: task ? task.submissionDeadline : null,
        isOnTime: task ? submission.datetime <= task.submissionDeadline : null,
        submissionQuestionAnswers: submission.submissionQuestionAnswers || [],
        feedbackReceivedQuestionAnswers: submission.feedbackReceivedQuestionAnswers || [],
        feedbackHistory: submission.feedbackHistory || [],
        starScoreHistory: submission.starScoreHistory || [],
        // Backward compatibility virtuals
        starScore: submission.starScore,
        feedback: submission.feedback
      };
    });

    res.status(200).json({
      success: true,
      data: timeline
    });
  } catch (error) {
    console.error('❌ Error fetching timeline:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch timeline data',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-submissions/:id/attachments
 * Get attachments for a single submission
 * Returns attachments from both the task and the stakeholder role (if assigned)
 */
router.get('/:id/attachments', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission ID format'
      });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    // Get task attachments
    const task = await Task.findById(submission.taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    let attachments = [...(task.attachments || [])];
    const attachmentSources = {
      task: task.attachments || [],
      role: []
    };

    // Get role attachments if stakeholder is assigned
    if (submission.stakeholderId) {
      const role = await Role.findById(submission.stakeholderId);
      if (role) {
        const roleAttachments = role.attachments || [];
        attachments = [...attachments, ...roleAttachments];
        attachmentSources.role = roleAttachments;
      }
    }

    // Remove duplicates while preserving order
    const uniqueAttachments = [...new Set(attachments)];

    res.status(200).json({
      success: true,
      data: {
        submissionId: submission._id.toString(),
        taskId: submission.taskId.toString(),
        stakeholderId: submission.stakeholderId ? submission.stakeholderId.toString() : null,
        attachments: uniqueAttachments,
        sources: {
          task: attachmentSources.task,
          role: attachmentSources.role
        },
        totalCount: uniqueAttachments.length
      }
    });
  } catch (error) {
    console.error('❌ Error fetching submission attachments:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch submission attachments',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

// Max file size per attachment (10MB) to avoid DoS/timeouts
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.xml', '.html', '.css', '.js', '.py', '.java', '.cpp', '.c', '.h'];

/**
 * Extract plain text from a file. Returns { text, entry } or throws.
 */
async function extractTextFromFile(filePath, filename) {
  const ext = path.extname(filename).toLowerCase();
  const stats = fs.statSync(filePath);
  if (stats.size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error(`File too large (max ${MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024}MB)`);
  }
  if (TEXT_EXTENSIONS.includes(ext)) {
    const content = fs.readFileSync(filePath, 'utf8');
    return {
      text: content,
      entry: { filename, size: content.length, type: 'text' }
    };
  }
  if (ext === '.pdf') {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return {
      text: data.text || '',
      entry: { filename, size: stats.size, type: 'pdf', pages: data.numpages }
    };
  }
  if (ext === '.docx' || ext === '.doc') {
    const result = await mammoth.extractRawText({ path: filePath });
    return {
      text: result.value || '',
      entry: { filename, size: stats.size, type: 'word' }
    };
  }
  const text = `[Binary file - ${ext ? ext.substring(1).toUpperCase() : 'unknown'} format, size: ${(stats.size / 1024).toFixed(2)} KB]\nTo view this file, please download it separately.`;
  return {
    text,
    entry: { filename, size: stats.size, type: 'binary', extension: ext }
  };
}

const UPLOAD_DIR_ASSESSMENT = path.join(__dirname, '../../uploads/assessment');

/**
 * Read attachment files and return combined text content (for feedback generation).
 * @param {string[]} filenames - List of filenames in uploads/assessment
 * @returns {Promise<{ attachmentContent: string }>}
 */
async function readAttachmentContents(filenames) {
  const unique = [...new Set((filenames || []).filter(Boolean))];
  const parts = [];
  for (const filename of unique) {
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) continue;
    const filePath = path.join(UPLOAD_DIR_ASSESSMENT, filename);
    if (!fs.existsSync(filePath)) continue;
    try {
      const { text } = await extractTextFromFile(filePath, filename);
      parts.push(`=== Attachment: ${filename} ===\n${text}\n=== End of Attachment: ${filename} ===`);
    } catch (err) {
      console.warn(`[readAttachmentContents] ${filename}:`, err.message);
    }
  }
  return { attachmentContent: parts.join('\n\n').trim() };
}

/**
 * POST /api/v1/assessment-submissions/:id/read-attachments
 * Read attachment files for a submission and return their content as text.
 * Frontend expects: { success, data: { attachmentContent, attachmentsRead[], attachmentsFailed[], attachmentsTotal, details } }
 */
router.post('/:id/read-attachments', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission ID format'
      });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    const task = await Task.findById(submission.taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const project = await Project.findById(task.projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const course = await Course.findById(project.courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    const currentUserId = req.user?.id || req.session?.userId;
    const currentUserEmail = req.user?.email || req.session?.userEmail;
    const currentUserUsername = req.user?.name || req.session?.userName || req.session?.username;
    const queryUserName = typeof req.query.userName === 'string' ? req.query.userName.trim() : '';

    let currentUser = null;
    if (currentUserId || currentUserEmail || currentUserUsername) {
      const userQuery = {};
      if (currentUserId && mongoose.Types.ObjectId.isValid(currentUserId)) {
        userQuery._id = currentUserId;
      } else {
        userQuery.$or = [];
        if (currentUserEmail) userQuery.$or.push({ email: currentUserEmail });
        if (currentUserUsername) userQuery.$or.push({ username: currentUserUsername });
        if (currentUserId) userQuery.$or.push({ username: currentUserId });
        if (currentUserEmail) userQuery.$or.push({ username: currentUserEmail });
      }
      if (Object.keys(userQuery).length > 0) {
        currentUser = await User.findOne(userQuery);
      }
    }
    if (!currentUser && queryUserName) {
      currentUser = await User.findOne({ $or: [{ username: queryUserName }, { email: queryUserName }] });
    }

    if (!currentUser) {
      return res.status(403).json({
        success: false,
        message: 'Authentication required to retrieve attachment content',
        error: 'UNAUTHORIZED'
      });
    }

    const isTeacherOrAdmin = currentUser.type === 'teacher' || currentUser.type === 'admin' || currentUser.type === 'school';
    if (!isTeacherOrAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only teachers of this course can retrieve attachment content',
        error: 'FORBIDDEN'
      });
    }

    const courseTeacherIds = [
      project.teacherId,
      course.teacherId,
      ...(course.teacherIds || [])
    ].filter(Boolean).map(s => (s && s.toString ? s.toString() : String(s)).trim().toLowerCase());

    const currentUserIdentifiers = [
      currentUser._id?.toString(),
      currentUser.username,
      currentUser.email
    ].filter(Boolean).map(s => (s && s.toString ? s.toString() : String(s)).trim().toLowerCase());

    const isTeacherOfCourse = courseTeacherIds.some(tid =>
      currentUserIdentifiers.some(uid => uid === tid)
    );

    if (!isTeacherOfCourse) {
      return res.status(403).json({
        success: false,
        message: 'Only teachers of this course can retrieve attachment content',
        error: 'FORBIDDEN'
      });
    }

    const uniqueAttachments = [...new Set(submission.attachments || [])];

    if (uniqueAttachments.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          submissionId: submission._id.toString(),
          attachmentContent: '',
          attachmentsRead: [],
          attachmentsFailed: [],
          attachmentsTotal: 0,
          details: {}
        }
      });
    }

    const parts = [];
    const attachmentsRead = [];
    const attachmentsFailed = [];

    for (const filename of uniqueAttachments) {
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        attachmentsFailed.push({ filename, error: 'Invalid filename format' });
        continue;
      }
      const filePath = path.join(UPLOAD_DIR_ASSESSMENT, filename);
      if (!fs.existsSync(filePath)) {
        attachmentsFailed.push({ filename, error: 'File not found' });
        continue;
      }

      try {
        const { text, entry } = await extractTextFromFile(filePath, filename);
        parts.push(`=== Attachment: ${filename} ===\n${text}\n=== End of Attachment: ${filename} ===`);
        attachmentsRead.push(entry);
      } catch (err) {
        console.warn(`[Read Attachments] ${filename}:`, err.message);
        attachmentsFailed.push({ filename, error: err.message || 'Failed to extract text' });
      }
    }

    const attachmentContent = parts.join('\n\n').trim();

    return res.status(200).json({
      success: true,
      data: {
        submissionId: submission._id.toString(),
        attachmentContent,
        attachmentsRead,
        attachmentsFailed,
        attachmentsTotal: uniqueAttachments.length,
        details: {}
      }
    });
  } catch (error) {
    console.error('❌ Error reading submission attachments:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to read submission attachments',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/assessment-submissions/attachments/batch
 * Get attachments for multiple submissions in a single request
 * Body: { "submissionIds": ["id1", "id2", ...] }
 * Response: { "success": true, "data": [{ "submissionId": "id1", "attachments": [...], ... }, ...] }
 */
router.post('/attachments/batch', isOptionalAuth, async (req, res) => {
  try {
    console.log('[Attachments Batch] Request received:', {
      submissionIds: req.body.submissionIds,
      submissionIdsCount: req.body.submissionIds?.length || 0
    });

    const schema = Joi.object({
      submissionIds: Joi.array().items(Joi.string().trim().min(1)).required().min(1).max(100)
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Validate all submissionIds
    const validSubmissionIds = [];
    const invalidSubmissionIds = [];
    
    for (const submissionId of value.submissionIds) {
      if (mongoose.Types.ObjectId.isValid(submissionId)) {
        validSubmissionIds.push(submissionId);
      } else {
        invalidSubmissionIds.push(submissionId);
      }
    }

    if (validSubmissionIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid submission IDs provided',
        invalidIds: invalidSubmissionIds
      });
    }

    // Fetch all submissions in a single query
    const submissions = await Submission.find({
      _id: { $in: validSubmissionIds.map(id => new mongoose.Types.ObjectId(id)) }
    });

    // Get all unique taskIds and stakeholderIds
    const taskIds = [...new Set(submissions.map(s => s.taskId.toString()))];
    const stakeholderIds = [...new Set(
      submissions
        .map(s => s.stakeholderId)
        .filter(id => id !== null && id !== undefined)
        .map(id => id.toString())
    )];

    // Fetch all tasks and roles in parallel
    const [tasks, roles] = await Promise.all([
      Task.find({ _id: { $in: taskIds.map(id => new mongoose.Types.ObjectId(id)) } }),
      stakeholderIds.length > 0 
        ? Role.find({ _id: { $in: stakeholderIds.map(id => new mongoose.Types.ObjectId(id)) } })
        : []
    ]);

    // Create maps for quick lookup
    const taskMap = {};
    tasks.forEach(task => {
      taskMap[task._id.toString()] = task;
    });

    const roleMap = {};
    roles.forEach(role => {
      roleMap[role._id.toString()] = role;
    });

    // Process each submission
    const results = [];
    const errors = [];

    console.log(`[Attachments Batch] Processing ${value.submissionIds.length} submissions`);
    console.log(`[Attachments Batch] Found ${submissions.length} submissions in DB`);
    console.log(`[Attachments Batch] Found ${tasks.length} tasks, ${roles.length} roles`);

    for (const submissionId of value.submissionIds) {
      try {
        // Validate submission ID format
        if (!mongoose.Types.ObjectId.isValid(submissionId)) {
          console.warn(`[Attachments Batch] Invalid submission ID format: ${submissionId}`);
          errors.push({
            submissionId,
            error: 'Invalid submission ID format'
          });
          continue;
        }

        const submission = submissions.find(s => s._id.toString() === submissionId);
        if (!submission) {
          console.warn(`[Attachments Batch] Submission not found: ${submissionId}`);
          errors.push({
            submissionId,
            error: 'Submission not found'
          });
          continue;
        }

        // Get task
        const task = taskMap[submission.taskId.toString()];
        if (!task) {
          console.warn(`[Attachments Batch] Task not found for submission ${submissionId}: ${submission.taskId}`);
          errors.push({
            submissionId,
            error: 'Task not found'
          });
          continue;
        }

        // Collect attachments
        let attachments = [...(task.attachments || [])];
        const attachmentSources = {
          task: task.attachments || [],
          role: []
        };

        console.log(`[Attachments Batch] Submission ${submissionId}: task attachments = ${task.attachments?.length || 0}`);

        // Get role attachments if stakeholder is assigned
        if (submission.stakeholderId) {
          const role = roleMap[submission.stakeholderId.toString()];
          if (role) {
            const roleAttachments = role.attachments || [];
            attachments = [...attachments, ...roleAttachments];
            attachmentSources.role = roleAttachments;
            console.log(`[Attachments Batch] Submission ${submissionId}: role attachments = ${roleAttachments.length}`);
          } else {
            console.warn(`[Attachments Batch] Submission ${submissionId}: role not found for stakeholderId ${submission.stakeholderId}`);
          }
        } else {
          console.log(`[Attachments Batch] Submission ${submissionId}: no stakeholderId assigned`);
        }

        // Remove duplicates while preserving order
        const uniqueAttachments = [...new Set(attachments)];

        console.log(`[Attachments Batch] Submission ${submissionId}: total unique attachments = ${uniqueAttachments.length}`);
        if (uniqueAttachments.length > 0) {
          console.log(`[Attachments Batch] Submission ${submissionId}: attachments =`, uniqueAttachments);
        }

        results.push({
          submissionId: submission._id.toString(),
          taskId: submission.taskId.toString(),
          stakeholderId: submission.stakeholderId ? submission.stakeholderId.toString() : null,
          attachments: uniqueAttachments,
          sources: {
            task: attachmentSources.task,
            role: attachmentSources.role
          },
          totalCount: uniqueAttachments.length
        });
      } catch (error) {
        console.error(`❌ Error processing submission ${submissionId}:`, error.message);
        console.error(`❌ Error stack:`, error.stack);
        errors.push({
          submissionId,
          error: error.message || 'Failed to process submission'
        });
      }
    }

    console.log(`[Attachments Batch] Final results: ${results.length} successful, ${errors.length} errors`);
    console.log(`[Attachments Batch] Results summary:`, results.map(r => ({
      submissionId: r.submissionId,
      attachmentCount: r.totalCount
    })));

    res.status(200).json({
      success: true,
      data: {
        results: results,
        ...(errors.length > 0 && { errors: errors }),
        meta: {
          requested: value.submissionIds.length,
          valid: validSubmissionIds.length,
          invalid: invalidSubmissionIds.length,
          processed: results.length,
          failed: errors.length
        }
      }
    });
  } catch (error) {
    console.error('❌ Error fetching batch attachments:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch batch attachments',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/assessment-submissions/:submissionId/share
 * Share a submission with other students in the same group(s)
 */
router.post('/:submissionId/share', isOptionalAuth, async (req, res) => {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/121bb795-66ba-4714-b528-2bbf010585d7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'assessment-submissions.js:3319',message:'Share endpoint entry',data:{submissionId:req.params.submissionId,hasSession:!!req.session,hasUser:!!req.user},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
    // #endregion
    const { submissionId } = req.params;

    // Validate submission ID
    if (!mongoose.Types.ObjectId.isValid(submissionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submission ID format',
        error: 'INVALID_SUBMISSION_ID'
      });
    }

    // Validation schema
    const shareSchema = Joi.object({
      targetStudentIds: Joi.array().items(Joi.string().trim()).optional(),
      autoDetectGroupMembers: Joi.boolean().optional().default(false),
      shareFeedback: Joi.boolean().optional().default(true),
      shareScore: Joi.boolean().optional().default(true)
    });

    const { error, value } = shareSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Get the submission
    const submission = await Submission.findById(submissionId);
    if (!submission) {
      return res.status(400).json({
        success: false,
        message: 'Submission not found',
        error: 'SUBMISSION_NOT_FOUND'
      });
    }

    // Get current user from session
    const currentUserId = req.user?.id || req.session?.userId;
    const currentUserEmail = req.user?.email || req.session?.userEmail;
    const currentUserUsername = req.user?.name || req.session?.userName;
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/121bb795-66ba-4714-b528-2bbf010585d7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'assessment-submissions.js:3360',message:'Session data extracted',data:{currentUserId,currentUserEmail,currentUserUsername,submissionStudentId:submission.studentId,sessionKeys:req.session?Object.keys(req.session):[]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
    // #endregion

    // Get current user from database to check all possible identifiers
    let currentUser = null;
    if (currentUserId || currentUserEmail || currentUserUsername) {
      const userQuery = {};
      if (currentUserId && mongoose.Types.ObjectId.isValid(currentUserId)) {
        userQuery._id = currentUserId;
      } else {
        userQuery.$or = [];
        if (currentUserEmail) userQuery.$or.push({ email: currentUserEmail });
        if (currentUserUsername) userQuery.$or.push({ username: currentUserUsername });
        if (currentUserId) userQuery.$or.push({ username: currentUserId });
        if (currentUserEmail) userQuery.$or.push({ username: currentUserEmail });
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/121bb795-66ba-4714-b528-2bbf010585d7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'assessment-submissions.js:3367',message:'User query before DB lookup',data:{userQuery:JSON.stringify(userQuery)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
      // #endregion
      
      if (Object.keys(userQuery).length > 0) {
        currentUser = await User.findOne(userQuery);
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/121bb795-66ba-4714-b528-2bbf010585d7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'assessment-submissions.js:3379',message:'User lookup result',data:{found:!!currentUser,userId:currentUser?._id?.toString(),username:currentUser?.username,email:currentUser?.email,type:currentUser?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
        // #endregion
      }
    } else {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/121bb795-66ba-4714-b528-2bbf010585d7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'assessment-submissions.js:3381',message:'No session data for user lookup',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
      // #endregion
    }

    // Check authorization: user must own the submission or be a teacher/admin
    let isOwner = false;
    if (currentUser) {
      // Compare submission.studentId with all possible user identifiers
      const submissionStudentId = submission.studentId?.toString() || '';
      isOwner = submissionStudentId === currentUser.username ||
                submissionStudentId === currentUser.email ||
                submissionStudentId === currentUser._id?.toString() ||
                (currentUser._id && submissionStudentId === currentUser._id.toString());
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/121bb795-66ba-4714-b528-2bbf010585d7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'assessment-submissions.js:3388',message:'Ownership check',data:{submissionStudentId,userUsername:currentUser.username,userEmail:currentUser.email,userId:currentUser._id?.toString(),isOwner,matches:[]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
      // #endregion
    }
    
    if (!isOwner) {
      // Check if user is teacher/admin
      if (currentUser && (currentUser.type === 'teacher' || currentUser.type === 'admin' || currentUser.type === 'school')) {
        // Allow teachers/admins to share any submission
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/121bb795-66ba-4714-b528-2bbf010585d7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'assessment-submissions.js:3396',message:'Teacher/admin authorized',data:{userType:currentUser.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
        // #endregion
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/121bb795-66ba-4714-b528-2bbf010585d7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'assessment-submissions.js:3399',message:'Authorization failed - returning 403',data:{hasCurrentUser:!!currentUser,userType:currentUser?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
        // #endregion
        return res.status(403).json({
          success: false,
          message: 'You can only share your own submissions',
          error: 'UNAUTHORIZED'
        });
      }
    }

    // Determine target students
    let targetStudentIds = [];

    if (value.autoDetectGroupMembers) {
      // Find all active groups that contain the submission owner
      const ownerId = submission.studentId;
      const groups = await StudentGroup.find({
        studentIds: ownerId,
        isActive: true
      });

      if (groups.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No target students specified or found in groups',
          error: 'NO_TARGET_STUDENTS'
        });
      }

      // Get all unique student IDs from all groups (excluding the owner)
      const allStudentIds = new Set();
      groups.forEach(group => {
        group.studentIds.forEach(id => {
          if (id !== ownerId) {
            allStudentIds.add(id);
          }
        });
      });

      targetStudentIds = Array.from(allStudentIds);
    } else if (value.targetStudentIds && value.targetStudentIds.length > 0) {
      targetStudentIds = value.targetStudentIds;
    } else {
      return res.status(400).json({
        success: false,
        message: 'No target students specified or found in groups',
        error: 'NO_TARGET_STUDENTS'
      });
    }

    if (targetStudentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No target students specified or found in groups',
        error: 'NO_TARGET_STUDENTS'
      });
    }

    // Validate that all target students are in the same active group(s) as the owner
    const ownerId = submission.studentId;
    const ownerGroups = await StudentGroup.find({
      studentIds: ownerId,
      isActive: true
    });

    if (ownerGroups.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Submission owner is not in any active groups',
        error: 'OWNER_NOT_IN_GROUP'
      });
    }

    // Get all valid student IDs from owner's groups
    const validStudentIds = new Set();
    ownerGroups.forEach(group => {
      group.studentIds.forEach(id => {
        validStudentIds.add(id);
      });
    });

    // Check if all target students are in valid groups
    const invalidStudents = targetStudentIds.filter(id => !validStudentIds.has(id));
    if (invalidStudents.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some students are not in the same group as the submission owner',
        error: 'STUDENTS_NOT_IN_GROUP',
        data: {
          invalidStudents: invalidStudents
        }
      });
    }

    // Get user information for target students
    const targetUsers = await User.find({
      $or: [
        { username: { $in: targetStudentIds } },
        { email: { $in: targetStudentIds } },
        { _id: { $in: targetStudentIds.filter(id => mongoose.Types.ObjectId.isValid(id)) } }
      ]
    }).select('username email fullName');

    const userMap = new Map();
    targetUsers.forEach(user => {
      userMap.set(user.username, user);
      userMap.set(user.email, user);
      if (user._id) {
        userMap.set(user._id.toString(), user);
      }
    });

    // Process each target student
    const sharedWith = [];
    const skipped = [];
    const failed = [];

    for (const targetStudentId of targetStudentIds) {
      try {
        // Get user info for this student
        const targetUser = userMap.get(targetStudentId);
        const targetStudentName = targetUser?.fullName || targetUser?.username || targetUser?.email || targetStudentId;

        // Check if target student already has a submission for this taskId
        const existingSubmission = await Submission.findOne({
          taskId: submission.taskId,
          studentId: targetStudentId
        });

        if (existingSubmission) {
          // Check if they already have the latest feedback
          const originalLatestFeedback = submission.feedbackHistory && submission.feedbackHistory.length > 0
            ? submission.feedbackHistory[submission.feedbackHistory.length - 1]
            : null;
          
          const existingLatestFeedback = existingSubmission.feedbackHistory && existingSubmission.feedbackHistory.length > 0
            ? existingSubmission.feedbackHistory[existingSubmission.feedbackHistory.length - 1]
            : null;

          // Compare feedback text and datetime
          if (originalLatestFeedback && existingLatestFeedback &&
              originalLatestFeedback.feedback === existingLatestFeedback.feedback &&
              originalLatestFeedback.createdAt.getTime() === existingLatestFeedback.createdAt.getTime()) {
            // Same feedback, skip
            skipped.push({
              studentId: targetStudentId,
              studentName: targetStudentName,
              reason: 'already_has_submission_with_same_feedback'
            });
            continue;
          }

          // Update existing submission with new content and feedback
          existingSubmission.submission = submission.submission;
          existingSubmission.conversationLog = submission.conversationLog;
          existingSubmission.attachments = submission.attachments || [];
          existingSubmission.submissionQuestionAnswers = submission.submissionQuestionAnswers || [];
          existingSubmission.feedbackReceivedQuestionAnswers = submission.feedbackReceivedQuestionAnswers || [];

          // Update feedback history if shareFeedback is true
          if (value.shareFeedback && submission.feedbackHistory && submission.feedbackHistory.length > 0) {
            existingSubmission.feedbackHistory = JSON.parse(JSON.stringify(submission.feedbackHistory));
          }

          // Update score history if shareScore is true
          if (value.shareScore && submission.starScoreHistory && submission.starScoreHistory.length > 0) {
            existingSubmission.starScoreHistory = JSON.parse(JSON.stringify(submission.starScoreHistory));
          }

          await existingSubmission.save();

          sharedWith.push({
            studentId: targetStudentId,
            studentName: targetStudentName,
            submissionId: existingSubmission._id.toString(),
            status: 'updated'
          });
        } else {
          // Create new submission
          const newSubmission = new Submission({
            taskId: submission.taskId,
            studentId: targetStudentId,
            studentName: targetStudentName,
            submission: submission.submission,
            attachments: submission.attachments || [],
            conversationLog: submission.conversationLog || '',
            attemptNumber: 1,
            submissionQuestionAnswers: submission.submissionQuestionAnswers || [],
            feedbackReceivedQuestionAnswers: submission.feedbackReceivedQuestionAnswers || [],
            datetime: submission.datetime || new Date(),
            stakeholderId: submission.stakeholderId || null,
            // Copy feedback history if shareFeedback is true
            feedbackHistory: value.shareFeedback && submission.feedbackHistory && submission.feedbackHistory.length > 0
              ? JSON.parse(JSON.stringify(submission.feedbackHistory))
              : [],
            // Copy score history if shareScore is true
            starScoreHistory: value.shareScore && submission.starScoreHistory && submission.starScoreHistory.length > 0
              ? JSON.parse(JSON.stringify(submission.starScoreHistory))
              : []
          });

          await newSubmission.save();

          sharedWith.push({
            studentId: targetStudentId,
            studentName: targetStudentName,
            submissionId: newSubmission._id.toString(),
            status: 'created'
          });
        }
      } catch (err) {
        console.error(`❌ Error sharing submission with ${targetStudentId}:`, err.message);
        failed.push({
          studentId: targetStudentId,
          studentName: userMap.get(targetStudentId)?.fullName || targetStudentId,
          error: process.env.NODE_ENV !== 'production' ? err.message : 'Failed to share submission'
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Submission shared successfully',
      data: {
        sharedWith: sharedWith,
        skipped: skipped,
        failed: failed,
        totalShared: sharedWith.length,
        totalSkipped: skipped.length,
        totalFailed: failed.length
      }
    });
  } catch (error) {
    console.error('❌ Error sharing submission:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to share submission',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-submissions/group/:groupId/task-status
 * Get task completion status for all members of a group
 */
router.get('/group/:groupId/task-status', isOptionalAuth, async (req, res) => {
  try {
    const { groupId } = req.params;

    // Validate groupId
    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid group ID format',
        error: 'INVALID_GROUP_ID'
      });
    }

    // Validation schema
    const schema = Joi.object({
      projectId: Joi.string().required().trim(),
      userName: Joi.string().required().trim()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message.includes('projectId') 
          ? 'projectId is required' 
          : 'userName is required',
        error: 'MISSING_PARAMETER'
      });
    }

    // Validate projectId format
    if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid projectId format',
        error: 'INVALID_PROJECT_ID'
      });
    }

    // Get the group
    const group = await StudentGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found',
        error: 'GROUP_NOT_FOUND'
      });
    }

    // Verify user is a member of the group or is a teacher/admin
    const isMember = group.studentIds.includes(value.userName);
    
    if (!isMember) {
      // Check if user is teacher/admin
      const user = await User.findOne({
        $or: [
          { username: value.userName },
          { email: value.userName }
        ]
      });

      if (!user || (user.type !== 'teacher' && user.type !== 'admin' && user.type !== 'school')) {
        return res.status(403).json({
          success: false,
          message: 'You are not a member of this group',
          error: 'UNAUTHORIZED'
        });
      }
    }

    // Get all tasks for this project
    const tasks = await Task.find({ projectId: value.projectId });
    const taskIds = tasks.map(t => t._id);

    if (taskIds.length === 0) {
      // No tasks in project, return empty status for all group members
      const emptyStatus = {};
      group.studentIds.forEach(studentId => {
        emptyStatus[studentId] = {
          completedTasks: [],
          taskCount: 0
        };
      });

      return res.status(200).json({
        success: true,
        data: emptyStatus
      });
    }

    // Get all submissions for group members and project tasks
    // Use aggregation for efficiency - only get taskId and studentId
    const submissions = await Submission.find({
      taskId: { $in: taskIds },
      studentId: { $in: group.studentIds }
    }).select('taskId studentId').lean();

    // Group submissions by studentId and extract unique task IDs
    const statusMap = {};
    
    // Initialize all group members with empty status
    group.studentIds.forEach(studentId => {
      statusMap[studentId] = {
        completedTasks: [],
        taskCount: 0
      };
    });

    // Process submissions to build status
    submissions.forEach(submission => {
      const studentId = submission.studentId;
      const taskId = submission.taskId?.toString();

      if (studentId && taskId && statusMap[studentId]) {
        // Only add if not already in the array (unique task IDs)
        if (!statusMap[studentId].completedTasks.includes(taskId)) {
          statusMap[studentId].completedTasks.push(taskId);
          statusMap[studentId].taskCount = statusMap[studentId].completedTasks.length;
        }
      }
    });

    return res.status(200).json({
      success: true,
      data: statusMap
    });
  } catch (error) {
    console.error('❌ Error fetching group task status:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch group task status',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

