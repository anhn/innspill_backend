const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Submission = require('../models/Submission');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Role = require('../models/Role');
const QuizSubmission = require('../models/QuizSubmission');
const Quiz = require('../models/Quiz');
const ChatSession = require('../models/ChatSession');
const LOMapping = require('../models/LOMapping');
const StudentGroup = require('../models/StudentGroup');
const User = require('../models/User');
const { isOptionalAuth } = require('../middleware/auth');
const Joi = require('joi');

// Validation schemas
const windowedMetricsSchema = Joi.object({
  projectId: Joi.string().required().trim().min(1),
  studentId: Joi.string().optional().trim(),
  userName: Joi.string().optional().trim(), // Allow userName to avoid validation errors
  windowType: Joi.string().valid('daily', 'weekly', 'monthly', 'task', 'custom').required(),
  startDate: Joi.date().iso().optional(),
  endDate: Joi.date().iso().optional(),
  metrics: Joi.string().optional().trim() // Comma-separated list
});

/**
 * Calculate trend (slope) from array of values
 */
function calculateTrend(values) {
  if (!values || values.length < 2) return 0;
  const n = values.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * values[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;
  
  const slope = (n * sumXY - sumX * sumY) / denominator;
  return parseFloat(slope.toFixed(3));
}

/**
 * Calculate statistics from array of numbers
 */
function calculateStats(values) {
  if (!values || values.length === 0) return null;
  
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  
  const percentile = (arr, p) => {
    if (arr.length === 0) return null;
    const index = Math.ceil(arr.length * p) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  };
  
  return {
    mean: parseFloat(mean.toFixed(2)),
    median: parseFloat(median.toFixed(2)),
    stdDev: parseFloat(stdDev.toFixed(2)),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    count: values.length,
    percentiles: {
      p25: parseFloat((percentile(sorted, 0.25) || 0).toFixed(2)),
      p50: parseFloat((percentile(sorted, 0.50) || 0).toFixed(2)),
      p75: parseFloat((percentile(sorted, 0.75) || 0).toFixed(2)),
      p90: parseFloat((percentile(sorted, 0.90) || 0).toFixed(2))
    },
    distribution: {
      '0-1': sorted.filter(v => v >= 0 && v <= 1).length,
      '2-3': sorted.filter(v => v >= 2 && v <= 3).length,
      '4-5': sorted.filter(v => v >= 4 && v <= 5).length
    }
  };
}

/**
 * Extract score from feedback history
 */
function getLatestScore(submission, scoreField) {
  if (!submission.feedbackHistory || submission.feedbackHistory.length === 0) return null;
  const latest = submission.feedbackHistory[submission.feedbackHistory.length - 1];
  const score = latest[scoreField];
  return typeof score === 'number' ? score : null;
}

/**
 * Calculate task quality score metrics for a window
 */
function calculateTaskQualityScore(submissions, windowStart, windowEnd) {
  const windowSubmissions = submissions.filter(s => {
    const subDate = new Date(s.datetime);
    return subDate >= windowStart && subDate <= windowEnd;
  });
  
  const scores = windowSubmissions
    .map(s => getLatestScore(s, 'taskQualityScore'))
    .filter(score => score !== null);
  
  if (scores.length === 0) return null;
  
  const trend = calculateTrend(scores);
  
  return {
    mean: parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
    latest: scores[scores.length - 1],
    trend: trend,
    count: scores.length,
    min: Math.min(...scores),
    max: Math.max(...scores)
  };
}

/**
 * Calculate reflection score metrics
 */
function calculateReflectionScore(submissions, windowStart, windowEnd) {
  const windowSubmissions = submissions.filter(s => {
    const subDate = new Date(s.datetime);
    return subDate >= windowStart && subDate <= windowEnd;
  });
  
  const scores = windowSubmissions
    .map(s => getLatestScore(s, 'reflectionScore'))
    .filter(score => score !== null);
  
  if (scores.length === 0) return null;
  
  const trend = calculateTrend(scores);
  
  return {
    mean: parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
    latest: scores[scores.length - 1],
    trend: trend,
    count: scores.length,
    min: Math.min(...scores),
    max: Math.max(...scores)
  };
}

/**
 * Calculate critical thinking score metrics
 */
function calculateCriticalThinkingScore(submissions, windowStart, windowEnd) {
  const windowSubmissions = submissions.filter(s => {
    const subDate = new Date(s.datetime);
    return subDate >= windowStart && subDate <= windowEnd;
  });
  
  const scores = windowSubmissions
    .map(s => getLatestScore(s, 'criticalthinkingScore'))
    .filter(score => score !== null);
  
  if (scores.length === 0) return null;
  
  const trend = calculateTrend(scores);
  
  return {
    mean: parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
    latest: scores[scores.length - 1],
    trend: trend,
    count: scores.length,
    min: Math.min(...scores),
    max: Math.max(...scores)
  };
}

/**
 * Calculate concept mastery score metrics
 */
function calculateConceptMasteryScore(submissions, windowStart, windowEnd) {
  const windowSubmissions = submissions.filter(s => {
    const subDate = new Date(s.datetime);
    return subDate >= windowStart && subDate <= windowEnd;
  });
  
  const scores = windowSubmissions
    .map(s => getLatestScore(s, 'conceptMasteryScore'))
    .filter(score => score !== null);
  
  if (scores.length === 0) return null;
  
  const trend = calculateTrend(scores);
  
  return {
    mean: parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
    latest: scores[scores.length - 1],
    trend: trend,
    count: scores.length,
    min: Math.min(...scores),
    max: Math.max(...scores)
  };
}

/**
 * Calculate behavioral metrics
 */
function calculateBehavioralMetrics(submissions, tasks, windowStart, windowEnd) {
  const windowSubmissions = submissions.filter(s => {
    const subDate = new Date(s.datetime);
    return subDate >= windowStart && subDate <= windowEnd;
  });
  
  const taskMap = new Map(tasks.map(t => [t._id.toString(), t]));
  
  let onTimeCount = 0;
  let totalSubmissions = windowSubmissions.length;
  let totalRevisions = 0;
  let aiUsageCount = 0;
  
  windowSubmissions.forEach(sub => {
    const task = taskMap.get(sub.taskId.toString());
    if (task && sub.datetime <= task.submissionDeadline) {
      onTimeCount++;
    }
    
    if (sub.attemptNumber > 1) {
      totalRevisions += sub.attemptNumber - 1;
    }
    
    if (sub.conversationLog && sub.conversationLog.trim().length > 0) {
      aiUsageCount++;
    }
  });
  
  return {
    submissionCount: totalSubmissions,
    revisionCount: totalRevisions,
    averageRevisionsPerSubmission: totalSubmissions > 0 
      ? parseFloat((totalRevisions / totalSubmissions).toFixed(2))
      : 0,
    timelinessRate: totalSubmissions > 0
      ? parseFloat((onTimeCount / totalSubmissions).toFixed(2))
      : 0,
    aiUsageCount: aiUsageCount,
    aiUsageRate: totalSubmissions > 0
      ? parseFloat((aiUsageCount / totalSubmissions).toFixed(2))
      : 0
  };
}

/**
 * Calculate feedback uptake score
 */
function calculateFeedbackUptakeScore(submissions, windowStart, windowEnd) {
  const windowSubmissions = submissions.filter(s => {
    const subDate = new Date(s.datetime);
    return subDate >= windowStart && subDate <= windowEnd;
  });
  
  let improvementCount = 0;
  let totalComparisons = 0;
  
  // Group submissions by taskId and studentId
  const submissionGroups = new Map();
  windowSubmissions.forEach(sub => {
    const key = `${sub.taskId}_${sub.studentId}`;
    if (!submissionGroups.has(key)) {
      submissionGroups.set(key, []);
    }
    submissionGroups.get(key).push(sub);
  });
  
  submissionGroups.forEach((subs, key) => {
    // Sort by datetime
    subs.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    
    for (let i = 0; i < subs.length - 1; i++) {
      const current = getLatestScore(subs[i], 'taskQualityScore');
      const next = getLatestScore(subs[i + 1], 'taskQualityScore');
      
      if (current !== null && next !== null) {
        totalComparisons++;
        if (next > current) {
          improvementCount++;
        }
      }
    }
  });
  
  const uptakeScore = totalComparisons > 0
    ? parseFloat((improvementCount / totalComparisons).toFixed(2))
    : 0;
  
  return {
    uptakeScore: uptakeScore,
    improvementCount: improvementCount,
    totalComparisons: totalComparisons
  };
}

/**
 * Calculate stakeholder engagement metrics
 */
async function calculateStakeholderEngagement(studentId, projectId, windowStart, windowEnd) {
  // Get chat sessions in window
  const chatSessions = await ChatSession.find({
    sender: studentId,
    projectId: projectId,
    startTime: { $gte: windowStart, $lte: windowEnd }
  });
  
  // Get submissions with stakeholderId
  const submissions = await Submission.find({
    studentId: studentId,
    stakeholderId: { $ne: null }
  }).populate('taskId');
  
  const windowSubmissions = submissions.filter(s => {
    const task = s.taskId;
    if (!task || task.projectId.toString() !== projectId) return false;
    const subDate = new Date(s.datetime);
    return subDate >= windowStart && subDate <= windowEnd;
  });
  
  const uniqueStakeholders = new Set();
  windowSubmissions.forEach(s => {
    if (s.stakeholderId) {
      uniqueStakeholders.add(s.stakeholderId.toString());
    }
  });
  
  chatSessions.forEach(session => {
    if (session.stakeholderId) {
      uniqueStakeholders.add(session.stakeholderId.toString());
    }
  });
  
  let totalChatItems = 0;
  let totalTokens = 0;
  chatSessions.forEach(session => {
    totalChatItems += session.chatItems?.length || 0;
    session.chatItems?.forEach(item => {
      if (item.openAIMetrics?.tokenUsage?.totalTokens) {
        totalTokens += item.openAIMetrics.tokenUsage.totalTokens;
      }
    });
  });
  
  return {
    stakeholderDiversity: uniqueStakeholders.size,
    chatSessionCount: chatSessions.length,
    averageChatItemsPerSession: chatSessions.length > 0
      ? parseFloat((totalChatItems / chatSessions.length).toFixed(2))
      : 0,
    totalChatItems: totalChatItems,
    totalTokensUsed: totalTokens
  };
}

/**
 * Calculate CLO mastery metrics
 */
async function calculateCLOMastery(studentId, projectId, windowStart, windowEnd) {
  const loMapping = await LOMapping.findOne({ projectId: projectId });
  if (!loMapping || !loMapping.mappings || loMapping.mappings.length === 0) {
    return null;
  }
  
  // Get all tasks for the project
  const tasks = await Task.find({ projectId: projectId });
  const taskMap = new Map(tasks.map(t => [t._id.toString(), t]));
  
  // Get submissions in window
  const submissions = await Submission.find({
    studentId: studentId,
    taskId: { $in: tasks.map(t => t._id) }
  });
  
  const windowSubmissions = submissions.filter(s => {
    const subDate = new Date(s.datetime);
    return subDate >= windowStart && subDate <= windowEnd;
  });
  
  const cloMetrics = {};
  
  loMapping.mappings.forEach(mapping => {
    const lo = mapping.learningObjective;
    const taskIds = mapping.taskIds.map(id => id.toString());
    
    // Get submissions for tasks mapped to this LO
    const loSubmissions = windowSubmissions.filter(s => 
      taskIds.includes(s.taskId.toString())
    );
    
    if (loSubmissions.length === 0) {
      cloMetrics[lo] = {
        score: null,
        coverage: 0,
        submissionCount: 0
      };
      return;
    }
    
    // Calculate average conceptMasteryScore for this LO
    const scores = loSubmissions
      .map(s => getLatestScore(s, 'conceptMasteryScore'))
      .filter(score => score !== null);
    
    const avgScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : null;
    
    cloMetrics[lo] = {
      score: avgScore ? parseFloat(avgScore.toFixed(2)) : null,
      coverage: parseFloat((loSubmissions.length / taskIds.length).toFixed(2)),
      submissionCount: loSubmissions.length
    };
  });
  
  return cloMetrics;
}

/**
 * Calculate quiz performance metrics
 */
async function calculateQuizPerformance(studentId, projectId, windowStart, windowEnd) {
  const quizzes = await Quiz.find({ projectId: projectId });
  if (quizzes.length === 0) return null;
  
  const quizSubmissions = await QuizSubmission.find({
    studentId: studentId,
    quizId: { $in: quizzes.map(q => q._id) },
    submittedAt: { $gte: windowStart, $lte: windowEnd }
  });
  
  if (quizSubmissions.length === 0) return null;
  
  const scores = quizSubmissions.map(qs => qs.score);
  
  return {
    averageScore: parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
    latestScore: scores[scores.length - 1],
    quizCount: quizSubmissions.length,
    min: Math.min(...scores),
    max: Math.max(...scores),
    trend: calculateTrend(scores)
  };
}

/**
 * Generate time windows based on windowType
 */
function generateTimeWindows(windowType, startDate, endDate, tasks = []) {
  const windows = [];
  
  if (windowType === 'task') {
    // Create windows per task
    const sortedTasks = tasks.sort((a, b) => 
      new Date(a.submissionDeadline) - new Date(b.submissionDeadline)
    );
    
    sortedTasks.forEach((task, index) => {
      windows.push({
        windowLabel: `Task ${index + 1}: ${task.taskTitle || task.keyword}`,
        windowStart: task.createdAt || new Date(),
        windowEnd: task.submissionDeadline,
        taskId: task._id.toString()
      });
    });
  } else if (windowType === 'custom') {
    if (!startDate || !endDate) {
      throw new Error('startDate and endDate required for custom window type');
    }
    windows.push({
      windowLabel: `Custom (${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]})`,
      windowStart: new Date(startDate),
      windowEnd: new Date(endDate)
    });
  } else {
    // Daily, weekly, or monthly
    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date();
    
    let current = new Date(start);
    current.setHours(0, 0, 0, 0);
    
    while (current <= end) {
      let windowStart = new Date(current);
      let windowEnd;
      let label;
      
      if (windowType === 'daily') {
        windowEnd = new Date(current);
        windowEnd.setHours(23, 59, 59, 999);
        label = current.toISOString().split('T')[0];
        current.setDate(current.getDate() + 1);
      } else if (windowType === 'weekly') {
        windowEnd = new Date(current);
        windowEnd.setDate(windowEnd.getDate() + 6);
        windowEnd.setHours(23, 59, 59, 999);
        label = `Week of ${current.toISOString().split('T')[0]}`;
        current.setDate(current.getDate() + 7);
      } else if (windowType === 'monthly') {
        windowEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
        windowEnd.setHours(23, 59, 59, 999);
        label = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
        current.setMonth(current.getMonth() + 1);
        current.setDate(1);
      }
      
      if (windowEnd > end) windowEnd = new Date(end);
      
      windows.push({
        windowLabel: label,
        windowStart: windowStart,
        windowEnd: windowEnd
      });
    }
  }
  
  return windows;
}

/**
 * Calculate boxplot statistics from array of values
 */
function calculateBoxplot(values) {
  if (!values || values.length === 0) return null;
  
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  
  const percentile = (arr, p) => {
    if (arr.length === 0) return null;
    const index = Math.ceil(arr.length * p) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  };
  
  return {
    min: sorted[0],
    q1: percentile(sorted, 0.25),
    median: percentile(sorted, 0.50),
    q3: percentile(sorted, 0.75),
    max: sorted[n - 1],
    mean: parseFloat((values.reduce((a, b) => a + b, 0) / n).toFixed(2))
  };
}

/**
 * Calculate LO performance with boxplot data
 */
async function calculateLOPerformance(studentIds, projectId, windowStart, windowEnd) {
  const loMapping = await LOMapping.findOne({ projectId: projectId });
  if (!loMapping || !loMapping.mappings || loMapping.mappings.length === 0) {
    return [];
  }

  const tasks = await Task.find({ projectId: projectId });
  const taskMap = new Map(tasks.map(t => [t._id.toString(), t]));

  const submissions = await Submission.find({
    studentId: { $in: studentIds },
    taskId: { $in: tasks.map(t => t._id) }
  });

  const windowSubmissions = submissions.filter(s => {
    const subDate = new Date(s.datetime);
    return subDate >= windowStart && subDate <= windowEnd;
  });

  const loResults = [];

  for (const mapping of loMapping.mappings) {
    const lo = mapping.learningObjective;
    const taskIds = mapping.taskIds.map(id => id.toString());
    
    const loSubmissions = windowSubmissions.filter(s => 
      taskIds.includes(s.taskId.toString())
    );

    const scores = loSubmissions
      .map(s => getLatestScore(s, 'conceptMasteryScore'))
      .filter(score => score !== null && score !== undefined);

    if (scores.length > 0) {
      const boxplot = calculateBoxplot(scores);
      loResults.push({
        learningObjective: lo,
        averageScore: parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
        boxplot: boxplot,
        submissionCount: loSubmissions.length
      });
    }
  }

  return loResults;
}

/**
 * Calculate task performance
 */
async function calculateTaskPerformance(studentIds, tasks, submissions, windowStart, windowEnd) {
  const windowSubmissions = submissions.filter(s => {
    const subDate = new Date(s.datetime);
    return subDate >= windowStart && subDate <= windowEnd;
  });

  const taskResults = [];

  for (const task of tasks) {
    const taskSubmissions = windowSubmissions.filter(s => 
      s.taskId.toString() === task._id.toString()
    );

    if (taskSubmissions.length > 0) {
      const taskQualityScores = taskSubmissions
        .map(s => getLatestScore(s, 'taskQualityScore'))
        .filter(score => score !== null && score !== undefined);

      const reflectionScores = taskSubmissions
        .map(s => getLatestScore(s, 'reflectionScore'))
        .filter(score => score !== null && score !== undefined);

      taskResults.push({
        taskId: task._id.toString(),
        taskTitle: task.taskTitle || task.keyword,
        averageScore: taskQualityScores.length > 0
          ? parseFloat((taskQualityScores.reduce((a, b) => a + b, 0) / taskQualityScores.length).toFixed(2))
          : null,
        averageReflectionScore: reflectionScores.length > 0
          ? parseFloat((reflectionScores.reduce((a, b) => a + b, 0) / reflectionScores.length).toFixed(2))
          : null,
        submissionCount: taskSubmissions.length
      });
    }
  }

  return taskResults;
}

/**
 * Calculate stakeholder interaction metrics
 */
async function calculateStakeholderInteraction(studentIds, projectId, windowStart, windowEnd) {
  const chatSessions = await ChatSession.find({
    sender: { $in: studentIds },
    projectId: projectId,
    startTime: { $gte: windowStart, $lte: windowEnd }
  });

  const totalSessions = chatSessions.length;
  const totalChatItems = chatSessions.reduce((sum, session) => 
    sum + (session.chatItems?.length || 0), 0
  );

  return {
    averageSessionCount: studentIds.length > 0 ? parseFloat((totalSessions / studentIds.length).toFixed(2)) : 0,
    averageSessionLength: totalSessions > 0 ? parseFloat((totalChatItems / totalSessions).toFixed(2)) : 0,
    totalSessions: totalSessions
  };
}

/**
 * Calculate quiz question performance
 */
async function calculateQuizQuestionPerformance(studentIds, projectId, windowStart, windowEnd) {
  const quizzes = await Quiz.find({ projectId: projectId });
  if (quizzes.length === 0) return [];

  const quizSubmissions = await QuizSubmission.find({
    studentId: { $in: studentIds },
    quizId: { $in: quizzes.map(q => q._id) },
    submittedAt: { $gte: windowStart, $lte: windowEnd }
  });

  if (quizSubmissions.length === 0) return [];

  // Group by quiz and calculate averages
  const quizResults = [];
  for (const quiz of quizzes) {
    const submissions = quizSubmissions.filter(qs => 
      qs.quizId.toString() === quiz._id.toString()
    );

    if (submissions.length > 0) {
      const scores = submissions.map(qs => qs.score || 0);
      quizResults.push({
        quizId: quiz._id.toString(),
        quizTitle: quiz.title || quiz.name,
        averageScore: parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
        submissionCount: submissions.length
      });
    }
  }

  return quizResults;
}

/**
 * Calculate concept performance with boxplot
 */
async function calculateConceptPerformance(studentIds, submissions, windowStart, windowEnd) {
  const windowSubmissions = submissions.filter(s => {
    const subDate = new Date(s.datetime);
    return subDate >= windowStart && subDate <= windowEnd;
  });

  // Extract concepts from feedback history
  const conceptScores = new Map();

  windowSubmissions.forEach(sub => {
    if (sub.feedbackHistory && sub.feedbackHistory.length > 0) {
      sub.feedbackHistory.forEach(feedback => {
        if (feedback.concept && feedback.conceptMasteryScore !== null && feedback.conceptMasteryScore !== undefined) {
          const concept = feedback.concept;
          if (!conceptScores.has(concept)) {
            conceptScores.set(concept, []);
          }
          conceptScores.get(concept).push(feedback.conceptMasteryScore);
        }
      });
    }
  });

  const conceptResults = [];
  for (const [concept, scores] of conceptScores.entries()) {
    if (scores.length > 0) {
      const boxplot = calculateBoxplot(scores);
      conceptResults.push({
        concept: concept,
        averageScore: parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
        boxplot: boxplot,
        submissionCount: scores.length
      });
    }
  }

  return conceptResults;
}

/**
 * GET /api/v1/student-metrics/progress-student
 * Aggregated progress metrics for a single student (individual + their groups)
 * Used by student workspace (individual + group tabs)
 */
router.get('/progress-student', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      projectId: Joi.string().required().trim().min(1),
      userName: Joi.string().required().trim(),
      studentId: Joi.string().optional().trim(),
      scope: Joi.string().valid('individual', 'group', 'both').optional().default('both')
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
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

    // Authorization: students can only view their own metrics
    const targetStudentId = value.studentId || value.userName;
    if (value.studentId && value.studentId !== value.userName) {
      return res.status(403).json({
        success: false,
        message: 'You can only view your own progress metrics'
      });
    }

    const scope = value.scope || 'both';

    // Load project (for courseId) and tasks
    const project = await Project.findById(value.projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const tasks = await Task.find({ projectId: value.projectId });
    const taskIds = tasks.map(t => t._id);
    const totalTasks = tasks.length;
    const now = new Date();

    let individualMetrics = null;
    let groupMetrics = [];

    /**
     * INDIVIDUAL METRICS
     */
    if (scope === 'individual' || scope === 'both') {
      const studentSubmissions = await Submission.find({
        studentId: targetStudentId,
        taskId: { $in: taskIds }
      });

      // tasksDone: tasks with at least one submission
      const tasksWithSubmission = new Set(
        studentSubmissions.map(s => s.taskId.toString())
      );
      const tasksDone = tasksWithSubmission.size;

      // tasksLate: deadline passed and no submission
      let tasksLate = 0;
      tasks.forEach(task => {
        const deadline = task.submissionDeadline;
        const hasSubmission = tasksWithSubmission.has(task._id.toString());
        if (deadline && deadline < now && !hasSubmission) {
          tasksLate++;
        }
      });

      // averageScore: average starScore (0–5) over all submissions with numeric score
      const starScores = studentSubmissions
        .map(s => s.starScore)
        .filter(score => typeof score === 'number');
      const averageScore = starScores.length > 0
        ? parseFloat((starScores.reduce((a, b) => a + b, 0) / starScores.length).toFixed(2))
        : null;

      // feedbackReceivedCount: submissions with any feedback
      const feedbackReceivedCount = studentSubmissions.filter(sub => {
        const hasHistory = Array.isArray(sub.feedbackHistory) && sub.feedbackHistory.length > 0;
        const hasVirtual = sub.feedback !== null && sub.feedback !== undefined && sub.feedback !== '';
        return hasHistory || hasVirtual;
      }).length;

      // feedbackOnFeedbackCount: submissions where student responded to feedback
      // We only have feedbackReceivedQuestionAnswers in the schema; other fields like
      // feedbackAgreement / feedbackComment are not modeled, so we just use that.
      const feedbackOnFeedbackCount = studentSubmissions.filter(sub => {
        return Array.isArray(sub.feedbackReceivedQuestionAnswers) &&
          sub.feedbackReceivedQuestionAnswers.length > 0;
      }).length;

      // submissionsCount
      const submissionsCount = studentSubmissions.length;

      // submissionQuestionsAnsweredCount: submissions with submissionQuestionAnswers
      const submissionQuestionsAnsweredCount = studentSubmissions.filter(sub => {
        return Array.isArray(sub.submissionQuestionAnswers) &&
          sub.submissionQuestionAnswers.length > 0;
      }).length;

      // Conversation messages and sessions (ChatSession)
      const chatSessions = await ChatSession.find({
        sender: targetStudentId,
        projectId: value.projectId
      });

      const conversationMessagesCount = chatSessions.reduce(
        (sum, session) => sum + (session.chatItems?.length || 0),
        0
      );

      // Count sessions in the current month only
      let conversationSessionsPerMonth = 0;
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      if (chatSessions.length > 0) {
        chatSessions.forEach(session => {
          let sessionDate = session.startTime;
          
          // Fallback to first chat item timestamp if startTime not available
          if (!sessionDate && session.chatItems && session.chatItems.length > 0) {
            sessionDate = session.chatItems[0].timestamp;
          }
          
          if (sessionDate) {
            const sessionDateObj = new Date(sessionDate);
            // Check if session is in current month
            if (sessionDateObj >= currentMonthStart && sessionDateObj <= currentMonthEnd) {
              conversationSessionsPerMonth++;
            }
          }
        });
      }

      // Latest quiz score for this student in this project
      let quizScoreLatest = null;
      const quizzes = await Quiz.find({ projectId: value.projectId });
      if (quizzes.length > 0) {
        const quizIds = quizzes.map(q => q._id);
        const latestQuizSubmission = await QuizSubmission.findOne({
          quizId: { $in: quizIds },
          studentId: targetStudentId,
          isSubmitted: true
        }).sort({ submittedAt: -1 });

        if (latestQuizSubmission && typeof latestQuizSubmission.score === 'number') {
          quizScoreLatest = latestQuizSubmission.score;
        }
      }

      individualMetrics = {
        tasksDone,
        tasksLate,
        totalTasks,
        averageScore,
        feedbackReceivedCount,
        feedbackOnFeedbackCount,
        submissionsCount,
        submissionQuestionsAnsweredCount,
        conversationMessagesCount,
        conversationSessionsPerMonth,
        quizScoreLatest
      };
    }

    /**
     * GROUP METRICS (only groups that the student belongs to)
     */
    if (scope === 'group' || scope === 'both') {
      // Find active groups in same course/project where student is a member
      const groupQuery = {
        courseId: project.courseId,
        isActive: true,
        studentIds: targetStudentId
      };

      // Accept groups either bound to this projectId or with no specific project
      groupQuery.$or = [
        { projectId: value.projectId },
        { projectId: null },
        { projectId: { $exists: false } }
      ];

      const studentGroups = await StudentGroup.find(groupQuery);

      if (studentGroups.length > 0) {
        // Preload quizzes for this project once
        const quizzes = await Quiz.find({ projectId: value.projectId });
        const quizIds = quizzes.map(q => q._id);

        groupMetrics = await Promise.all(
          studentGroups.map(async (group) => {
            const memberIds = group.studentIds || [];

            // Submissions for members in this project
            const groupSubmissions = await Submission.find({
              studentId: { $in: memberIds },
              taskId: { $in: taskIds }
            });

            const groupTasksWithSubmission = new Set(
              groupSubmissions.map(s => s.taskId.toString())
            );

            const groupTasksDone = groupTasksWithSubmission.size;

            let groupTasksLate = 0;
            tasks.forEach(task => {
              const deadline = task.submissionDeadline;
              const hasSubmission = groupTasksWithSubmission.has(task._id.toString());
              if (deadline && deadline < now && !hasSubmission) {
                groupTasksLate++;
              }
            });

            const groupStarScores = groupSubmissions
              .map(s => s.starScore)
              .filter(score => typeof score === 'number');
            const groupAverageScore = groupStarScores.length > 0
              ? parseFloat((groupStarScores.reduce((a, b) => a + b, 0) / groupStarScores.length).toFixed(2))
              : null;

            const groupFeedbackReceivedCount = groupSubmissions.filter(sub => {
              const hasHistory = Array.isArray(sub.feedbackHistory) && sub.feedbackHistory.length > 0;
              const hasVirtual = sub.feedback !== null && sub.feedback !== undefined && sub.feedback !== '';
              return hasHistory || hasVirtual;
            }).length;

            const groupFeedbackOnFeedbackCount = groupSubmissions.filter(sub => {
              return Array.isArray(sub.feedbackReceivedQuestionAnswers) &&
                sub.feedbackReceivedQuestionAnswers.length > 0;
            }).length;

            const groupSubmissionsCount = groupSubmissions.length;

            const groupSubmissionQuestionsAnsweredCount = groupSubmissions.filter(sub => {
              return Array.isArray(sub.submissionQuestionAnswers) &&
                sub.submissionQuestionAnswers.length > 0;
            }).length;

            // Chat sessions/messages for all group members in this project
            const groupChatSessions = await ChatSession.find({
              sender: { $in: memberIds },
              projectId: value.projectId
            });

            const groupConversationMessagesCount = groupChatSessions.reduce(
              (sum, session) => sum + (session.chatItems?.length || 0),
              0
            );

            // Count sessions in the current month only (for group)
            let groupConversationSessionsPerMonth = 0;
            const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

            if (groupChatSessions.length > 0) {
              groupChatSessions.forEach(session => {
                let sessionDate = session.startTime;
                
                // Fallback to first chat item timestamp if startTime not available
                if (!sessionDate && session.chatItems && session.chatItems.length > 0) {
                  sessionDate = session.chatItems[0].timestamp;
                }
                
                if (sessionDate) {
                  const sessionDateObj = new Date(sessionDate);
                  // Check if session is in current month
                  if (sessionDateObj >= currentMonthStart && sessionDateObj <= currentMonthEnd) {
                    groupConversationSessionsPerMonth++;
                  }
                }
              });
            }

            // Latest quiz score per member, then average
            let quizScoreLatestAverage = null;
            if (quizzes.length > 0 && memberIds.length > 0) {
              const allGroupQuizSubs = await QuizSubmission.find({
                quizId: { $in: quizIds },
                studentId: { $in: memberIds },
                isSubmitted: true
              }).sort({ submittedAt: -1 });

              const latestPerStudent = new Map();
              allGroupQuizSubs.forEach(qs => {
                if (!latestPerStudent.has(qs.studentId)) {
                  latestPerStudent.set(qs.studentId, qs);
                }
              });

              const latestScores = Array.from(latestPerStudent.values())
                .map(qs => qs.score)
                .filter(score => typeof score === 'number');

              if (latestScores.length > 0) {
                quizScoreLatestAverage = parseFloat(
                  (latestScores.reduce((a, b) => a + b, 0) / latestScores.length).toFixed(2)
                );
              }
            }

            return {
              groupId: group._id.toString(),
              groupName: group.name,
              memberCount: memberIds.length,
              tasksDone: groupTasksDone,
              tasksLate: groupTasksLate,
              totalTasks,
              averageScore: groupAverageScore,
              feedbackReceivedCount: groupFeedbackReceivedCount,
              feedbackOnFeedbackCount: groupFeedbackOnFeedbackCount,
              submissionsCount: groupSubmissionsCount,
              submissionQuestionsAnsweredCount: groupSubmissionQuestionsAnsweredCount,
              conversationMessagesCount: groupConversationMessagesCount,
              conversationSessionsPerMonth: groupConversationSessionsPerMonth,
              quizScoreLatestAverage
            };
          })
        );
      }
    }

    res.status(200).json({
      success: true,
      data: {
        projectId: value.projectId,
        studentId: targetStudentId,
        scope: scope,
        ...(scope === 'individual' || scope === 'both' ? { individualMetrics } : {}),
        ...(scope === 'group' || scope === 'both' ? { groupMetrics } : {})
      }
    });
  } catch (error) {
    console.error('❌ Error calculating student progress metrics:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate student progress metrics',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * Calculate class feedback uptake
 */
async function calculateClassFeedbackUptake(studentIds, submissions, windowStart, windowEnd) {
  const windowSubmissions = submissions.filter(s => {
    const subDate = new Date(s.datetime);
    return subDate >= windowStart && subDate <= windowEnd;
  });

  let totalImprovement = 0;
  let improvementCount = 0;

  for (const studentId of studentIds) {
    const studentSubmissions = windowSubmissions.filter(s => s.studentId === studentId);
    const uptake = calculateFeedbackUptakeScore(studentSubmissions, windowStart, windowEnd);
    if (uptake && uptake.uptakeScore !== null && uptake.uptakeScore !== undefined) {
      totalImprovement += uptake.uptakeScore;
      improvementCount++;
    }
  }

  return {
    averageImprovementRate: improvementCount > 0 ? parseFloat((totalImprovement / improvementCount).toFixed(2)) : 0,
    studentCount: improvementCount
  };
}

/**
 * Calculate LO performance with boxplot data (AGGREGATED - all data)
 */
async function calculateLOPerformanceAggregated(projectId, studentId = null) {
  const loMapping = await LOMapping.findOne({ projectId: projectId });
  if (!loMapping || !loMapping.mappings || loMapping.mappings.length === 0) {
    return [];
  }

  const tasks = await Task.find({ projectId: projectId });

  // Get all submissions (no window filtering)
  const query = {
    taskId: { $in: tasks.map(t => t._id) }
  };
  if (studentId) {
    query.studentId = studentId;
  }
  const submissions = await Submission.find(query);

  const loResults = [];

  for (const mapping of loMapping.mappings) {
    const lo = mapping.learningObjective;
    const taskIds = mapping.taskIds.map(id => id.toString());
    
    // Get submissions for tasks mapped to this LO
    const loSubmissions = submissions.filter(s => 
      taskIds.includes(s.taskId.toString())
    );

    // Extract conceptMasteryScore for each submission
    const scores = loSubmissions
      .map(s => getLatestScore(s, 'conceptMasteryScore'))
      .filter(score => score !== null && typeof score === 'number');

    // Only include LOs with actual data (filter out null boxplots)
    if (scores.length > 0) {
      loResults.push({
        learningObjective: lo,
        boxplot: calculateBoxplot(scores),
        studentCount: new Set(loSubmissions.map(s => s.studentId)).size,
        submissionCount: loSubmissions.length
      });
    }
  }

  return loResults;
}

/**
 * Calculate task performance (AGGREGATED - all data)
 */
async function calculateTaskPerformanceAggregated(projectId, studentId = null) {
  const tasks = await Task.find({ projectId: projectId }).sort({ createdAt: 1 });

  const query = {
    taskId: { $in: tasks.map(t => t._id) }
  };
  if (studentId) {
    query.studentId = studentId;
  }
  const submissions = await Submission.find(query);

  const taskResults = [];

  for (const task of tasks) {
    const taskSubmissions = submissions.filter(s => 
      s.taskId.toString() === task._id.toString()
    );

    const taskQualityScores = taskSubmissions
      .map(s => getLatestScore(s, 'taskQualityScore'))
      .filter(score => score !== null && typeof score === 'number');

    const reflectionScores = taskSubmissions
      .map(s => getLatestScore(s, 'reflectionScore'))
      .filter(score => score !== null && typeof score === 'number');

    taskResults.push({
      taskId: task._id.toString(),
      taskTitle: task.taskTitle || task.keyword,
      averageTaskQuality: taskQualityScores.length > 0
        ? parseFloat((taskQualityScores.reduce((a, b) => a + b, 0) / taskQualityScores.length).toFixed(2))
        : null,
      averageReflection: reflectionScores.length > 0
        ? parseFloat((reflectionScores.reduce((a, b) => a + b, 0) / reflectionScores.length).toFixed(2))
        : null,
      submissionCount: taskSubmissions.length,
      studentCount: new Set(taskSubmissions.map(s => s.studentId)).size
    });
  }

  return taskResults;
}

/**
 * Calculate stakeholder interaction metrics (AGGREGATED - all data)
 */
async function calculateStakeholderInteractionAggregated(projectId, studentId = null) {
  const query = {
    projectId: projectId
  };
  if (studentId) {
    query.sender = studentId;
  }

  const chatSessions = await ChatSession.find(query);

  // Group by student
  const studentSessions = new Map();

  chatSessions.forEach(session => {
    const sid = session.sender;
    if (!studentSessions.has(sid)) {
      studentSessions.set(sid, []);
    }
    studentSessions.get(sid).push(session);
  });

  const studentMetrics = [];

  studentSessions.forEach((sessions, sid) => {
    let totalDuration = 0;
    let totalChatItems = 0;
    let validSessions = 0;

    sessions.forEach(session => {
      totalChatItems += session.chatItems?.length || 0;

      // Calculate duration
      if (session.endTime && session.startTime) {
        totalDuration += new Date(session.endTime) - new Date(session.startTime);
        validSessions++;
      } else if (session.chatItems && session.chatItems.length > 0) {
        // Estimate duration from chat items
        const firstItem = session.chatItems[0];
        const lastItem = session.chatItems[session.chatItems.length - 1];
        if (firstItem.timestamp && lastItem.timestamp) {
          totalDuration += new Date(lastItem.timestamp) - new Date(firstItem.timestamp);
          validSessions++;
        }
      }
    });

    studentMetrics.push({
      studentId: sid,
      sessionCount: sessions.length,
      averageSessionLength: validSessions > 0 
        ? parseFloat((totalDuration / validSessions / 1000 / 60).toFixed(2)) // in minutes
        : 0,
      averageChatItemsPerSession: sessions.length > 0
        ? parseFloat((totalChatItems / sessions.length).toFixed(2))
        : 0,
      totalChatItems: totalChatItems
    });
  });

  // Calculate class averages
  if (studentMetrics.length > 0) {
    const avgSessionCount = studentMetrics.reduce((sum, m) => sum + m.sessionCount, 0) / studentMetrics.length;
    const avgSessionLength = studentMetrics.reduce((sum, m) => sum + m.averageSessionLength, 0) / studentMetrics.length;
    const avgChatItems = studentMetrics.reduce((sum, m) => sum + m.averageChatItemsPerSession, 0) / studentMetrics.length;

    return {
      classAverage: {
        averageSessionCount: parseFloat(avgSessionCount.toFixed(2)),
        averageSessionLength: parseFloat(avgSessionLength.toFixed(2)),
        averageChatItemsPerSession: parseFloat(avgChatItems.toFixed(2))
      },
      studentMetrics: studentId ? studentMetrics.filter(m => m.studentId === studentId) : studentMetrics,
      totalStudents: studentSessions.size
    };
  }

  return {
    classAverage: {
      averageSessionCount: 0,
      averageSessionLength: 0,
      averageChatItemsPerSession: 0
    },
    studentMetrics: [],
    totalStudents: 0
  };
}

/**
 * Calculate quiz question performance (AGGREGATED - all data)
 */
async function calculateQuizQuestionPerformanceAggregated(projectId, studentId = null) {
  const quizzes = await Quiz.find({ projectId: projectId });
  if (quizzes.length === 0) return [];

  const query = {
    quizId: { $in: quizzes.map(q => q._id) }
  };
  if (studentId) {
    query.studentId = studentId;
  }

  const quizSubmissions = await QuizSubmission.find(query);

  const questionPerformance = [];

  quizzes.forEach(quiz => {
    const quizSubs = quizSubmissions.filter(qs => 
      qs.quizId.toString() === quiz._id.toString()
    );

    if (quizSubs.length === 0) return;

    quiz.questions.forEach((question, qIdx) => {
      const questionId = question.id || `q${qIdx}`;
      let correctCount = 0;
      let totalAnswers = 0;
      const answerDistribution = {};

      quizSubs.forEach(sub => {
        if (sub.answers && sub.answers[questionId] !== undefined) {
          totalAnswers++;
          const answer = sub.answers[questionId];

          // Track answer distribution
          if (!answerDistribution[answer]) {
            answerDistribution[answer] = 0;
          }
          answerDistribution[answer]++;

          // Check if correct
          if (answer === question.correctAnswer) {
            correctCount++;
          }
        }
      });

      if (totalAnswers > 0) {
        questionPerformance.push({
          quizId: quiz._id.toString(),
          quizName: quiz.name || 'Unnamed Quiz',
          questionId: questionId,
          question: question.question,
          averageScore: parseFloat((correctCount / totalAnswers * 100).toFixed(2)), // percentage
          correctAnswerRate: parseFloat((correctCount / totalAnswers).toFixed(2)),
          totalAnswers: totalAnswers,
          answerDistribution: answerDistribution,
          correctAnswer: question.correctAnswer
        });
      }
    });
  });

  return questionPerformance;
}

/**
 * Calculate concept performance with boxplot (AGGREGATED - all data)
 */
async function calculateConceptPerformanceAggregated(projectId, studentId = null) {
  const tasks = await Task.find({ projectId: projectId });

  const query = {
    taskId: { $in: tasks.map(t => t._id) }
  };
  if (studentId) {
    query.studentId = studentId;
  }

  const submissions = await Submission.find(query);

  // Extract all unique concepts
  const conceptMap = new Map();

  submissions.forEach(sub => {
    if (sub.feedbackHistory && sub.feedbackHistory.length > 0) {
      sub.feedbackHistory.forEach(feedback => {
        if (feedback.concept && feedback.concept.trim() !== '') {
          const concept = feedback.concept.trim();
          if (!conceptMap.has(concept)) {
            conceptMap.set(concept, []);
          }
          // Get conceptMasteryScore for this feedback entry
          if (typeof feedback.conceptMasteryScore === 'number') {
            conceptMap.get(concept).push({
              score: feedback.conceptMasteryScore,
              studentId: sub.studentId,
              submissionId: sub._id.toString()
            });
          }
        }
      });
    }
  });

  const conceptResults = [];

  conceptMap.forEach((scores, concept) => {
    const scoreValues = scores.map(s => s.score);
    if (scoreValues.length > 0) {
      conceptResults.push({
        concept: concept,
        boxplot: calculateBoxplot(scoreValues),
        studentCount: new Set(scores.map(s => s.studentId)).size,
        submissionCount: scores.length
      });
    }
  });

  // Sort by student count (most common concepts first)
  conceptResults.sort((a, b) => b.studentCount - a.studentCount);

  return conceptResults;
}

/**
 * Calculate class feedback uptake (AGGREGATED - all data)
 */
async function calculateClassFeedbackUptakeAggregated(projectId, studentId = null) {
  const tasks = await Task.find({ projectId: projectId });

  const query = {
    taskId: { $in: tasks.map(t => t._id) }
  };
  if (studentId) {
    query.studentId = studentId;
  }

  const submissions = await Submission.find(query);

  // Group submissions by taskId and studentId
  const submissionGroups = new Map();
  submissions.forEach(sub => {
    const key = `${sub.taskId}_${sub.studentId}`;
    if (!submissionGroups.has(key)) {
      submissionGroups.set(key, []);
    }
    submissionGroups.get(key).push(sub);
  });

  let improvementCount = 0;
  let totalComparisons = 0;
  const studentUptakeRates = [];

  submissionGroups.forEach((subs, key) => {
    // Sort by datetime
    subs.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

    let studentImprovements = 0;
    let studentComparisons = 0;

    for (let i = 0; i < subs.length - 1; i++) {
      const current = getLatestScore(subs[i], 'taskQualityScore');
      const next = getLatestScore(subs[i + 1], 'taskQualityScore');

      if (current !== null && next !== null && typeof current === 'number' && typeof next === 'number') {
        totalComparisons++;
        studentComparisons++;
        if (next > current) {
          improvementCount++;
          studentImprovements++;
        }
      }
    }

    if (studentComparisons > 0) {
      const studentRate = studentImprovements / studentComparisons;
      studentUptakeRates.push(studentRate);
    }
  });

  const classAverageUptake = totalComparisons > 0
    ? parseFloat((improvementCount / totalComparisons).toFixed(2))
    : 0;

  const averageStudentUptake = studentUptakeRates.length > 0
    ? parseFloat((studentUptakeRates.reduce((a, b) => a + b, 0) / studentUptakeRates.length).toFixed(2))
    : 0;

  return {
    classAverageImprovementRate: classAverageUptake,
    averageStudentUptakeRate: averageStudentUptake,
    improvementCount: improvementCount,
    totalComparisons: totalComparisons,
    studentsWithData: studentUptakeRates.length
  };
}

/**
 * Calculate engagement metrics (AGGREGATED - all data)
 */
async function calculateEngagementAggregated(projectId, studentId = null) {
  const ActionLog = require('../models/ActionLog');
  
  // Get all students in the project (from submissions)
  const tasks = await Task.find({ projectId: projectId });
  const submissions = await Submission.find({
    taskId: { $in: tasks.map(t => t._id) }
  });
  const allStudentIds = [...new Set(submissions.map(s => s.studentId))];

  const targetStudentIds = studentId ? [studentId] : allStudentIds;

  const studentEngagement = [];

  for (const sid of targetStudentIds) {
    // Get all actions for this student (no window filtering)
    const actions = await ActionLog.find({
      userId: sid,
      action: { $in: ['login', 'logout'] }
    }).sort({ timestamp: 1 });

    if (actions.length === 0) continue;

    // Group actions by sessionId
    const sessionMap = new Map();
    actions.forEach(action => {
      const sessionId = action.sessionId;
      if (!sessionMap.has(sessionId)) {
        sessionMap.set(sessionId, []);
      }
      sessionMap.get(sessionId).push(action);
    });

    const sessions = [];
    const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    const MIN_SESSION_DURATION = 60 * 1000; // 1 minute

    sessionMap.forEach((sessionActions, sessionId) => {
      sessionActions.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const firstAction = sessionActions[0];
      const lastAction = sessionActions[sessionActions.length - 1];
      const duration = new Date(lastAction.timestamp) - new Date(firstAction.timestamp);

      if (duration >= MIN_SESSION_DURATION) {
        sessions.push({
          sessionId: sessionId,
          startTime: firstAction.timestamp,
          endTime: lastAction.timestamp,
          duration: duration, // in milliseconds
          actionCount: sessionActions.length
        });
      }
    });

    if (sessions.length > 0) {
      const totalSessions = sessions.length;
      const avgDuration = sessions.reduce((sum, s) => sum + s.duration, 0) / totalSessions;
      const totalDuration = sessions.reduce((sum, s) => sum + s.duration, 0);

      studentEngagement.push({
        studentId: sid,
        sessionCount: totalSessions,
        averageSessionDuration: parseFloat((avgDuration / 1000 / 60).toFixed(2)), // in minutes
        totalSessionDuration: parseFloat((totalDuration / 1000 / 60).toFixed(2)), // in minutes
        totalActions: actions.length
      });
    }
  }

  // Calculate class averages
  if (studentEngagement.length > 0) {
    const avgSessionCount = studentEngagement.reduce((sum, e) => sum + e.sessionCount, 0) / studentEngagement.length;
    const avgSessionDuration = studentEngagement.reduce((sum, e) => sum + e.averageSessionDuration, 0) / studentEngagement.length;

    return {
      classAverage: {
        averageSessionCount: parseFloat(avgSessionCount.toFixed(2)),
        averageSessionDuration: parseFloat(avgSessionDuration.toFixed(2))
      },
      studentMetrics: studentId ? studentEngagement.filter(e => e.studentId === studentId) : studentEngagement,
      totalStudents: allStudentIds.length
    };
  }

  return {
    classAverage: {
      averageSessionCount: 0,
      averageSessionDuration: 0
    },
    studentMetrics: [],
    totalStudents: allStudentIds.length
  };
}

/**
 * Calculate engagement metrics
 */
async function calculateEngagement(studentIds, windowStart, windowEnd) {
  const ActionLog = require('../models/ActionLog');
  
  const actions = await ActionLog.find({
    userId: { $in: studentIds },
    action: { $in: ['login', 'logout'] },
    timestamp: { $gte: windowStart, $lte: windowEnd }
  }).sort({ timestamp: 1 });

  // Group actions by userId
  const userActions = new Map();
  studentIds.forEach(id => userActions.set(id.toString(), []));
  
  actions.forEach(action => {
    const userId = action.userId?.toString();
    if (userId && userActions.has(userId)) {
      userActions.get(userId).push(action);
    }
  });

  let totalSessions = 0;
  let totalDuration = 0;
  const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  const MIN_SESSION_DURATION = 60 * 1000; // 1 minute

  for (const [userId, userActionsList] of userActions.entries()) {
    const sessions = [];
    let currentSession = null;

    for (const action of userActionsList) {
      if (action.action === 'login') {
        if (currentSession && currentSession.loginTime) {
          // Close previous session if exists
          const duration = action.timestamp - currentSession.loginTime;
          if (duration >= MIN_SESSION_DURATION) {
            sessions.push({
              start: currentSession.loginTime,
              end: action.timestamp,
              duration: duration
            });
          }
        }
        currentSession = { loginTime: action.timestamp };
      } else if (action.action === 'logout' && currentSession && currentSession.loginTime) {
        const duration = action.timestamp - currentSession.loginTime;
        if (duration >= MIN_SESSION_DURATION) {
          sessions.push({
            start: currentSession.loginTime,
            end: action.timestamp,
            duration: duration
          });
        }
        currentSession = null;
      }
    }

    // Handle session timeout
    if (currentSession && currentSession.loginTime) {
      const lastAction = userActionsList[userActionsList.length - 1];
      if (lastAction) {
        const timeSinceLastAction = windowEnd - lastAction.timestamp;
        if (timeSinceLastAction > SESSION_TIMEOUT) {
          const duration = lastAction.timestamp - currentSession.loginTime;
          if (duration >= MIN_SESSION_DURATION) {
            sessions.push({
              start: currentSession.loginTime,
              end: lastAction.timestamp,
              duration: duration
            });
          }
        } else {
          const duration = windowEnd - currentSession.loginTime;
          if (duration >= MIN_SESSION_DURATION) {
            sessions.push({
              start: currentSession.loginTime,
              end: windowEnd,
              duration: duration
            });
          }
        }
      }
    }

    totalSessions += sessions.length;
    totalDuration += sessions.reduce((sum, s) => sum + s.duration, 0);
  }

  return {
    averageActiveSessions: studentIds.length > 0 ? parseFloat((totalSessions / studentIds.length).toFixed(2)) : 0,
    averageSessionDuration: totalSessions > 0 ? parseFloat((totalDuration / totalSessions).toFixed(2)) : 0,
    totalSessions: totalSessions
  };
}

/**
 * GET /api/v1/student-metrics/windowed
 * Get windowed performance metrics for a student or class
 */
router.get('/windowed', isOptionalAuth, async (req, res) => {
  try {
    const { error, value } = windowedMetricsSchema.validate(req.query);
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

    const project = await Project.findById(value.projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const tasks = await Task.find({ projectId: value.projectId });
    
    // Determine default date range if not provided
    let startDate = value.startDate;
    let endDate = value.endDate;
    
    if (!startDate || !endDate) {
      // Get earliest task creation and latest deadline
      if (tasks.length > 0) {
        const earliestTask = tasks.reduce((earliest, task) => 
          (!earliest || task.createdAt < earliest.createdAt) ? task : earliest
        );
        const latestDeadline = tasks.reduce((latest, task) => 
          (!latest || task.submissionDeadline > latest.submissionDeadline) ? task : latest
        );
        
        if (!startDate) {
          startDate = earliestTask.createdAt || new Date();
        }
        if (!endDate) {
          endDate = latestDeadline.submissionDeadline || new Date();
        }
      } else {
        // Fallback to current date range
        if (!startDate) startDate = new Date();
        if (!endDate) endDate = new Date();
      }
    }
    
    // Generate time windows
    let windows;
    try {
      windows = generateTimeWindows(
        value.windowType,
        startDate,
        endDate,
        tasks
      );
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }

    if (value.studentId) {
      // Student-level metrics
      const submissions = await Submission.find({
        studentId: value.studentId,
        taskId: { $in: tasks.map(t => t._id) }
      });

      const windowMetrics = await Promise.all(windows.map(async (window, windowIdx) => {
        // Filter submissions in this window
        const windowSubmissions = submissions.filter(s => {
          const subDate = new Date(s.datetime);
          return subDate >= window.windowStart && subDate <= window.windowEnd;
        });
        
        const metrics = {};
        
        // Score metrics
        metrics.taskQualityScore = calculateTaskQualityScore(
          submissions,
          window.windowStart,
          window.windowEnd
        );
        
        metrics.reflectionScore = calculateReflectionScore(
          submissions,
          window.windowStart,
          window.windowEnd
        );
        
        metrics.criticalthinkingScore = calculateCriticalThinkingScore(
          submissions,
          window.windowStart,
          window.windowEnd
        );
        
        metrics.conceptMasteryScore = calculateConceptMasteryScore(
          submissions,
          window.windowStart,
          window.windowEnd
        );
        
        // Behavioral metrics
        metrics.behavioral = calculateBehavioralMetrics(
          submissions,
          tasks,
          window.windowStart,
          window.windowEnd
        );
        
        // Feedback uptake
        metrics.feedbackUptake = calculateFeedbackUptakeScore(
          submissions,
          window.windowStart,
          window.windowEnd
        );
        
        // Stakeholder engagement
        metrics.stakeholderEngagement = await calculateStakeholderEngagement(
          value.studentId,
          value.projectId,
          window.windowStart,
          window.windowEnd
        );
        
        // CLO mastery
        metrics.cloMastery = await calculateCLOMastery(
          value.studentId,
          value.projectId,
          window.windowStart,
          window.windowEnd
        );
        
        // Quiz performance
        metrics.quizPerformance = await calculateQuizPerformance(
          value.studentId,
          value.projectId,
          window.windowStart,
          window.windowEnd
        );
        
        return {
          ...window,
          metrics: metrics
        };
      }));

      // Calculate overall summary
      const allSubmissions = submissions;
      const summary = {
        overallTaskQuality: calculateTaskQualityScore(
          allSubmissions,
          new Date(0),
          new Date()
        )?.mean || null,
        overallReflection: calculateReflectionScore(
          allSubmissions,
          new Date(0),
          new Date()
        )?.mean || null,
        overallCriticalThinking: calculateCriticalThinkingScore(
          allSubmissions,
          new Date(0),
          new Date()
        )?.mean || null,
        overallConceptMastery: calculateConceptMasteryScore(
          allSubmissions,
          new Date(0),
          new Date()
        )?.mean || null,
        totalSubmissions: allSubmissions.length,
        averageTimeliness: calculateBehavioralMetrics(
          allSubmissions,
          tasks,
          new Date(0),
          new Date()
        ).timelinessRate
      };

      res.status(200).json({
        success: true,
        data: {
          studentId: value.studentId,
          projectId: value.projectId,
          windowType: value.windowType,
          windows: windowMetrics,
          summary: summary
        }
      });
    } else {
      // Class-level metrics
      const allSubmissions = await Submission.find({
        taskId: { $in: tasks.map(t => t._id) }
      });

      const studentIds = [...new Set(allSubmissions.map(s => s.studentId))];

      const windowMetrics = await Promise.all(windows.map(async (window) => {
        // Collect metrics for all students in this window
        const studentMetrics = [];
        
        for (const studentId of studentIds) {
          const studentSubmissions = allSubmissions.filter(s => 
            s.studentId === studentId
          );
          
          const taskQuality = calculateTaskQualityScore(
            studentSubmissions,
            window.windowStart,
            window.windowEnd
          );
          
          const reflection = calculateReflectionScore(
            studentSubmissions,
            window.windowStart,
            window.windowEnd
          );
          
          const criticalThinking = calculateCriticalThinkingScore(
            studentSubmissions,
            window.windowStart,
            window.windowEnd
          );
          
          const conceptMastery = calculateConceptMasteryScore(
            studentSubmissions,
            window.windowStart,
            window.windowEnd
          );
          
          if (taskQuality || reflection || criticalThinking || conceptMastery) {
            studentMetrics.push({
              studentId: studentId,
              taskQualityScore: taskQuality?.mean,
              reflectionScore: reflection?.mean,
              criticalthinkingScore: criticalThinking?.mean,
              conceptMasteryScore: conceptMastery?.mean
            });
          }
        }
        
        // Calculate class-level statistics
        const taskQualityScores = studentMetrics
          .map(m => m.taskQualityScore)
          .filter(s => s !== null && s !== undefined);
        
        const reflectionScores = studentMetrics
          .map(m => m.reflectionScore)
          .filter(s => s !== null && s !== undefined);
        
        const criticalThinkingScores = studentMetrics
          .map(m => m.criticalthinkingScore)
          .filter(s => s !== null && s !== undefined);
        
        const conceptMasteryScores = studentMetrics
          .map(m => m.conceptMasteryScore)
          .filter(s => s !== null && s !== undefined);
        
        const classMetrics = {};
        
        if (taskQualityScores.length > 0) {
          classMetrics.taskQualityScore = calculateStats(taskQualityScores);
        }
        
        if (reflectionScores.length > 0) {
          classMetrics.reflectionScore = calculateStats(reflectionScores);
        }
        
        if (criticalThinkingScores.length > 0) {
          classMetrics.criticalthinkingScore = calculateStats(criticalThinkingScores);
        }
        
        if (conceptMasteryScores.length > 0) {
          classMetrics.conceptMasteryScore = calculateStats(conceptMasteryScores);
        }
        
        // Behavioral metrics for class
        const windowSubmissions = allSubmissions.filter(s => {
          const subDate = new Date(s.datetime);
          return subDate >= window.windowStart && subDate <= window.windowEnd;
        });
        
        const behavioral = calculateBehavioralMetrics(
          windowSubmissions,
          tasks,
          window.windowStart,
          window.windowEnd
        );
        
        return {
          ...window,
          classMetrics: classMetrics,
          behavioral: behavioral,
          studentCount: studentIds.length,
          submissionCount: windowSubmissions.length
        };
      }));

      res.status(200).json({
        success: true,
        data: {
          projectId: value.projectId,
          windowType: value.windowType,
          windows: windowMetrics,
          totalStudents: studentIds.length
        }
      });
    }
  } catch (error) {
    console.error('❌ Error calculating windowed metrics:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate windowed metrics',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/student-metrics/progress-masterview
 * Get consolidated progress masterview metrics for class or student
 * Returns: LO performance, Task performance, Stakeholder interaction, Quiz scores, 
 *          Concepts, Feedback uptake, and Engagement metrics
 * NOTE: Aggregates ALL data so far (no window filtering)
 */
router.get('/progress-masterview', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      projectId: Joi.string().required().trim().min(1),
      studentId: Joi.string().optional().trim(),
      userName: Joi.string().optional().trim(),
      windowType: Joi.string().valid('weekly', 'monthly').required()
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

    const project = await Project.findById(value.projectId);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Calculate all metrics in parallel (AGGREGATED - all data, no window filtering)
    const [
      loPerformance,
      taskPerformance,
      stakeholderInteraction,
      quizQuestionPerformance,
      conceptPerformance,
      feedbackUptake,
      engagement
    ] = await Promise.all([
      calculateLOPerformanceAggregated(value.projectId, value.studentId),
      calculateTaskPerformanceAggregated(value.projectId, value.studentId),
      calculateStakeholderInteractionAggregated(value.projectId, value.studentId),
      calculateQuizQuestionPerformanceAggregated(value.projectId, value.studentId),
      calculateConceptPerformanceAggregated(value.projectId, value.studentId),
      calculateClassFeedbackUptakeAggregated(value.projectId, value.studentId),
      calculateEngagementAggregated(value.projectId, value.studentId)
    ]);

    // If student view, also get class averages for comparison
    let classAverages = null;
    if (value.studentId) {
      const [
        classLO,
        classTask,
        classStakeholder,
        classQuiz,
        classConcept,
        classUptake,
        classEngagement
      ] = await Promise.all([
        calculateLOPerformanceAggregated(value.projectId, null),
        calculateTaskPerformanceAggregated(value.projectId, null),
        calculateStakeholderInteractionAggregated(value.projectId, null),
        calculateQuizQuestionPerformanceAggregated(value.projectId, null),
        calculateConceptPerformanceAggregated(value.projectId, null),
        calculateClassFeedbackUptakeAggregated(value.projectId, null),
        calculateEngagementAggregated(value.projectId, null)
      ]);

      classAverages = {
        loPerformance: classLO,
        taskPerformance: classTask,
        stakeholderInteraction: classStakeholder,
        quizQuestionPerformance: classQuiz,
        conceptPerformance: classConcept,
        feedbackUptake: classUptake,
        engagement: classEngagement
      };
    }

    res.status(200).json({
      success: true,
      data: {
        projectId: value.projectId,
        windowType: value.windowType,
        studentId: value.studentId || null,
        viewType: value.studentId ? 'student' : 'class',
        metrics: {
          loPerformance: loPerformance || [],
          taskPerformance: taskPerformance || [],
          stakeholderInteraction: stakeholderInteraction || {
            classAverage: { averageSessionCount: 0, averageSessionLength: 0, averageChatItemsPerSession: 0 },
            studentMetrics: [],
            totalStudents: 0
          },
          quizQuestionPerformance: quizQuestionPerformance || [],
          conceptPerformance: conceptPerformance || [],
          feedbackUptake: feedbackUptake || {
            classAverageImprovementRate: 0,
            averageStudentUptakeRate: 0,
            improvementCount: 0,
            totalComparisons: 0,
            studentsWithData: 0
          },
          engagement: engagement || {
            classAverage: { averageSessionCount: 0, averageSessionDuration: 0 },
            studentMetrics: [],
            totalStudents: 0
          }
        },
        classAverages: classAverages // Only present for student view
      }
    });
  } catch (error) {
    console.error('❌ Error calculating progress masterview:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate progress masterview',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/student-metrics/progress-masterview/grouped
 * Get grouped progress metrics
 */
router.get('/progress-masterview/grouped', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      courseId: Joi.string().required().trim().min(1),
      projectId: Joi.string().optional().trim(),
      groupId: Joi.string().optional().trim(),
      windowType: Joi.string().valid('weekly', 'monthly').required(),
      viewType: Joi.string().valid('class', 'student', 'group').required()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    if (!mongoose.Types.ObjectId.isValid(value.courseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid courseId format'
      });
    }

    if (value.projectId && !mongoose.Types.ObjectId.isValid(value.projectId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid projectId format'
      });
    }

    // Get groups
    const groupQuery = {
      courseId: value.courseId,
      isActive: true
    };

    if (value.projectId) {
      groupQuery.projectId = value.projectId;
    } else {
      groupQuery.$or = [
        { projectId: null },
        { projectId: { $exists: false } }
      ];
    }

    if (value.groupId) {
      if (!mongoose.Types.ObjectId.isValid(value.groupId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid groupId format'
        });
      }
      groupQuery._id = value.groupId;
    }

    const groups = await StudentGroup.find(groupQuery);
    
    if (groups.length === 0) {
      return res.status(200).json({
        success: true,
        viewType: 'group',
        data: {
          summary: {
            totalGroups: 0,
            totalStudents: 0,
            averageGroupSize: 0
          },
          groups: []
        }
      });
    }

    // Get project for each group to calculate metrics
    let projectId = value.projectId;
    if (!projectId && groups.length > 0 && groups[0].projectId) {
      projectId = groups[0].projectId.toString();
    }

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: 'ProjectId is required for grouped metrics'
      });
    }

    // Calculate metrics for each group
    const groupMetrics = await Promise.all(
      groups.map(async (group) => {
        // Get all submissions for students in this group
        const submissions = await Submission.find({
          taskId: { $in: await Task.find({ projectId: projectId }).distinct('_id') },
          studentId: { $in: group.studentIds }
        });

        // Calculate aggregated metrics for the group
        const taskIds = [...new Set(submissions.map(s => s.taskId.toString()))];
        const totalTasks = await Task.countDocuments({ projectId: projectId });
        const completedTasks = taskIds.length;

        // Aggregate scores from feedback history
        const allTaskQualityScores = [];
        const allReflectionScores = [];
        const allCriticalthinkingScores = [];
        const allConceptMasteryScores = [];

        submissions.forEach(sub => {
          if (sub.feedbackHistory && sub.feedbackHistory.length > 0) {
            const latest = sub.feedbackHistory[sub.feedbackHistory.length - 1];
            if (typeof latest.taskQualityScore === 'number') {
              allTaskQualityScores.push(latest.taskQualityScore);
            }
            if (typeof latest.reflectionScore === 'number') {
              allReflectionScores.push(latest.reflectionScore);
            }
            if (typeof latest.criticalthinkingScore === 'number') {
              allCriticalthinkingScores.push(latest.criticalthinkingScore);
            }
            if (typeof latest.conceptMasteryScore === 'number') {
              allConceptMasteryScores.push(latest.conceptMasteryScore);
            }
          }
        });

        const averageTaskQualityScore = allTaskQualityScores.length > 0
          ? allTaskQualityScores.reduce((sum, s) => sum + s, 0) / allTaskQualityScores.length
          : null;
        const averageReflectionScore = allReflectionScores.length > 0
          ? allReflectionScores.reduce((sum, s) => sum + s, 0) / allReflectionScores.length
          : null;
        const averageCriticalThinkingScore = allCriticalthinkingScores.length > 0
          ? allCriticalthinkingScores.reduce((sum, s) => sum + s, 0) / allCriticalthinkingScores.length
          : null;
        const averageConceptMasteryScore = allConceptMasteryScores.length > 0
          ? allConceptMasteryScores.reduce((sum, s) => sum + s, 0) / allConceptMasteryScores.length
          : null;

        // Get student names
        const studentMap = {};
        const objectIdArray = group.studentIds.filter(id => mongoose.Types.ObjectId.isValid(id));
        const usernameArray = group.studentIds.filter(id => !mongoose.Types.ObjectId.isValid(id));

        if (objectIdArray.length > 0) {
          const usersById = await User.find({ 
            _id: { $in: objectIdArray.map(id => new mongoose.Types.ObjectId(id)) }
          }).select('_id username fullName').lean();
          usersById.forEach(user => {
            studentMap[user._id.toString()] = user.fullName || user.username;
          });
        }

        if (usernameArray.length > 0) {
          const usersByUsername = await User.find({ 
            username: { $in: usernameArray }
          }).select('_id username fullName').lean();
          usersByUsername.forEach(user => {
            studentMap[user.username] = user.fullName || user.username;
          });
        }

        const studentNames = group.studentIds.map(id => studentMap[id] || id);

        // Calculate timeline data (simplified - can be enhanced)
        const timelineData = [];
        const dateMap = {};
        submissions.forEach(sub => {
          const date = new Date(sub.datetime).toISOString().split('T')[0];
          if (!dateMap[date]) {
            dateMap[date] = {
              date: date,
              submissionsCount: 0,
              taskQualityScores: [],
              reflectionScores: []
            };
          }
          dateMap[date].submissionsCount++;
          if (sub.feedbackHistory && sub.feedbackHistory.length > 0) {
            const latest = sub.feedbackHistory[sub.feedbackHistory.length - 1];
            if (typeof latest.taskQualityScore === 'number') {
              dateMap[date].taskQualityScores.push(latest.taskQualityScore);
            }
            if (typeof latest.reflectionScore === 'number') {
              dateMap[date].reflectionScores.push(latest.reflectionScore);
            }
          }
        });

        Object.values(dateMap).forEach(day => {
          timelineData.push({
            date: day.date,
            taskQualityScore: day.taskQualityScores.length > 0
              ? day.taskQualityScores.reduce((sum, s) => sum + s, 0) / day.taskQualityScores.length
              : null,
            reflectionScore: day.reflectionScores.length > 0
              ? day.reflectionScores.reduce((sum, s) => sum + s, 0) / day.reflectionScores.length
              : null,
            submissionsCount: day.submissionsCount
          });
        });

        timelineData.sort((a, b) => a.date.localeCompare(b.date));

        return {
          groupId: group._id.toString(),
          groupName: group.name,
          studentIds: group.studentIds,
          studentNames: studentNames,
          metrics: {
            averageTaskQualityScore: averageTaskQualityScore ? parseFloat(averageTaskQualityScore.toFixed(2)) : null,
            averageReflectionScore: averageReflectionScore ? parseFloat(averageReflectionScore.toFixed(2)) : null,
            averageCriticalThinkingScore: averageCriticalThinkingScore ? parseFloat(averageCriticalThinkingScore.toFixed(2)) : null,
            averageConceptMasteryScore: averageConceptMasteryScore ? parseFloat(averageConceptMasteryScore.toFixed(2)) : null,
            totalSubmissions: submissions.length,
            completedTasks: completedTasks,
            totalTasks: totalTasks,
            completionRate: totalTasks > 0 ? parseFloat((completedTasks / totalTasks).toFixed(2)) : 0,
            averageResponseTime: null, // Can be calculated if needed
            averageFeedbackTime: null // Can be calculated if needed
          },
          timelineData: timelineData
        };
      })
    );

    // Calculate summary
    const totalStudents = new Set();
    groups.forEach(group => {
      group.studentIds.forEach(id => totalStudents.add(id));
    });

    const summary = {
      totalGroups: groups.length,
      totalStudents: totalStudents.size,
      averageGroupSize: groups.length > 0 ? parseFloat((totalStudents.size / groups.length).toFixed(2)) : 0
    };

    res.status(200).json({
      success: true,
      viewType: 'group',
      data: {
        summary: summary,
        groups: groupMetrics
      }
    });
  } catch (error) {
    console.error('❌ Error calculating grouped progress masterview:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate grouped progress masterview',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * GET /api/v1/student-metrics/progress-detail/grouped
 * Get detailed progress metrics for a specific group
 */
router.get('/progress-detail/grouped', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      courseId: Joi.string().required().trim().min(1),
      projectId: Joi.string().optional().trim(),
      groupId: Joi.string().required().trim(),
      windowType: Joi.string().valid('weekly', 'monthly').required()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        error: error.details[0].message
      });
    }

    if (!mongoose.Types.ObjectId.isValid(value.courseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid courseId format'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(value.groupId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid groupId format'
      });
    }

    const group = await StudentGroup.findById(value.groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Get project
    let projectId = value.projectId;
    if (!projectId && group.projectId) {
      projectId = group.projectId.toString();
    }

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: 'ProjectId is required for grouped metrics'
      });
    }

    // Get all tasks for the project
    const tasks = await Task.find({ projectId: projectId });
    const taskIds = tasks.map(t => t._id);

    // Get all submissions for students in this group
    const submissions = await Submission.find({
      taskId: { $in: taskIds },
      studentId: { $in: group.studentIds }
    });

    // Calculate aggregated metrics
    const totalSubmissions = submissions.length;
    const completedTasks = [...new Set(submissions.map(s => s.taskId.toString()))].length;
    const totalTasks = tasks.length;

    // Aggregate scores
    const allTaskQualityScores = [];
    const allReflectionScores = [];
    const allCriticalthinkingScores = [];
    const allConceptMasteryScores = [];

    submissions.forEach(sub => {
      if (sub.feedbackHistory && sub.feedbackHistory.length > 0) {
        const latest = sub.feedbackHistory[sub.feedbackHistory.length - 1];
        if (typeof latest.taskQualityScore === 'number') {
          allTaskQualityScores.push(latest.taskQualityScore);
        }
        if (typeof latest.reflectionScore === 'number') {
          allReflectionScores.push(latest.reflectionScore);
        }
        if (typeof latest.criticalthinkingScore === 'number') {
          allCriticalthinkingScores.push(latest.criticalthinkingScore);
        }
        if (typeof latest.conceptMasteryScore === 'number') {
          allConceptMasteryScores.push(latest.conceptMasteryScore);
        }
      }
    });

    const averageTaskQualityScore = allTaskQualityScores.length > 0
      ? allTaskQualityScores.reduce((sum, s) => sum + s, 0) / allTaskQualityScores.length
      : null;
    const averageReflectionScore = allReflectionScores.length > 0
      ? allReflectionScores.reduce((sum, s) => sum + s, 0) / allReflectionScores.length
      : null;
    const averageCriticalThinkingScore = allCriticalthinkingScores.length > 0
      ? allCriticalthinkingScores.reduce((sum, s) => sum + s, 0) / allCriticalthinkingScores.length
      : null;
    const averageConceptMasteryScore = allConceptMasteryScores.length > 0
      ? allConceptMasteryScores.reduce((sum, s) => sum + s, 0) / allConceptMasteryScores.length
      : null;

    // Get student names
    const studentMap = {};
    const objectIdArray = group.studentIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    const usernameArray = group.studentIds.filter(id => !mongoose.Types.ObjectId.isValid(id));

    if (objectIdArray.length > 0) {
      const usersById = await User.find({ 
        _id: { $in: objectIdArray.map(id => new mongoose.Types.ObjectId(id)) }
      }).select('_id username fullName').lean();
      usersById.forEach(user => {
        studentMap[user._id.toString()] = user.fullName || user.username;
      });
    }

    if (usernameArray.length > 0) {
      const usersByUsername = await User.find({ 
        username: { $in: usernameArray }
      }).select('_id username fullName').lean();
      usersByUsername.forEach(user => {
        studentMap[user.username] = user.fullName || user.username;
      });
    }

    const studentNames = group.studentIds.map(id => studentMap[id] || id);

    // Task breakdown
    const taskBreakdown = await Promise.all(
      tasks.map(async (task) => {
        const taskSubmissions = submissions.filter(s => s.taskId.toString() === task._id.toString());
        const taskScores = [];
        const reflectionScores = [];

        taskSubmissions.forEach(sub => {
          if (sub.feedbackHistory && sub.feedbackHistory.length > 0) {
            const latest = sub.feedbackHistory[sub.feedbackHistory.length - 1];
            if (typeof latest.taskQualityScore === 'number') {
              taskScores.push(latest.taskQualityScore);
            }
            if (typeof latest.reflectionScore === 'number') {
              reflectionScores.push(latest.reflectionScore);
            }
          }
        });

        // Get individual student data for this task
        const studentData = [];
        for (const studentId of group.studentIds) {
          const studentSubmissions = taskSubmissions.filter(s => s.studentId === studentId);
          if (studentSubmissions.length > 0) {
            const latestSub = studentSubmissions.reduce((latest, sub) => {
              return new Date(sub.datetime) > new Date(latest.datetime) ? sub : latest;
            }, studentSubmissions[0]);

            let taskQualityScore = null;
            if (latestSub.feedbackHistory && latestSub.feedbackHistory.length > 0) {
              const latest = latestSub.feedbackHistory[latestSub.feedbackHistory.length - 1];
              if (typeof latest.taskQualityScore === 'number') {
                taskQualityScore = latest.taskQualityScore;
              }
            }

            studentData.push({
              studentId: studentId,
              studentName: studentMap[studentId] || studentId,
              submissionCount: studentSubmissions.length,
              taskQualityScore: taskQualityScore
            });
          }
        }

        return {
          taskId: task._id.toString(),
          taskTitle: task.taskTitle || '',
          submissionsCount: taskSubmissions.length,
          averageTaskQualityScore: taskScores.length > 0
            ? parseFloat((taskScores.reduce((sum, s) => sum + s, 0) / taskScores.length).toFixed(2))
            : null,
          averageReflectionScore: reflectionScores.length > 0
            ? parseFloat((reflectionScores.reduce((sum, s) => sum + s, 0) / reflectionScores.length).toFixed(2))
            : null,
          students: studentData
        };
      })
    );

    // Timeline data
    const timelineData = [];
    const dateMap = {};
    submissions.forEach(sub => {
      const date = new Date(sub.datetime).toISOString().split('T')[0];
      if (!dateMap[date]) {
        dateMap[date] = {
          date: date,
          metrics: {
            taskQualityScore: [],
            reflectionScore: [],
            submissionsCount: 0
          }
        };
      }
      dateMap[date].metrics.submissionsCount++;
      if (sub.feedbackHistory && sub.feedbackHistory.length > 0) {
        const latest = sub.feedbackHistory[sub.feedbackHistory.length - 1];
        if (typeof latest.taskQualityScore === 'number') {
          dateMap[date].metrics.taskQualityScore.push(latest.taskQualityScore);
        }
        if (typeof latest.reflectionScore === 'number') {
          dateMap[date].metrics.reflectionScore.push(latest.reflectionScore);
        }
      }
    });

    Object.values(dateMap).forEach(day => {
      timelineData.push({
        date: day.date,
        metrics: {
          taskQualityScore: day.metrics.taskQualityScore.length > 0
            ? parseFloat((day.metrics.taskQualityScore.reduce((sum, s) => sum + s, 0) / day.metrics.taskQualityScore.length).toFixed(2))
            : null,
          reflectionScore: day.metrics.reflectionScore.length > 0
            ? parseFloat((day.metrics.reflectionScore.reduce((sum, s) => sum + s, 0) / day.metrics.reflectionScore.length).toFixed(2))
            : null,
          submissionsCount: day.metrics.submissionsCount
        }
      });
    });

    timelineData.sort((a, b) => a.date.localeCompare(b.date));

    res.status(200).json({
      success: true,
      viewType: 'group',
      data: {
        groupId: group._id.toString(),
        groupName: group.name,
        studentIds: group.studentIds,
        studentNames: studentNames,
        metrics: {
          averageTaskQualityScore: averageTaskQualityScore ? parseFloat(averageTaskQualityScore.toFixed(2)) : null,
          averageReflectionScore: averageReflectionScore ? parseFloat(averageReflectionScore.toFixed(2)) : null,
          averageCriticalThinkingScore: averageCriticalThinkingScore ? parseFloat(averageCriticalThinkingScore.toFixed(2)) : null,
          averageConceptMasteryScore: averageConceptMasteryScore ? parseFloat(averageConceptMasteryScore.toFixed(2)) : null,
          totalSubmissions: totalSubmissions,
          completedTasks: completedTasks,
          totalTasks: totalTasks,
          completionRate: totalTasks > 0 ? parseFloat((completedTasks / totalTasks).toFixed(2)) : 0
        },
        taskBreakdown: taskBreakdown,
        timelineData: timelineData
      }
    });
  } catch (error) {
    console.error('❌ Error calculating grouped progress detail:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate grouped progress detail',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router;

