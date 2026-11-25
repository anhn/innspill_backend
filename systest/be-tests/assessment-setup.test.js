const __ROOT = require('path').resolve(__dirname, '..');
const { suite } = require('../lib');
const { MongoClient } = require('mongodb');

suite('BE-ASSESS', async (t, h) => {
  const P = 'assess-' + h.uid();
  const NX = '0123456789abcdef01234567'; // valid but non-existent ObjectId
  const teacher = await h.makeUser('teacher', P);
  const teacher2 = await h.makeUser('teacher', P);
  const student = await h.makeUser('student', P);
  const student2 = await h.makeUser('student', P);
  const T = teacher.client, T2 = teacher2.client, S = student.client;
  const anon = () => new h.Client();
  const mc = await MongoClient.connect('mongodb://127.0.0.1:27017/?replicaSet=rs0');
  const db = mc.db('ai4edu_database');

  const mkCourse = async (c, owner, name) => {
    const r = await c.post('/courses', { name: `${P} ${name}`, code: 'AS1', academicYear: '2026', university: 'SysTest U', teacherIds: [owner] });
    if (r.status !== 201) throw new Error('course create failed ' + h.short(r));
    return r.body.data.id;
  };
  const courseId = await mkCourse(T, teacher.username, 'main');
  const courseId2 = await mkCourse(T, teacher.username, 'second');
  const courseIdT2 = await mkCourse(T2, teacher2.username, 't2');
  const deadline = new Date(Date.now() + 7 * 86400000).toISOString();

  // ======================= PROJECTS =======================
  let projectId;
  await t('PRJ-01', 'Create project for course', { req: 'Teacher creates an assessment project for a course', steps: 'POST /projects {projectTitle, courseId, learningOutcome, keyMilestones}; GET /projects/:id', expected: '201 with id; read-back returns same fields; teacherId defaulted from course' }, async () => {
    const r = await T.post('/projects', { projectTitle: `${P} Project`, courseId, courseDescription: 'Desc', learningOutcome: 'Understand photosynthesis', keyMilestones: 'M1, M2', availableStakeholders: ['CEO'] });
    projectId = r.body?.data?.id;
    const g = projectId ? await T.get('/projects/' + projectId) : null;
    const doc = projectId ? await db.collection('projects').findOne({ projectTitle: `${P} Project` }) : null;
    return { pass: r.status === 201 && g?.status === 200 && g.body.data.learningOutcome === 'Understand photosynthesis' && g.body.data.availableStakeholders?.[0] === 'CEO' && doc?.teacherId === teacher.username, actual: `create ${h.short(r).slice(0, 120)} | get ${g?.status} | stored teacherId=${doc?.teacherId}` };
  });
  await t('PRJ-02', 'Reject second project for same course', { req: 'One project per course', steps: 'POST /projects again with same courseId', expected: '400 "Project already exists"' }, async () => {
    const r = await T.post('/projects', { projectTitle: 'dup', courseId });
    return { pass: r.status === 400 && /already exists/.test(r.text), actual: h.short(r) };
  });
  await t('PRJ-03', 'Reject project missing title', { req: 'projectTitle required', steps: 'POST /projects {courseId}', expected: '400' }, async () => {
    const r = await T.post('/projects', { courseId: courseId2 });
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('PRJ-04', 'Reject invalid / non-existent courseId', { req: 'courseId validated', steps: 'POST with courseId="bad", then with non-existent ObjectId', expected: '400 then 404' }, async () => {
    const a = await T.post('/projects', { projectTitle: 'x', courseId: 'bad' });
    const b = await T.post('/projects', { projectTitle: 'x', courseId: NX });
    return { pass: a.status === 400 && b.status === 404, actual: `bad: ${a.status} | nx: ${b.status}` };
  });
  await t('PRJ-05', 'Get project: invalid id 400, unknown id 404', { req: 'ID validation', steps: 'GET /projects/bad, GET /projects/<nx>', expected: '400, 404' }, async () => {
    const a = await T.get('/projects/bad'); const b = await T.get('/projects/' + NX);
    return { pass: a.status === 400 && b.status === 404, actual: `${a.status} | ${b.status}` };
  });
  await t('PRJ-06', 'Get project by course', { req: 'Project lookup by course', steps: 'GET /projects/course/:courseId; and for a course without project', expected: '200 data.id=project; 200 data=null for course without project; 400 for bad id' }, async () => {
    const a = await T.get('/projects/course/' + courseId);
    const b = await T.get('/projects/course/' + courseId2);
    const c = await T.get('/projects/course/bad');
    return { pass: a.status === 200 && a.body.data?.id === projectId && b.status === 200 && b.body.data === null && c.status === 400, actual: `${a.status} id=${a.body?.data?.id === projectId} | none: ${b.status} ${JSON.stringify(b.body?.data)} | bad: ${c.status}` };
  });
  await t('PRJ-07', 'List projects filtered by courseId / teacherId', { req: 'Project list with filters', steps: 'GET /projects?courseId=, ?teacherId=, ?courseId=bad', expected: '200 containing project; 400 for invalid courseId' }, async () => {
    const a = await T.get('/projects?courseId=' + courseId);
    const b = await T.get('/projects?teacherId=' + encodeURIComponent(teacher.username));
    const c = await T.get('/projects?courseId=bad');
    return { pass: a.status === 200 && a.body.data.length === 1 && a.body.data[0].id === projectId && b.body?.data?.some(p => p.id === projectId) && c.status === 400, actual: `course: ${a.status} n=${a.body?.data?.length} | teacher: ${b.status} n=${b.body?.data?.length} | bad: ${c.status}` };
  });
  await t('PRJ-08', 'Update project and read back', { req: 'Teacher edits project', steps: 'PUT /projects/:id {projectTitle, keyMilestones}; GET', expected: '200; persisted values' }, async () => {
    const r = await T.put('/projects/' + projectId, { projectTitle: `${P} Project v2`, keyMilestones: 'M1,M2,M3' });
    const g = await T.get('/projects/' + projectId);
    return { pass: r.status === 200 && g.body?.data?.projectTitle === `${P} Project v2` && g.body.data.keyMilestones === 'M1,M2,M3', actual: `${r.status} | read: ${g.body?.data?.projectTitle}` };
  });
  await t('PRJ-09', 'Update project validation', { req: 'Update body validated', steps: 'PUT {} ; PUT bad id; PUT unknown id; PUT coverPhoto with invalid url', expected: '400, 400, 404, 400' }, async () => {
    const a = await T.put('/projects/' + projectId, {});
    const b = await T.put('/projects/bad', { projectTitle: 'x' });
    const c = await T.put('/projects/' + NX, { projectTitle: 'x' });
    const d = await T.put('/projects/' + projectId, { coverPhoto: { fileId: 'f', fileName: 'f', fileUrl: 'not a url', fileSize: 1, mimeType: 'image/png', uploadedAt: new Date().toISOString() } });
    return { pass: a.status === 400 && b.status === 400 && c.status === 404 && d.status === 400, actual: `${a.status}, ${b.status}, ${c.status}, ${d.status}` };
  });

  // ======================= TASKS =======================
  let taskId, task2Id;
  await t('TSK-01', 'Create task under project', { req: 'Teacher adds tasks to project', steps: 'POST /assessment-tasks {projectId, taskTitle, description, keyword, submissionDeadline}; GET', expected: '201; defaults status=unpublished, timers=5; read-back matches' }, async () => {
    const r = await T.post('/assessment-tasks', { projectId, taskTitle: 'Task 1', description: 'Analyse leaf', keyword: 'chlorophyll', submissionDeadline: deadline, outcome: 'Report' });
    taskId = r.body?.data?.id;
    const g = taskId ? await T.get('/assessment-tasks/' + taskId) : null;
    const d = g?.body?.data;
    return { pass: r.status === 201 && d?.keyword === 'chlorophyll' && d.status === 'unpublished' && d.submissionQuestionTimer === 5 && new Date(d.submissionDeadline).toISOString() === deadline, actual: `${r.status} | get ${g?.status} status=${d?.status} timer=${d?.submissionQuestionTimer}` };
  });
  await t('TSK-02', 'Reject task missing required fields', { req: 'description, keyword, submissionDeadline required', steps: 'POST without keyword; POST without deadline', expected: '400, 400' }, async () => {
    const a = await T.post('/assessment-tasks', { projectId, description: 'd', submissionDeadline: deadline });
    const b = await T.post('/assessment-tasks', { projectId, description: 'd', keyword: 'k' });
    return { pass: a.status === 400 && b.status === 400, actual: `${a.status} | ${b.status}` };
  });
  await t('TSK-03', 'Reject invalid deadline / status value', { req: 'Deadline ISO date, status in {published, unpublished}', steps: 'POST submissionDeadline="tomorrow"; POST status="draft"', expected: '400, 400' }, async () => {
    const a = await T.post('/assessment-tasks', { projectId, description: 'd', keyword: 'k', submissionDeadline: 'tomorrow' });
    const b = await T.post('/assessment-tasks', { projectId, description: 'd', keyword: 'k', submissionDeadline: deadline, status: 'draft' });
    return { pass: a.status === 400 && b.status === 400, actual: `${a.status} | ${b.status}` };
  });
  await t('TSK-04', 'Lock-on-submission requires a submissionQuestion', { req: 'Conditional validation', steps: 'POST lockOnSubmissionQuestion=true without submissionQuestion', expected: '400' }, async () => {
    const r = await T.post('/assessment-tasks', { projectId, description: 'd', keyword: 'k', submissionDeadline: deadline, lockOnSubmissionQuestion: true });
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('TSK-05', 'Create task: invalid / unknown projectId', { req: 'projectId validated', steps: 'POST projectId="bad", then non-existent', expected: '400, 404' }, async () => {
    const a = await T.post('/assessment-tasks', { projectId: 'bad', description: 'd', keyword: 'k', submissionDeadline: deadline });
    const b = await T.post('/assessment-tasks', { projectId: NX, description: 'd', keyword: 'k', submissionDeadline: deadline });
    return { pass: a.status === 400 && b.status === 404, actual: `${a.status} | ${b.status}` };
  });
  await t('TSK-06', 'Create second task (published, with lock question)', { req: 'Task with AI guideline and lock question', steps: 'POST status=published, lockOnSubmissionQuestion+submissionQuestion, timer 3', expected: '201, values persisted' }, async () => {
    const r = await T.post('/assessment-tasks', { projectId, taskTitle: 'Task 2', description: 'Explain light reaction', keyword: 'ATP', submissionDeadline: deadline, status: 'published', enabledAIGuideline: true, lockOnSubmissionQuestion: true, submissionQuestion: 'What did you learn?', submissionQuestionTimer: 3 });
    task2Id = r.body?.data?.id;
    const doc = task2Id ? await db.collection('tasks').findOne({ keyword: 'ATP', taskTitle: 'Task 2', projectId: r.body && new (require('mongodb').ObjectId)(projectId) }) : null;
    return { pass: r.status === 201 && doc?.status === 'published' && doc?.submissionQuestionTimer === 3 && doc?.enabledAIGuideline === true, actual: `${r.status} | db status=${doc?.status} timer=${doc?.submissionQuestionTimer}` };
  });
  await t('TSK-07', 'Get task: invalid 400 / unknown 404', { req: 'ID validation', steps: 'GET /assessment-tasks/bad, /<nx>', expected: '400, 404' }, async () => {
    const a = await T.get('/assessment-tasks/bad'); const b = await T.get('/assessment-tasks/' + NX);
    return { pass: a.status === 400 && b.status === 404, actual: `${a.status} | ${b.status}` };
  });
  await t('TSK-08', 'List tasks by project (both routes)', { req: 'Tasks listed per project', steps: 'GET /assessment-tasks/project/:pid ; GET /assessment-tasks?projectId= ; ?projectId=bad', expected: '200 with both tasks; 400 for bad id' }, async () => {
    const a = await T.get('/assessment-tasks/project/' + projectId);
    const b = await T.get('/assessment-tasks?projectId=' + projectId);
    const c = await T.get('/assessment-tasks?projectId=bad');
    const d = await T.get('/assessment-tasks/project/bad');
    const ids = (a.body?.data || []).map(x => x.id);
    return { pass: a.status === 200 && ids.includes(taskId) && ids.includes(task2Id) && ids.length === 2 && b.body?.data?.length === 2 && c.status === 400 && d.status === 400, actual: `project route n=${ids.length} | query n=${b.body?.data?.length} | bad ${c.status}/${d.status}` };
  });
  await t('TSK-09', 'Publish task (unpublished -> published) and unpublish', { req: 'Teacher publishes task to students', steps: 'PUT {projectId, status:published} (as FE sends); GET; PUT status:unpublished', expected: '200; status persisted at each step' }, async () => {
    const a = await T.put('/assessment-tasks/' + taskId, { projectId, status: 'published' });
    const g1 = await T.get('/assessment-tasks/' + taskId);
    const b = await T.put('/assessment-tasks/' + taskId, { projectId, status: 'unpublished' });
    const g2 = await T.get('/assessment-tasks/' + taskId);
    await T.put('/assessment-tasks/' + taskId, { projectId, status: 'published' });
    return { pass: a.status === 200 && g1.body?.data?.status === 'published' && b.status === 200 && g2.body?.data?.status === 'unpublished', actual: `pub ${a.status}->${g1.body?.data?.status} | unpub ${b.status}->${g2.body?.data?.status}` };
  });
  await t('TSK-10', 'Update task fields and read back', { req: 'Teacher edits task', steps: 'PUT {projectId, keyword, instruction, submissionDeadline}; GET', expected: '200, persisted' }, async () => {
    const nd = new Date(Date.now() + 14 * 86400000).toISOString();
    const r = await T.put('/assessment-tasks/' + taskId, { projectId, keyword: 'stomata', instruction: 'Use microscope', submissionDeadline: nd });
    const g = await T.get('/assessment-tasks/' + taskId);
    return { pass: r.status === 200 && g.body?.data?.keyword === 'stomata' && g.body.data.instruction === 'Use microscope' && new Date(g.body.data.submissionDeadline).toISOString() === nd, actual: `${r.status} | kw=${g.body?.data?.keyword}` };
  });
  await t('TSK-11', 'Update task validation', { req: 'Update validated', steps: 'PUT bad id; unknown id; status="draft"; projectId non-existent', expected: '400, 404, 400, 404' }, async () => {
    const a = await T.put('/assessment-tasks/bad', { projectId, status: 'published' });
    const b = await T.put('/assessment-tasks/' + NX, { projectId, status: 'published' });
    const c = await T.put('/assessment-tasks/' + taskId, { projectId, status: 'draft' });
    const d = await T.put('/assessment-tasks/' + taskId, { projectId: NX, keyword: 'x' });
    return { pass: a.status === 400 && b.status === 404 && c.status === 400 && d.status === 404, actual: `${a.status}, ${b.status}, ${c.status}, ${d.status}` };
  });
  await t('TSK-12', 'Delete task and verify gone', { req: 'Teacher deletes task', steps: 'Create temp task, DELETE, GET; DELETE again; DELETE bad id', expected: '200; GET 404; 404; 400' }, async () => {
    const c = await T.post('/assessment-tasks', { projectId, description: 'tmp', keyword: 'tmp', submissionDeadline: deadline });
    const id = c.body?.data?.id;
    const d = await T.del('/assessment-tasks/' + id);
    const g = await T.get('/assessment-tasks/' + id);
    const d2 = await T.del('/assessment-tasks/' + id);
    const d3 = await T.del('/assessment-tasks/bad');
    return { pass: d.status === 200 && g.status === 404 && d2.status === 404 && d3.status === 400, actual: `del ${d.status} | get ${g.status} | again ${d2.status} | bad ${d3.status}` };
  });

  // ======================= ROLES =======================
  let roleId;
  await t('ROL-01', 'Create role (stakeholder persona)', { req: 'Teacher defines AI stakeholder roles', steps: 'POST /assessment-roles {projectId, name, persona}; GET', expected: '201, status defaults to active, read-back matches' }, async () => {
    const r = await T.post('/assessment-roles', { projectId, name: 'CEO', persona: 'Demanding CEO focused on ROI', attachments: ['a.pdf'] });
    roleId = r.body?.data?.id;
    const g = roleId ? await T.get('/assessment-roles/' + roleId) : null;
    return { pass: r.status === 201 && g?.status === 200 && g.body.data.status === 'active' && g.body.data.persona === 'Demanding CEO focused on ROI' && g.body.data.attachments?.[0] === 'a.pdf', actual: `${r.status} | get ${g?.status} status=${g?.body?.data?.status}` };
  });
  await t('ROL-02', 'Reject role missing name/persona', { req: 'name and persona required', steps: 'POST without persona; POST without name', expected: '400, 400' }, async () => {
    const a = await T.post('/assessment-roles', { projectId, name: 'X' });
    const b = await T.post('/assessment-roles', { projectId, persona: 'p' });
    return { pass: a.status === 400 && b.status === 400, actual: `${a.status} | ${b.status}` };
  });
  await t('ROL-03', 'Create role: invalid / unknown projectId', { req: 'projectId validated', steps: 'POST projectId=bad; non-existent', expected: '400, 404' }, async () => {
    const a = await T.post('/assessment-roles', { projectId: 'bad', name: 'X', persona: 'p' });
    const b = await T.post('/assessment-roles', { projectId: NX, name: 'X', persona: 'p' });
    return { pass: a.status === 400 && b.status === 404, actual: `${a.status} | ${b.status}` };
  });
  await t('ROL-04', 'Get role: invalid 400 / unknown 404', { req: 'ID validation', steps: 'GET /assessment-roles/bad, /<nx>', expected: '400, 404' }, async () => {
    const a = await T.get('/assessment-roles/bad'); const b = await T.get('/assessment-roles/' + NX);
    return { pass: a.status === 400 && b.status === 404, actual: `${a.status} | ${b.status}` };
  });
  await t('ROL-05', 'List roles by project (both routes)', { req: 'Roles listed per project', steps: 'GET /assessment-roles/project/:pid ; ?projectId= ; ?projectId=bad', expected: '200 with role; 400 bad' }, async () => {
    const a = await T.get('/assessment-roles/project/' + projectId);
    const b = await T.get('/assessment-roles?projectId=' + projectId);
    const c = await T.get('/assessment-roles?projectId=bad');
    return { pass: a.status === 200 && a.body.data.length === 1 && a.body.data[0].id === roleId && b.body?.data?.length === 1 && c.status === 400, actual: `${a.status} n=${a.body?.data?.length} | q n=${b.body?.data?.length} | bad ${c.status}` };
  });
  await t('ROL-06', 'Update role and read back', { req: 'Teacher edits role', steps: 'PUT {persona, status:inactive}; GET', expected: '200; persisted' }, async () => {
    const r = await T.put('/assessment-roles/' + roleId, { persona: 'Friendly CEO', status: 'inactive' });
    const g = await T.get('/assessment-roles/' + roleId);
    return { pass: r.status === 200 && g.body?.data?.persona === 'Friendly CEO' && g.body.data.status === 'inactive', actual: `${r.status} | ${g.body?.data?.persona}/${g.body?.data?.status}` };
  });
  await t('ROL-07', 'Update role validation', { req: 'Update validated', steps: 'PUT {} ; PUT name=""; bad id; unknown id', expected: '400, 400, 400, 404' }, async () => {
    const a = await T.put('/assessment-roles/' + roleId, {});
    const b = await T.put('/assessment-roles/' + roleId, { name: '' });
    const c = await T.put('/assessment-roles/bad', { name: 'x' });
    const d = await T.put('/assessment-roles/' + NX, { name: 'x' });
    return { pass: a.status === 400 && b.status === 400 && c.status === 400 && d.status === 404, actual: `${a.status}, ${b.status}, ${c.status}, ${d.status}` };
  });
  await t('ROL-08', 'Delete role and verify gone', { req: 'Teacher deletes role', steps: 'Create temp role, DELETE, GET, DELETE again, DELETE bad', expected: '200, 404, 404, 400' }, async () => {
    const c = await T.post('/assessment-roles', { projectId, name: 'Tmp', persona: 'tmp' });
    const id = c.body?.data?.id;
    const d = await T.del('/assessment-roles/' + id); const g = await T.get('/assessment-roles/' + id);
    const d2 = await T.del('/assessment-roles/' + id); const d3 = await T.del('/assessment-roles/bad');
    return { pass: d.status === 200 && g.status === 404 && d2.status === 404 && d3.status === 400, actual: `${d.status}, ${g.status}, ${d2.status}, ${d3.status}` };
  });

  // ======================= QUIZZES =======================
  let genQuizId, quizId;
  await t('QUZ-01', 'Generate quiz with AI (from tasks + keywords)', { req: 'Teacher generates quiz via AI', steps: 'POST /assessment-quizzes/generate {projectId, name, taskIds, keywords, numberOfQuestions}; GET /assessment-quizzes/:id', expected: '200; well-formed questions (id, question, >=2 options, correctAnswer within options); quiz persisted' }, async () => {
    const r = await T.post('/assessment-quizzes/generate', { projectId, name: `${P} AI Quiz`, taskIds: [taskId, task2Id], keywords: ['photosynthesis'], numberOfQuestions: 5 }, { timeout: 120000 });
    genQuizId = r.body?.data?.id;
    const qs = r.body?.data?.questions || [];
    const wellFormed = qs.length > 0 && qs.every(q => q.id && q.question && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.correctAnswer) && q.correctAnswer >= 0 && q.correctAnswer < q.options.length);
    const uniq = new Set(qs.map(q => q.id)).size === qs.length;
    const g = genQuizId ? await T.get('/assessment-quizzes/' + genQuizId) : null;
    return { pass: r.status === 200 && wellFormed && uniq && g?.status === 200 && g.body.data.questions.length === qs.length && g.body.data.name === `${P} AI Quiz`, actual: `${r.status} n=${qs.length} wellFormed=${wellFormed} uniqueIds=${uniq} | get ${g?.status}` };
  });
  await t('QUZ-02', 'Generate quiz validation', { req: 'Generate input validated', steps: 'POST without projectId; numberOfQuestions=51; projectId=bad; unknown project', expected: '400, 400, 400, 404' }, async () => {
    const a = await T.post('/assessment-quizzes/generate', { keywords: ['x'] });
    const b = await T.post('/assessment-quizzes/generate', { projectId, keywords: ['x'], numberOfQuestions: 51 });
    const c = await T.post('/assessment-quizzes/generate', { projectId: 'bad', keywords: ['x'] });
    const d = await T.post('/assessment-quizzes/generate', { projectId: NX, keywords: ['x'] });
    return { pass: a.status === 400 && b.status === 400 && c.status === 400 && d.status === 404, actual: `${a.status}, ${b.status}, ${c.status}, ${d.status}` };
  });
  await t('QUZ-03', 'Generate quiz with malformed taskId', { req: 'taskIds validated', steps: 'POST /generate {projectId, taskIds:["not-an-id"]}', expected: '400 (not 500)' }, async () => {
    const r = await T.post('/assessment-quizzes/generate', { projectId, taskIds: ['not-an-id'] });
    return { pass: r.status === 400, actual: h.short(r), severity: 'Medium' };
  });
  const quizQuestions = [
    { id: 'q1', question: '2+2?', options: ['3', '4', '5', '6'], correctAnswer: 1 },
    { id: 'q2', question: 'Capital of France?', options: ['Paris', 'Rome', 'Berlin'], correctAnswer: 0 },
    { id: 'q3', question: 'Sky colour?', options: ['Green', 'Red', 'Blue'], correctAnswer: 2 },
    { id: 'q4', question: 'Water formula?', options: ['H2O', 'CO2'], correctAnswer: 0 },
  ];
  await t('QUZ-04', 'Create quiz manually', { req: 'Teacher creates quiz with explicit questions', steps: 'POST /assessment-quizzes {projectId, name, questions[4]}; read DB', expected: '201; questions & correctAnswer persisted; history empty' }, async () => {
    const r = await T.post('/assessment-quizzes', { projectId, name: `${P} Manual Quiz`, questions: quizQuestions });
    quizId = r.body?.data?.id;
    const g = quizId ? await T.get('/assessment-quizzes/' + quizId) : null;
    const qs = g?.body?.data?.questions || [];
    return { pass: r.status === 201 && qs.length === 4 && qs.map(q => q.correctAnswer).join() === '1,0,2,0' && qs[0].id === 'q1' && g.body.data.history.length === 0, actual: `${r.status} | get ${g?.status} answers=${qs.map(q => q.correctAnswer).join()}` };
  });
  await t('QUZ-05', 'Create quiz validation', { req: 'Quiz body validated', steps: 'POST no questions; question with 1 option; negative correctAnswer; projectId bad; unknown project', expected: '400, 400, 400, 400, 404' }, async () => {
    const a = await T.post('/assessment-quizzes', { projectId, questions: [] });
    const b = await T.post('/assessment-quizzes', { projectId, questions: [{ question: 'q', options: ['a'], correctAnswer: 0 }] });
    const c = await T.post('/assessment-quizzes', { projectId, questions: [{ question: 'q', options: ['a', 'b'], correctAnswer: -1 }] });
    const d = await T.post('/assessment-quizzes', { projectId: 'bad', questions: quizQuestions });
    const e = await T.post('/assessment-quizzes', { projectId: NX, questions: quizQuestions });
    return { pass: a.status === 400 && b.status === 400 && c.status === 400 && d.status === 400 && e.status === 404, actual: `${a.status}, ${b.status}, ${c.status}, ${d.status}, ${e.status}` };
  });
  await t('QUZ-06', 'Reject correctAnswer index outside options', { req: 'Each question must have a valid correct option', steps: 'POST question with 2 options and correctAnswer=5', expected: '400 (an unanswerable question must not be saved)' }, async () => {
    const r = await T.post('/assessment-quizzes', { projectId, name: `${P} bad-key`, questions: [{ question: 'q', options: ['a', 'b'], correctAnswer: 5 }] });
    if (r.body?.data?.id) await T.del('/assessment-quizzes/' + r.body.data.id);
    return { pass: r.status === 400, actual: h.short(r).slice(0, 160), severity: 'Medium' };
  });
  await t('QUZ-07', 'Duplicate question IDs are de-duplicated', { req: 'Question IDs unique within quiz', steps: 'POST quiz with two questions id="dup"', expected: '201; second question gets a new unique id' }, async () => {
    const r = await T.post('/assessment-quizzes', { projectId, name: `${P} dup`, questions: [{ id: 'dup', question: 'a', options: ['x', 'y'], correctAnswer: 0 }, { id: 'dup', question: 'b', options: ['x', 'y'], correctAnswer: 1 }] });
    const ids = (r.body?.data?.questions || []).map(q => q.id);
    if (r.body?.data?.id) await T.del('/assessment-quizzes/' + r.body.data.id);
    return { pass: r.status === 201 && ids.length === 2 && ids[0] === 'dup' && ids[1] !== 'dup', actual: `${r.status} ids=${ids.join(',')}` };
  });
  await t('QUZ-08', 'Get quiz: invalid 400 / unknown 404 / includeSubmissions=false', { req: 'Quiz retrieval', steps: 'GET bad; GET nx; GET ?includeSubmissions=false', expected: '400, 404, 200 without studentSubmissions' }, async () => {
    const a = await T.get('/assessment-quizzes/bad'); const b = await T.get('/assessment-quizzes/' + NX);
    const c = await T.get(`/assessment-quizzes/${quizId}?includeSubmissions=false`);
    return { pass: a.status === 400 && b.status === 404 && c.status === 200 && c.body.data.studentSubmissions === undefined, actual: `${a.status}, ${b.status}, ${c.status} hasSubs=${c.body?.data?.studentSubmissions !== undefined}` };
  });
  await t('QUZ-09', 'Update quiz saves previous version to history', { req: 'Quiz edit with version history', steps: 'PUT {questions (q4 key changed), name, updatedBy}; GET', expected: '200; questions updated; history[0] holds old questions and updatedBy' }, async () => {
    const newQs = quizQuestions.map(q => ({ ...q }));
    newQs.push({ id: 'q5', question: 'Largest planet?', options: ['Mars', 'Jupiter'], correctAnswer: 1 });
    const r = await T.put('/assessment-quizzes/' + quizId, { questions: newQs, name: `${P} Manual Quiz v2`, updatedBy: teacher.username });
    const g = await T.get('/assessment-quizzes/' + quizId);
    const d = g.body?.data;
    return { pass: r.status === 200 && d?.questions?.length === 5 && d.name === `${P} Manual Quiz v2` && d.history?.length === 1 && d.history[0].questions.length === 4 && d.history[0].updatedBy === teacher.username, actual: `${r.status} | q=${d?.questions?.length} hist=${d?.history?.length} histQ=${d?.history?.[0]?.questions?.length} by=${d?.history?.[0]?.updatedBy}` };
  });
  await t('QUZ-10', 'Update quiz validation', { req: 'Update validated', steps: 'PUT without updatedBy; PUT without questions; bad id; unknown id', expected: '400, 400, 400, 404' }, async () => {
    const a = await T.put('/assessment-quizzes/' + quizId, { questions: quizQuestions });
    const b = await T.put('/assessment-quizzes/' + quizId, { updatedBy: 'x' });
    const c = await T.put('/assessment-quizzes/bad', { questions: quizQuestions, updatedBy: 'x' });
    const d = await T.put('/assessment-quizzes/' + NX, { questions: quizQuestions, updatedBy: 'x' });
    return { pass: a.status === 400 && b.status === 400 && c.status === 400 && d.status === 404, actual: `${a.status}, ${b.status}, ${c.status}, ${d.status}` };
  });
  await t('QUZ-11', 'Quiz publish state (not supported by API)', { req: 'Teacher publishes quiz', steps: 'PUT /assessment-quizzes/:id with status:"published"', expected: 'Clean 4xx (Quiz model has no status/publish field; quizzes are visible as soon as created) - not 500' }, async () => {
    const r = await T.put('/assessment-quizzes/' + quizId, { questions: quizQuestions, updatedBy: 'x', status: 'published' });
    return { pass: r.status === 400, actual: h.short(r).slice(0, 160) };
  });
  await t('QUZ-12', 'List quizzes by project (both routes)', { req: 'Quizzes listed per project', steps: 'GET /assessment-quizzes/project/:pid ; ?projectId= ; ?projectId=bad', expected: '200 containing generated + manual quiz; 400 for bad id' }, async () => {
    const a = await T.get('/assessment-quizzes/project/' + projectId);
    const b = await T.get(`/assessment-quizzes?projectId=${projectId}&includeSubmissions=true`);
    const c = await T.get('/assessment-quizzes?projectId=bad');
    const d = await T.get('/assessment-quizzes/project/bad');
    const ids = (a.body?.data || []).map(q => q.id);
    return { pass: a.status === 200 && ids.includes(quizId) && ids.includes(genQuizId) && b.status === 200 && b.body.data.every(q => Array.isArray(q.studentSubmissions)) && c.status === 400 && d.status === 400, actual: `${a.status} n=${ids.length} | q ${b.status} n=${b.body?.data?.length} | bad ${c.status}/${d.status}` };
  });

  // ======================= QUIZ SUBMISSIONS (student workflow) =======================
  // Current quiz key (5 questions): q1=1, q2=0, q3=2, q4=0, q5=1
  let subId;
  await t('QSB-01', 'Student saves draft (score stays null)', { req: 'Student progress auto-saved', steps: 'POST /quiz-submissions {quizId, studentId, answers{q1:1}, isSubmitted:false, currentQuestionIndex:1}', expected: '201; score null; isSubmitted false; persisted' }, async () => {
    const r = await S.post('/quiz-submissions', { quizId, studentId: student.username, courseId, answers: { q1: 1 }, comments: { q1: 'easy' }, lockedAnswers: { q1: true }, isSubmitted: false, currentQuestionIndex: 1, score: 80 });
    subId = r.body?.data?.submissionId;
    const g = await S.get(`/quiz-submissions/quiz/${quizId}/student/${encodeURIComponent(student.username)}`);
    return { pass: r.status === 201 && r.body.data.score === null && g.status === 200 && g.body.data.isSubmitted === false && g.body.data.answers.q1 === 1 && g.body.data.currentQuestionIndex === 1 && g.body.data.score === null, actual: `${r.status} score=${r.body?.data?.score} | get ${g.status} idx=${g.body?.data?.currentQuestionIndex}` };
  });
  await t('QSB-02', 'Submit quiz: server computes score from correct answers', { req: 'Scoring correctness', steps: 'POST answers q1=1(ok) q2=0(ok) q3=0(wrong) q4=0(ok), q5 unanswered, isSubmitted:true, no score', expected: '200 (update of existing); score = round(3/5*100) = 60; submittedAt set' }, async () => {
    const r = await S.post('/quiz-submissions', { quizId, studentId: student.username, courseId, answers: { q1: 1, q2: 0, q3: 0, q4: 0 }, isSubmitted: true });
    const doc = await db.collection('quiz_submissions').findOne({ studentId: student.username });
    return { pass: r.status === 200 && r.body.data.score === 60 && doc?.score === 60 && !!doc?.submittedAt && r.body.data.submissionId === subId, actual: `${r.status} score=${r.body?.data?.score} db=${doc?.score} submittedAt=${!!doc?.submittedAt}` };
  });
  await t('QSB-03', 'Scoring: all correct = 100, all wrong = 0, rounding 2/3 = 67', { req: 'Scoring correctness', steps: 'Second student submits all-correct; third quiz (3 q) submit 2 correct; fourth student all wrong', expected: '100, 67, 0' }, async () => {
    const st2 = await new h.Client();
    const a = await st2.post('/quiz-submissions', { quizId, studentId: student2.username, answers: { q1: 1, q2: 0, q3: 2, q4: 0, q5: 1 }, isSubmitted: true });
    const q3 = await T.post('/assessment-quizzes', { projectId, name: `${P} 3q`, questions: quizQuestions.slice(0, 3) });
    const b = await st2.post('/quiz-submissions', { quizId: q3.body?.data?.id, studentId: `${P}-r1`, answers: { q1: 1, q2: 0, q3: 1 }, isSubmitted: true });
    const c = await st2.post('/quiz-submissions', { quizId: q3.body?.data?.id, studentId: `${P}-r2`, answers: { q1: 0, q2: 2, q3: 99 }, isSubmitted: true });
    return { pass: a.body?.data?.score === 100 && b.body?.data?.score === 67 && c.body?.data?.score === 0, actual: `all-correct=${a.body?.data?.score} (${a.status}) | 2/3=${b.body?.data?.score} | wrong=${c.body?.data?.score}` };
  });
  await t('QSB-04', 'Client-supplied score must not override computed score', { req: 'Score integrity (grading must be server-side)', steps: 'POST all-wrong answers with isSubmitted:true and score:100', expected: 'Stored score = 0 (computed) or 400; NOT 100', type: 'security' }, async () => {
    const c = new h.Client();
    const r = await c.post('/quiz-submissions', { quizId, studentId: `${P}-cheater`, answers: { q1: 0, q2: 1, q3: 0, q4: 1, q5: 0 }, isSubmitted: true, score: 100 });
    const doc = await db.collection('quiz_submissions').findOne({ studentId: `${P}-cheater` });
    return { pass: doc?.score !== 100, actual: `${r.status} stored score=${doc?.score}`, severity: 'High' };
  });
  await t('QSB-05', 'Submit validation', { req: 'Submission body validated', steps: 'POST without answers; without isSubmitted; answers with string value; quizId bad; unknown quiz; score 150', expected: '400, 400, 400, 400, 404, 400' }, async () => {
    const base = { quizId, studentId: `${P}-v`, answers: { q1: 1 }, isSubmitted: false };
    const rs = [
      await S.post('/quiz-submissions', { ...base, answers: undefined }),
      await S.post('/quiz-submissions', { ...base, isSubmitted: undefined }),
      await S.post('/quiz-submissions', { ...base, answers: { q1: 'A' } }),
      await S.post('/quiz-submissions', { ...base, quizId: 'bad' }),
      await S.post('/quiz-submissions', { ...base, quizId: NX }),
      await S.post('/quiz-submissions', { ...base, isSubmitted: true, score: 150 }),
    ].map(r => r.status);
    return { pass: rs.join() === '400,400,400,400,404,400', actual: rs.join(', ') };
  });
  await t('QSB-06', 'Submitted quiz cannot be reverted to draft by re-POST', { req: 'Once submitted, an attempt is final (score kept)', steps: 'After QSB-02 submit (score 60), POST same student isSubmitted:false with new answers', expected: '4xx or submission unchanged (isSubmitted true, score 60)' }, async () => {
    const r = await S.post('/quiz-submissions', { quizId, studentId: student.username, answers: { q1: 0 }, isSubmitted: false });
    const doc = await db.collection('quiz_submissions').findOne({ studentId: student.username, quizId: new (require('mongodb').ObjectId)(quizId) });
    // restore for later tests
    await S.post('/quiz-submissions', { quizId, studentId: student.username, answers: { q1: 1, q2: 0, q3: 0, q4: 0 }, isSubmitted: true });
    return { pass: r.status >= 400 || (doc?.isSubmitted === true && doc?.score === 60), actual: `${r.status} -> stored isSubmitted=${doc?.isSubmitted} score=${doc?.score}`, severity: 'Medium' };
  });
  await t('QSB-07', 'Get submission by quiz & student', { req: 'Student resumes / views result', steps: 'GET /quiz-submissions/quiz/:quizId/student/:username ; unknown student; bad quizId', expected: '200 with score 60; 404; 400' }, async () => {
    const a = await S.get(`/quiz-submissions/quiz/${quizId}/student/${encodeURIComponent(student.username)}`);
    const b = await S.get(`/quiz-submissions/quiz/${quizId}/student/nobody-${P}`);
    const c = await S.get(`/quiz-submissions/quiz/bad/student/x`);
    return { pass: a.status === 200 && a.body.data.score === 60 && a.body.data.isSubmitted === true && b.status === 404 && c.status === 400, actual: `${a.status} score=${a.body?.data?.score} | ${b.status} | ${c.status}` };
  });
  await t('QSB-08', 'List a student\'s submissions', { req: 'Student sees own quiz history', steps: 'GET /quiz-submissions/student/:username ; ?quizId=bad', expected: '200 array with submission (answers as object, quizId string); 400 for bad quizId' }, async () => {
    const a = await S.get(`/quiz-submissions/student/${encodeURIComponent(student.username)}`);
    const b = await S.get(`/quiz-submissions/student/${encodeURIComponent(student.username)}?quizId=bad`);
    return { pass: a.status === 200 && a.body?.data?.length === 1 && a.body.data[0].quizId === quizId && a.body.data[0].score === 60 && b.status === 400, actual: `${h.short(a).slice(0, 160)} | bad ${b.status}`, severity: 'High' };
  });
  await t('QSB-09', 'Update submission recalculates score', { req: 'PUT recomputes score when answers change', steps: 'PUT /quiz-submissions/:id {answers all correct}; read DB', expected: '200; score = 100' }, async () => {
    const r = await S.put('/quiz-submissions/' + subId, { answers: { q1: 1, q2: 0, q3: 2, q4: 0, q5: 1 } });
    const doc = await db.collection('quiz_submissions').findOne({ studentId: student.username });
    return { pass: r.status === 200 && r.body.data.score === 100 && doc?.score === 100, actual: `${r.status} score=${r.body?.data?.score} db=${doc?.score}` };
  });
  await t('QSB-10', 'Update submission validation', { req: 'PUT validated', steps: 'PUT {} ; bad id; unknown id; score -5', expected: '400, 400, 404, 400' }, async () => {
    const a = await S.put('/quiz-submissions/' + subId, {});
    const b = await S.put('/quiz-submissions/bad', { currentQuestionIndex: 1 });
    const c = await S.put('/quiz-submissions/' + NX, { currentQuestionIndex: 1 });
    const d = await S.put('/quiz-submissions/' + subId, { score: -5 });
    return { pass: a.status === 400 && b.status === 400 && c.status === 404 && d.status === 400, actual: `${a.status}, ${b.status}, ${c.status}, ${d.status}` };
  });
  await t('QSB-11', 'Update submission: client score cannot override graded answers', { req: 'Score integrity', steps: 'PUT {answers: all wrong, score: 100}', expected: 'Stored score = 0 (computed) or 400; NOT 100', type: 'security' }, async () => {
    const r = await S.put('/quiz-submissions/' + subId, { answers: { q1: 0, q2: 1, q3: 0, q4: 1, q5: 0 }, score: 100 });
    const doc = await db.collection('quiz_submissions').findOne({ studentId: student.username });
    // restore correct state
    await S.put('/quiz-submissions/' + subId, { answers: { q1: 1, q2: 0, q3: 2, q4: 0, q5: 1 } });
    return { pass: doc?.score !== 100, actual: `${r.status} stored score=${doc?.score}`, severity: 'High' };
  });
  await t('QSB-12', 'Leaderboard (both routes): submitted only, sorted desc, limit', { req: 'Quiz leaderboard', steps: 'GET /quiz-submissions/quiz/:id/leaderboard ; /quiz-submissions/:id/leaderboard?limit=1 ; limit=0; bad id; unknown quiz', expected: '200 sorted by score desc, names resolved; limit honoured; 400; 400; 404' }, async () => {
    const a = await S.get(`/quiz-submissions/quiz/${quizId}/leaderboard`);
    const b = await S.get(`/quiz-submissions/${quizId}/leaderboard?limit=1`);
    const c = await S.get(`/quiz-submissions/${quizId}/leaderboard?limit=0`);
    const d = await S.get(`/quiz-submissions/quiz/bad/leaderboard`);
    const e = await S.get(`/quiz-submissions/quiz/${NX}/leaderboard`);
    const sc = (a.body?.data || []).map(x => x.score);
    const sorted = sc.every((v, i) => i === 0 || sc[i - 1] >= v);
    const named = (a.body?.data || []).find(x => x.studentId === student.username)?.studentName;
    return { pass: a.status === 200 && sc.length >= 2 && sorted && named === `${P} student` && b.body?.data?.length === 1 && c.status === 400 && d.status === 400 && e.status === 404, actual: `${a.status} scores=${sc.join(',')} name=${named} | limit1 n=${b.body?.data?.length} | ${c.status}, ${d.status}, ${e.status}` };
  });
  await t('QSB-13', 'Scores endpoint by quiz / project / course', { req: 'Teacher score overview', steps: 'GET /quiz-submissions/scores?quizId= ; ?projectId= ; ?courseId= ; no filter; course without project', expected: '200 with student rows (score, quizName); 400 without filter; 404 for course without project' }, async () => {
    const a = await T.get('/quiz-submissions/scores?quizId=' + quizId);
    const b = await T.get('/quiz-submissions/scores?projectId=' + projectId);
    const c = await T.get('/quiz-submissions/scores?courseId=' + courseId);
    const d = await T.get('/quiz-submissions/scores');
    const e = await T.get('/quiz-submissions/scores?courseId=' + courseId2);
    const f = await T.get('/quiz-submissions/scores?quizId=bad');
    const row = (a.body?.data || []).find(r => r.studentId === student.username);
    return { pass: a.status === 200 && row?.score === 100 && row.quizName === `${P} Manual Quiz v2` && b.status === 200 && b.body.totalStudents >= 3 && c.status === 200 && c.body.filterType === 'course' && d.status === 400 && e.status === 404 && f.status === 400, actual: `quiz ${a.status} row=${row?.score}/${row?.quizName} | proj ${b.status} n=${b.body?.totalStudents} | course ${c.status} | none ${d.status} | noProj ${e.status} | bad ${f.status}` };
  });
  await t('QSB-14', 'Quiz detail shows latest student submissions to teacher', { req: 'Teacher monitors quiz results', steps: 'GET /assessment-quizzes/:id (includeSubmissions default true)', expected: '200; studentSubmissions contains student with score 100; submittedCount >= 2' }, async () => {
    const r = await T.get('/assessment-quizzes/' + quizId);
    const s = (r.body?.data?.studentSubmissions || []).find(x => x.studentId === student.username);
    return { pass: r.status === 200 && s?.score === 100 && s.studentName === `${P} student` && r.body.data.submittedCount >= 2, actual: `${r.status} score=${s?.score} name=${s?.studentName} submitted=${r.body?.data?.submittedCount}` };
  });

  // ======================= QUIZ leaderboard / student answers (assessment-quizzes) =======================
  await t('QUZ-13', 'Quiz leaderboard reflects student submissions', { req: 'GET /assessment-quizzes/:quizId/leaderboard lists students who took the quiz', steps: 'After students submitted via /quiz-submissions, GET /assessment-quizzes/:quizId/leaderboard', expected: '200 with the submitting students (score, correctAnswers)', severity: 'Medium' }, async () => {
    const r = await T.get(`/assessment-quizzes/${quizId}/leaderboard`);
    return { pass: r.status === 200 && (r.body?.data || []).some(x => x.studentId === student.username), actual: `${h.short(r).slice(0, 160)} (reads quiz_attempts, which no endpoint writes)` };
  });
  await t('QUZ-14', 'Quiz leaderboard / student answers format (seeded QuizAttempt)', { req: 'Leaderboard & per-student answer detail', steps: 'Insert QuizAttempt doc; GET /:quizId/leaderboard ; GET /:quizId/student/:sid ; unknown student; bad id; unknown quiz', expected: '200 with totalQuestions=5, correctAnswers=1; 200 answers detail (empty options fall back to quiz question options); 404; 400; 404' }, async () => {
    const { ObjectId } = require('mongodb');
    const sid = `${P}-attempt`;
    await db.collection('quiz_attempts').insertOne({ quizId: new ObjectId(quizId), studentId: sid, studentName: 'Attempt Stu', score: 50, completedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      answers: [{ questionId: 'q1', question: '2+2?', options: ['3', '4', '5', '6'], correctAnswer: 1, studentAnswer: 1, isCorrect: true }, { questionId: 'q2', question: 'Capital?', options: [], correctAnswer: 0, studentAnswer: 1, isCorrect: false, comment: 'unsure' }] });
    const a = await T.get(`/assessment-quizzes/${quizId}/leaderboard`);
    const b = await T.get(`/assessment-quizzes/${quizId}/student/${sid}`);
    const c = await T.get(`/assessment-quizzes/${quizId}/student/nobody-${P}`);
    const d = await T.get(`/assessment-quizzes/bad/leaderboard`);
    const e = await T.get(`/assessment-quizzes/${NX}/student/x`);
    const row = (a.body?.data || []).find(x => x.studentId === sid);
    const ans = b.body?.data?.answers || [];
    return { pass: a.status === 200 && row?.totalQuestions === 5 && row.correctAnswers === 1 && b.status === 200 && ans.length === 2 && ans[1].options.length === 3 && ans[1].comment === 'unsure' && c.status === 404 && d.status === 400 && e.status === 404, actual: `lb ${a.status} row=${JSON.stringify(row)?.slice(0, 80)} | student ${b.status} n=${ans.length} fallbackOpts=${ans[1]?.options?.length} | ${c.status}, ${d.status}, ${e.status}` };
  });

  // ======================= UPLOAD =======================
  const up = async (client, name, type, bytes) => {
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type }), name);
    return client.post('/assessment/upload', fd, { timeout: 60000 });
  };
  let uploaded;
  await t('UPL-01', 'Upload allowed file (PDF) and download it', { req: 'Teacher uploads task attachment', steps: 'POST multipart file=report.pdf; GET returned fileUrl', expected: '200 with fileId, fileName, fileSize, mimeType, fileUrl; fileUrl downloadable (200)' }, async () => {
    const body = '%PDF-1.4\n' + 'x'.repeat(1000);
    const r = await up(T, `${P}-report.pdf`, 'application/pdf', body);
    uploaded = r.body?.data;
    const dl = uploaded?.fileUrl ? await fetch(uploaded.fileUrl).catch(() => null) : null;
    return { pass: r.status === 200 && uploaded?.fileName === `${P}-report.pdf` && uploaded.fileSize === body.length && uploaded.mimeType === 'application/pdf' && dl?.status === 200, actual: `${r.status} fileId=${uploaded?.fileId} size=${uploaded?.fileSize} | GET fileUrl -> ${dl?.status}`, severity: 'High' };
  });
  await t('UPL-02', 'Upload response usable as project coverPhoto', { req: 'Upload metadata feeds project.coverPhoto', steps: 'Upload PNG; PUT /projects/:id {coverPhoto: upload data}; GET', expected: '200; coverPhoto persisted' }, async () => {
    const r = await up(T, `${P}-cover.png`, 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
    const u = await T.put('/projects/' + projectId, { coverPhoto: r.body?.data });
    const g = await T.get('/projects/' + projectId);
    return { pass: r.status === 200 && u.status === 200 && g.body?.data?.coverPhoto?.fileId === r.body.data.fileId, actual: `upload ${r.status} | put ${u.status} | stored fileId=${g.body?.data?.coverPhoto?.fileId}` };
  });
  await t('UPL-03', 'Upload without file', { req: 'File required', steps: 'POST multipart with no file field', expected: '400 "No file uploaded"' }, async () => {
    const fd = new FormData(); fd.append('note', 'x');
    const r = await T.post('/assessment/upload', fd);
    return { pass: r.status === 400 && /No file/.test(r.text), actual: h.short(r) };
  });
  await t('UPL-04', 'Reject disallowed file types (exe, html, svg)', { req: 'Only document/image attachment types accepted', steps: 'POST evil.exe (application/x-msdownload), evil.html (text/html), evil.svg with script', expected: '400/415 for each; nothing stored', type: 'security' }, async () => {
    const a = await up(T, `${P}-evil.exe`, 'application/x-msdownload', 'MZ\x90\x00binary');
    const b = await up(T, `${P}-evil.html`, 'text/html', '<script>alert(1)</script>');
    const c = await up(T, `${P}-evil.svg`, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const st = [a, b, c].map(r => r.status);
    return { pass: st.every(s => s === 400 || s === 415), actual: `exe ${st[0]}, html ${st[1]}, svg ${st[2]} (fileFilter accepts all types)`, severity: 'Medium' };
  });
  await t('UPL-05', 'Reject oversize file (>10MB) with 413/400', { req: '10MB upload limit', steps: 'POST 11MB file', expected: '413 or 400 with clear message (not 500); file not stored' }, async () => {
    const r = await up(T, `${P}-big.pdf`, 'application/pdf', Buffer.alloc(11 * 1024 * 1024, 65));
    const fs = require('fs');
    const left = fs.readdirSync(`${__ROOT}/../uploads/assessment`).filter(f => f.startsWith(`${P}-big`));
    return { pass: (r.status === 413 || r.status === 400) && left.length === 0, actual: `${h.short(r).slice(0, 120)} | stored copies=${left.length}`, severity: 'Medium' };
  });
  await t('UPL-06', 'File just under the limit is accepted', { req: '10MB upload limit', steps: 'POST 9.9MB pdf', expected: '200, fileSize correct' }, async () => {
    const n = Math.floor(9.9 * 1024 * 1024);
    const r = await up(T, `${P}-9mb.pdf`, 'application/pdf', Buffer.alloc(n, 66));
    return { pass: r.status === 200 && r.body.data.fileSize === n, actual: `${r.status} size=${r.body?.data?.fileSize}` };
  });
  await t('UPL-07', 'Path traversal in filename is neutralised', { req: 'Uploaded files stay in uploads dir', steps: 'POST file named "../../../evil.pdf"', expected: '200 or 400; stored fileId has no path separators; no file written outside uploads/assessment', type: 'security' }, async () => {
    const fd = new FormData(); fd.append('file', new Blob(['%PDF-1.4']), `../../../${P}-trav.pdf`);
    const r = await T.post('/assessment/upload', fd);
    const fs = require('fs');
    const outside = fs.existsSync(`${__ROOT}/../${P}-trav.pdf`) || fs.readdirSync(`${__ROOT}/..`).some(f => f.includes(`${P}-trav`));
    return { pass: (r.status === 400 || (r.status === 200 && !/[\\/]/.test(r.body.data.fileId))) && !outside, actual: `${r.status} fileId=${r.body?.data?.fileId} outside=${outside}` };
  });

  // ======================= CASCADE / BUSINESS RULES =======================
  await t('PRJ-10', 'Delete project removes it; dependents not orphaned', { req: 'Deleting a project should not leave orphan tasks/roles/quizzes', steps: 'Create project on course2 + task + role + quiz; DELETE project; GET project; GET tasks/roles/quizzes by project', expected: 'DELETE 200, GET 404; dependent tasks/roles/quizzes removed (or delete refused 409)', severity: 'Medium' }, async () => {
    const p = await T.post('/projects', { projectTitle: `${P} temp`, courseId: courseId2 });
    const pid = p.body?.data?.id;
    await T.post('/assessment-tasks', { projectId: pid, description: 'd', keyword: 'k', submissionDeadline: deadline });
    await T.post('/assessment-roles', { projectId: pid, name: 'R', persona: 'p' });
    await T.post('/assessment-quizzes', { projectId: pid, questions: quizQuestions.slice(0, 2) });
    const d = await T.del('/projects/' + pid);
    const g = await T.get('/projects/' + pid);
    const tk = await T.get('/assessment-tasks/project/' + pid);
    const rl = await T.get('/assessment-roles/project/' + pid);
    const qz = await T.get('/assessment-quizzes/project/' + pid);
    const orphans = (tk.body?.data?.length || 0) + (rl.body?.data?.length || 0) + (qz.body?.data?.length || 0);
    const d2 = await T.del('/projects/' + pid); const d3 = await T.del('/projects/bad');
    return { pass: d.status === 200 && g.status === 404 && orphans === 0 && d2.status === 404 && d3.status === 400, actual: `del ${d.status} get ${g.status} | orphans: tasks=${tk.body?.data?.length} roles=${rl.body?.data?.length} quizzes=${qz.body?.data?.length} | again ${d2.status} bad ${d3.status}` };
  });
  await t('QUZ-15', 'Delete quiz and verify gone', { req: 'Teacher deletes quiz', steps: 'DELETE generated quiz; GET; DELETE again; DELETE bad', expected: '200, 404, 404, 400' }, async () => {
    const d = await T.del('/assessment-quizzes/' + genQuizId); const g = await T.get('/assessment-quizzes/' + genQuizId);
    const d2 = await T.del('/assessment-quizzes/' + genQuizId); const d3 = await T.del('/assessment-quizzes/bad');
    return { pass: d.status === 200 && g.status === 404 && d2.status === 404 && d3.status === 400, actual: `${d.status}, ${g.status}, ${d2.status}, ${d3.status}` };
  });

  // ======================= ACCESS CONTROL =======================
  const sev = (bad) => bad ? 'Critical' : '';
  await t('PRJ-11', 'Projects access control', { req: 'Only the owning teacher can read/modify a project', steps: 'No session: GET /projects (list all), PUT /projects/:id. Teacher2: PUT teacher1 project; Teacher2 creates project on teacher1 course', expected: '401 for anonymous; 403 for other teacher', type: 'security' }, async () => {
    const a = await anon().get('/projects');
    const b = await anon().put('/projects/' + projectId, { courseDescription: 'anon edit' });
    const c = await T2.put('/projects/' + projectId, { courseDescription: 'teacher2 edit' });
    const p2 = await T2.post('/projects', { projectTitle: `${P} t2`, courseId: courseIdT2 });
    const d = await T2.get('/projects/' + projectId);
    const ok = [401, 403].includes(a.status) && [401, 403].includes(b.status) && c.status === 403;
    return { pass: ok, actual: `anon list ${a.status} (n=${a.body?.data?.length}) | anon PUT ${b.status} | teacher2 PUT ${c.status} | teacher2 GET other ${d.status}`, severity: sev(!ok) };
  });
  await t('TSK-13', 'Assessment tasks access control', { req: 'Only project owner can modify tasks', steps: 'No session: GET /assessment-tasks (all), DELETE task. Teacher2: PUT teacher1 task', expected: '401 anonymous; 403 other teacher', type: 'security' }, async () => {
    const tmp = await T.post('/assessment-tasks', { projectId, description: 'ac', keyword: 'ac', submissionDeadline: deadline });
    const a = await anon().get('/assessment-tasks');
    const b = await anon().del('/assessment-tasks/' + tmp.body?.data?.id);
    const c = await T2.put('/assessment-tasks/' + taskId, { projectId, instruction: 'teacher2 edit' });
    const ok = [401, 403].includes(a.status) && [401, 403].includes(b.status) && c.status === 403;
    return { pass: ok, actual: `anon list ${a.status} (n=${a.body?.data?.length}) | anon DELETE ${b.status} | teacher2 PUT ${c.status}`, severity: sev(!ok) };
  });
  await t('ROL-09', 'Assessment roles access control', { req: 'Only project owner can modify roles', steps: 'No session: GET role, PUT role. Teacher2: DELETE teacher1 role (temp)', expected: '401 anonymous; 403 other teacher', type: 'security' }, async () => {
    const tmp = await T.post('/assessment-roles', { projectId, name: 'AC', persona: 'ac' });
    const a = await anon().get('/assessment-roles/' + roleId);
    const b = await anon().put('/assessment-roles/' + roleId, { persona: 'anon edit' });
    const c = await T2.del('/assessment-roles/' + tmp.body?.data?.id);
    const ok = [401, 403].includes(a.status) && [401, 403].includes(b.status) && c.status === 403;
    return { pass: ok, actual: `anon GET ${a.status} | anon PUT ${b.status} | teacher2 DELETE ${c.status}`, severity: sev(!ok) };
  });
  await t('QUZ-16', 'Quizzes access control (student edits answer key)', { req: 'Only teacher owner can create/edit quizzes; answer key not modifiable by students', steps: 'No session: GET /assessment-quizzes (all, incl. correctAnswer), POST /generate. Student: PUT teacher quiz changing correctAnswer. Teacher2: DELETE teacher1 quiz', expected: '401 anonymous; 403 student / other teacher', type: 'security' }, async () => {
    const victim = await T.post('/assessment-quizzes', { projectId, name: `${P} victim`, questions: quizQuestions.slice(0, 2) });
    const vid = victim.body?.data?.id;
    const a = await anon().get('/assessment-quizzes');
    const leaksKey = (a.body?.data || []).some(q => q.questions?.some(x => x.correctAnswer !== undefined));
    const b = await S.put('/assessment-quizzes/' + vid, { questions: [{ id: 'q1', question: '2+2?', options: ['3', '4'], correctAnswer: 0 }], updatedBy: 'student' });
    const v2 = await T2.del('/assessment-quizzes/' + vid);
    const ok = [401, 403].includes(a.status) && b.status === 403 && v2.status === 403;
    return { pass: ok, actual: `anon list ${a.status} (answer key exposed=${leaksKey}) | student PUT ${b.status} | teacher2 DELETE ${v2.status}`, severity: sev(!ok) };
  });
  await t('QSB-15', 'Quiz submissions access control (impersonation)', { req: 'A student can only submit/read own submissions', steps: 'Student2 POSTs submission with studentId=student1 (overwriting); anonymous GET student1 submission; student2 PUT student1 submissionId', expected: '403 / 401; student1 submission unchanged', type: 'security' }, async () => {
    const st2 = new h.Client(); st2.cookie = student2.client.cookie;
    const before = await db.collection('quiz_submissions').findOne({ studentId: student.username, quizId: new (require('mongodb').ObjectId)(quizId) });
    const a = await st2.post('/quiz-submissions', { quizId, studentId: student.username, answers: { q1: 0 }, isSubmitted: true });
    const b = await anon().get(`/quiz-submissions/quiz/${quizId}/student/${encodeURIComponent(student.username)}`);
    const c = await st2.put('/quiz-submissions/' + subId, { score: 0 });
    const after = await db.collection('quiz_submissions').findOne({ _id: before._id });
    const ok = [401, 403].includes(a.status) && [401, 403].includes(b.status) && [401, 403].includes(c.status) && after.score === before.score;
    return { pass: ok, actual: `impersonated POST ${a.status} | anon GET ${b.status} | other-student PUT ${c.status} | score ${before.score} -> ${after.score}`, severity: sev(!ok) };
  });
  await t('UPL-08', 'Upload requires authentication', { req: 'Only logged-in users can upload', steps: 'POST /assessment/upload with no session', expected: '401', type: 'security' }, async () => {
    const r = await up(anon(), `${P}-anon.pdf`, 'application/pdf', '%PDF-1.4 anon');
    return { pass: r.status === 401, actual: h.short(r).slice(0, 140), severity: r.status === 200 ? 'High' : '' };
  });

  // cleanup uploaded test files
  try { const fs = require('fs'); const d = `${__ROOT}/../uploads/assessment`; for (const f of fs.readdirSync(d)) if (f.startsWith(P)) fs.unlinkSync(d + '/' + f); } catch {}
  await mc.close();
});
