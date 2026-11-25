const mongoose = require('mongoose');

const versionSchema = new mongoose.Schema({
  at: { type: Date, required: true },
  by: { type: String, required: true, trim: true },
}, { _id: false });

const KINDS = [
  'requirements', 'stories', 'nfr', 'wbs', 'gantt', 'backlog', 'sprint',
  'commPlan', 'testPlan', 'usability', 'swot', 'stakeholders', 'charter',
  'interviewGuide', 'folderTree', 'prototype', 'reflection', 'review', 'retro',
];

/**
 * One live PRO1000 artefact per group and task.
 * versions records each save. Submissions keep their own frozen snapshot.
 */
const artifactSchema = new mongoose.Schema({
  courseId: { type: String, required: true, trim: true },
  groupId: { type: String, required: true, trim: true },
  taskId: { type: String, required: true, trim: true },
  kind: { type: String, required: true, enum: KINDS },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  versions: { type: [versionSchema], default: [] },
}, {
  collection: 'artefacts',
  timestamps: true,
});

artifactSchema.index({ courseId: 1, groupId: 1, taskId: 1 }, { unique: true });

const artifactSubmissionSchema = new mongoose.Schema({
  artifactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Artifact', required: true, index: true },
  attempt: { type: Number, required: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  submittedAt: { type: Date, required: true },
  members: { type: [String], default: [] },
  reflectionAnswers: { type: mongoose.Schema.Types.Mixed, default: {} },
  checks: { type: [mongoose.Schema.Types.Mixed], default: [] },
  feedback: { type: [mongoose.Schema.Types.Mixed], default: [] },
  status: { type: String, required: true, enum: ['submitted', 'approved', 'returned'], default: 'submitted' },
}, {
  collection: 'artefactsubmissions',
  timestamps: true,
});

artifactSubmissionSchema.index({ artifactId: 1, attempt: 1 }, { unique: true });

module.exports = {
  KINDS,
  Artifact: mongoose.model('Artifact', artifactSchema),
  ArtifactSubmission: mongoose.model('ArtifactSubmission', artifactSubmissionSchema),
};
