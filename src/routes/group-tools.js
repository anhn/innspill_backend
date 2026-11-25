const express = require('express');
const mongoose = require('mongoose');
const Joi = require('joi');
const ReStudioSession = require('../models/ReStudioSession');
const ReviewRun = require('../models/ReviewRun');
const AcceptanceSession = require('../models/AcceptanceSession');
const LabReport = require('../models/LabReport');
const { Artifact, ArtifactSubmission, KINDS } = require('../models/Artifact');
const Role = require('../models/Role');
const StudentGroup = require('../models/StudentGroup');
const ChatSession = require('../models/ChatSession');
const Task = require('../models/Task');
const Course = require('../models/Course');
const Submission = require('../models/Submission');
const { getOpenAIClient, llmConfigured } = require('../services/openaiClient');
const { isOptionalAuth } = require('../middleware/auth');
const { constraintsFromPersona, constraintHit, personaReply } = require('../utils/reStudio');
const {
  unknownTools,
  precisionByTool,
  compareRuns,
  toCsv,
  toMarkdown,
  toSarif,
  toPdf,
} = require('../utils/review2027');
const { assembleReview } = require('../utils/reviewNormalise');
const { labChecks, labReady, sustainabilityView } = require('../utils/labs2027');
const { annotateAgentsMd } = require('../utils/agentsMd');
const { checksFor, coverageLinks } = require('../utils/pro1000Checks');

const router = express.Router();
const openai = llmConfigured() ? getOpenAIClient() : null;

const NAME_KEYS = new Set(['name', 'participantname', 'fullname', 'email', 'studentname']);

function nameKeys(value, path = '') {
  if (!value || typeof value !== 'object') return [];
  const found = [];
  for (const [key, child] of Object.entries(value)) {
    const here = path ? `${path}.${key}` : key;
    if (NAME_KEYS.has(key.toLowerCase())) found.push(here);
    else found.push(...nameKeys(child, here));
  }
  return found;
}

async function courseFor(groupId, explicit) {
  if (explicit) return String(explicit);
  if (!mongoose.Types.ObjectId.isValid(groupId)) return '';
  const group = await StudentGroup.findById(groupId).select('courseId').lean();
  return group && group.courseId ? String(group.courseId) : '';
}

