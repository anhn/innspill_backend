const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Quiz = require('../models/Quiz');
const Project = require('../models/Project');
const Task = require('../models/Task');
const QuizSubmission = require('../models/QuizSubmission');
const User = require('../models/User');
const QuizGenerationAgent = require('../agents/QuizGenerationAgent');
const OpenAI = require('openai');
const { isOptionalAuth } = require('../middleware/auth');
const actionLoggingMiddleware = require('../middleware/actionLogging');
const Joi = require('joi');
const crypto = require('crypto');

// Improved unique ID generator with timestamp, random, and counter
let idCounter = 0;
const generateId = () => {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  const counter = (++idCounter).toString(36);
  return `q_${timestamp}_${random}_${counter}`;
};

// Function to ensure all question IDs are unique within a quiz
const ensureUniqueQuestionIds = (questions) => {
  const seenIds = new Set();
  
  return questions.map((q) => {
    let questionId = q.id;
    
    // If no ID provided, generate one
    if (!questionId) {
      questionId = generateId();
    }
    
    // If ID is duplicate, generate a new one
    if (seenIds.has(questionId)) {
      const newId = generateId();
      console.log(`⚠️ Duplicate question ID detected (${questionId}), generated new ID: ${newId}`);
      questionId = newId;
    }
    
    seenIds.add(questionId);
    
    return {
      ...q,
      id: questionId
    };
  });
};

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Validation schemas
const generateQuizSchema = Joi.object({
  projectId: Joi.string().required().trim().min(1),
  name: Joi.string().optional().trim().min(1),
  taskIds: Joi.array().items(Joi.string()).optional().default([]),
  keywords: Joi.array().items(Joi.string()).optional().default([]),
  learningObjectives: Joi.string().optional().allow('', null).trim(),
  numberOfQuestions: Joi.number().integer().min(1).max(50).optional().default(10)
});

const createQuizSchema = Joi.object({
  projectId: Joi.string().required().trim().min(1),
  name: Joi.string().optional().trim().min(1),
  questions: Joi.array().items(
    Joi.object({
      id: Joi.string().optional().trim(),
      question: Joi.string().required().trim().min(1),
      options: Joi.array().items(Joi.string()).min(2).required(),
      correctAnswer: Joi.number().integer().min(0).required()
    })
  ).min(1).required()
});

const updateQuizSchema = Joi.object({
  name: Joi.string().optional().trim().min(1),
  questions: Joi.array().items(
    Joi.object({
      id: Joi.string().optional().trim(),
      question: Joi.string().required().trim().min(1),
      options: Joi.array().items(Joi.string()).min(2).required(),
      correctAnswer: Joi.number().integer().min(0).required()
    })
  ).min(1).required(),
  updatedBy: Joi.string().required().trim().min(1)
});

/**
 * POST /api/v1/assessment-quizzes/generate
 * Generate quiz using AI
 */
