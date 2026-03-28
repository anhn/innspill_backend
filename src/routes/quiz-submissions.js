const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const QuizSubmission = require('../models/QuizSubmission');
const Quiz = require('../models/Quiz');
const Project = require('../models/Project');
const User = require('../models/User');
const { isOptionalAuth } = require('../middleware/auth');
const Joi = require('joi');

// Validation schemas
const submitQuizSchema = Joi.object({
  quizId: Joi.string().required().trim().min(1),
  studentId: Joi.string().required().trim().min(1),
  courseId: Joi.string().optional().trim(),
  currentQuestionIndex: Joi.number().integer().min(0).optional(),
  lockedAnswers: Joi.object().pattern(
    Joi.string(),
    Joi.boolean()
  ).optional().default({}),
  answers: Joi.object().pattern(
    Joi.string(),
    Joi.number().integer().min(0)
  ).required(),
  comments: Joi.object().pattern(
    Joi.string(),
    Joi.string().allow('', null)
  ).optional().default({}),
  score: Joi.number().min(0).max(100).allow(null).optional(),
  isSubmitted: Joi.boolean().required(),
  submittedAt: Joi.date().iso().allow(null).optional(),
  startedAt: Joi.date().iso().optional()
});

const updateQuizSubmissionSchema = Joi.object({
  courseId: Joi.string().optional().trim(),
  currentQuestionIndex: Joi.number().integer().min(0).optional(),
  lockedAnswers: Joi.object().pattern(
    Joi.string(),
    Joi.boolean()
  ).optional(),
  answers: Joi.object().pattern(
    Joi.string(),
    Joi.number().integer().min(0)
  ).optional(),
  comments: Joi.object().pattern(
    Joi.string(),
    Joi.string().allow('', null)
  ).optional(),
  score: Joi.number().min(0).max(100).allow(null).optional(),
  isSubmitted: Joi.boolean().optional(),
  submittedAt: Joi.date().iso().allow(null).optional(),
  startedAt: Joi.date().iso().optional()
}).min(1);

/**
 * Helper function to calculate score from answers
 */
async function calculateScore(quizId, answers) {
  try {
    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return null;
    }

    let correctCount = 0;
    const totalQuestions = quiz.questions.length;

    quiz.questions.forEach(question => {
      const questionId = question.id || question._id?.toString();
      const studentAnswer = answers[questionId];

      // Count correct answers; unanswered questions are treated as incorrect
      if (studentAnswer !== undefined && studentAnswer === question.correctAnswer) {
        correctCount++;
      }
    });

    return totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
  } catch (error) {
    console.error('Error calculating score:', error.message);
    return null;
  }
}

/**
 * Helper function to get student name from username/email
 */
async function getStudentName(studentId) {
  try {
    // Try to find user by username or email
    const user = await User.findOne({
      $or: [
        { username: studentId },
        { email: studentId }
      ]
    });
    
    return user ? (user.fullName || user.username || studentId) : studentId;
  } catch (error) {
    console.error('Error getting student name:', error.message);
    return studentId;
  }
}

/**
 * POST /api/v1/quiz-submissions
 * Submit/Save Quiz Answers
 */
