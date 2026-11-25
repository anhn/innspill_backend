const DEFAULT_MODEL = 'claude-sonnet-5-5';

function claudeApiKey() {
  return process.env.CLAUDE_API || process.env.ANTHROPIC_API_KEY || '';
}

function resolveClaudeModel(requested) {
  const configured = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || DEFAULT_MODEL;
  if (requested && /^claude/i.test(String(requested))) return String(requested);
  return configured;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => part.text || part.content || '').join('');
  }
  return content == null ? '' : String(content);
}

/**
 * OpenAI chat body -> Anthropic Messages body.
 * A gpt model name is replaced by ANTHROPIC_MODEL. JSON mode is an instruction,
 * because Claude has no response_format field.
 */
function toClaudeBody(request) {
  const systemParts = [];
  const turns = [];
  for (const message of request.messages || []) {
    const text = textOf(message.content).trim();
    if (!text) continue;
    if (message.role === 'system') {
      systemParts.push(text);
      continue;
    }
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const previous = turns[turns.length - 1];
    if (previous && previous.role === role) previous.content += `\n${text}`;
    else turns.push({ role, content: text });
  }
  if (request.response_format && request.response_format.type === 'json_object') {
    systemParts.push('Return one JSON object and no markdown.');
  }
  if (!turns.length || turns[0].role !== 'user') {
    turns.unshift({ role: 'user', content: 'Continue.' });
  }
  const body = {
    model: resolveClaudeModel(request.model),
    max_tokens: request.max_completion_tokens || request.max_tokens || 1024,
    messages: turns,
  };
  // Current Claude models reject temperature. Older ones still accept it.
  if (process.env.ANTHROPIC_TEMPERATURE === 'on' && request.temperature != null) {
    body.temperature = Math.min(1, Math.max(0, request.temperature));
  }
  if (systemParts.length) body.system = systemParts.join('\n\n');
  return body;
}

function createClaudeClient() {
  const apiKey = claudeApiKey();
  if (!apiKey) throw new Error('CLAUDE_API is not set');
  const endpoint = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1/messages';
  return {
    chat: {
      completions: {
        async create(request) {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(toClaudeBody(request)),
            signal: AbortSignal.timeout(110000),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            const message = data.error && data.error.message ? data.error.message : `Claude API ${response.status}`;
            throw new Error(message);
          }
          const content = (data.content || []).map((block) => block.text || '').join('');
          const input = data.usage && data.usage.input_tokens ? data.usage.input_tokens : 0;
          const output = data.usage && data.usage.output_tokens ? data.usage.output_tokens : 0;
          return {
            choices: [{ message: { content } }],
            usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output },
          };
        },
      },
    },
  };
}

module.exports = {
  DEFAULT_MODEL,
  claudeApiKey,
  resolveClaudeModel,
  toClaudeBody,
  createClaudeClient,
};