router.post('/generate', isOptionalAuth, actionLoggingMiddleware('generate-quiz'), async (req, res) => {
  try {
    const { error, value } = generateQuizSchema.validate(req.body);
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

    // Fetch tasks if taskIds provided
    let taskKeywords = [];
    if (value.taskIds && value.taskIds.length > 0) {
      const tasks = await Task.find({ 
        _id: { $in: value.taskIds.map(id => new mongoose.Types.ObjectId(id)) },
        projectId: value.projectId
      });
      taskKeywords = tasks.map(t => t.keyword).filter(Boolean);
    }

    // Combine keywords
    const allKeywords = [...(value.keywords || []), ...taskKeywords];

    // Get learning objectives from project if not provided
    const learningObjectives = value.learningObjectives || project.learningOutcome || '';

    // Generate quiz using AI
    const agent = new QuizGenerationAgent(openai);
    const request = {
      taskIds: value.taskIds || [],
      keywords: allKeywords,
      learningObjectives: learningObjectives,
      numberOfQuestions: value.numberOfQuestions || 10
    };

    const startTime = Date.now();
    const response = await agent.process(request);
    const processingTime = Date.now() - startTime;

    if (!response.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate quiz',
        error: response.error
      });
    }

    // Parse AI response
    let questions = [];
    try {
      const responseText = response.response.trim();
      // Remove markdown code blocks if present
      const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleanedText);
      
      if (parsed.questions && Array.isArray(parsed.questions)) {
        // Map questions and ensure unique IDs
        const mappedQuestions = parsed.questions.map(q => ({
          id: q.id || generateId(),
          question: q.question,
          options: q.options,
          correctAnswer: q.correctAnswer
        }));
        
        // Ensure all IDs are unique
        questions = ensureUniqueQuestionIds(mappedQuestions);
      }
    } catch (parseError) {
      console.error('❌ Error parsing quiz response:', parseError.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to parse quiz generation response',
        error: process.env.NODE_ENV !== 'production' ? parseError.message : undefined
      });
    }

    if (questions.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'No questions generated'
      });
    }

    // Create quiz
    const quiz = new Quiz({
      name: value.name || null,
      projectId: value.projectId,
      questions: questions,
      history: []
    });
    await quiz.save();

    res.status(200).json({
      success: true,
      data: {
        id: quiz._id.toString(),
        name: quiz.name,
        projectId: quiz.projectId.toString(),
        questions: quiz.questions,
        history: quiz.history,
        createdAt: quiz.createdAt,
        updatedAt: quiz.updatedAt
      },
      usage: response.usage,
      usageInternal: response.usageInternal,
      processingTime
    });
  } catch (error) {
    console.error('❌ Error generating quiz:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to generate quiz',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * POST /api/v1/assessment-quizzes
 * Create a new quiz
 */
router.post('/', isOptionalAuth, async (req, res) => {
  try {
    const { error, value } = createQuizSchema.validate(req.body);
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

    // Ensure all questions have IDs and are unique
    const mappedQuestions = value.questions.map(q => ({
      id: q.id || generateId(),
      question: q.question,
      options: q.options,
      correctAnswer: q.correctAnswer
    }));
    
    // Ensure all IDs are unique
    const questions = ensureUniqueQuestionIds(mappedQuestions);

    const quiz = new Quiz({
      name: value.name || null,
      projectId: value.projectId,
      questions: questions,
      history: []
    });
    await quiz.save();

    res.status(201).json({
      success: true,
      data: {
        id: quiz._id.toString(),
        name: quiz.name,
        projectId: quiz.projectId.toString(),
        questions: quiz.questions,
        history: quiz.history,
        createdAt: quiz.createdAt,
        updatedAt: quiz.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error creating quiz:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to create quiz',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-quizzes/:id
 * Get quiz by ID (with latest student submission details)
 */
router.get('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quiz ID format'
      });
    }

    const schema = Joi.object({
      includeSubmissions: Joi.boolean().optional().default(true)
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    const responseData = {
      id: quiz._id.toString(),
      name: quiz.name,
      projectId: quiz.projectId.toString(),
      questions: quiz.questions,
      history: quiz.history,
      createdAt: quiz.createdAt,
      updatedAt: quiz.updatedAt
    };

    // Include student submission data if requested
    if (value.includeSubmissions) {
      // Get all submissions for this quiz, sorted by updatedAt descending
      const allSubmissions = await QuizSubmission.find({
        quizId: req.params.id
      }).sort({ updatedAt: -1 });

      // Group by student to get the latest submission for each student
      const studentMap = new Map();
      allSubmissions.forEach(submission => {
        if (!studentMap.has(submission.studentId)) {
          studentMap.set(submission.studentId, submission);
        } else {
          // Keep the most recent one
          const existing = studentMap.get(submission.studentId);
          if (submission.updatedAt > existing.updatedAt) {
            studentMap.set(submission.studentId, submission);
          }
        }
      });

      // Get unique student IDs to fetch student names
      const studentIds = [...studentMap.keys()];
      const studentNamesMap = new Map();
      
      // Fetch student names from User model
      for (const studentId of studentIds) {
        try {
          const user = await User.findOne({
            $or: [
              { username: studentId },
              { email: studentId }
            ]
          });
          studentNamesMap.set(studentId, user ? (user.fullName || user.username || studentId) : studentId);
        } catch (error) {
          studentNamesMap.set(studentId, studentId);
        }
      }

      // Format student submissions
      const studentSubmissions = [];
      studentMap.forEach((submission, studentId) => {
        studentSubmissions.push({
          studentId: studentId,
          studentName: studentNamesMap.get(studentId) || studentId,
          score: submission.score,
          isSubmitted: submission.isSubmitted,
          submittedAt: submission.submittedAt,
          startedAt: submission.startedAt,
          lastUpdated: submission.updatedAt,
          submissionId: submission._id.toString(),
          answers: submission.answers || {},
          comments: submission.comments || {}
        });
      });

      // Sort by score descending, then by submittedAt
      studentSubmissions.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        if (a.submittedAt && b.submittedAt) {
          return new Date(a.submittedAt) - new Date(b.submittedAt);
        }
        return 0;
      });

      responseData.studentSubmissions = studentSubmissions;
      responseData.totalSubmissions = studentSubmissions.length;
      responseData.submittedCount = studentSubmissions.filter(s => s.isSubmitted).length;
    }

    res.status(200).json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('❌ Error fetching quiz:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch quiz',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-quizzes/project/:projectId
 * Get quizzes by project with latest submission scores and details for students
 */
router.get('/project/:projectId', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.projectId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid project ID format'
      });
    }

    const quizzes = await Quiz.find({ projectId: req.params.projectId }).sort({ createdAt: -1 });

    // Get all quiz IDs
    const quizIds = quizzes.map(quiz => quiz._id);

    // Get all submissions for these quizzes, sorted by updatedAt descending to get latest
    const allSubmissions = await QuizSubmission.find({
      quizId: { $in: quizIds }
    }).sort({ updatedAt: -1 });

    // Group submissions by quizId and studentId to get the latest submission for each student per quiz
    const latestSubmissionsMap = new Map();
    allSubmissions.forEach(submission => {
      const key = `${submission.quizId.toString()}_${submission.studentId}`;
      if (!latestSubmissionsMap.has(key)) {
        latestSubmissionsMap.set(key, submission);
      }
    });

    // Get unique student IDs to fetch student names
    const studentIds = [...new Set(allSubmissions.map(s => s.studentId))];
    const studentNamesMap = new Map();
    
    // Fetch student names from User model
    for (const studentId of studentIds) {
      try {
        const user = await User.findOne({
          $or: [
            { username: studentId },
            { email: studentId }
          ]
        });
        studentNamesMap.set(studentId, user ? (user.fullName || user.username || studentId) : studentId);
      } catch (error) {
        studentNamesMap.set(studentId, studentId);
      }
    }

    // Format quizzes with student submission data
    const formattedQuizzes = await Promise.all(quizzes.map(async (quiz) => {
      // Get all latest submissions for this quiz
      const quizSubmissions = Array.from(latestSubmissionsMap.values())
        .filter(sub => sub.quizId.toString() === quiz._id.toString());

      // Group by student and get latest submission details
      const studentSubmissions = [];
      const studentMap = new Map();

      quizSubmissions.forEach(submission => {
        if (!studentMap.has(submission.studentId)) {
          studentMap.set(submission.studentId, submission);
        } else {
          // Keep the most recent one
          const existing = studentMap.get(submission.studentId);
          if (submission.updatedAt > existing.updatedAt) {
            studentMap.set(submission.studentId, submission);
          }
        }
      });

      // Format student submissions
      studentMap.forEach((submission, studentId) => {
        studentSubmissions.push({
          studentId: studentId,
          studentName: studentNamesMap.get(studentId) || studentId,
          score: submission.score,
          isSubmitted: submission.isSubmitted,
          submittedAt: submission.submittedAt,
          startedAt: submission.startedAt,
          lastUpdated: submission.updatedAt,
          submissionId: submission._id.toString(),
          answers: submission.answers || {},
          comments: submission.comments || {}
        });
      });

      // Sort by score descending, then by submittedAt
      studentSubmissions.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        if (a.submittedAt && b.submittedAt) {
          return new Date(a.submittedAt) - new Date(b.submittedAt);
        }
        return 0;
      });

      return {
        id: quiz._id.toString(),
        name: quiz.name,
        projectId: quiz.projectId.toString(),
        questions: quiz.questions,
        history: quiz.history,
        createdAt: quiz.createdAt,
        updatedAt: quiz.updatedAt,
        studentSubmissions: studentSubmissions,
        totalSubmissions: studentSubmissions.length,
        submittedCount: studentSubmissions.filter(s => s.isSubmitted).length
      };
    }));

    res.status(200).json({
      success: true,
      data: formattedQuizzes
    });
  } catch (error) {
    console.error('❌ Error fetching quizzes by project:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch quizzes',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-quizzes
 * List all quizzes (optionally with student submission data for dashboard)
 */
router.get('/', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      userName: Joi.string().optional().trim(),
      projectId: Joi.string().optional().trim(),
      includeSubmissions: Joi.boolean().optional().default(false)
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

    const quizzes = await Quiz.find(query).sort({ createdAt: -1 });

    let formattedQuizzes;
    
    if (value.includeSubmissions) {
      // Get all quiz IDs
      const quizIds = quizzes.map(quiz => quiz._id);

      // Get all submissions for these quizzes, sorted by updatedAt descending
      const allSubmissions = await QuizSubmission.find({
        quizId: { $in: quizIds }
      }).sort({ updatedAt: -1 });

      // Group submissions by quizId and studentId to get the latest submission
      const latestSubmissionsMap = new Map();
      allSubmissions.forEach(submission => {
        const key = `${submission.quizId.toString()}_${submission.studentId}`;
        if (!latestSubmissionsMap.has(key)) {
          latestSubmissionsMap.set(key, submission);
        }
      });

      // Get unique student IDs to fetch student names
      const studentIds = [...new Set(allSubmissions.map(s => s.studentId))];
      const studentNamesMap = new Map();
      
      // Fetch student names from User model
      for (const studentId of studentIds) {
        try {
          const user = await User.findOne({
            $or: [
              { username: studentId },
              { email: studentId }
            ]
          });
          studentNamesMap.set(studentId, user ? (user.fullName || user.username || studentId) : studentId);
        } catch (error) {
          studentNamesMap.set(studentId, studentId);
        }
      }

      // Format quizzes with student submission data
      formattedQuizzes = await Promise.all(quizzes.map(async (quiz) => {
        // Get all latest submissions for this quiz
        const quizSubmissions = Array.from(latestSubmissionsMap.values())
          .filter(sub => sub.quizId.toString() === quiz._id.toString());

        // Group by student and get latest submission details
        const studentSubmissions = [];
        const studentMap = new Map();

        quizSubmissions.forEach(submission => {
          if (!studentMap.has(submission.studentId)) {
            studentMap.set(submission.studentId, submission);
          } else {
            // Keep the most recent one
            const existing = studentMap.get(submission.studentId);
            if (submission.updatedAt > existing.updatedAt) {
              studentMap.set(submission.studentId, submission);
            }
          }
        });

        // Format student submissions
        studentMap.forEach((submission, studentId) => {
          studentSubmissions.push({
            studentId: studentId,
            studentName: studentNamesMap.get(studentId) || studentId,
            score: submission.score,
            isSubmitted: submission.isSubmitted,
            submittedAt: submission.submittedAt,
            startedAt: submission.startedAt,
            lastUpdated: submission.updatedAt,
            submissionId: submission._id.toString(),
            answers: submission.answers || {},
            comments: submission.comments || {}
          });
        });

        // Sort by score descending, then by submittedAt
        studentSubmissions.sort((a, b) => {
          if (b.score !== a.score) {
            return b.score - a.score;
          }
          if (a.submittedAt && b.submittedAt) {
            return new Date(a.submittedAt) - new Date(b.submittedAt);
          }
          return 0;
        });

        return {
          id: quiz._id.toString(),
        name: quiz.name,
          projectId: quiz.projectId.toString(),
          questions: quiz.questions,
          history: quiz.history,
          createdAt: quiz.createdAt,
          updatedAt: quiz.updatedAt,
          studentSubmissions: studentSubmissions,
          totalSubmissions: studentSubmissions.length,
          submittedCount: studentSubmissions.filter(s => s.isSubmitted).length
        };
      }));
    } else {
      // Return quizzes without submission data
      formattedQuizzes = quizzes.map(quiz => ({
        id: quiz._id.toString(),
        name: quiz.name,
        projectId: quiz.projectId.toString(),
        questions: quiz.questions,
        history: quiz.history,
        createdAt: quiz.createdAt,
        updatedAt: quiz.updatedAt
      }));
    }

    res.status(200).json({
      success: true,
      data: formattedQuizzes
    });
  } catch (error) {
    console.error('❌ Error fetching quizzes:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch quizzes',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * PUT /api/v1/assessment-quizzes/:id
 * Update quiz (saves previous version to history)
 */
router.put('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quiz ID format'
      });
    }

    const { error, value } = updateQuizSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

  // Save current version to history
  const historyItem = {
    id: generateId(),
    questions: JSON.parse(JSON.stringify(quiz.questions)), // Deep copy
    createdAt: new Date(),
    updatedBy: value.updatedBy
  };
  
  quiz.history.push(historyItem);

  // Optionally update name
  if (value.name !== undefined) {
    quiz.name = value.name;
  }

  // Update questions and ensure unique IDs
  const mappedQuestions = value.questions.map(q => ({
    id: q.id || generateId(),
    question: q.question,
    options: q.options,
    correctAnswer: q.correctAnswer
  }));
  
  // Ensure all IDs are unique
  const questions = ensureUniqueQuestionIds(mappedQuestions);
  
  quiz.questions = questions;
    await quiz.save();

    res.status(200).json({
      success: true,
      data: {
        id: quiz._id.toString(),
        name: quiz.name,
        projectId: quiz.projectId.toString(),
        questions: quiz.questions,
        history: quiz.history,
        createdAt: quiz.createdAt,
        updatedAt: quiz.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error updating quiz:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update quiz',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/v1/assessment-quizzes/:id
 * Delete quiz
 */
router.delete('/:id', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quiz ID format'
      });
    }

    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    await Quiz.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Quiz deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting quiz:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete quiz',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

const QuizAttempt = require('../models/QuizAttempt');

/**
 * GET /api/v1/assessment-quizzes/:quizId/leaderboard
 * Get quiz leaderboard
 */
router.get('/:quizId/leaderboard', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.quizId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quiz ID format'
      });
    }

    const quiz = await Quiz.findById(req.params.quizId);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    // Get all attempts for this quiz, sorted by score descending
    const attempts = await QuizAttempt.find({ quizId: req.params.quizId })
      .sort({ score: -1, completedAt: 1 });

    const leaderboard = attempts.map(attempt => ({
      studentId: attempt.studentId,
      studentName: attempt.studentName,
      score: attempt.score,
      totalQuestions: quiz.questions.length,
      correctAnswers: attempt.answers.filter(a => a.isCorrect).length,
      completedAt: attempt.completedAt
    }));

    res.status(200).json({
      success: true,
      data: leaderboard
    });
  } catch (error) {
    console.error('❌ Error fetching leaderboard:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leaderboard',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/assessment-quizzes/:quizId/student/:studentId
 * Get student quiz answers
 */
router.get('/:quizId/student/:studentId', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.quizId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quiz ID format'
      });
    }

    const quiz = await Quiz.findById(req.params.quizId);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    // Get the most recent attempt for this student
    const attempt = await QuizAttempt.findOne({
      quizId: req.params.quizId,
      studentId: req.params.studentId
    }).sort({ completedAt: -1 });

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: 'No quiz attempt found for this student'
      });
    }

    // Build answer details by matching with quiz questions
    const answers = attempt.answers.map(answer => {
      // Find the corresponding question in the quiz
      const question = quiz.questions.find(q => q.id === answer.questionId);
      return {
        questionId: answer.questionId,
        question: answer.question || (question ? question.question : ''),
        options: answer.options.length > 0 ? answer.options : (question ? question.options : []),
        correctAnswer: answer.correctAnswer,
        studentAnswer: answer.studentAnswer,
        isCorrect: answer.isCorrect,
        comment: answer.comment || null
      };
    });

    res.status(200).json({
      success: true,
      data: {
        studentId: attempt.studentId,
        studentName: attempt.studentName,
        quizId: attempt.quizId.toString(),
        answers: answers,
        score: attempt.score,
        completedAt: attempt.completedAt
      }
    });
  } catch (error) {
    console.error('❌ Error fetching student quiz answers:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch student quiz answers',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

