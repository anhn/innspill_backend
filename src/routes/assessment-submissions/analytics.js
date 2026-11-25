const express = require("express");
const mongoose = require("mongoose");
const Submission = require("../../models/Submission");
const Task = require("../../models/Task");
const Role = require("../../models/Role");
const { isOptionalAuth } = require("../../middleware/auth");
const {
  forbidIdentitySpoof,
  forbidStudentClassMetrics,
  isStaffRole,
  actingRole,
} = require("../../middleware/requestIdentity");
const Joi = require("joi");

const router = express.Router();

function assertAnalyticsAccess(req, res, value) {
  const target = value.studentId || value.userName;
  if (target) {
    if (forbidIdentitySpoof(req, res, target)) return false;
    return true;
  }
  if (!isStaffRole(actingRole(req))) {
    forbidStudentClassMetrics(req, res);
    return false;
  }
  return true;
}

router.get("/heatmap", isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      projectId: Joi.string().required().trim().min(1),
      userName: Joi.string().optional().trim(),
    });
    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid query parameters",
        error: error.details[0].message,
      });
    }
    if (!assertAnalyticsAccess(req, res, value)) return;
    if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid projectId format",
      });
    }

    const tasks = await Task.find({ projectId: value.projectId });
    const taskIds = tasks.map((t) => t._id);
    const submissions = await Submission.find({ taskId: { $in: taskIds } });
    const studentIds = [...new Set(submissions.map((s) => s.studentId))];

    const heatmap = [];
    for (const task of tasks) {
      for (const studentId of studentIds) {
        const submission = submissions.find(
          (s) =>
            s.taskId.toString() === task._id.toString() &&
            s.studentId === studentId,
        );
        heatmap.push({
          taskId: task._id.toString(),
          studentId,
          hasSubmission: !!submission,
          starScore: submission ? submission.starScore : null,
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        tasks: tasks.map((t) => ({
          id: t._id.toString(),
          taskTitle: t.taskTitle,
          keyword: t.keyword,
        })),
        students: studentIds,
        heatmap,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching heatmap:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch heatmap data",
      error: process.env.NODE_ENV !== "production" ? error.message : undefined,
    });
  }
});

router.get("/stakeholder-heatmap", isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      projectId: Joi.string().required().trim().min(1),
      userName: Joi.string().optional().trim(),
    });
    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid query parameters",
        error: error.details[0].message,
      });
    }
    if (!assertAnalyticsAccess(req, res, value)) return;
    if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid projectId format",
      });
    }

    const stakeholders = await Role.find({ projectId: value.projectId });
    const tasks = await Task.find({ projectId: value.projectId });
    const taskIds = tasks.map((t) => t._id);
    const submissions = await Submission.find({
      taskId: { $in: taskIds },
      stakeholderId: { $ne: null },
    });
    const studentIds = [...new Set(submissions.map((s) => s.studentId))];

    const heatmap = [];
    for (const stakeholder of stakeholders) {
      for (const studentId of studentIds) {
        const studentSubmissions = submissions.filter(
          (s) =>
            s.stakeholderId &&
            s.stakeholderId.toString() === stakeholder._id.toString() &&
            s.studentId === studentId,
        );
        const conversationCount = studentSubmissions.length;
        const totalConversationLength = studentSubmissions.reduce((sum, s) => {
          return sum + (s.conversationLog ? s.conversationLog.length : 0);
        }, 0);
        heatmap.push({
          stakeholderId: stakeholder._id.toString(),
          studentId,
          conversationCount,
          totalConversationLength,
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        stakeholders: stakeholders.map((s) => ({
          id: s._id.toString(),
          name: s.name,
        })),
        students: studentIds,
        heatmap,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching stakeholder heatmap:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch stakeholder heatmap data",
      error: process.env.NODE_ENV !== "production" ? error.message : undefined,
    });
  }
});

