// Robustness: upstream AI failures (fault injection on the mock), database stall, malformed input.
// Run ONLY when no other suite is running (it changes the mock mode and pauses MongoDB).
const { suite } = require('../lib');
const MOCK = 'http://127.0.0.1:4010';
const setMode = m => fetch(MOCK + '/__mode', { method: 'POST', body: JSON.stringify({ mode: m }) });
const alive = async () => (await fetch('http://localhost:3000/health').catch(() => null))?.status === 200;

suite('BE-ROB', async (t, h) => {
  const T = (await h.makeUser('teacher', 'rob')).client;
  const P = 'rob-' + h.uid();
  const course = await T.post('/courses', { name: `${P} course`, code: P, academicYear: '2026-2027', university: 'USN' });
  const courseId = course.body?.data?.id || course.body?.data?._id || course.body?.data?.courseId;
  const proj = await T.post('/projects', { projectTitle: `${P} project`, courseId, courseDescription: 'Desc', learningOutcome: 'Understand testing', keyMilestones: 'M1' });
  const projectId = proj.body?.data?.id;
  const teacherInfo = { educationLevel: 'University', subjectArea: 'Software', country: 'Norway', academicYear: '2026-2027', organization: 'USN', language: 'English' };
  const AI = [
    ['chatbot/asks', () => T.post('/chatbot/asks', { message: 'Help me plan a course', context: { currentContent: 'x', userName: 'rob', teacherInfo } }, { timeout: 200000 })],
    ['assessment-quizzes/generate', () => T.post('/assessment-quizzes/generate', { projectId, numberOfQuestions: 3, keywords: ['testing'] }, { timeout: 200000 })],
    ['prompts/revise', () => T.post('/prompts/revise', { prompt: 'write an essay', userName: 'rob' }, { timeout: 200000 })],
  ];
  await t('ROB-00', 'Baseline: AI endpoints succeed with healthy upstream', { req: 'AI features work', steps: 'Mock mode ok; call 3 AI endpoints', expected: '200 for all', type: 'robustness' }, async () => {
    await setMode('ok');
    const out = []; for (const [n, f] of AI) { const r = await f(); out.push(`${n}=${r.status}`); }
    return { pass: out.every(x => x.endsWith('=200')), actual: out.join(', ') + ` (course=${course.status}, project=${proj.status})` };
  });
  let n = 1;
  for (const [mode, expect] of [['error500', 'clean 5xx/502/503 JSON error, server stays up'], ['error429', 'clean 429/503 JSON "try again later" error, server stays up'],
    ['garbage', 'graceful fallback or clean error (no crash, no corrupt data saved)'], ['empty', 'clean error or fallback, no crash']]) {
    for (const [name, f] of AI) {
      const id = `ROB-${String(n++).padStart(2, '0')}`;
      await t(id, `${name} when OpenAI returns ${mode}`, { req: 'Graceful degradation when AI provider fails', steps: `Mock mode=${mode}; call ${name}`, expected: expect, type: 'robustness' }, async () => {
        await setMode(mode);
        const r = await f();
        await setMode('ok');
        const up = await alive();
        const clean = r.status > 0 && r.body && r.body.success === false;
        const ok = up && (mode === 'garbage' || mode === 'empty' ? (r.status === 200 || clean) : (r.status >= 500 || r.status === 429) && clean);
        const leaks = /stack|node_modules|\/home\//.test(r.text);
        return { pass: ok && !leaks, actual: `${r.status} in ${r.ms}ms, serverUp=${up}${leaks ? ', stack leaked' : ''}: ${r.text.replace(/\s+/g, ' ').slice(0, 150)}`, severity: !up ? 'Critical' : 'Medium' };
      });
    }
  }
  await t('ROB-20', 'Status code distinguishes upstream rate-limit from server bug', { req: 'Clients can tell "try later" from "broken"', steps: 'Mock 429 on chatbot/asks', expected: '429 or 503 (not generic 500)', type: 'robustness' }, async () => {
    await setMode('error429'); const r = await AI[0][1](); await setMode('ok');
    return { pass: [429, 503].includes(r.status), actual: `${r.status} ${r.text.slice(0, 120)}`, severity: 'Low' };
  });
  await t('ROB-21', 'Slow AI upstream: request is bounded by a server-side timeout', { req: 'Requests do not hang indefinitely', steps: 'Mock delays 65 s; call assessment-quizzes/generate (client waits up to 150 s)', expected: 'Server answers (success or timeout error) — note total time', type: 'robustness' }, async () => {
    await setMode('slow'); const r = await T.post('/assessment-quizzes/generate', { projectId, numberOfQuestions: 2 }, { timeout: 150000 }); await setMode('ok');
    return { pass: r.status > 0, actual: `${r.status} after ${(r.ms / 1000).toFixed(1)} s: ${(r.text || r.error || '').slice(0, 120)}` };
  });

  // ---- Malformed / extreme input ----
  const bad = [
    ['ROB-30', 'Invalid JSON body', () => T.req('POST', '/courses', '{bad json', {}), r => r.status === 400],
    ['ROB-31', 'Array instead of object body', () => T.post('/courses', [1, 2, 3]), r => r.status === 400],
    ['ROB-32', 'Wrong types (numbers/objects for strings)', () => T.post('/courses', { name: { $gt: '' }, code: 123, academicYear: [], university: true }), r => r.status === 400],
    ['ROB-33', '1 MB string in a name field', () => T.post('/courses', { name: 'x'.repeat(1_000_000), code: P + 'big', academicYear: '2026', university: 'USN' }), r => r.status === 400 || r.status === 413],
    ['ROB-34', 'Unicode / emoji / RTL text round-trip', async () => { const name = `${P} Kurs ÆØÅ 测试 🚀 مرحبا`; const c = await T.post('/courses', { name, code: P + 'u', academicYear: '2026-2027', university: 'USN' }); const id = c.body?.data?.id; const { MongoClient } = require('mongodb'); const mc = await MongoClient.connect('mongodb://127.0.0.1:27017/?replicaSet=rs0'); const doc = await mc.db('ai4edu_database').collection('courses').findOne({ code: P + 'u' }); await mc.close(); return { status: c.status, body: { stored: doc?.name, created: c.body?.data?.name }, text: `stored="${doc?.name}"` }; }, r => r.status === 201 && (r.body.stored || '').includes('ÆØÅ 测试 🚀 مرحبا') && (r.body.created || '').includes('ÆØÅ 测试 🚀')],
    ['ROB-35', 'Deeply nested JSON (5,000 levels)', () => T.req('POST', '/logs/track', '{"a":'.repeat(5000) + '1' + '}'.repeat(5000), {}), r => r.status < 500],
    ['ROB-36', 'Invalid ObjectId in path', () => T.get('/projects/not-an-id'), r => r.status === 400 || r.status === 404],
    ['ROB-37', 'Wrong Content-Type (text/plain)', () => T.req('POST', '/courses', 'name=x', { headers: { 'content-type': 'text/plain' } }), r => r.status === 400],
  ];
  for (const [id, title, f, ok] of bad) {
    await t(id, title, { req: 'Malformed input rejected cleanly', steps: title, expected: '4xx (clean), no 500, no stack trace, server stays up', type: 'robustness' }, async () => {
      const r = await f(); const up = await alive();
      const leak = /"stack"|node_modules/.test(r.text || '');
      return { pass: ok(r) && up && !leak, actual: `${r.status} ${leak ? '[stack leaked] ' : ''}${(r.text || r.error || '').replace(/\s+/g, ' ').slice(0, 130)} serverUp=${up}`, severity: up ? 'Medium' : 'Critical' };
    });
  }
  await setMode('ok');
});