router.post('/', isOptionalAuth, async (req, res) => {
  try {
    const { error, value } = submitQuizSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    // Validate quizId format
    if (!mongoose.Types.ObjectId.isValid(value.quizId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quizId format'
      });
    }

    // Verify quiz exists
    const quiz = await Quiz.findById(value.quizId);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    // Handle score differently for drafts vs submitted
    let score = value.score;
    if (value.isSubmitted) {
      // For submitted attempts: ensure we have a numeric score
      if (score === undefined || score === null) {
        score = await calculateScore(value.quizId, value.answers);
        if (score === null) {
          return res.status(500).json({
            success: false,
            message: 'Failed to calculate score'
          });
        }
      }
    } else {
      // Draft save: always keep score as null
      score = null;
    }

    // Check if submission already exists
    const existingSubmission = await QuizSubmission.findOne({
      quizId: value.quizId,
      studentId: value.studentId
    });

    let submission;
    if (existingSubmission) {
      // Update existing submission
      existingSubmission.answers = value.answers || {};
      existingSubmission.comments = value.comments || {};
      existingSubmission.score = score;
      existingSubmission.isSubmitted = value.isSubmitted;
      if (value.courseId !== undefined) {
        existingSubmission.courseId = value.courseId;
      }
      if (value.currentQuestionIndex !== undefined) {
        existingSubmission.currentQuestionIndex = value.currentQuestionIndex;
      }
      if (value.lockedAnswers !== undefined) {
        existingSubmission.lockedAnswers = value.lockedAnswers;
      }
      if (value.submittedAt) {
        existingSubmission.submittedAt = new Date(value.submittedAt);
      } else if (value.isSubmitted && !existingSubmission.submittedAt) {
        existingSubmission.submittedAt = new Date();
      }
      if (value.startedAt) {
        existingSubmission.startedAt = new Date(value.startedAt);
      }
      await existingSubmission.save();
      submission = existingSubmission;
    } else {
      // Create new submission
      const submissionData = {
        quizId: value.quizId,
        studentId: value.studentId,
        courseId: value.courseId,
        currentQuestionIndex: value.currentQuestionIndex,
        lockedAnswers: value.lockedAnswers || {},
        answers: value.answers || {},
        comments: value.comments || {},
        score: score,
        isSubmitted: value.isSubmitted,
        startedAt: value.startedAt ? new Date(value.startedAt) : new Date()
      };

      if (value.submittedAt) {
        submissionData.submittedAt = new Date(value.submittedAt);
      } else if (value.isSubmitted) {
        submissionData.submittedAt = new Date();
      }

      submission = new QuizSubmission(submissionData);
      await submission.save();
    }

    console.log(`✅ Quiz submission ${existingSubmission ? 'updated' : 'created'} successfully: ID=${submission._id.toString()}, QuizID=${submission.quizId.toString()}, StudentID=${submission.studentId}`);

    res.status(existingSubmission ? 200 : 201).json({
      success: true,
      data: {
        submissionId: submission._id.toString(),
        quizId: submission.quizId.toString(),
        studentId: submission.studentId,
        courseId: submission.courseId,
        currentQuestionIndex: submission.currentQuestionIndex,
        lockedAnswers: submission.lockedAnswers || {},
        answers: submission.answers || {},
        comments: submission.comments || {},
        score: submission.score,
        isSubmitted: submission.isSubmitted,
        submittedAt: submission.submittedAt,
        startedAt: submission.startedAt,
        lastUpdated: submission.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error submitting quiz:', error.message);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Submission already exists for this quiz and student'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to submit quiz',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/quiz-submissions/student/:username
 * Get Student's Quiz Submissions
 */
router.get('/student/:username', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      userName: Joi.string().optional().trim(),
      quizId: Joi.string().optional().trim()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    const username = req.params.username || value.userName;
    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Username is required'
      });
    }

    const query = { studentId: username };
    if (value.quizId) {
      if (!mongoose.Types.ObjectId.isValid(value.quizId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid quizId format'
        });
      }
      query.quizId = value.quizId;
    }

    const submissions = await QuizSubmission.find(query)
      .sort({ updatedAt: -1 })
      .populate('quizId', 'projectId questions');

    const formattedSubmissions = submissions.map(submission => ({
      id: submission._id.toString(),
      quizId: submission.quizId.toString(),
      studentId: submission.studentId,
      courseId: submission.courseId,
      currentQuestionIndex: submission.currentQuestionIndex,
      lockedAnswers: submission.lockedAnswers || {},
      answers: Object.fromEntries(submission.answers),
      comments: Object.fromEntries(submission.comments),
      score: submission.score,
      isSubmitted: submission.isSubmitted,
      submittedAt: submission.submittedAt,
      startedAt: submission.startedAt,
      lastUpdated: submission.updatedAt
    }));

    res.status(200).json({
      success: true,
      data: formattedSubmissions
    });
  } catch (error) {
    console.error('❌ Error fetching student submissions:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch student submissions',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/quiz-submissions/quiz/:quizId/student/:username
 * Get Quiz Submission by Quiz and Student
 */
router.get('/quiz/:quizId/student/:username', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
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

    if (!mongoose.Types.ObjectId.isValid(req.params.quizId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quizId format'
      });
    }

    const username = req.params.username || value.userName;
    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Username is required'
      });
    }

    const submission = await QuizSubmission.findOne({
      quizId: req.params.quizId,
      studentId: username
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Quiz submission not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: submission._id.toString(),
        quizId: submission.quizId.toString(),
        studentId: submission.studentId,
        courseId: submission.courseId,
        currentQuestionIndex: submission.currentQuestionIndex,
        lockedAnswers: submission.lockedAnswers || {},
        answers: submission.answers || {},
        comments: submission.comments || {},
        score: submission.score,
        isSubmitted: submission.isSubmitted,
        submittedAt: submission.submittedAt,
        startedAt: submission.startedAt,
        lastUpdated: submission.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error fetching quiz submission:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch quiz submission',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/quiz-submissions/:quizId/leaderboard
 * Alternative leaderboard route (without /quiz/ prefix for compatibility)
 * Get Quiz Leaderboard
 */
router.get('/:quizId/leaderboard', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      userName: Joi.string().optional().trim(),
      limit: Joi.number().integer().min(1).max(100).optional().default(5)
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.quizId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quizId format'
      });
    }

    // Verify quiz exists
    const quiz = await Quiz.findById(req.params.quizId);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    // Get top submissions sorted by score (descending), then by submittedAt (ascending for tie-breaking)
    const submissions = await QuizSubmission.find({
      quizId: req.params.quizId,
      isSubmitted: true
    })
      .sort({ score: -1, submittedAt: 1 })
      .limit(value.limit);

    // Get student names for each submission
    const leaderboard = await Promise.all(
      submissions.map(async (submission) => {
        const studentName = await getStudentName(submission.studentId);
        return {
          studentId: submission.studentId,
          studentName: studentName,
          score: submission.score,
          submittedAt: submission.submittedAt
        };
      })
    );

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
 * GET /api/v1/quiz-submissions/quiz/:quizId/leaderboard
 * Get Quiz Leaderboard (original route for backward compatibility)
 */
