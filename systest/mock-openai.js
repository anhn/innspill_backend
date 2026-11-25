// OpenAI-compatible mock used for system testing (api.openai.com is unreachable from the test environment).
// Returns schema-plausible responses for every AI agent in AI4EDU and supports fault injection via POST /__mode.
const __ROOT = require('path').resolve(__dirname, '.');
const http = require('http');
const fs = require('fs');
const PORT = process.env.MOCK_PORT || 4010;
const LOG = process.env.MOCK_LOG || `${__ROOT}/results/mock-openai-calls.jsonl`;
let mode = 'ok'; // ok | error500 | error429 | garbage | slow | empty
let calls = 0;

function universal(prompt) {
  const m = prompt.match(/(\d+)\s*(?:multiple[- ]choice\s*)?questions/i);
  const n = Math.min(parseInt(m?.[1] || '5', 10) || 5, 50);
  const questions = Array.from({ length: n }, (_, i) => ({
    id: `q${i + 1}`, question: `Mock question ${i + 1}?`,
    options: ['Option A', 'Option B', 'Option C', 'Option D'], correctAnswer: i % 4,
  }));
  return {
    // quiz
    questions,
    // feedback generation
    feedback: 'Mock feedback: the submission addresses the task.', feedforward: 'Mock feedforward: add evidence.',
    concept: 'Mock concept analysis.', reflection: 'Mock reflection.', criticalThinking: 'Mock critical thinking.',
    taskQualityScore: 4, reflectionScore: 3, criticalthinkingScore: 3, conceptMasteryScore: 4,
    // prompt revision
    analysis: 'Mock analysis of the prompt.', revisedPrompt: 'Mock revised prompt.',
    // worksheets
    title: 'Mock Worksheet', instructionPage: 'Mock instructions', worksheetContent: { title: 'Mock Worksheet', sections: [] },
    answerSheet: 'Mock answers', learningObjectives: ['LO1: Understand testing', 'LO2: Apply testing'],
    formatDescription: 'Mock format description', examples: ['Example 1', 'Example 2'],
    // course plan analysis
    major: 'Applied Sciences', approaches: ['Active learning'], activities: ['Lecture'], types: ['Project'],
    learningOutcomes: ['Mock LO'], teachingActivities: ['Mock activity'], assignments: ['Mock assignment'],
    readingMaterials: ['Mock reading'], policyAndTransparency: {}, assessment: 'Mock assessment',
  };
}

function reply(body) {
  const msgs = body.messages || [];
  const prompt = msgs.map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  const wantsArray = /JSON arrays?/i.test(prompt) && /learningObjective|alignment/i.test(prompt);
  const wantsJson = /json/i.test(prompt) || body.response_format;
  if (wantsArray) return JSON.stringify([{ learningObjective: 'Mock LO', taskIds: [], roleIds: [], quizQuestionIds: [] }]);
  if (wantsJson) return '```json\n' + JSON.stringify(universal(prompt)) + '\n```';
  return '## Mock AI response\n\nThis is a deterministic mock response for system testing.\n\n- Point one\n- Point two';
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    if (req.url === '/__mode') { mode = JSON.parse(raw || '{}').mode || 'ok'; res.end(JSON.stringify({ mode })); return; }
    if (req.url === '/__stats') { res.end(JSON.stringify({ calls, mode })); return; }
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch {}
    calls++;
    fs.appendFile(LOG, JSON.stringify({ t: Date.now(), url: req.url, model: body.model, mode,
      chars: raw.length, stream: !!body.stream }) + '\n', () => {});
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (mode === 'error500') return send(500, { error: { message: 'mock upstream failure', type: 'server_error' } });
    if (mode === 'error429') return send(429, { error: { message: 'Rate limit reached', type: 'rate_limit' } });
    if (mode === 'slow') return setTimeout(() => send(200, completion(body)), 65000);
    if (req.url.includes('/embeddings')) {
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return send(200, { object: 'list', model: body.model, data: inputs.map((_, i) => ({ object: 'embedding', index: i,
        embedding: Array.from({ length: 3072 }, (_, k) => Math.sin(k + i)) })), usage: { prompt_tokens: 1, total_tokens: 1 } });
    }
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const text = reply(body);
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      return res.end('data: [DONE]\n\n');
    }
    send(200, completion(body));
  });
});

function completion(body) {
  let content = reply(body);
  if (mode === 'garbage') content = '<<<not json at all {{{';
  if (mode === 'empty') content = '';
  return { id: 'chatcmpl-mock', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: body.model || 'gpt-4o-mini',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
}

server.listen(PORT, '127.0.0.1', () => console.log('mock openai on', PORT));
