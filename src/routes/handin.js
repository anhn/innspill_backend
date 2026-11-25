const express = require('express');
const Joi = require('joi');
const { isOptionalAuth } = require('../middleware/auth');
const { actingUsername } = require('../middleware/requestIdentity');
const { checkLink } = require('../utils/handin');
const { assess } = require('../assessment');

/**
 * POST /api/v1/handin/check { url } — check a GitHub link for the hand-in portal.
 * Files are read at a pinned commit; pull requests get the task 2.1 checks.
 */
const router = express.Router();

router.post('/check', isOptionalAuth, require('../utils/activity').trackRoute('link-check', (req, body) => ({ task: req.body.task, data: { url: req.body.url, ok: body?.data?.ok, type: body?.data?.type, checks: body?.data?.checks, error: body?.data?.error } })), async (req, res) => {
  if (!actingUsername(req)) return res.status(401).json({ success: false, message: 'Log in to check links.' });
  const { error, value } = Joi.object({ url: Joi.string().trim().uri({ scheme: ['http', 'https'] }).max(500).required(), task: Joi.string().pattern(/^\d\.\d$/).optional() }).validate(req.body);
  if (error) return res.status(400).json({ success: false, message: 'Give a full link, starting with https://github.com/' });
  try {
    const result = await checkLink(value.url, value.task);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('❌ Hand-in link check failed:', err.message);
    return res.status(500).json({ success: false, message: 'The link could not be checked.' });
  }
});

/**
 * POST /api/v1/handin/precheck { task, text, parts, conversationLog } — the fixed rules only (no AI),
 * so the portal can tell students about format problems before they hand in.
 */
router.post('/precheck', isOptionalAuth, require('../utils/activity').trackRoute('format-check', (req, body) => ({ task: req.body.task, data: { problems: (body?.data?.problems || []).length, chars: String(req.body.text || '').length } })), async (req, res) => {
  if (!actingUsername(req)) return res.status(401).json({ success: false, message: 'Log in first.' });
  const { error, value } = Joi.object({
    task: Joi.string().pattern(/^\d\.\d$/).required(),
    text: Joi.string().allow('').max(400000).required(),
    parts: Joi.array().items(Joi.object().unknown(true)).max(20).default([]),
    conversationLog: Joi.string().allow('', null).max(400000).optional(),
  }).validate(req.body);
  if (error) return res.status(400).json({ success: false, message: error.details[0].message });
  try {
    const result = await assess(value.task, { text: value.text, parts: value.parts, conversationLog: value.conversationLog || '', related: {}, noAi: true });
    if (!result) return res.json({ success: true, data: null });
    // Students see the structure problems, not a score.
    const problems = [];
    for (const section of result.sections) for (const item of section.items) {
      const issues = (item.issues || []).filter((i) => ['template', 'source', 'scale', 'target', 'verification', 'gwt', 'issue', 'use-case', 'identity', 'missing', 'runs', 'bug', 'setup', 'uncertainty', 'label', 'reason'].includes(i.rule));
      if (issues.length) problems.push({ section: section.title, item: item.label, text: item.text, issues: issues.map((i) => i.message) });
    }
    return res.json({ success: true, data: { facts: result.facts, problems: problems.slice(0, 60) } });
  } catch (err) {
    console.error('❌ Hand-in precheck failed:', err.message);
    return res.status(500).json({ success: false, message: 'The format check failed.' });
  }
});

module.exports = router;