router.get('/quiz/:quizId/leaderboard', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      userName: Joi.string().optional().trim(),
      limit: Joi.number().integer().min(1).max(100).optional().default(5)
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.quizId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quizId format'
      });
    }

    // Verify quiz exists
    const quiz = await Quiz.findById(req.params.quizId);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    // Get top submissions sorted by score (descending), then by submittedAt (ascending for tie-breaking)
    const submissions = await QuizSubmission.find({
      quizId: req.params.quizId,
      isSubmitted: true
    })
      .sort({ score: -1, submittedAt: 1 })
      .limit(value.limit);

    // Get student names for each submission
    const leaderboard = await Promise.all(
      submissions.map(async (submission) => {
        const studentName = await getStudentName(submission.studentId);
        return {
          studentId: submission.studentId,
          studentName: studentName,
          score: submission.score,
          submittedAt: submission.submittedAt
        };
      })
    );

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
 * PUT /api/v1/quiz-submissions/:submissionId
 * Update Quiz Submission
 */
router.put('/:submissionId', isOptionalAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.submissionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid submissionId format'
      });
    }

    const { error, value } = updateQuizSubmissionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request body',
        error: error.details[0].message
      });
    }

    const submission = await QuizSubmission.findById(req.params.submissionId);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Quiz submission not found'
      });
    }

    // Update fields
    if (value.answers !== undefined) {
      submission.answers = value.answers;
      // Recalculate score if answers changed
      if (value.score === undefined) {
        const newScore = await calculateScore(submission.quizId, value.answers);
        if (newScore !== null) {
          submission.score = newScore;
        }
      }
    }
    if (value.comments !== undefined) {
      submission.comments = value.comments;
    }
    if (value.courseId !== undefined) {
      submission.courseId = value.courseId;
    }
    if (value.currentQuestionIndex !== undefined) {
      submission.currentQuestionIndex = value.currentQuestionIndex;
    }
    if (value.lockedAnswers !== undefined) {
      submission.lockedAnswers = value.lockedAnswers;
    }
    if (value.score !== undefined) {
      submission.score = value.score;
    }
    if (value.isSubmitted !== undefined) {
      submission.isSubmitted = value.isSubmitted;
      // Set submittedAt if being submitted for the first time
      if (value.isSubmitted && !submission.submittedAt) {
        submission.submittedAt = new Date();
      }
    }
    if (value.submittedAt !== undefined) {
      submission.submittedAt = new Date(value.submittedAt);
    }
    if (value.startedAt !== undefined) {
      submission.startedAt = new Date(value.startedAt);
    }

    await submission.save();

    console.log(`✅ Quiz submission updated successfully: ID=${submission._id.toString()}`);

    res.status(200).json({
      success: true,
      data: {
        id: submission._id.toString(),
        quizId: submission.quizId.toString(),
        studentId: submission.studentId,
        courseId: submission.courseId,
        currentQuestionIndex: submission.currentQuestionIndex,
        lockedAnswers: submission.lockedAnswers || {},
        answers: submission.answers || {},
        comments: submission.comments || {},
        score: submission.score,
        isSubmitted: submission.isSubmitted,
        submittedAt: submission.submittedAt,
        startedAt: submission.startedAt,
        lastUpdated: submission.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error updating quiz submission:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update quiz submission',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/quiz-submissions/scores
 * Get all quiz scores filtered by quiz, course (class), or project
 * Returns latest attempt for each student
 * Query parameters:
 *   - quizId (optional): Get scores for a specific quiz
 *   - courseId (optional): Get scores for all quizzes in a course's project
 *   - projectId (optional): Get scores for all quizzes in a project
 *   - userName (optional): For authentication
 * 
 * Note: Only one filter (quizId, courseId, or projectId) should be provided
 */
router.get('/scores', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      quizId: Joi.string().optional().trim(),
      courseId: Joi.string().optional().trim(),
      projectId: Joi.string().optional().trim(),
      userName: Joi.string().optional().trim()
    }).or('quizId', 'courseId', 'projectId'); // At least one filter required

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    let quizIds = [];
    let filterType = '';
    let filterValue = '';

    // Determine which filter to use and get quiz IDs
    if (value.quizId) {
      if (!mongoose.Types.ObjectId.isValid(value.quizId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid quizId format'
        });
      }

      // Verify quiz exists
      const quiz = await Quiz.findById(value.quizId);
      if (!quiz) {
        return res.status(404).json({
          success: false,
          message: 'Quiz not found'
        });
      }

      quizIds = [value.quizId];
      filterType = 'quiz';
      filterValue = value.quizId;
    } else if (value.projectId) {
      if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid projectId format'
        });
      }

      // Verify project exists
      const project = await Project.findById(value.projectId);
      if (!project) {
        return res.status(404).json({
          success: false,
          message: 'Project not found'
        });
      }

      // Get all quizzes for this project
      const quizzes = await Quiz.find({ projectId: value.projectId });
      if (quizzes.length === 0) {
        return res.status(200).json({
          success: true,
          filterType: 'project',
          filterValue: value.projectId,
          data: []
        });
      }

      quizIds = quizzes.map(q => q._id);
      filterType = 'project';
      filterValue = value.projectId;
    } else if (value.courseId) {
      if (!mongoose.Types.ObjectId.isValid(value.courseId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid courseId format'
        });
      }

      // Get project for this course
      const project = await Project.findOne({ courseId: value.courseId });
      if (!project) {
        return res.status(404).json({
          success: false,
          message: 'Project not found for this course'
        });
      }

      // Get all quizzes for this project
      const quizzes = await Quiz.find({ projectId: project._id });
      if (quizzes.length === 0) {
        return res.status(200).json({
          success: true,
          filterType: 'course',
          filterValue: value.courseId,
          data: []
        });
      }

      quizIds = quizzes.map(q => q._id);
      filterType = 'course';
      filterValue = value.courseId;
    }

    // Get all submissions for these quizzes (only submitted ones)
    const allSubmissions = await QuizSubmission.find({
      quizId: { $in: quizIds },
      isSubmitted: true
    }).sort({ submittedAt: -1, updatedAt: -1 });

    // Group by studentId and quizId, keeping only the latest attempt
    const latestSubmissionsMap = new Map();
    
    allSubmissions.forEach(submission => {
      const key = `${submission.studentId}_${submission.quizId.toString()}`;
      
      if (!latestSubmissionsMap.has(key)) {
        latestSubmissionsMap.set(key, submission);
      } else {
        const existing = latestSubmissionsMap.get(key);
        // Compare by submittedAt first, then updatedAt
        const existingDate = existing.submittedAt || existing.updatedAt;
        const currentDate = submission.submittedAt || submission.updatedAt;
        
        if (currentDate > existingDate) {
          latestSubmissionsMap.set(key, submission);
        }
      }
    });

    // Get quiz details for enrichment
    const quizzes = await Quiz.find({ _id: { $in: quizIds } });
    const quizMap = new Map(quizzes.map(q => [q._id.toString(), q]));

    // Get student names
    const studentIds = [...new Set(Array.from(latestSubmissionsMap.values()).map(s => s.studentId))];
    const studentMap = new Map();

    // Fetch student names in batches
    const users = await User.find({
      $or: [
        { username: { $in: studentIds } },
        { email: { $in: studentIds } }
      ]
    }).select('username email fullName');

    users.forEach(user => {
      if (user.username) studentMap.set(user.username, user.fullName || user.username);
      if (user.email) studentMap.set(user.email, user.fullName || user.username);
    });

    // Format results
    const results = Array.from(latestSubmissionsMap.values()).map(submission => {
      const quiz = quizMap.get(submission.quizId.toString());
      const studentName = studentMap.get(submission.studentId) || submission.studentId;

      return {
        studentId: submission.studentId,
        studentName: studentName,
        quizId: submission.quizId.toString(),
        quizName: quiz ? (quiz.name || 'Unnamed Quiz') : 'Unknown Quiz',
        score: submission.score,
        submittedAt: submission.submittedAt,
        startedAt: submission.startedAt,
        updatedAt: submission.updatedAt
      };
    });

    // Sort by score (descending), then by student name
    results.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.studentName.localeCompare(b.studentName);
    });

    res.status(200).json({
      success: true,
      filterType: filterType,
      filterValue: filterValue,
      totalStudents: results.length,
      data: results
    });
  } catch (error) {
    console.error('❌ Error fetching quiz scores:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch quiz scores',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

