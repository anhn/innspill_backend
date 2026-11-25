const mongoose = require('mongoose');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Role = require('../models/Role');
const Quiz = require('../models/Quiz');
const Submission = require('../models/Submission');
const QuizSubmission = require('../models/QuizSubmission');
const Exercise = require('../models/Exercise');
const StudentGroup = require('../models/StudentGroup');

async function deleteProjectCascade(projectId) {
  const pid = new mongoose.Types.ObjectId(projectId);
  const taskIds = await Task.find({ projectId: pid }).distinct('_id');
  const quizIds = await Quiz.find({ projectId: pid }).distinct('_id');

  if (taskIds.length > 0) {
    await Submission.deleteMany({ taskId: { $in: taskIds } });
  }
  if (quizIds.length > 0) {
    await QuizSubmission.deleteMany({ quizId: { $in: quizIds } });
  }

  await Quiz.deleteMany({ projectId: pid });
  await Role.deleteMany({ projectId: pid });
  await Task.deleteMany({ projectId: pid });
  await StudentGroup.updateMany({ projectId: pid }, { isActive: false });
  await Project.findByIdAndDelete(pid);
}

async function deleteCourseCascade(courseId) {
  const cid = new mongoose.Types.ObjectId(courseId);
  const projects = await Project.find({ courseId: cid }).select('_id').lean();

  for (const project of projects) {
    await deleteProjectCascade(project._id);
  }

  await Exercise.deleteMany({ courseId: cid });
  await StudentGroup.deleteMany({ courseId: cid });
  await Project.deleteMany({ courseId: cid });
}

module.exports = {
  deleteProjectCascade,
  deleteCourseCascade
};
