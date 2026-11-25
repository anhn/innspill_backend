const { personaReply } = require('../src/utils/reStudio');

describe('stakeholder replies', () => {
  test('the model answers the question that was just asked', async () => {
    let seen;
    const openai = {
      chat: {
        completions: {
          create: async ({ messages }) => {
            seen = messages;
            return {
              choices: [{ message: { content: 'Exam week I study in one-hour blocks and sleep less.' } }],
              usage: {},
            };
          },
        },
      },
    };
    const result = await personaReply(openai, {
      persona: 'Kari, a second-year student. Past papers only open on campus wifi.',
      message: 'What is your load like in exam week?',
      history: [
        { speaker: 'student', text: 'Hi Kari' },
        { speaker: 'persona', text: 'Hi.' },
      ],
    });
    expect(result.text).toBe('Exam week I study in one-hour blocks and sleep less.');
    expect(result.error).toBeNull();
    expect(seen[0].role).toBe('system');
    expect(seen[0].content).toMatch(/campus wifi/);
    expect(seen[1]).toMatchObject({ role: 'user', content: 'Hi Kari' });
    expect(seen[2]).toMatchObject({ role: 'assistant', content: 'Hi.' });
    expect(seen[3]).toMatchObject({ role: 'user', content: 'What is your load like in exam week?' });
  });

  test('a missing client does not invent a sentence', async () => {
    const result = await personaReply(null, { persona: 'Kari', message: 'How is exam week?', history: [] });
    expect(result.text).toBeNull();
    expect(result.error).toMatch(/not configured/);
  });
});
