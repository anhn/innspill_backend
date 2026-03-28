const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const LOMapping = require('../models/LOMapping');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Role = require('../models/Role');
const Quiz = require('../models/Quiz');
const OpenAI = require('openai');
const { isOptionalAuth } = require('../middleware/auth');
const actionLoggingMiddleware = require('../middleware/actionLogging');
const Joi = require('joi');

// Initialize OpenAI client
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
}) : null;

// Validation schemas
const saveMappingSchema = Joi.object({
  projectId: Joi.string().required().trim().min(1),
  mappings: Joi.array().items(
    Joi.object({
      learningObjective: Joi.string().required().trim().min(1),
      taskIds: Joi.array().items(Joi.string().trim()).optional().default([]),
      roleIds: Joi.array().items(Joi.string().trim()).optional().default([]),
      quizQuestionIds: Joi.array().items(Joi.string().trim()).optional().default([])
    })
  ).required().min(1)
});

const autoMapSchema = Joi.object({
  projectId: Joi.string().required().trim().min(1),
  useOpenAI: Joi.boolean().optional().default(false),
  minKeywordLength: Joi.number().integer().min(3).optional().default(3)
});

/**
 * POST /api/v1/lo-mappings
 * Save LO mappings for a project
 */
router.post('/', isOptionalAuth, async (req, res) => {
  try {
    const { error, value } = saveMappingSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Validate projectId
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

    // Validate all taskIds, roleIds
    const allTaskIds = value.mappings.flatMap(m => m.taskIds || []);
    const allRoleIds = value.mappings.flatMap(m => m.roleIds || []);

    // Validate taskIds
    for (const taskId of allTaskIds) {
      if (!mongoose.Types.ObjectId.isValid(taskId)) {
        return res.status(400).json({
          success: false,
          message: `Invalid taskId format: ${taskId}`
        });
      }
      const task = await Task.findById(taskId);
      if (!task || task.projectId.toString() !== value.projectId) {
        return res.status(400).json({
          success: false,
          message: `Task ${taskId} not found or does not belong to this project`
        });
      }
    }

    // Validate roleIds
    for (const roleId of allRoleIds) {
      if (!mongoose.Types.ObjectId.isValid(roleId)) {
        return res.status(400).json({
          success: false,
          message: `Invalid roleId format: ${roleId}`
        });
      }
      const role = await Role.findById(roleId);
      if (!role || role.projectId.toString() !== value.projectId) {
        return res.status(400).json({
          success: false,
          message: `Role ${roleId} not found or does not belong to this project`
        });
      }
    }

    // Prepare mappings with ObjectIds
    const mappings = value.mappings.map(m => ({
      learningObjective: m.learningObjective,
      taskIds: (m.taskIds || []).map(id => new mongoose.Types.ObjectId(id)),
      roleIds: (m.roleIds || []).map(id => new mongoose.Types.ObjectId(id)),
      quizQuestionIds: m.quizQuestionIds || []
    }));

    // Upsert mapping (update if exists, create if not)
    const loMapping = await LOMapping.findOneAndUpdate(
      { projectId: value.projectId },
      {
        projectId: value.projectId,
        mappings: mappings
      },
      {
        new: true,
        upsert: true,
        runValidators: true
      }
    );

    res.status(200).json({
      success: true,
      message: 'LO mappings saved successfully',
      data: {
        id: loMapping._id.toString(),
        projectId: loMapping.projectId.toString(),
        mappings: loMapping.mappings.map(m => ({
          learningObjective: m.learningObjective,
          taskIds: m.taskIds.map(id => id.toString()),
          roleIds: m.roleIds.map(id => id.toString()),
          quizQuestionIds: m.quizQuestionIds
        })),
        createdAt: loMapping.createdAt,
        updatedAt: loMapping.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error saving LO mappings:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to save LO mappings',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/lo-mappings/auto-map
 * Auto-map learning objectives to tasks, roles, and quiz questions
 * Uses keyword matching or OpenAI if useOpenAI=true
 */
router.post('/auto-map', isOptionalAuth, actionLoggingMiddleware('lo-auto-map'), async (req, res) => {
  try {
    const { error, value } = autoMapSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Validate projectId
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

    // Parse learning objectives from project.learningOutcome
    const learningObjectives = parseLearningObjectives(project.learningOutcome || '');

    if (learningObjectives.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No learning objectives found in project'
      });
    }

    // Fetch all tasks, roles, and quiz for this project
    const tasks = await Task.find({ projectId: value.projectId });
    const roles = await Role.find({ projectId: value.projectId });
    const quiz = await Quiz.findOne({ projectId: value.projectId }).sort({ updatedAt: -1, createdAt: -1 });

    // Get quiz questions (from latest quiz)
    const quizQuestions = quiz ? (quiz.questions || []) : [];

    let mappings = [];

    if (value.useOpenAI && openai) {
      // Use OpenAI for intelligent mapping
      mappings = await autoMapWithOpenAI(
        learningObjectives,
        tasks,
        roles,
        quizQuestions,
        openai
      );
    } else {
      // Use keyword matching
      mappings = autoMapWithKeywords(
        learningObjectives,
        tasks,
        roles,
        quizQuestions,
        value.minKeywordLength
      );
    }

    res.status(200).json({
      success: true,
      data: {
        projectId: value.projectId,
        mappings: mappings,
        method: value.useOpenAI ? 'openai' : 'keyword-matching',
        stats: {
          totalLOs: learningObjectives.length,
          totalTasks: tasks.length,
          totalRoles: roles.length,
          totalQuizQuestions: quizQuestions.length
        }
      }
    });
  } catch (error) {
    console.error('❌ Error auto-mapping LOs:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to auto-map learning objectives',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * Parse learning objectives from text
 * Handles multiple formats: single line, newlines, semicolons, numbered lists
 */
function parseLearningObjectives(text) {
  if (!text || !text.trim()) return [];

  // Remove common headers
  let cleaned = text
    .replace(/^(learning\s+objectives?|los?|outcomes?)[:.\s]*/i, '')
    .trim();

  // Split by newlines, semicolons, or numbered lists
  let objectives = cleaned
    .split(/[\n;]/)
    .map(line => {
      // Remove numbering (1., 2., etc.) and bullets
      return line
        .replace(/^\d+[.)]\s*/, '')
        .replace(/^[-•*]\s*/, '')
        .trim();
    })
    .filter(line => line.length > 0);

  return objectives;
}

/**
 * Extract keywords from text (words longer than minLength)
 */
function extractKeywords(text, minLength = 3) {
  if (!text) return [];
  
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= minLength)
    .filter((word, index, arr) => arr.indexOf(word) === index); // unique
}

/**
 * Calculate keyword match score between two texts
 */
function calculateMatchScore(text1, text2, minKeywordLength = 3) {
  const keywords1 = extractKeywords(text1, minKeywordLength);
  const keywords2 = extractKeywords(text2, minKeywordLength);
  
  if (keywords1.length === 0 || keywords2.length === 0) return 0;
  
  const matches = keywords1.filter(k => keywords2.includes(k)).length;
  return matches / Math.max(keywords1.length, keywords2.length);
}

/**
 * Auto-map using keyword matching
 */
function autoMapWithKeywords(learningObjectives, tasks, roles, quizQuestions, minKeywordLength = 3) {
  return learningObjectives.map(lo => {
    const loKeywords = extractKeywords(lo, minKeywordLength);
    
    // Match tasks
    const matchedTaskIds = tasks
      .filter(task => {
        const taskText = `${task.taskTitle || ''} ${task.keyword || ''} ${task.description || ''}`.toLowerCase();
        return calculateMatchScore(lo, taskText, minKeywordLength) > 0.1; // 10% keyword overlap
      })
      .map(task => task._id.toString());

    // Match roles
    const matchedRoleIds = roles
      .filter(role => {
        const roleText = `${role.name || ''} ${role.persona || ''}`.toLowerCase();
        return calculateMatchScore(lo, roleText, minKeywordLength) > 0.1;
      })
      .map(role => role._id.toString());

    // Match quiz questions
    const matchedQuizQuestionIds = quizQuestions
      .filter(q => {
        const questionText = (q.question || '').toLowerCase();
        return calculateMatchScore(lo, questionText, minKeywordLength) > 0.1;
      })
      .map(q => q.id || q._id?.toString() || '');

    return {
      learningObjective: lo,
      taskIds: matchedTaskIds,
      roleIds: matchedRoleIds,
      quizQuestionIds: matchedQuizQuestionIds.filter(id => id) // Remove empty IDs
    };
  });
}

/**
 * Auto-map using OpenAI
 */
async function autoMapWithOpenAI(learningObjectives, tasks, roles, quizQuestions, openaiClient) {
  try {
    const tasksData = tasks.map(t => ({
      id: t._id.toString(),
      title: t.taskTitle,
      keyword: t.keyword,
      description: t.description
    }));

    const rolesData = roles.map(r => ({
      id: r._id.toString(),
      name: r.name,
      persona: r.persona
    }));

    const questionsData = quizQuestions.map(q => ({
      id: q.id || q._id?.toString() || '',
      question: q.question
    }));

    const prompt = `You are an expert in educational curriculum alignment. Map learning objectives to relevant tasks, roles, and quiz questions.

Learning Objectives:
${learningObjectives.map((lo, i) => `${i + 1}. ${lo}`).join('\n')}

Available Tasks:
${tasksData.map(t => `- ID: ${t.id}, Title: ${t.title}, Keyword: ${t.keyword}, Description: ${t.description?.substring(0, 100)}`).join('\n')}

Available Roles:
${rolesData.map(r => `- ID: ${r.id}, Name: ${r.name}, Persona: ${r.persona?.substring(0, 100)}`).join('\n')}

Available Quiz Questions:
${questionsData.map(q => `- ID: ${q.id}, Question: ${q.question}`).join('\n')}

Return a JSON array where each object has:
{
  "learningObjective": "exact text from learning objectives above",
  "taskIds": ["task_id1", "task_id2"],
  "roleIds": ["role_id1"],
  "quizQuestionIds": ["question_id1", "question_id2"]
}

Only include mappings where there is a clear educational relationship. Return ONLY valid JSON, no markdown.`;

    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert educational curriculum alignment assistant. Return only valid JSON arrays.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 2000
    });

    const content = response.choices[0].message.content.trim();
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    // Validate and return
    return parsed.map(m => ({
      learningObjective: m.learningObjective || '',
      taskIds: Array.isArray(m.taskIds) ? m.taskIds : [],
      roleIds: Array.isArray(m.roleIds) ? m.roleIds : [],
      quizQuestionIds: Array.isArray(m.quizQuestionIds) ? m.quizQuestionIds : []
    }));
  } catch (error) {
    console.error('❌ Error in OpenAI auto-mapping:', error.message);
    // Fallback to keyword matching
    return autoMapWithKeywords(learningObjectives, tasks, roles, quizQuestions, 3);
  }
}

/**
 * GET /api/v1/lo-mappings/project/:projectId
 * Get LO mappings for a project
 */
router.get('/project/:projectId', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.projectId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid projectId format'
      });
    }

    const loMapping = await LOMapping.findOne({ projectId: req.params.projectId });

    if (!loMapping) {
      return res.status(200).json({
        success: true,
        data: {
          projectId: req.params.projectId,
          mappings: []
        }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: loMapping._id.toString(),
        projectId: loMapping.projectId.toString(),
        mappings: loMapping.mappings.map(m => ({
          learningObjective: m.learningObjective,
          taskIds: m.taskIds.map(id => id.toString()),
          roleIds: m.roleIds.map(id => id.toString()),
          quizQuestionIds: m.quizQuestionIds
        })),
        createdAt: loMapping.createdAt,
        updatedAt: loMapping.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error fetching LO mappings:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch LO mappings',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

