const { suite } = require('../lib');
const { MongoClient } = require('mongodb');

suite('BE-AI', async (t, h) => {
  const P = 'ai-' + h.uid();
  const mc = await MongoClient.connect('mongodb://127.0.0.1:27017/?replicaSet=rs0');
  const db = mc.db('ai4edu_database');
  const { ObjectId } = require('mongodb');
  const FAKE_ID = new ObjectId().toString();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // Poll action_log for the entry written asynchronously on 'finish'
  const findLog = async (filter) => {
    for (let i = 0; i < 20; i++) { const d = await db.collection('action_log').findOne(filter, { sort: { _id: -1 } }); if (d) return d; await sleep(150); }
    return null;
  };

  const teacher = await h.makeUser('teacher', P);
  const teacherB = await h.makeUser('teacher', P + 'b');
  const T = teacher.client;
  const userA = teacher.username;
  const userB = teacherB.username;

  // ======================= CHATBOT =======================
  const teacherInfo = { educationLevel: 'University', subjectArea: 'Computer Science', country: 'Norway', academicYear: '2025-2026', organization: 'Universitetet i Sørøst-Norge (USN)', language: 'English' };
  const ctx = (extra = {}) => ({ currentContent: 'Course: Intro to Programming\nWeek 1: Variables\nAssessment: written essay', searchAIApplications: 'Intro to Programming', userName: `${P}-chat-user`, teacherInfo, ...extra });
  const body = (msg, extra) => ({ message: msg, context: ctx(extra) });

  await t('CHAT-01', 'GET /chatbot lists available endpoints', { req: 'Chatbot API index', steps: 'GET /chatbot', expected: '200, success true, endpoints map incl. general-chat' }, async () => {
    const r = await T.get('/chatbot');
    return { pass: r.status === 200 && r.body?.success && !!r.body?.endpoints?.['general-chat'], actual: h.short(r) };
  });
  await t('CHAT-02', 'GET /chatbot/performance reports server status', { req: 'Performance endpoint', steps: 'GET /chatbot/performance', expected: '200, openai.configured true, agents.initialized true' }, async () => {
    const r = await T.get('/chatbot/performance');
    return { pass: r.status === 200 && r.body?.openai?.configured === true && r.body?.agents?.initialized === true, actual: h.short(r) };
  });
  await t('CHAT-03', 'GET /chatbot/agents lists agent types', { req: 'Agent info endpoint', steps: 'GET /chatbot/agents', expected: '200, agents array containing general, create-course-plan, analyze-course-plan' }, async () => {
    const r = await T.get('/chatbot/agents');
    const types = (r.body?.agents || []).map(a => a.type);
    return { pass: r.status === 200 && ['general', 'create-course-plan', 'analyze-course-plan'].every(x => types.includes(x)), actual: `${r.status} types=${types.join(',')}` };
  });
  await t('CHAT-04', 'GET /chatbot/health returns healthy with agent count', { req: 'Health endpoint', steps: 'GET /chatbot/health', expected: '200, agents > 0' }, async () => {
    const r = await T.get('/chatbot/health');
    return { pass: r.status === 200 && r.body?.agents > 0, actual: h.short(r) };
  });

  const aiEndpoints = [
    ['CHAT-05', 'create-course-plan', 'create-course-plan', 'Create a course plan for intro programming'],
    ['CHAT-06', 'update-course-plan', 'update-course-plan', 'Add a week on loops'],
    ['CHAT-07', 'create-lecture-plan', 'create-lecture-plan', 'Create a lecture plan for week 1'],
    ['CHAT-08', 'analyze-feedback', 'analyze-feedback', 'Students said the pace is too fast'],
    ['CHAT-09', 'analyze-a-course-plan', 'analyze-course-plan', 'Analyze this course plan and provide detailed feedback.'],
    ['CHAT-10', 'revise-a-course-plan', 'revise-course-plan', 'Revise the course plan based on the analysis.'],
    ['CHAT-11', 'asks', 'general-chat', 'What is formative assessment?'],
  ];
  for (const [id, path, action, msg] of aiEndpoints) {
    await t(id, `POST /chatbot/${path} returns AI response and logs action`, { req: `AI ${action} via agent`, steps: `Logged-in teacher POST /chatbot/${path} with FE-shaped body (message + context.teacherInfo)`, expected: `200, success, non-empty response string, agent name, usage; action_log row action=${action}` }, async () => {
      const un = `${P}-${action}`;
      const r = await T.post(`/chatbot/${path}`, body(msg, { userName: un }), { timeout: 200000 });
      const okResp = r.status === 200 && r.body?.success === true && typeof r.body?.response === 'string' && r.body.response.length > 0 && !!r.body?.agent && !!r.body?.usage;
      const log = await findLog({ action, 'metadata.userName': un });
      return { pass: okResp && !!log && log.success === true, actual: `${r.status} agent=${r.body?.agent} len=${r.body?.response?.length}; action_log=${log ? 'found success=' + log.success + ' userId=' + log.userId : 'MISSING'}` };
    });
  }
  await t('CHAT-12', 'Reject chatbot request with missing message', { req: 'message required', steps: 'POST /chatbot/asks without message', expected: '400 Invalid request format' }, async () => {
    const r = await T.post('/chatbot/asks', { context: ctx() });
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('CHAT-13', 'Reject chatbot request with missing teacherInfo', { req: 'context.teacherInfo required', steps: 'POST /chatbot/create-course-plan with context without teacherInfo', expected: '400' }, async () => {
    const r = await T.post('/chatbot/create-course-plan', { message: 'x', context: { currentContent: 'abc' } });
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('CHAT-14', 'Reject invalid educationLevel value', { req: 'educationLevel enum', steps: 'POST /chatbot/analyze-a-course-plan with educationLevel=Kindergarten', expected: '400' }, async () => {
    const r = await T.post('/chatbot/analyze-a-course-plan', body('x', { teacherInfo: { ...teacherInfo, educationLevel: 'Kindergarten' } }));
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('CHAT-15', 'Reject message longer than 5000 chars', { req: 'message max 5000', steps: 'POST /chatbot/revise-a-course-plan with 5001-char message', expected: '400' }, async () => {
    const r = await T.post('/chatbot/revise-a-course-plan', body('a'.repeat(5001)));
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('CHAT-16', 'Chat panel payload (educationLevel "Elementary") accepted', { req: 'FE ChatPanel (components/ChatPanel.tsx:133-156) sends educationLevel "Elementary" for primary/default users', steps: 'POST /chatbot/asks with the exact ChatPanel default body (educationLevel Elementary, subject Math, org University of Oslo)', expected: '200 AI response (FE/BE contract must match)', severity: 'High' }, async () => {
    const r = await T.post('/chatbot/asks', { message: 'Hjelp meg med en mattepensum', context: { currentContent: 'Jeg jobber med en mattepensum for min 3. klasse', userName: 'Guest', teacherInfo: { educationLevel: 'Elementary', subjectArea: 'Math', country: 'Norway', academicYear: '2023-2024', organization: 'University of Oslo', language: 'Norwegian' } } });
    return { pass: r.status === 200, actual: h.short(r) };
  });
  await t('CHAT-17', 'Reject empty organization in teacherInfo', { req: 'organization required (non-empty string)', steps: 'POST /chatbot/update-course-plan with organization ""', expected: '400' }, async () => {
    const r = await T.post('/chatbot/update-course-plan', body('x', { teacherInfo: { ...teacherInfo, organization: '' } }));
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('CHAT-18', 'Debug endpoint /test-token-usage handles bad input without 500', { req: 'No unvalidated debug endpoints; bad input -> 4xx', steps: 'POST /chatbot/test-token-usage with {}', expected: '404 (endpoint not exposed) or 400 validation error; not 500', severity: 'Medium' }, async () => {
    const r = await new h.Client().post('/chatbot/test-token-usage', {});
    return { pass: r.status === 400 || r.status === 404, actual: h.short(r) };
  });
  await t('CHAT-19', 'Chatbot AI and diagnostics endpoints require authentication', { req: 'AI generation endpoints (paid OpenAI calls) and server diagnostics should not be anonymous', steps: 'Fresh client (no session): POST /chatbot/asks valid body; GET /chatbot/performance', expected: '401/403 for both', type: 'security', severity: 'Medium' }, async () => {
    const anon = new h.Client();
    const a = await anon.post('/chatbot/asks', body('hello'));
    const p = await anon.get('/chatbot/performance');
    const ok = [401, 403].includes(a.status) && [401, 403].includes(p.status);
    return { pass: ok, actual: `anon asks: ${a.status} success=${a.body?.success}; anon performance: ${p.status} (pid/node version exposed=${!!p.body?.server?.pid})` };
  });

  // ======================= PROMPTS =======================
  await t('PRM-01', 'Revise a prompt with AI', { req: 'Prompt revision via PromptRevisionAgent', steps: 'POST /prompts/revise {prompt, userName}', expected: '200, data.analysis and data.revisedPrompt non-empty; action_log revise-prompt row' }, async () => {
    const r = await T.post('/prompts/revise', { prompt: 'write an essay about climate', userName: userA });
    const log = await findLog({ action: 'revise-prompt', 'metadata.userName': userA });
    return { pass: r.status === 200 && !!r.body?.data?.analysis && !!r.body?.data?.revisedPrompt && !!log, actual: `${h.short(r)}; log=${!!log}` };
  });
  await t('PRM-02', 'Revise rejects missing prompt / userName', { req: 'prompt & userName required', steps: 'POST /prompts/revise {userName} and {prompt}', expected: '400 both' }, async () => {
    const a = await T.post('/prompts/revise', { userName: userA });
    const b = await T.post('/prompts/revise', { prompt: 'x' });
    return { pass: a.status === 400 && b.status === 400, actual: `noPrompt ${a.status}; noUser ${b.status}` };
  });
  let promptId;
  await t('PRM-03', 'Save a prompt and read it back', { req: 'Create prompt', steps: 'POST /prompts then GET /prompts/:id', expected: '201 with id; GET returns same fields' }, async () => {
    const r = await T.post('/prompts', { originalPrompt: `${P} orig`, revisedPrompt: `${P} revised`, analysis: 'analysis text', topic: 'Climate', userName: userA });
    promptId = r.body?.data?.id;
    const g = promptId ? await T.get(`/prompts/${promptId}`) : null;
    return { pass: r.status === 201 && g?.status === 200 && g.body?.data?.originalPrompt === `${P} orig` && g.body?.data?.topic === 'Climate' && g.body?.data?.userName === userA, actual: `create ${h.short(r)} | get ${g?.status}` };
  });
  await t('PRM-04', 'Save prompt rejects missing analysis', { req: 'analysis required', steps: 'POST /prompts without analysis', expected: '400, nothing saved' }, async () => {
    const r = await T.post('/prompts', { originalPrompt: `${P} noanalysis`, revisedPrompt: 'r', userName: userA });
    const n = await db.collection('prompts').countDocuments({ originalPrompt: `${P} noanalysis` });
    return { pass: r.status === 400 && n === 0, actual: `${h.short(r)}; saved=${n}` };
  });
  await t('PRM-05', 'List prompts filtered by userName, newest first', { req: 'List user prompts', steps: 'Create 2nd prompt for A and one for B; GET /prompts?userName=A', expected: '200, only A prompts, sorted createdAt desc' }, async () => {
    await T.post('/prompts', { originalPrompt: `${P} orig2`, revisedPrompt: 'r2', analysis: 'a2', userName: userA });
    await teacherB.client.post('/prompts', { originalPrompt: `${P} origB`, revisedPrompt: 'rB', analysis: 'aB', userName: userB });
    const r = await T.get(`/prompts?userName=${encodeURIComponent(userA)}`);
    const d = r.body?.data || [];
    const onlyA = d.length >= 2 && d.every(p => p.userName === userA);
    const sorted = d.every((p, i) => i === 0 || new Date(d[i - 1].createdAt) >= new Date(p.createdAt));
    return { pass: r.status === 200 && onlyA && sorted && d[0].originalPrompt === `${P} orig2`, actual: `${r.status} count=${d.length} onlyA=${onlyA} sorted=${sorted}` };
  });
  await t('PRM-06', 'List prompts without userName rejected', { req: 'userName query required', steps: 'GET /prompts', expected: '400' }, async () => {
    const r = await T.get('/prompts');
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('PRM-07', 'Get prompt with invalid / unknown id', { req: 'ID validation', steps: 'GET /prompts/abc and /prompts/<random ObjectId>', expected: '400 and 404' }, async () => {
    const a = await T.get('/prompts/abc');
    const b = await T.get(`/prompts/${FAKE_ID}`);
    return { pass: a.status === 400 && b.status === 404, actual: `invalid ${a.status}; unknown ${b.status}` };
  });
  await t('PRM-08', 'Update own prompt and verify persisted', { req: 'Update prompt', steps: 'PUT /prompts/:id {revisedPrompt, topic:"", userName:A}; GET', expected: '200; revisedPrompt updated, topic cleared' }, async () => {
    const r = await T.put(`/prompts/${promptId}`, { revisedPrompt: `${P} revised v2`, topic: '', userName: userA });
    const doc = await db.collection('prompts').findOne({ _id: new ObjectId(promptId) });
    return { pass: r.status === 200 && doc?.revisedPrompt === `${P} revised v2` && !doc?.topic, actual: `${h.short(r)}; db topic=${doc?.topic}` };
  });
  await t('PRM-09', 'Update by non-owner userName is forbidden', { req: 'Ownership check', steps: 'PUT /prompts/:id with userName=B', expected: '403, unchanged' }, async () => {
    const r = await T.put(`/prompts/${promptId}`, { revisedPrompt: 'hacked', userName: userB });
    const doc = await db.collection('prompts').findOne({ _id: new ObjectId(promptId) });
    return { pass: r.status === 403 && doc?.revisedPrompt !== 'hacked', actual: `${h.short(r)}` };
  });
  await t('PRM-10', 'Update validation: only userName / unknown id / invalid id', { req: 'At least one field; ID checks', steps: 'PUT {userName} ; PUT unknown id ; PUT /prompts/xyz', expected: '400, 404, 400' }, async () => {
    const a = await T.put(`/prompts/${promptId}`, { userName: userA });
    const b = await T.put(`/prompts/${FAKE_ID}`, { analysis: 'x', userName: userA });
    const c = await T.put('/prompts/xyz', { analysis: 'x', userName: userA });
    return { pass: a.status === 400 && b.status === 404 && c.status === 400, actual: `onlyUser ${a.status}; unknown ${b.status}; invalid ${c.status}` };
  });
  await t('PRM-11', 'Delete validation: missing userName / wrong owner', { req: 'Delete requires owner', steps: 'DELETE without body; DELETE with userName=B', expected: '400, 403; prompt still exists' }, async () => {
    const a = await T.del(`/prompts/${promptId}`, {});
    const b = await T.del(`/prompts/${promptId}`, { userName: userB });
    const n = await db.collection('prompts').countDocuments({ _id: new ObjectId(promptId) });
    return { pass: a.status === 400 && b.status === 403 && n === 1, actual: `noUser ${a.status}; wrongOwner ${b.status}; exists=${n}` };
  });
  await t('PRM-12', 'Delete own prompt', { req: 'Delete prompt', steps: 'DELETE /prompts/:id {userName:A}; GET', expected: '200; GET 404; second delete 404' }, async () => {
    const r = await T.del(`/prompts/${promptId}`, { userName: userA });
    const g = await T.get(`/prompts/${promptId}`);
    const r2 = await T.del(`/prompts/${promptId}`, { userName: userA });
    return { pass: r.status === 200 && g.status === 404 && r2.status === 404, actual: `del ${r.status}; get ${g.status}; del again ${r2.status}` };
  });
  await t('PRM-13', 'Prompts: anonymous / other-user access to user A data', { req: 'Users may only read/modify their own prompts (identity from session)', steps: 'A creates prompt. (1) Anonymous GET /prompts/:id and GET /prompts?userName=A. (2) User B (own session) PUT/DELETE A\'s prompt passing userName=A in body', expected: '401/403 for all; A\'s prompt unchanged', type: 'security', severity: 'Critical' }, async () => {
    const c = await T.post('/prompts', { originalPrompt: `${P} victim`, revisedPrompt: 'r', analysis: 'a', userName: userA });
    const id = c.body?.data?.id;
    const anon = new h.Client();
    const g = await anon.get(`/prompts/${id}`);
    const l = await anon.get(`/prompts?userName=${encodeURIComponent(userA)}`);
    const u = await teacherB.client.put(`/prompts/${id}`, { revisedPrompt: 'tampered by B', userName: userA });
    const d = await teacherB.client.del(`/prompts/${id}`, { userName: userA });
    const exists = await db.collection('prompts').countDocuments({ _id: new ObjectId(id) });
    const ok = [g, l, u, d].every(r => [401, 403].includes(r.status));
    return { pass: ok, actual: `anon get ${g.status}; anon list ${l.status} (${(l.body?.data || []).length} items); B update-as-A ${u.status}; B delete-as-A ${d.status}; A's prompt exists=${exists}` };
  });

  // ======================= WORKSHEETS =======================
  const SUBJ = `${P}-Math`;
  await db.collection('worksheet_template').insertOne({ template_id: `${P}-tpl`, education_level: 'high-school', year: '10', subject: SUBJ, learning_objectives: ['LO1', 'LO2', 'LO3', 'LO4'], format_description: `${P} format desc`, examples: ['EX1', 'EX2', 'EX3', 'EX4'], createdAt: new Date(), updatedAt: new Date() });
  const wsBase = { educationLevel: 'high-school', year: '10', subjectArea: SUBJ, learningObjective: 'Add fractions', difficultyLevel: 'medium', userName: userA };

  await t('WKS-01', 'Learning objectives from matching template', { req: 'Learning objectives from worksheet_template', steps: 'Insert template; POST /worksheets/generate-learning-objectives {educationLevel, year, subjectArea}', expected: '200, first 3 objectives joined by blank line' }, async () => {
    const r = await T.post('/worksheets/generate-learning-objectives', { educationLevel: 'high-school', year: '10', subjectArea: SUBJ, userName: userA });
    return { pass: r.status === 200 && r.body?.data?.learningObjectives === 'LO1\n\nLO2\n\nLO3', actual: h.short(r) };
  });
  await t('WKS-02', 'Learning objectives rejects invalid educationLevel', { req: 'educationLevel enum', steps: 'POST generate-learning-objectives educationLevel=college', expected: '400' }, async () => {
    const r = await T.post('/worksheets/generate-learning-objectives', { educationLevel: 'college' });
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('WKS-03', 'Format description from matching template', { req: 'Format description from template', steps: 'POST /worksheets/generate-format-description full body', expected: '200, formatDescription = template value' }, async () => {
    const { userName, ...rest } = wsBase;
    const r = await T.post('/worksheets/generate-format-description', { ...rest, userName });
    return { pass: r.status === 200 && r.body?.data?.formatDescription === `${P} format desc`, actual: h.short(r) };
  });
  await t('WKS-04', 'Format description rejects missing difficultyLevel', { req: 'difficultyLevel required', steps: 'POST generate-format-description without difficultyLevel', expected: '400' }, async () => {
    const { difficultyLevel, ...rest } = wsBase;
    const r = await T.post('/worksheets/generate-format-description', rest);
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('WKS-05', 'Examples from matching template', { req: 'Examples from template', steps: 'POST /worksheets/generate-examples full body', expected: '200, first 3 examples joined' }, async () => {
    const r = await T.post('/worksheets/generate-examples', { ...wsBase, formatDescription: 'MCQ' });
    return { pass: r.status === 200 && r.body?.data?.examples === 'EX1\n\nEX2\n\nEX3', actual: h.short(r) };
  });
  await t('WKS-06', 'Examples rejects invalid difficultyLevel', { req: 'difficultyLevel enum', steps: 'POST generate-examples difficultyLevel=extreme', expected: '400' }, async () => {
    const r = await T.post('/worksheets/generate-examples', { ...wsBase, formatDescription: 'MCQ', difficultyLevel: 'extreme' });
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('WKS-07', 'Generate a full worksheet with AI', { req: 'Worksheet generation via agent', steps: 'POST /worksheets/generate full body', expected: '200, worksheetContent present, title, metadata echoes inputs; action_log generate-worksheet row' }, async () => {
    const r = await T.post('/worksheets/generate', { ...wsBase, language: 'English', formatDescription: 'MCQ', examples: 'EX1', references: '' }, { timeout: 200000 });
    const d = r.body?.data;
    const log = await findLog({ action: 'generate-worksheet', 'metadata.userName': userA });
    return { pass: r.status === 200 && !!d?.worksheetContent && !!d?.title && d?.metadata?.subjectArea === SUBJ && d?.metadata?.language === 'English' && !!log, actual: `${h.short(r)}; log=${!!log}` };
  });
  await t('WKS-08', 'Generate rejects missing formatDescription', { req: 'formatDescription required', steps: 'POST /worksheets/generate without formatDescription', expected: '400' }, async () => {
    const r = await T.post('/worksheets/generate', wsBase);
    return { pass: r.status === 400, actual: h.short(r) };
  });
  let wsId;
  const wsSave = { ...wsBase, title: `${P} Worksheet 1`, content: '{"title":"Fractions","sections":[]}', language: 'English', formatDescription: 'MCQ', instructionPage: 'Read carefully', answerSheet: 'A,B,C', printoutLayoutOptions: { columns: 2 } };
  await t('WKS-09', 'Save worksheet and read it back', { req: 'Save worksheet', steps: 'POST /worksheets then GET /worksheets/:id', expected: '201 with id; GET returns content, instructionPage, layout options' }, async () => {
    const r = await T.post('/worksheets', wsSave);
    wsId = r.body?.data?.id;
    const g = wsId ? await T.get(`/worksheets/${wsId}`) : null;
    const d = g?.body?.data;
    return { pass: r.status === 201 && g?.status === 200 && d?.content === wsSave.content && d?.instructionPage === 'Read carefully' && d?.printoutLayoutOptions?.columns === 2 && d?.userName === userA, actual: `create ${h.short(r).slice(0, 120)} | get ${g?.status}` };
  });
  await t('WKS-10', 'Save worksheet rejects invalid difficulty / missing title', { req: 'Save validation', steps: 'POST /worksheets with difficultyLevel=extreme; and without title', expected: '400 both; nothing saved' }, async () => {
    const a = await T.post('/worksheets', { ...wsSave, title: `${P} bad`, difficultyLevel: 'extreme' });
    const { title, ...noTitle } = wsSave;
    const b = await T.post('/worksheets', noTitle);
    const n = await db.collection('worksheets').countDocuments({ title: `${P} bad` });
    return { pass: a.status === 400 && b.status === 400 && n === 0, actual: `badDifficulty ${a.status}; noTitle ${b.status}; saved=${n}` };
  });
  await t('WKS-11', 'List worksheets with pagination and filters', { req: 'List with pagination/filters, content excluded', steps: 'Save 2 more (one elementary); GET ?userName=A&limit=2; GET ?educationLevel=elementary', expected: '200; total=3, totalPages=2, 2 items, no content field; filter returns 1' }, async () => {
    await T.post('/worksheets', { ...wsSave, title: `${P} Worksheet 2` });
    await T.post('/worksheets', { ...wsSave, title: `${P} Worksheet 3`, educationLevel: 'elementary' });
    const r = await T.get(`/worksheets?userName=${encodeURIComponent(userA)}&limit=2&page=1`);
    const f = await T.get(`/worksheets?userName=${encodeURIComponent(userA)}&educationLevel=elementary`);
    const pg = r.body?.data?.pagination; const items = r.body?.data?.worksheets || [];
    const ok = r.status === 200 && pg?.total === 3 && pg?.totalPages === 2 && items.length === 2 && items.every(w => w.content === undefined) && f.body?.data?.worksheets?.length === 1;
    return { pass: ok, actual: `${r.status} pagination=${JSON.stringify(pg)} items=${items.length}; filter=${f.body?.data?.worksheets?.length}` };
  });
  await t('WKS-12', 'List worksheets query validation', { req: 'userName required, limit<=100', steps: 'GET /worksheets ; GET ?userName=A&limit=101', expected: '400 both' }, async () => {
    const a = await T.get('/worksheets');
    const b = await T.get(`/worksheets?userName=${encodeURIComponent(userA)}&limit=101`);
    return { pass: a.status === 400 && b.status === 400, actual: `noUser ${a.status}; limit101 ${b.status}` };
  });
  await t('WKS-13', 'Get worksheet with invalid / unknown id', { req: 'ID validation', steps: 'GET /worksheets/nope and /worksheets/<random ObjectId>', expected: '400 and 404' }, async () => {
    const a = await T.get('/worksheets/nope');
    const b = await T.get(`/worksheets/${FAKE_ID}`);
    return { pass: a.status === 400 && b.status === 404, actual: `invalid ${a.status}; unknown ${b.status}` };
  });
  await t('WKS-14', 'Update own worksheet and verify persisted', { req: 'Update worksheet', steps: 'PUT /worksheets/:id {title, difficultyLevel:hard, answerSheet:"" , userName:A}; read DB', expected: '200; title & difficulty updated, answerSheet cleared' }, async () => {
    const r = await T.put(`/worksheets/${wsId}`, { title: `${P} Worksheet 1 v2`, difficultyLevel: 'hard', answerSheet: '', userName: userA });
    const doc = await db.collection('worksheets').findOne({ _id: new ObjectId(wsId) });
    return { pass: r.status === 200 && doc?.title === `${P} Worksheet 1 v2` && doc?.difficultyLevel === 'hard' && !doc?.answerSheet, actual: `${h.short(r).slice(0, 120)}; db title=${doc?.title}` };
  });
  await t('WKS-15', 'Update validation: wrong owner / unknown id / invalid enum', { req: 'Ownership + validation', steps: 'PUT with userName=B; PUT unknown id; PUT educationLevel=college', expected: '403, 404, 400; unchanged' }, async () => {
    const a = await T.put(`/worksheets/${wsId}`, { title: 'hacked', userName: userB });
    const b = await T.put(`/worksheets/${FAKE_ID}`, { title: 'x', userName: userA });
    const c = await T.put(`/worksheets/${wsId}`, { educationLevel: 'college', userName: userA });
    const doc = await db.collection('worksheets').findOne({ _id: new ObjectId(wsId) });
    return { pass: a.status === 403 && b.status === 404 && c.status === 400 && doc?.title !== 'hacked', actual: `wrongOwner ${a.status}; unknown ${b.status}; badEnum ${c.status}` };
  });
  await t('WKS-16', 'Delete worksheet: validation, wrong owner, success', { req: 'Delete worksheet', steps: 'DELETE without userName; with userName=B; with userName=A; GET', expected: '400, 403, 200; then GET 404' }, async () => {
    const a = await T.del(`/worksheets/${wsId}`, {});
    const b = await T.del(`/worksheets/${wsId}`, { userName: userB });
    const c = await T.del(`/worksheets/${wsId}`, { userName: userA });
    const g = await T.get(`/worksheets/${wsId}`);
    return { pass: a.status === 400 && b.status === 403 && c.status === 200 && g.status === 404, actual: `noUser ${a.status}; wrongOwner ${b.status}; owner ${c.status}; get after ${g.status}` };
  });
  await t('WKS-17', 'Worksheets: anonymous / other-user access to user A data', { req: 'Users may only read/modify their own worksheets (identity from session)', steps: 'A saves worksheet. (1) Anonymous GET /worksheets/:id and list ?userName=A. (2) User B (own session) PUT/DELETE A\'s worksheet passing userName=A', expected: '401/403 for all; A\'s worksheet intact', type: 'security', severity: 'Critical' }, async () => {
    const c = await T.post('/worksheets', { ...wsSave, title: `${P} victim ws` });
    const id = c.body?.data?.id;
    const anon = new h.Client();
    const g = await anon.get(`/worksheets/${id}`);
    const l = await anon.get(`/worksheets?userName=${encodeURIComponent(userA)}`);
    const u = await teacherB.client.put(`/worksheets/${id}`, { title: 'tampered by B', userName: userA });
    const d = await teacherB.client.del(`/worksheets/${id}`, { userName: userA });
    const exists = await db.collection('worksheets').countDocuments({ _id: new ObjectId(id) });
    const ok = [g, l, u, d].every(r => [401, 403].includes(r.status));
    return { pass: ok, actual: `anon get ${g.status}; anon list ${l.status} (${l.body?.data?.pagination?.total} items); B update-as-A ${u.status}; B delete-as-A ${d.status}; A's worksheet exists=${exists}` };
  });

  // ======================= CHAT MESSAGES (stakeholder chat) =======================
  const student = await h.makeUser('student', P);
  const studentB = await h.makeUser('student', P + 'b');
  const S = student.client;
  const sid = student.username;
  let projectId, roleId, setupErr = '';
  {
    const c = await T.post('/courses', { name: `${P} course`, code: 'AI101', academicYear: '2025-2026', university: 'USN', teacherId: userA });
    const courseId = c.body?.data?.id;
    const p = await T.post('/projects', { projectTitle: `${P} project`, courseId, courseDescription: 'Build an app for a library', keyMilestones: 'M1 requirements; M2 prototype', teacherId: userA });
    projectId = p.body?.data?.id;
    const r = await T.post('/assessment-roles', { projectId, name: `${P} Librarian`, persona: 'You are the head librarian, practical and concise.' });
    roleId = r.body?.data?.id;
    if (!roleId) setupErr = `course ${c.status} project ${p.status} role ${r.status} ${r.text.slice(0, 120)}`;
  }
  const roleName = `${P} Librarian`;
  let chatSessionId;
  await t('MSG-01', 'Student sends message to stakeholder (new session)', { req: 'Stakeholder chat: student message + AI persona reply', steps: 'Setup course/project/role via API; student POST /chat-messages {studentId, stakeholderId, projectId, message}', expected: '201; session created; studentMessage.sender = student full name; stakeholderResponse from role name with openAIMetrics; DB session has 2 chatItems and projectId' }, async () => {
    if (!roleId) return { pass: false, actual: 'setup failed: ' + setupErr };
    const r = await S.post('/chat-messages', { studentId: sid, stakeholderId: roleId, projectId, message: 'What features do you need?' }, { timeout: 200000 });
    const d = r.body?.data;
    chatSessionId = d?.session?.id;
    const doc = chatSessionId ? await db.collection('chat_sessions').findOne({ _id: new ObjectId(chatSessionId) }) : null;
    const ok = r.status === 201 && d?.studentMessage?.sender === student.user.fullName && d?.stakeholderResponse?.sender === roleName && !!d?.stakeholderResponse?.message && !!d?.stakeholderResponse?.openAIMetrics && d?.session?.projectId === projectId && doc?.chatItems?.length === 2;
    return { pass: ok, actual: `${r.status} studentSender=${d?.studentMessage?.sender} stakeholderSender=${d?.stakeholderResponse?.sender} dbItems=${doc?.chatItems?.length}` };
  });
  const sessionsColl = async () => {
    const names = (await db.listCollections().toArray()).map(c => c.name);
    return names.includes('chat_sessions') ? 'chat_sessions' : (names.find(n => /chat.?session/i.test(n)) || 'chat_sessions');
  };
  const SC = await sessionsColl();
  const getSess = (id) => db.collection(SC).findOne({ _id: new ObjectId(id) });
  await t('MSG-02', 'Continue an existing active session', { req: 'Add to existing session via sessionId', steps: 'POST /chat-messages with sessionId from MSG-01 and custom sender label', expected: '201; same session id; DB session has 4 items; sender label honoured' }, async () => {
    const r = await S.post('/chat-messages', { studentId: sid, stakeholderId: roleId, sessionId: chatSessionId, sender: 'Team Alpha', message: 'When is the deadline?' }, { timeout: 200000 });
    const doc = await getSess(chatSessionId);
    return { pass: r.status === 201 && r.body?.data?.session?.id === chatSessionId && doc?.chatItems?.length === 4 && r.body?.data?.studentMessage?.sender === 'Team Alpha', actual: `${r.status} session=${r.body?.data?.session?.id === chatSessionId ? 'same' : 'different'} dbItems=${doc?.chatItems?.length}` };
  });
  await t('MSG-03', 'Get chat history for student and stakeholder', { req: 'History by student/stakeholder', steps: 'GET /chat-messages/student/:username/stakeholder/:id', expected: '200; session listed; 4 chatItems flat list sorted by time; pagination.total>=1' }, async () => {
    const r = await S.get(`/chat-messages/student/${encodeURIComponent(sid)}/stakeholder/${roleId}`);
    const items = r.body?.data?.chatItems || [];
    const sorted = items.every((x, i) => i === 0 || new Date(items[i - 1].timestamp) <= new Date(x.timestamp));
    return { pass: r.status === 200 && r.body?.data?.sessions?.some(s => s.id === chatSessionId) && items.length === 4 && sorted && r.body?.pagination?.total >= 1, actual: `${r.status} sessions=${r.body?.data?.sessions?.length} items=${items.length} sorted=${sorted}` };
  });
  await t('MSG-04', 'History filter by sessionId and invalid sessionId', { req: 'Optional sessionId filter', steps: 'GET ...?sessionId=<id>; GET ...?sessionId=bad', expected: '200 with exactly that session; 400' }, async () => {
    const a = await S.get(`/chat-messages/student/${encodeURIComponent(sid)}/stakeholder/${roleId}?sessionId=${chatSessionId}`);
    const b = await S.get(`/chat-messages/student/${encodeURIComponent(sid)}/stakeholder/${roleId}?sessionId=bad`);
    return { pass: a.status === 200 && a.body?.data?.sessions?.length === 1 && b.status === 400, actual: `filter ${a.status} n=${a.body?.data?.sessions?.length}; bad ${b.status}` };
  });
  await t('MSG-05', 'History with invalid / unknown stakeholderId', { req: 'Stakeholder validation', steps: 'GET .../stakeholder/xyz; .../stakeholder/<random ObjectId>; limit=0', expected: '400, 404, 400' }, async () => {
    const a = await S.get(`/chat-messages/student/${encodeURIComponent(sid)}/stakeholder/xyz`);
    const b = await S.get(`/chat-messages/student/${encodeURIComponent(sid)}/stakeholder/${FAKE_ID}`);
    const c = await S.get(`/chat-messages/student/${encodeURIComponent(sid)}/stakeholder/${roleId}?limit=0`);
    return { pass: a.status === 400 && b.status === 404 && c.status === 400, actual: `invalid ${a.status}; unknown ${b.status}; limit0 ${c.status}` };
  });
  await t('MSG-06', 'Send validation: missing message / invalid / unknown stakeholder', { req: 'Send validation', steps: 'POST without message; stakeholderId=xyz; stakeholderId=<random ObjectId>', expected: '400, 400, 404; no session created' }, async () => {
    const before = await db.collection(SC).countDocuments({ sender: sid });
    const a = await S.post('/chat-messages', { studentId: sid, stakeholderId: roleId });
    const b = await S.post('/chat-messages', { studentId: sid, stakeholderId: 'xyz', message: 'hi' });
    const c = await S.post('/chat-messages', { studentId: sid, stakeholderId: FAKE_ID, message: 'hi' });
    const after = await db.collection(SC).countDocuments({ sender: sid });
    return { pass: a.status === 400 && b.status === 400 && c.status === 404 && before === after, actual: `noMsg ${a.status}; invalid ${b.status}; unknown ${c.status}; sessions ${before}->${after}` };
  });
  await t('MSG-07', 'Send validation: invalid / unknown projectId', { req: 'projectId validation', steps: 'POST with projectId=bad; projectId=<random ObjectId>', expected: '400, 404' }, async () => {
    const a = await S.post('/chat-messages', { studentId: sid, stakeholderId: roleId, projectId: 'bad', message: 'hi' });
    const b = await S.post('/chat-messages', { studentId: sid, stakeholderId: roleId, projectId: FAKE_ID, message: 'hi' });
    return { pass: a.status === 400 && b.status === 404, actual: `invalid ${a.status}; unknown ${b.status}` };
  });
  await t('MSG-08', 'Send with malformed sessionId is rejected', { req: 'sessionId must be validated (like stakeholderId/projectId)', steps: 'POST /chat-messages with sessionId="not-an-id"', expected: '400 Invalid sessionId; no new session created', severity: 'Medium' }, async () => {
    const before = await db.collection(SC).countDocuments({ sender: sid });
    const r = await S.post('/chat-messages', { studentId: sid, stakeholderId: roleId, sessionId: 'not-an-id', message: 'continue please' }, { timeout: 200000 });
    const after = await db.collection(SC).countDocuments({ sender: sid });
    return { pass: r.status === 400 && before === after, actual: `${r.status} newSession=${r.body?.data?.session?.id !== undefined}; sessions ${before}->${after}` };
  });
  await t('MSG-09', 'Batch fetch messages for student/stakeholder pairs', { req: 'Batch history', steps: 'POST /chat-messages/batch {pairs:[{studentId, stakeholderId}]}', expected: '200; one entry with >=4 messages sorted; meta.processed=1' }, async () => {
    const r = await T.post('/chat-messages/batch', { pairs: [{ studentId: sid, stakeholderId: roleId }] });
    const m = r.body?.data?.[0]?.messages || [];
    return { pass: r.status === 200 && m.length >= 4 && r.body?.meta?.processed === 1, actual: `${r.status} messages=${m.length} meta=${JSON.stringify(r.body?.meta)}` };
  });
  await t('MSG-10', 'Batch validation: mixed, all-invalid, empty, too many', { req: 'Batch partial errors and limits (max 20)', steps: 'pairs mix valid+invalid; all invalid; []; 21 pairs; only unknown stakeholder', expected: '200 with errors[]; 400; 400; 400; 400' }, async () => {
    const a = await T.post('/chat-messages/batch', { pairs: [{ studentId: sid, stakeholderId: roleId }, { studentId: sid, stakeholderId: 'bad' }] });
    const b = await T.post('/chat-messages/batch', { pairs: [{ studentId: sid, stakeholderId: 'bad' }] });
    const c = await T.post('/chat-messages/batch', { pairs: [] });
    const d = await T.post('/chat-messages/batch', { pairs: Array.from({ length: 21 }, () => ({ studentId: sid, stakeholderId: roleId })) });
    const e = await T.post('/chat-messages/batch', { pairs: [{ studentId: sid, stakeholderId: FAKE_ID }] });
    const ok = a.status === 200 && a.body?.errors?.length === 1 && b.status === 400 && c.status === 400 && d.status === 400 && e.status === 400;
    return { pass: ok, actual: `mixed ${a.status} errors=${a.body?.errors?.length}; allInvalid ${b.status}; empty ${c.status}; 21 ${d.status}; unknown ${e.status}` };
  });
  await t('MSG-11', 'End a chat session', { req: 'Close session', steps: 'PUT /chat-messages/session/:id/end; read DB', expected: '200; endTime set; chatItemsCount=4' }, async () => {
    const r = await S.put(`/chat-messages/session/${chatSessionId}/end`);
    const doc = await getSess(chatSessionId);
    return { pass: r.status === 200 && !!doc?.endTime && r.body?.data?.chatItemsCount === 4, actual: `${h.short(r).slice(0, 120)}; db endTime=${doc?.endTime}` };
  });
  await t('MSG-12', 'Ended session cannot be ended again or receive messages', { req: 'State transition: ended is terminal', steps: 'PUT end again; POST message with sessionId of ended session', expected: '400 already ended; 404 active session not found; item count unchanged' }, async () => {
    const a = await S.put(`/chat-messages/session/${chatSessionId}/end`);
    const b = await S.post('/chat-messages', { studentId: sid, stakeholderId: roleId, sessionId: chatSessionId, message: 'still there?' });
    const doc = await getSess(chatSessionId);
    return { pass: a.status === 400 && b.status === 404 && doc?.chatItems?.length === 4, actual: `endAgain ${a.status}; postToEnded ${b.status}; items=${doc?.chatItems?.length}` };
  });
  await t('MSG-13', 'End session with invalid / unknown id', { req: 'ID validation', steps: 'PUT /chat-messages/session/bad/end; /session/<random>/end', expected: '400, 404' }, async () => {
    const a = await S.put('/chat-messages/session/bad/end');
    const b = await S.put(`/chat-messages/session/${FAKE_ID}/end`);
    return { pass: a.status === 400 && b.status === 404, actual: `invalid ${a.status}; unknown ${b.status}` };
  });
  await t('MSG-14', 'Chat: anonymous / other-student access to student A chats', { req: 'Students may only read/write their own stakeholder chats', steps: 'Student A opens new session. (1) Anonymous GET A\'s history and POST /batch for A. (2) Student B (own session) posts into A\'s session as studentId=A, and ends A\'s session', expected: '401/403 for all; A\'s session unchanged', type: 'security', severity: 'Critical' }, async () => {
    const n = await S.post('/chat-messages', { studentId: sid, stakeholderId: roleId, message: 'private question' }, { timeout: 200000 });
    const vs = n.body?.data?.session?.id;
    const anon = new h.Client();
    const g = await anon.get(`/chat-messages/student/${encodeURIComponent(sid)}/stakeholder/${roleId}`);
    const bt = await anon.post('/chat-messages/batch', { pairs: [{ studentId: sid, stakeholderId: roleId }] });
    const p = await studentB.client.post('/chat-messages', { studentId: sid, stakeholderId: roleId, sessionId: vs, message: 'injected by B' }, { timeout: 200000 });
    const e = await studentB.client.put(`/chat-messages/session/${vs}/end`);
    const doc = vs ? await getSess(vs) : null;
    const ok = [g, bt, p, e].every(r => [401, 403].includes(r.status));
    return { pass: ok, actual: `anon history ${g.status} (${g.body?.data?.chatItems?.length} items); anon batch ${bt.status}; B post-as-A ${p.status}; B end A's session ${e.status}; A session items=${doc?.chatItems?.length} ended=${!!doc?.endTime}` };
  });

  // cleanup only own template
  await db.collection('worksheet_template').deleteMany({ template_id: `${P}-tpl` });
  await mc.close();
});
