const express = require('express');
const Joi = require('joi');
const { getOpenAIClient, llmConfigured } = require('../services/openaiClient');
const { isOptionalAuth } = require('../middleware/auth');
const { personaReply } = require('../utils/reStudio');
const { trackRoute } = require('../utils/activity');

const router = express.Router();
const openai = llmConfigured() ? getOpenAIClient() : null;

// Every interview turn is logged: who asked which persona what, and what the persona answered.
const trackTurn = trackRoute('interview-turn', (req, body) => ({
  tool: 're-studio',
  task: req.body.task || '1.1',
  taskId: req.body.taskId || undefined,
  course: req.body.course || undefined,
  data: {
    persona: req.body.personaName || String(req.body.persona || '').slice(0, 120),
    question: req.body.message,
    reply: body?.reply,
    historyLength: Array.isArray(req.body.history) ? req.body.history.length : 0,
  },
}));

router.post('/reply', isOptionalAuth, trackTurn, async (req, res) => {
  try {
    const schema = Joi.object({
      persona: Joi.string().trim().min(1).max(4000).required(),
      message: Joi.string().trim().min(1).max(2000).required(),
      history: Joi.array().max(12).items(Joi.object({
        speaker: Joi.string().valid('student', 'persona').required(),
        text: Joi.string().trim().min(1).max(2000).required(),
      })).default([]),
      personaName: Joi.string().trim().max(120).optional(),
      course: Joi.string().trim().max(60).optional(),
      task: Joi.string().trim().max(10).optional(),
      taskId: Joi.string().trim().max(40).optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });
    const reply = await personaReply(openai, value);
    if (!reply.text) {
      return res.status(503).json({ success: false, message: reply.error || 'The stakeholder agent failed.' });
    }
    return res.status(200).json({ success: true, reply: reply.text });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to answer as the stakeholder' });
  }
});

module.exports = router;
