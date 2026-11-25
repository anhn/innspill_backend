const mongoose = require('mongoose');

/**
 * Marks that a student has started a task before handing it in.
 * New collection. Existing tasks and submissions are not updated.
 */
const taskProgressSchema = new mongoose.Schema({
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
  },
  studentId: {
    type: String,
    required: true,
    trim: true,
  },
  startedAt: {
    type: Date,
    required: true,
  },
}, {
  collection: 'taskprogress',
  timestamps: true,
});

taskProgressSchema.index({ taskId: 1, studentId: 1 }, { unique: true });

const TaskProgress = mongoose.model('TaskProgress', taskProgressSchema);

module.exports = TaskProgress;