router.get("/progress", isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      projectId: Joi.string().required().trim().min(1),
      studentId: Joi.string().optional().trim(),
      userName: Joi.string().optional().trim(),
    });
    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid query parameters",
        error: error.details[0].message,
      });
    }
    if (!assertAnalyticsAccess(req, res, value)) return;
    if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid projectId format",
      });
    }

    const tasks = await Task.find({ projectId: value.projectId });
    const taskIds = tasks.map((t) => t._id);
    const submissionQuery = { taskId: { $in: taskIds } };
    if (value.studentId) {
      submissionQuery.studentId = value.studentId;
    }

    const submissions = await Submission.find(submissionQuery);
    const studentIds = [...new Set(submissions.map((s) => s.studentId))];
    const studentNames = {};
    submissions.forEach((s) => {
      if (!studentNames[s.studentId]) studentNames[s.studentId] = s.studentName;
    });

    const progressData = {};
    for (const studentId of studentIds) {
      progressData[studentId] = {};
      const studentSubmissions = submissions.filter(
        (s) => s.studentId === studentId,
      );
      studentSubmissions.forEach((submission) => {
        const date = submission.datetime.toISOString().split("T")[0];
        if (!progressData[studentId][date]) progressData[studentId][date] = 0;
        progressData[studentId][date]++;
      });
    }

    const students = studentIds.map((studentId) => {
      const progress = Object.keys(progressData[studentId] || {})
        .sort()
        .map((date) => {
          const dates = Object.keys(progressData[studentId] || {}).sort();
          const dateIndex = dates.indexOf(date);
          let completedTasks = 0;
          for (let i = 0; i <= dateIndex; i++) {
            completedTasks += progressData[studentId][dates[i]];
          }
          return { date, completedTasks };
        });
      return {
        studentId,
        studentName: studentNames[studentId],
        progress,
      };
    });

    res.status(200).json({
      success: true,
      data: { students },
    });
  } catch (error) {
    console.error("❌ Error fetching progress:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch progress data",
      error: process.env.NODE_ENV !== "production" ? error.message : undefined,
    });
  }
});

router.get("/timeline", isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      projectId: Joi.string().required().trim().min(1),
      studentId: Joi.string().optional().trim(),
      userName: Joi.string().optional().trim(),
    });
    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid query parameters",
        error: error.details[0].message,
      });
    }
    if (!assertAnalyticsAccess(req, res, value)) return;
    if (!mongoose.Types.ObjectId.isValid(value.projectId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid projectId format",
      });
    }

    const tasks = await Task.find({ projectId: value.projectId });
    const taskMap = {};
    tasks.forEach((t) => {
      taskMap[t._id.toString()] = t;
    });
    const taskIds = tasks.map((t) => t._id);

    const submissionQuery = { taskId: { $in: taskIds } };
    if (value.studentId) submissionQuery.studentId = value.studentId;

    const submissions = await Submission.find(submissionQuery).sort({
      datetime: 1,
    });

    const timeline = submissions.map((submission) => {
      const task = taskMap[submission.taskId.toString()];
      return {
        id: submission._id.toString(),
        taskId: submission.taskId.toString(),
        taskTitle: task ? task.taskTitle : null,
        taskKeyword: task ? task.keyword : "",
        studentId: submission.studentId,
        studentName: submission.studentName,
        datetime: submission.datetime,
        submissionDeadline: task ? task.submissionDeadline : null,
        isOnTime: task ? submission.datetime <= task.submissionDeadline : null,
        submissionQuestionAnswers: submission.submissionQuestionAnswers || [],
        feedbackReceivedQuestionAnswers:
          submission.feedbackReceivedQuestionAnswers || [],
        feedbackHistory: submission.feedbackHistory || [],
        starScoreHistory: submission.starScoreHistory || [],
        starScore: submission.starScore,
        feedback: submission.feedback,
      };
    });

    res.status(200).json({ success: true, data: timeline });
  } catch (error) {
    console.error("❌ Error fetching timeline:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch timeline data",
      error: process.env.NODE_ENV !== "production" ? error.message : undefined,
    });
  }
});

module.exports = router;