function codeUrl(repo, commit, file, line) {
  const base = String(repo || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const path = /github\.com/i.test(base) ? 'blob' : '-/blob';
  return `${base}/${path}/${encodeURIComponent(String(commit || '').trim())}/${file}#L${line}`;
}

async function personaRole(personaId) {
  if (mongoose.Types.ObjectId.isValid(personaId)) {
    const byId = await Role.findById(personaId);
    if (byId) return byId;
  }
  return Role.findOne({ name: new RegExp(`^${personaId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
}

function formatInterview(session) {
  const pins = new Set(session.pins || []);
  return {
    id: session._id.toString(),
    courseId: session.courseId,
    groupId: session.groupId,
    personaId: session.persona,
    concluded: !session.open,
    turns: (session.turns || []).map((turn) => ({
      id: turn._id.toString(),
      at: turn.at,
      who: turn.speaker === 'student' ? 'student' : 'persona',
      text: turn.text,
      pinned: pins.has(turn._id.toString()),
    })),
    hits: session.hits || [],
    markers: session.markers || [],
  };
}

async function replyAsPersona(role, history, text) {
  if (!role) return { text: null, error: 'Stakeholder agent is not configured.' };
  return personaReply(openai, {
    persona: role.persona || '',
    message: text,
    history: history.map((turn) => ({ speaker: turn.speaker, text: turn.text })),
  });
}

router.get('/:groupId/interviews', isOptionalAuth, async (req, res) => {
  const sessions = await ReStudioSession.find({ groupId: req.params.groupId }).sort({ persona: 1 });
  return res.status(200).json({ success: true, data: sessions.map(formatInterview) });
});

router.get('/:groupId/interviews/:personaId/log', isOptionalAuth, async (req, res) => {
  const session = await ReStudioSession.findOne({ groupId: req.params.groupId, persona: req.params.personaId });
  if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
  const pins = new Set(session.pins || []);
  const lines = (session.turns || []).map((turn) => {
    const pinned = pins.has(turn._id.toString()) ? ' (pinned)' : '';
    return `[${new Date(turn.at).toISOString()}] ${turn.speaker}: ${turn.text}${pinned}`;
  });
  res.set('Content-Type', 'text/plain; charset=utf-8');
  return res.status(200).send([`RE Studio · ${session.persona}`, ...lines].join('\n'));
});

router.get('/:groupId/interviews/:personaId', isOptionalAuth, async (req, res) => {
  const session = await ReStudioSession.findOne({ groupId: req.params.groupId, persona: req.params.personaId });
  if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
  return res.status(200).json({ success: true, data: formatInterview(session) });
});

router.post('/:groupId/interviews/:personaId/turns', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      text: Joi.string().trim().min(1).required(),
      courseId: Joi.string().trim().optional(),
      studentId: Joi.string().trim().optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const role = await personaRole(req.params.personaId);
    if (!role) return res.status(404).json({ success: false, message: 'Persona not found' });
    const courseId = await courseFor(req.params.groupId, value.courseId);
    if (!courseId) return res.status(400).json({ success: false, message: 'courseId is required when the group has none' });

    let session = await ReStudioSession.findOne({ groupId: req.params.groupId, persona: req.params.personaId });
    if (!session) {
      session = new ReStudioSession({ courseId, groupId: req.params.groupId, persona: req.params.personaId });
    }
    if (!session.open) return res.status(409).json({ success: false, message: 'Session is concluded' });

    const constraints = constraintsFromPersona(role.persona);
    const hit = constraintHit(value.text, constraints, session.constraintHits);
    session.turns.push({ at: new Date(), speaker: 'student', text: value.text, constraintId: hit ? hit.id : undefined });
    const studentTurn = session.turns[session.turns.length - 1];
    session.markers.push({ kind: hit ? 'H' : 'F', at: studentTurn.at });
    if (hit) {
      session.constraintHits.push(hit.id);
      session.hits.push({ constraintId: hit.id, turnId: studentTurn._id.toString(), at: studentTurn.at });
    }

    const reply = await replyAsPersona(role, session.turns.slice(0, -1), value.text);
    if (reply.text) {
      session.turns.push({ at: new Date(), speaker: 'persona', text: reply.text });
    }
    await session.save();

    if (value.studentId && mongoose.Types.ObjectId.isValid(role._id)) {
      let chat = await ChatSession.findOne({ sender: value.studentId, stakeholderId: role._id, endTime: null });
      if (!chat) {
        chat = new ChatSession({
          title: `RE Studio ${role.name || req.params.personaId}`,
          sender: value.studentId,
          stakeholderId: role._id,
          participants: [value.studentId],
          startTime: new Date(),
          chatItems: [],
        });
      }
      chat.chatItems.push({ sender: value.studentId, message: value.text, timestamp: new Date() });
      if (reply.text) chat.chatItems.push({ sender: role.name || 'Stakeholder', message: reply.text, timestamp: new Date() });
      await chat.save();
    }

    return res.status(201).json({
      success: true,
      data: formatInterview(session),
      reply: reply.text,
      hit: hit ? hit.id : null,
      agentError: reply.error,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to store the interview turn' });
  }
});

router.post('/:groupId/interviews/:personaId/pins', isOptionalAuth, async (req, res) => {
  const session = await ReStudioSession.findOne({ groupId: req.params.groupId, persona: req.params.personaId });
  if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
  const latest = [...(session.turns || [])].reverse().find((turn) => turn.speaker === 'persona');
  if (!latest) return res.status(400).json({ success: false, message: 'There is no persona answer to pin' });
  const id = latest._id.toString();
  if (!session.pins.includes(id)) session.pins.push(id);
  session.markers.push({ kind: 'P', at: new Date() });
  await session.save();
  return res.status(200).json({ success: true, data: formatInterview(session) });
});

router.post('/:groupId/interviews/:personaId/conclude', isOptionalAuth, async (req, res) => {
  const session = await ReStudioSession.findOne({ groupId: req.params.groupId, persona: req.params.personaId });
  if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
  session.open = false;
  session.concludedAt = new Date();
  await session.save();
  return res.status(200).json({ success: true, data: formatInterview(session) });
});

router.post('/:groupId/interviews/:personaId/reopen', isOptionalAuth, async (req, res) => {
  const session = await ReStudioSession.findOne({ groupId: req.params.groupId, persona: req.params.personaId });
  if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
  session.open = true;
  session.reopenedAt = new Date();
  await session.save();
  return res.status(200).json({ success: true, data: formatInterview(session) });
});

function formatRun(run) {
  return {
    id: run._id.toString(),
    courseId: run.courseId,
    groupId: run.groupId,
    repo: run.repo,
    commit: run.commit,
    purpose: run.purpose,
    status: run.status,
    findings: (run.findings || []).map((finding) => ({
      ...finding.toObject ? finding.toObject() : finding,
      url: codeUrl(run.repo, run.commit, finding.file, finding.line),
    })),
    labels: run.labels || [],
    toolRuns: run.toolRuns || [],
    submittedAt: run.submittedAt || null,
    executed: (run.toolRuns || []).some((tool) => tool.status === 'done'),
    createdAt: run.createdAt,
  };
}

const findingBody = Joi.object({
  id: Joi.string().trim().optional(),
  tools: Joi.array().items(Joi.string().trim()).default([]),
  tool: Joi.string().trim().optional(),
  rule: Joi.string().allow('').optional(),
  message: Joi.string().allow('').optional(),
  file: Joi.string().allow('').required(),
  line: Joi.number().integer().min(0).required(),
  snippet: Joi.string().allow('').optional(),
  code: Joi.string().allow('').optional(),
  severity: Joi.string().valid('critical', 'high', 'medium', 'low', 'info').optional(),
  category: Joi.string().trim().optional(),
});

const outputBody = Joi.object({
  toolId: Joi.string().trim().required(),
  format: Joi.string().valid('sarif', 'prodlint').default('sarif'),
  body: Joi.alternatives().try(Joi.object(), Joi.array()).required(),
});

const toolRunBody = Joi.object({
  id: Joi.string().trim().required(),
  status: Joi.string().valid('done', 'failed', 'skipped').required(),
  message: Joi.string().allow('').optional(),
});

async function reviewToolsFor(courseId) {
  if (!mongoose.Types.ObjectId.isValid(courseId)) return undefined;
  const course = await Course.findById(courseId).select('config.reviewTools').lean();
  return course && course.config ? course.config.reviewTools : undefined;
}

router.post('/:groupId/reviews', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      courseId: Joi.string().trim().optional(),
      repo: Joi.string().trim().uri().required(),
      commit: Joi.string().trim().required(),
      findings: Joi.array().items(findingBody).optional(),
      outputs: Joi.array().items(outputBody).optional(),
      toolRuns: Joi.array().items(toolRunBody).optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });
    const courseId = await courseFor(req.params.groupId, value.courseId);
    if (!courseId) return res.status(400).json({ success: false, message: 'courseId is required when the group has none' });
    if ((value.findings || []).some((finding) => !(finding.tools && finding.tools.length) && !finding.tool)) {
      return res.status(400).json({ success: false, message: 'Each finding names at least one tool.' });
    }
    const unknown = unknownTools(value.findings || []);
    if (unknown.length) return res.status(400).json({ success: false, message: `Unknown tool: ${unknown[0]}` });
    const assembled = assembleReview({
      outputs: value.outputs,
      findings: value.findings,
      toolRuns: value.toolRuns,
      reviewTools: await reviewToolsFor(courseId),
    });
    const submitted = (value.findings || []).length || (value.outputs || []).length || (value.toolRuns || []).length;
    const anyDone = assembled.findings.length > 0 || assembled.toolRuns.some((tool) => tool.status === 'done');
    const run = await ReviewRun.create({
      courseId,
      groupId: req.params.groupId,
      purpose: 'review',
      repo: value.repo,
      commit: value.commit,
      status: submitted ? (anyDone ? 'done' : 'failed') : 'queued',
      findings: assembled.findings,
      toolRuns: assembled.toolRuns,
      labels: [],
    });
    return res.status(201).json({
      success: true,
      data: formatRun(run),
      message: submitted
        ? 'Findings stored. This server did not start the review image.'
        : 'Run queued. This server does not start the review image.',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to store the review run' });
  }
});

router.get('/:groupId/reviews/:runId/export', isOptionalAuth, async (req, res) => {
  const run = await ReviewRun.findOne({ _id: req.params.runId, groupId: req.params.groupId });
  if (!run) return res.status(404).json({ success: false, message: 'Run not found' });
  const format = req.query.format || 'md';
  if (format === 'csv') {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    return res.status(200).send(toCsv(run.findings, run.labels));
  }
  if (format === 'sarif') return res.status(200).json(toSarif(run));
  if (format === 'pdf') {
    res.set('Content-Type', 'application/pdf');
    return res.status(200).send(toPdf(toMarkdown(run)));
  }
  if (format === 'md') {
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    return res.status(200).send(toMarkdown(run));
  }
  return res.status(400).json({ success: false, message: 'format must be pdf, md, sarif, or csv' });
});

router.put('/:groupId/reviews/:runId/labels', isOptionalAuth, async (req, res) => {
  const schema = Joi.object({
    labels: Joi.array().items(Joi.object({
      findingId: Joi.string().required(),
      verdict: Joi.string().valid('tp', 'fp').required(),
      reason: Joi.string().trim().min(1).required(),
    })).required(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });
  const run = await ReviewRun.findOne({ _id: req.params.runId, groupId: req.params.groupId, purpose: 'review' });
  if (!run) return res.status(404).json({ success: false, message: 'Run not found' });
  if (run.submittedAt) return res.status(409).json({ success: false, message: 'Labels are already submitted' });
  const ids = new Set(run.findings.map((finding) => finding.id));
  const missing = value.labels.find((label) => !ids.has(label.findingId));
  if (missing) return res.status(400).json({ success: false, message: `Unknown finding ${missing.findingId}` });
  run.labels = value.labels;
  await run.save();
  return res.status(200).json({ success: true, data: formatRun(run), precision: precisionByTool(run.findings, run.labels) });
});

router.post('/:groupId/reviews/:runId/submit', isOptionalAuth, async (req, res) => {
  const run = await ReviewRun.findOne({ _id: req.params.runId, groupId: req.params.groupId, purpose: 'review' });
  if (!run) return res.status(404).json({ success: false, message: 'Run not found' });
  const labelled = new Set((run.labels || []).map((label) => label.findingId));
  const missing = (run.findings || []).filter((finding) => !labelled.has(finding.id));
  if (missing.length) {
    return res.status(400).json({ success: false, message: 'Every finding needs a verdict and a reason.' });
  }
  run.submittedAt = new Date();
  await run.save();
  return res.status(200).json({ success: true, data: formatRun(run), precision: precisionByTool(run.findings, run.labels) });
});

router.get('/:groupId/reviews/:runId', isOptionalAuth, async (req, res) => {
  const run = await ReviewRun.findOne({ _id: req.params.runId, groupId: req.params.groupId });
  if (!run) return res.status(404).json({ success: false, message: 'Run not found' });
  return res.status(200).json({ success: true, data: formatRun(run) });
});

function bugView(review, run, previousFindings) {
  const diff = compareRuns(review.findings, review.labels, previousFindings, run.findings);
  return {
    id: run._id.toString(),
    repo: run.repo,
    commit: run.commit,
    at: run.createdAt,
    baseline: run.purpose === 'review',
    fixedIds: diff.fixed.map((finding) => finding.id),
    stillIds: diff.present.map((finding) => finding.id),
    newFindings: diff.added,
    fixed: diff.fixed,
    present: diff.present,
  };
}

router.get('/:groupId/bug-fixes', isOptionalAuth, async (req, res) => {
  const review = await ReviewRun.findOne({
    groupId: req.params.groupId,
    purpose: 'review',
    submittedAt: { $ne: null },
  }).sort({ createdAt: -1 });
  if (!review) return res.status(404).json({ success: false, message: 'No submitted review for this group' });
  const fixes = await ReviewRun.find({ groupId: req.params.groupId, purpose: 'fix' }).sort({ createdAt: 1 });
  const runs = [review, ...fixes];
  return res.status(200).json({
    success: true,
    data: {
      problems: compareRuns(review.findings, review.labels, review.findings, review.findings).present,
      runs: runs.map((run, index) => bugView(review, run, index === 0 ? review.findings : runs[index - 1].findings)),
    },
  });
});

router.post('/:groupId/bug-fixes', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      courseId: Joi.string().trim().optional(),
      repo: Joi.string().trim().uri().required(),
      commit: Joi.string().trim().required(),
      findings: Joi.array().items(findingBody).optional(),
      outputs: Joi.array().items(outputBody).optional(),
      toolRuns: Joi.array().items(toolRunBody).optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });
    const review = await ReviewRun.findOne({
      groupId: req.params.groupId,
      purpose: 'review',
      submittedAt: { $ne: null },
    }).sort({ createdAt: -1 });
    if (!review) return res.status(404).json({ success: false, message: 'Submit the review labels before bug fixing' });
    if ((value.findings || []).some((finding) => !(finding.tools && finding.tools.length) && !finding.tool)) {
      return res.status(400).json({ success: false, message: 'Each finding names at least one tool.' });
    }
    const unknown = unknownTools(value.findings || []);
    if (unknown.length) return res.status(400).json({ success: false, message: `Unknown tool: ${unknown[0]}` });
    const assembled = assembleReview({
      outputs: value.outputs,
      findings: value.findings,
      toolRuns: value.toolRuns,
      reviewTools: await reviewToolsFor(review.courseId),
    });
    const findings = assembled.findings;
    const previous = await ReviewRun.findOne({ groupId: req.params.groupId }).sort({ createdAt: -1 });
    const submitted = (value.findings || []).length || (value.outputs || []).length || (value.toolRuns || []).length;
    const run = await ReviewRun.create({
      courseId: review.courseId,
      groupId: req.params.groupId,
      purpose: 'fix',
      repo: value.repo,
      commit: value.commit,
      status: submitted ? (findings.length || assembled.toolRuns.some((tool) => tool.status === 'done') ? 'done' : 'failed') : 'queued',
      findings,
      toolRuns: assembled.toolRuns,
    });
    return res.status(201).json({
      success: true,
      data: bugView(review, run, previous ? previous.findings : review.findings),
      message: 'Diff stored. This server did not start the review image.',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to store the bug-fix run' });
  }
});

router.get('/:groupId/bug-fixes/:runId', isOptionalAuth, async (req, res) => {
  const review = await ReviewRun.findOne({
    groupId: req.params.groupId,
    purpose: 'review',
    submittedAt: { $ne: null },
  }).sort({ createdAt: -1 });
  const run = await ReviewRun.findOne({ _id: req.params.runId, groupId: req.params.groupId });
  if (!review || !run) return res.status(404).json({ success: false, message: 'Run not found' });
  const earlier = await ReviewRun.findOne({
    groupId: req.params.groupId,
    createdAt: { $lt: run.createdAt },
  }).sort({ createdAt: -1 });
  return res.status(200).json({
    success: true,
    data: bugView(review, run, earlier ? earlier.findings : review.findings),
  });
});

function formatAcceptance(session) {
  return {
    id: session._id.toString(),
    courseId: session.courseId,
    groupId: session.groupId,
    partnerGroupId: session.partnerGroupId || '',
    criteria: session.criteria || [],
    issues: (session.issues || []).map((issue) => ({
      id: issue._id.toString(),
      title: issue.title,
      steps: issue.steps,
      expected: issue.expected,
      actual: issue.actual,
      issueUrl: issue.externalUrl || '',
      usefulness: issue.useful || null,
    })),
    sessions: (session.participants || []).map((person) => ({
      code: person.code,
      consent: person.consent,
      script: person.script,
      observations: person.notes,
    })),
    load: session.load || null,
    status: session.status,
  };
}

router.post('/:groupId/acceptance/import', isOptionalAuth, async (req, res) => {
  try {
    const schema = Joi.object({
      partnerGroupId: Joi.string().trim().required(),
      courseId: Joi.string().trim().optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });
    const partner = await AcceptanceSession.findOne({ groupId: value.partnerGroupId }).sort({ updatedAt: -1 });
    const source = (partner && partner.criteria) || [];
    if (!source.length) return res.status(404).json({ success: false, message: 'The partner group has no acceptance criteria' });
    const courseId = await courseFor(req.params.groupId, value.courseId);
    if (!courseId) return res.status(400).json({ success: false, message: 'courseId is required when the group has none' });
    let session = await AcceptanceSession.findOne({ groupId: req.params.groupId, status: 'draft' });
    const criteria = source.map((item) => ({
      id: item.id,
      text: item.text,
      sourceGroupId: value.partnerGroupId,
      result: '',
      evidence: '',
    }));
    if (!session) {
      session = new AcceptanceSession({
        courseId,
        groupId: req.params.groupId,
        partnerGroupId: value.partnerGroupId,
        criteria,
      });
    } else {
      session.partnerGroupId = value.partnerGroupId;
      session.criteria = criteria;
    }
    await session.save();
    return res.status(200).json({ success: true, data: formatAcceptance(session) });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to import criteria' });
  }
});

router.get('/:groupId/acceptance/export', isOptionalAuth, async (req, res) => {
  const session = await AcceptanceSession.findOne({ groupId: req.params.groupId }).sort({ updatedAt: -1 });
  if (!session) return res.status(404).json({ success: false, message: 'No acceptance report' });
  const ready = (session.criteria || []).length > 0 && session.criteria.every((item) => item.result);
  if (!ready) return res.status(400).json({ success: false, message: 'Every criterion needs a result before export' });
  const lines = (session.criteria || []).map((item) => `- ${item.text}: ${item.result} — ${item.evidence || ''}`);
  res.set('Content-Type', 'text/markdown; charset=utf-8');
  return res.status(200).send(lines.join('\n'));
});

router.get('/:groupId/acceptance', isOptionalAuth, async (req, res) => {
  const session = await AcceptanceSession.findOne({ groupId: req.params.groupId }).sort({ updatedAt: -1 });
  if (!session) return res.status(404).json({ success: false, message: 'No acceptance report' });
  return res.status(200).json({ success: true, data: formatAcceptance(session) });
});

router.put('/:groupId/acceptance', isOptionalAuth, async (req, res) => {
  if (nameKeys(req.body).length) {
    return res.status(400).json({ success: false, message: 'Sessions are stored as P1, P2, and so on. Do not send names.' });
  }
  const schema = Joi.object({
    courseId: Joi.string().trim().optional(),
    criteria: Joi.array().items(Joi.object({
      id: Joi.string().required(),
      text: Joi.string().required(),
      sourceGroupId: Joi.string().allow('').optional(),
      result: Joi.string().valid('pass', 'fail', 'blocked', '').optional(),
      evidence: Joi.string().allow('').optional(),
    })).optional(),
    sessions: Joi.array().items(Joi.object({
      code: Joi.string().pattern(/^P\d+$/).required(),
      consent: Joi.boolean().required(),
      script: Joi.string().allow('').optional(),
      observations: Joi.string().allow('').optional(),
    }).unknown(false)).optional(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });
  const courseId = await courseFor(req.params.groupId, value.courseId);
  let session = await AcceptanceSession.findOne({ groupId: req.params.groupId, status: 'draft' });
  if (!session) {
    if (!courseId) return res.status(400).json({ success: false, message: 'courseId is required when the group has none' });
    session = new AcceptanceSession({ courseId, groupId: req.params.groupId });
  }
  if (session.status === 'submitted') return res.status(409).json({ success: false, message: 'The report is submitted' });
  if (value.criteria) session.criteria = value.criteria;
  if (value.sessions) {
    session.participants = value.sessions.map((person) => ({
      code: person.code,
      consent: person.consent,
      script: person.script || '',
      notes: person.observations || '',
    }));
  }
  await session.save();
  return res.status(200).json({ success: true, data: formatAcceptance(session) });
});

router.post('/:groupId/acceptance/issues', isOptionalAuth, async (req, res) => {
  const schema = Joi.object({
    title: Joi.string().trim().required(),
    steps: Joi.string().allow('').optional(),
    expected: Joi.string().allow('').optional(),
    actual: Joi.string().allow('').optional(),
    issueUrl: Joi.string().trim().uri().optional(),
    usefulness: Joi.number().integer().min(1).max(5).optional(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });
  const session = await AcceptanceSession.findOne({ groupId: req.params.groupId }).sort({ updatedAt: -1 });
  if (!session) return res.status(404).json({ success: false, message: 'No acceptance report' });
  session.issues.push({
    title: value.title,
    steps: value.steps || '',
    expected: value.expected || '',
    actual: value.actual || '',
    externalUrl: value.issueUrl || '',
    useful: value.usefulness || 0,
  });
  await session.save();
  return res.status(201).json({
    success: true,
    data: formatAcceptance(session),
    message: value.issueUrl
      ? 'Issue URL stored.'
      : 'Issue stored here. This server does not open it in the partner repository.',
  });
});

router.post('/:groupId/acceptance/load', isOptionalAuth, async (req, res) => {
  const schema = Joi.object({
    p95ms: Joi.number().min(0).required(),
    limit: Joi.string().allow('').required(),
    raw: Joi.string().allow('').optional(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });
  const session = await AcceptanceSession.findOne({ groupId: req.params.groupId }).sort({ updatedAt: -1 });
  if (!session) return res.status(404).json({ success: false, message: 'No acceptance report' });
  session.load = { p95ms: value.p95ms, limit: value.limit, raw: value.raw || '' };
  await session.save();
  return res.status(200).json({
    success: true,
    data: formatAcceptance(session),
    message: 'k6 result stored. This server does not run k6 or call the partner URL.',
  });
});

router.post('/:groupId/acceptance/submit', isOptionalAuth, async (req, res) => {
  const session = await AcceptanceSession.findOne({ groupId: req.params.groupId, status: 'draft' }).sort({ updatedAt: -1 });
  if (!session) return res.status(404).json({ success: false, message: 'No draft acceptance report' });
  const ready = (session.criteria || []).length > 0 && session.criteria.every((item) => item.result);
  if (!ready) return res.status(400).json({ success: false, message: 'Every criterion needs a result' });
  session.status = 'submitted';
  await session.save();
  return res.status(200).json({ success: true, data: formatAcceptance(session) });
});

async function openTeacherSubmission(report, studentName) {
  if (!report.taskId || !mongoose.Types.ObjectId.isValid(report.taskId) || !report.studentId) return;
  const task = await Task.findById(report.taskId);
  if (!task) return;
  const submission = await Submission.create({
    taskId: task._id,
    studentId: report.studentId,
    studentName: studentName || report.studentId,
    submission: `${report.kind} report ${report._id}`,
    datetime: new Date(),
  });
  report.submissionId = submission._id.toString();
}

router.get('/:groupId/agents-md', isOptionalAuth, async (req, res) => {
  const report = await LabReport.findOne({ groupId: req.params.groupId, kind: 'agents-md' });
  if (!report) return res.status(404).json({ success: false, message: 'No AGENTS.md draft' });
  const notes = annotateAgentsMd(report.data.text || '', report.data.knownScripts);
  return res.status(200).json({ success: true, data: { ...report.data, notes: notes.notes, checks: notes.checks, submittedAt: report.submittedAt || null } });
});

router.put('/:groupId/agents-md', isOptionalAuth, async (req, res) => {
  const schema = Joi.object({
    courseId: Joi.string().trim().optional(),
    text: Joi.string().allow('').required(),
    handwritten: Joi.boolean().optional(),
    pasteFlag: Joi.boolean().optional(),
    knownScripts: Joi.array().items(Joi.string()).optional(),
    taskId: Joi.string().allow('').optional(),
    studentId: Joi.string().allow('').optional(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });
  const courseId = await courseFor(req.params.groupId, value.courseId);
  if (!courseId) return res.status(400).json({ success: false, message: 'courseId is required when the group has none' });
  let report = await LabReport.findOne({ groupId: req.params.groupId, kind: 'agents-md' });
  if (report && report.status === 'submitted') return res.status(409).json({ success: false, message: 'AGENTS.md is submitted' });
  const data = {
    text: value.text,
    handwritten: value.handwritten !== false,
    pasteFlag: Boolean(value.pasteFlag),
    knownScripts: value.knownScripts || ['test', 'lint', 'build', 'dev', 'ci', 'eval:hints'],
  };
  const notes = annotateAgentsMd(data.text, data.knownScripts);
  if (!report) {
    report = new LabReport({ courseId, groupId: req.params.groupId, kind: 'agents-md', data, checks: notes.checks, taskId: value.taskId || '', studentId: value.studentId || '' });
  } else {
    report.data = data;
    report.checks = notes.checks;
    report.status = 'draft';
    if (value.taskId != null) report.taskId = value.taskId;
    if (value.studentId != null) report.studentId = value.studentId;
  }
  await report.save();
  return res.status(200).json({ success: true, data: { ...data, notes: notes.notes, checks: notes.checks } });
});

router.post('/:groupId/agents-md/submit', isOptionalAuth, async (req, res) => {
  const report = await LabReport.findOne({ groupId: req.params.groupId, kind: 'agents-md' });
  if (!report) return res.status(404).json({ success: false, message: 'No AGENTS.md draft' });
  const notes = annotateAgentsMd(report.data.text || '', report.data.knownScripts);
  report.checks = notes.checks;
  if (!labReady(notes.checks)) {
    await report.save();
    return res.status(400).json({ success: false, message: 'The checklist is not complete', data: notes.checks });
  }
  await openTeacherSubmission(report, req.body && req.body.studentName);
  report.status = 'submitted';
  report.submittedAt = new Date();
  await report.save();
  return res.status(200).json({ success: true, data: { submittedAt: report.submittedAt, submissionId: report.submissionId || '' } });
});

function llmExport(data, format) {
  const feature = data.feature || {};
  const cases = data.cases || [];
  if (format === 'csv') {
    const lines = ['id,technique,link,verdict,notes'];
    for (const item of cases) {
      lines.push([item.id, item.technique, item.link, item.verdict, item.notes].map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(','));
    }
    return lines.join('\n');
  }
  const lines = [`# ${feature.name || 'LLM lab'}`, '', ...cases.map((item) => `### ${item.id} ${item.title || ''}\n- ${item.technique}: ${item.verdict || ''}\n- ${item.notes || ''}`)];
  return lines.join('\n');
}

router.get('/:groupId/llm-lab/export', isOptionalAuth, async (req, res) => {
  const report = await LabReport.findOne({ groupId: req.params.groupId, kind: 'llm' });
  if (!report) return res.status(404).json({ success: false, message: 'No LLM lab' });
  const format = req.query.format === 'csv' ? 'csv' : 'md';
  res.set('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8');
  return res.status(200).send(llmExport(report.data || {}, format));
});

router.get('/:groupId/llm-lab', isOptionalAuth, async (req, res) => {
  const report = await LabReport.findOne({ groupId: req.params.groupId, kind: 'llm' });
  if (!report) return res.status(404).json({ success: false, message: 'No LLM lab' });
  return res.status(200).json({ success: true, data: { ...report.data, checks: labChecks('llm', report.data), submittedAt: report.submittedAt || null } });
});

router.put('/:groupId/llm-lab', isOptionalAuth, async (req, res) => {
  const schema = Joi.object({
    courseId: Joi.string().trim().optional(),
    taskId: Joi.string().allow('').optional(),
    studentId: Joi.string().allow('').optional(),
    feature: Joi.object().required(),
    cases: Joi.array().required(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });
  const courseId = await courseFor(req.params.groupId, value.courseId);
  if (!courseId) return res.status(400).json({ success: false, message: 'courseId is required when the group has none' });
  const data = { feature: value.feature, cases: value.cases };
  let report = await LabReport.findOne({ groupId: req.params.groupId, kind: 'llm' });
  if (report && report.status === 'submitted') return res.status(409).json({ success: false, message: 'The LLM lab is submitted' });
  const checks = labChecks('llm', data);
  if (!report) report = new LabReport({ courseId, groupId: req.params.groupId, kind: 'llm', data, checks, status: 'draft', taskId: value.taskId || '', studentId: value.studentId || '' });
  else {
    report.data = data;
    report.checks = checks;
    report.status = 'draft';
    if (value.taskId != null) report.taskId = value.taskId;
    if (value.studentId != null) report.studentId = value.studentId;
  }
  await report.save();
  return res.status(200).json({ success: true, data: { ...data, checks } });
});

router.post('/:groupId/llm-lab/submit', isOptionalAuth, async (req, res) => {
  const report = await LabReport.findOne({ groupId: req.params.groupId, kind: 'llm' });
  if (!report) return res.status(404).json({ success: false, message: 'No LLM lab' });
  const checks = labChecks('llm', report.data || {});
  report.checks = checks;
  if (!labReady(checks)) {
    await report.save();
    return res.status(400).json({ success: false, message: 'The LLM lab is not ready', data: checks });
  }
  await openTeacherSubmission(report, req.body && req.body.studentName);
  report.status = 'submitted';
  report.submittedAt = new Date();
  await report.save();
  return res.status(200).json({ success: true, data: { submittedAt: report.submittedAt, submissionId: report.submissionId || '', checks } });
});

router.get('/:groupId/sustainability/quality-import', isOptionalAuth, async (req, res) => {
  const report = await LabReport.findOne({ groupId: req.params.groupId, kind: 'llm' });
  const cases = (report && report.data && report.data.cases) || [];
  return res.status(200).json({
    success: true,
    data: {
      total: cases.length,
      passed: cases.filter((item) => item.verdict === 'pass').length,
    },
  });
});

router.get('/:groupId/sustainability/export', isOptionalAuth, async (req, res) => {
  const report = await LabReport.findOne({ groupId: req.params.groupId, kind: 'sustainability' });
  if (!report) return res.status(404).json({ success: false, message: 'No sustainability lab' });
  const view = sustainabilityView(report.data || {});
  const lines = [
    '# Sustainability lab',
    '',
    `Grid source: ${view.gridSource || 'missing'}`,
    view.estimateLabel || '',
    `NFR: ${view.nfr || 'not enough data'}`,
    `Baseline mean kWh: ${view.baseline.mean}`,
    `After mean kWh: ${view.after.mean}`,
  ].filter(Boolean);
  res.set('Content-Type', 'text/markdown; charset=utf-8');
  return res.status(200).send(lines.join('\n'));
});

router.get('/:groupId/sustainability', isOptionalAuth, async (req, res) => {
  const report = await LabReport.findOne({ groupId: req.params.groupId, kind: 'sustainability' });
  if (!report) return res.status(404).json({ success: false, message: 'No sustainability lab' });
  return res.status(200).json({
    success: true,
    data: { ...report.data, summary: sustainabilityView(report.data || {}), checks: labChecks('sustainability', report.data), submittedAt: report.submittedAt || null },
  });
});

router.put('/:groupId/sustainability', isOptionalAuth, async (req, res) => {
  const schema = Joi.object({
    courseId: Joi.string().trim().optional(),
    taskId: Joi.string().allow('').optional(),
    studentId: Joi.string().allow('').optional(),
    setup: Joi.object().required(),
    baseline: Joi.object().required(),
    after: Joi.object().required(),
    changes: Joi.array().required(),
    quality: Joi.object().optional(),
    uncertainty: Joi.string().allow('').optional(),
    reflection: Joi.string().allow('').optional(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });
  const courseId = await courseFor(req.params.groupId, value.courseId);
  if (!courseId) return res.status(400).json({ success: false, message: 'courseId is required when the group has none' });
  const data = {
    setup: value.setup,
    baseline: value.baseline,
    after: value.after,
    changes: value.changes,
    quality: value.quality || {},
    uncertainty: value.uncertainty || '',
    reflection: value.reflection || '',
  };
  if (value.setup.tdp) data.estimateLabel = 'TDP fallback is an estimate. It is not a measurement.';
  let report = await LabReport.findOne({ groupId: req.params.groupId, kind: 'sustainability' });
  if (report && report.status === 'submitted') return res.status(409).json({ success: false, message: 'The sustainability lab is submitted' });
  const checks = labChecks('sustainability', data);
  if (!report) report = new LabReport({ courseId, groupId: req.params.groupId, kind: 'sustainability', data, checks, taskId: value.taskId || '', studentId: value.studentId || '' });
  else {
    report.data = data;
    report.checks = checks;
    report.status = 'draft';
    if (value.taskId != null) report.taskId = value.taskId;
    if (value.studentId != null) report.studentId = value.studentId;
  }
  await report.save();
  return res.status(200).json({ success: true, data: { ...data, summary: sustainabilityView(data), checks } });
});

router.post('/:groupId/sustainability/submit', isOptionalAuth, async (req, res) => {
  const report = await LabReport.findOne({ groupId: req.params.groupId, kind: 'sustainability' });
  if (!report) return res.status(404).json({ success: false, message: 'No sustainability lab' });
  const checks = labChecks('sustainability', report.data || {});
  report.checks = checks;
  if (!labReady(checks)) {
    await report.save();
    return res.status(400).json({ success: false, message: 'The sustainability lab is not ready', data: checks });
  }
  await openTeacherSubmission(report, req.body && req.body.studentName);
  report.status = 'submitted';
  report.submittedAt = new Date();
  await report.save();
  return res.status(200).json({ success: true, data: { submittedAt: report.submittedAt, submissionId: report.submissionId || '', summary: sustainabilityView(report.data) } });
});

router.get('/:groupId/artifacts/coverage', isOptionalAuth, async (req, res) => {
  const rows = await Artifact.find({ groupId: req.params.groupId }).sort({ updatedAt: 1 });
  const bundle = {};
  for (const row of rows) bundle[row.kind] = row.data || {};
  return res.status(200).json({ success: true, data: coverageLinks(bundle) });
});

router.get('/:groupId/artifacts/:taskId/attempts', isOptionalAuth, async (req, res) => {
  const artifact = await Artifact.findOne({ groupId: req.params.groupId, taskId: req.params.taskId });
  if (!artifact) return res.status(404).json({ success: false, message: 'Artefact not found' });
  const rows = await ArtifactSubmission.find({ artifactId: artifact._id }).sort({ attempt: 1 });
  const attempts = rows.map((row, index) => {
    const previous = index === 0 ? null : rows[index - 1].snapshot;
    const changed = previous
      ? Object.keys({ ...previous, ...row.snapshot }).filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(row.snapshot[key]))
      : Object.keys(row.snapshot || {});
    return {
      id: row._id.toString(),
      attempt: row.attempt,
      snapshot: row.snapshot,
      submittedAt: row.submittedAt,
      members: row.members,
      reflectionAnswers: row.reflectionAnswers,
      checks: row.checks,
      feedback: row.feedback,
      status: row.status,
      changed,
    };
  });
  return res.status(200).json({ success: true, data: attempts });
});

router.get('/:groupId/artifacts/:taskId', isOptionalAuth, async (req, res) => {
  const artifact = await Artifact.findOne({ groupId: req.params.groupId, taskId: req.params.taskId });
  if (!artifact) return res.status(404).json({ success: false, message: 'Artefact not found' });
  return res.status(200).json({
    success: true,
    data: {
      id: artifact._id.toString(),
      courseId: artifact.courseId,
      groupId: artifact.groupId,
      taskId: artifact.taskId,
      kind: artifact.kind,
      data: artifact.data,
      updatedAt: artifact.updatedAt,
      versions: artifact.versions,
      checks: checksFor(artifact.kind, artifact.data || {}),
    },
  });
});

router.put('/:groupId/artifacts/:taskId', isOptionalAuth, async (req, res) => {
  const schema = Joi.object({
    courseId: Joi.string().trim().optional(),
    kind: Joi.string().valid(...KINDS).required(),
    by: Joi.string().trim().required(),
    data: Joi.object().required(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });
  const courseId = await courseFor(req.params.groupId, value.courseId);
  if (!courseId) return res.status(400).json({ success: false, message: 'courseId is required when the group has none' });
  let artifact = await Artifact.findOne({ groupId: req.params.groupId, taskId: req.params.taskId });
  const version = { at: new Date(), by: value.by };
  if (!artifact) {
    artifact = new Artifact({
      courseId,
      groupId: req.params.groupId,
      taskId: req.params.taskId,
      kind: value.kind,
      data: value.data,
      versions: [version],
    });
  } else {
    artifact.kind = value.kind;
    artifact.data = value.data;
    artifact.versions.push(version);
  }
  await artifact.save();
  return res.status(200).json({
    success: true,
    data: {
      id: artifact._id.toString(),
      kind: artifact.kind,
      data: artifact.data,
      versions: artifact.versions,
      checks: checksFor(artifact.kind, artifact.data),
    },
  });
});

router.post('/:groupId/artifacts/:taskId/submit', isOptionalAuth, async (req, res) => {
  const artifact = await Artifact.findOne({ groupId: req.params.groupId, taskId: req.params.taskId });
  if (!artifact) return res.status(404).json({ success: false, message: 'Artefact not found' });
  const latest = await ArtifactSubmission.findOne({ artifactId: artifact._id }).sort({ attempt: -1 });
  if (latest && latest.status !== 'returned') {
    return res.status(409).json({ success: false, message: 'This attempt is already submitted' });
  }
  const saved = await ArtifactSubmission.create({
    artifactId: artifact._id,
    attempt: latest ? latest.attempt + 1 : 1,
    snapshot: JSON.parse(JSON.stringify(artifact.data || {})),
    submittedAt: new Date(),
    members: (req.body && req.body.members) || [],
    reflectionAnswers: (req.body && req.body.reflectionAnswers) || {},
    checks: checksFor(artifact.kind, artifact.data || {}),
    feedback: [],
    status: 'submitted',
  });
  return res.status(201).json({ success: true, data: { id: saved._id.toString(), attempt: saved.attempt, checks: saved.checks, status: saved.status } });
});

module.exports = router;
module.exports.nameKeys = nameKeys;
