const { toClaudeBody, resolveClaudeModel } = require('../src/services/claudeClient');

describe('Claude chat adapter', () => {
  const previous = process.env.ANTHROPIC_MODEL;
  beforeAll(() => {
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-5-5';
  });
  afterAll(() => {
    if (previous == null) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = previous;
  });

  test('a gpt model name is sent to the Claude model from the env', () => {
    const body = toClaudeBody({
      model: 'gpt-5.4-mini',
      temperature: 0.7,
      max_completion_tokens: 800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are Kari.' },
        { role: 'user', content: 'How is exam week?' },
        { role: 'assistant', content: 'Busy.' },
        { role: 'user', content: 'What do you cut first?' },
      ],
    });
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(resolveClaudeModel('gpt-4o-mini')).toBe('claude-sonnet-5-5');
    expect(body.max_tokens).toBe(800);
    expect(body.system).toMatch(/You are Kari/);
    expect(body.system).toMatch(/JSON object/);
    expect(body.messages.map((turn) => turn.role)).toEqual(['user', 'assistant', 'user']);
    expect(body.messages[2].content).toBe('What do you cut first?');
  });
});
