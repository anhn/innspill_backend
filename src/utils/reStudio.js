const StakeholderChatAgent = require('../agents/StakeholderChatAgent');

/**
 * One stakeholder answer from the LLM. The reply is the model's answer
 * to the latest question, not a stored sentence.
 */
async function personaReply(openai, { persona, message, history }) {
  if (!openai) return { text: null, error: 'Stakeholder agent is not configured.' };
  const agent = new StakeholderChatAgent(openai, persona || '');
  const response = await agent.process({
    message,
    context: {
      conversationHistory: (history || []).map((turn) => ({
        message: turn.text,
        role: turn.speaker === 'persona' ? 'stakeholder' : 'student',
      })),
    },
  });
  if (!response.success) return { text: null, error: response.error || 'The stakeholder agent failed.' };
  return { text: response.response, error: null };
}

/**
 * Hidden constraints live in the persona text:
 * "(reveal only if asked about: wifi, campus, offline)"
 * A hit is a topic the student actually asked about.
 */
function constraintsFromPersona(persona) {
  const constraints = [];
  const pattern = /reveal only if asked about:\s*([^)\n]+)/gi;
  let match = pattern.exec(String(persona || ''));
  while (match) {
    const topics = match[1].split(',').map((topic) => topic.trim()).filter(Boolean);
    constraints.push({
      id: topics[0] ? topics[0].toLowerCase().replace(/\s+/g, '-') : `c${constraints.length + 1}`,
      topics,
    });
    match = pattern.exec(String(persona || ''));
  }
  return constraints;
}

function constraintHit(text, constraints, alreadyHit) {
  const asked = String(text || '').toLowerCase();
  return (constraints || []).find((constraint) => {
    if ((alreadyHit || []).includes(constraint.id)) return false;
    return constraint.topics.some((topic) => asked.includes(topic.toLowerCase()));
  }) || null;
}

module.exports = { constraintsFromPersona, constraintHit, personaReply };
