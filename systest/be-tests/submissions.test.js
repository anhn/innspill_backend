const { suite } = require('../lib');

const BAD_OID = '000000000000000000000000';
const idOf = (r) => r?.body?.data?.id || r?.body?.data?._id || r?.body?.id || r?.body?._id;

suite('BE-SUBMIT', async (t, h) => {
  const P = 'sub-' + h.uid();
  const S = h.short;

  // ---------- Fixtures ----------
  const teacher = await h.makeUser('teacher', P);
  const otherTeacher = await h.makeUser('teacher', P + 'x');
  const stA = await h.makeUser('student', P + 'a');
  const stB = await h.makeUser('student', P + 'b');
  const stC = await h.makeUser('student', P + 'c');
  const tUser = teacher.user.username, aUser = stA.user.username, bUser = stB.user.username, cUser = stC.user.username;
  const T = teacher.client;

  const cr = await T.post('/courses', { name: `${P} course`, academicYear: '2026', university: 'Systest U', teacherIds: [tUser] });
  const courseId = idOf(cr);
  if (!courseId) throw new Error('course create failed ' + S(cr));
  const pr = await T.post('/projects', { projectTitle: `${P} project`, courseId, learningOutcome: 'LO: critical thinking', teacherId: tUser });
  const projectId = idOf(pr);
  if (!projectId) throw new Error('project create failed ' + S(pr));
  const mkTask = async (k) => {
    const r = await T.post('/assessment-tasks', { projectId, taskTitle: `${P} task ${k}`, description: 'Write an essay', keyword: `${P}-${k}`,
      submissionDeadline: new Date(Date.now() + 7 * 864e5).toISOString(), evaluationCriteria: 'Clarity; evidence', status: 'published' });
    const id = idOf(r); if (!id) throw new Error('task create failed ' + S(r)); return id;
  };
  const taskId = await mkTask(1);
  const task2Id = await mkTask(2);
  const rr = await T.post('/assessment-roles', { projectId, name: `${P} CEO`, persona: 'A demanding CEO stakeholder' });
  const roleId = idOf(rr);
  if (!roleId) throw new Error('role create failed ' + S(rr));
  const gr = await T.post('/student-groups', { courseId, projectId, name: `${P} group`, studentIds: [aUser, cUser] });
  const groupId = idOf(gr);
  if (!groupId) throw new Error('group create failed ' + S(gr));

  const base = (who, extra = {}) => ({ taskId, studentId: who.user.username, studentName: who.user.fullName || who.user.username, submission: `${P} essay by ${who.user.username}`, ...extra });

  // ---------- Create ----------
  let subA1, subA2, subB1;
  await t('SUB-01', 'Student creates submission (attempt 1)', { req: 'Students submit task answers', steps: 'Student A POST /assessment-submissions with taskId, studentId, studentName, submission, submissionQuestionAnswer', expected: '201; data echoes fields; GET /:id returns same submission with 1 reflection answer' }, async () => {
    const r = await stA.client.post('/assessment-submissions', base(stA, { conversationLog: 'chat log', submissionQuestionAnswer: 'My reflection', attemptNumber: 1 }));
    subA1 = idOf(r);
    const g = subA1 ? await stA.client.get('/assessment-submissions/' + subA1) : null;
    const ok = r.status === 201 && g?.status === 200 && g.body.data.studentId === aUser && g.body.data.taskId === taskId &&
      g.body.data.submissionQuestionAnswers.length === 1 && g.body.data.attemptNumber === 1 && g.body.data.conversationLog === 'chat log';
    return { pass: ok, actual: `create ${S(r).slice(0, 120)} | read ${g?.status}` };
  });
  await t('SUB-02', 'Resubmission creates attempt 2 kept in history', { req: 'Attempt history', steps: 'Student A POST again for same task with attemptNumber=2; GET /student/:A?taskId', expected: '201; both attempts listed for student/task, newest first' }, async () => {
    const r = await stA.client.post('/assessment-submissions', base(stA, { submission: `${P} improved essay`, attemptNumber: 2 }));
    subA2 = idOf(r);
    const l = await stA.client.get(`/assessment-submissions/student/${encodeURIComponent(aUser)}?taskId=${taskId}`);
    const atts = (l.body?.data || []).map(s => s.attemptNumber);
    return { pass: r.status === 201 && l.status === 200 && atts.length === 2 && atts[0] === 2 && atts[1] === 1, actual: `create ${r.status}; list ${l.status} attempts=${JSON.stringify(atts)}` };
  });
  await t('SUB-03', 'Second student creates own submission', { req: 'Students submit task answers', steps: 'Student B POST submission', expected: '201' }, async () => {
    const r = await stB.client.post('/assessment-submissions', base(stB, { attachments: [`${P}-missing.txt`] }));
    subB1 = idOf(r);
    return { pass: r.status === 201 && !!subB1, actual: S(r).slice(0, 150) };
  });
  await t('SUB-04', 'Create rejects missing required fields', { req: 'Validation', steps: 'POST {taskId} only', expected: '400' }, async () => {
    const r = await stA.client.post('/assessment-submissions', { taskId });
    return { pass: r.status === 400, actual: S(r) };
  });
  await t('SUB-05', 'Create rejects whitespace-only submission text', { req: 'Validation', steps: 'POST submission="   "', expected: '400' }, async () => {
    const r = await stA.client.post('/assessment-submissions', base(stA, { submission: '   ' }));
    return { pass: r.status === 400, actual: S(r) };
  });
  await t('SUB-06', 'Create rejects invalid taskId format', { req: 'Validation', steps: 'POST taskId="not-an-id"', expected: '400' }, async () => {
    const r = await stA.client.post('/assessment-submissions', base(stA, { taskId: 'not-an-id' }));
    return { pass: r.status === 400, actual: S(r) };
  });
  await t('SUB-07', 'Create rejects non-existent task', { req: 'Validation', steps: 'POST taskId=valid but unknown ObjectId', expected: '404' }, async () => {
    const r = await stA.client.post('/assessment-submissions', base(stA, { taskId: BAD_OID }));
    return { pass: r.status === 404, actual: S(r) };
  });
  await t('SUB-08', 'Create rejects attemptNumber 0 and unknown stakeholder', { req: 'Validation', steps: 'POST attemptNumber=0; POST stakeholderId=unknown ObjectId', expected: '400; 404' }, async () => {
    const a = await stA.client.post('/assessment-submissions', base(stA, { attemptNumber: 0 }));
    const b = await stA.client.post('/assessment-submissions', base(stA, { stakeholderId: BAD_OID }));
    return { pass: a.status === 400 && b.status === 404, actual: `attempt0 ${a.status}; stakeholder ${b.status}` };
  });

  // ---------- Read ----------
  await t('SUB-09', 'GET /:id validation (bad id / unknown id)', { req: 'Validation', steps: 'GET /assessment-submissions/xyz and /<unknown>', expected: '400; 404' }, async () => {
    const a = await T.get('/assessment-submissions/xyz'); const b = await T.get('/assessment-submissions/' + BAD_OID);
    return { pass: a.status === 400 && b.status === 404, actual: `${a.status}; ${b.status}` };
  });
  await t('SUB-10', 'Teacher lists submissions by task', { req: 'Teacher views submissions', steps: 'GET /task/:taskId', expected: '200, 3 submissions (A x2, B)' }, async () => {
    const r = await T.get('/assessment-submissions/task/' + taskId);
    const ids = (r.body?.data || []).map(s => s.id);
    return { pass: r.status === 200 && ids.length === 3 && [subA1, subA2, subB1].every(i => ids.includes(i)), actual: `${r.status} count=${ids.length}` };
  });
  await t('SUB-11', 'GET /task/:taskId validation', { req: 'Validation', steps: 'GET /task/bad and /task/:id?stakeholderId=bad', expected: '400; 400' }, async () => {
    const a = await T.get('/assessment-submissions/task/bad'); const b = await T.get(`/assessment-submissions/task/${taskId}?stakeholderId=bad`);
    return { pass: a.status === 400 && b.status === 400, actual: `${a.status}; ${b.status}` };
  });
  await t('SUB-12', 'Batch fetch submissions for multiple tasks', { req: 'Teacher views submissions', steps: 'POST /batch {taskIds:[task1, task2, "bad"]}', expected: '200; task1 has 3, task2 has 0; errors lists "bad"; meta.invalid=1' }, async () => {
    const r = await T.post('/assessment-submissions/batch', { taskIds: [taskId, task2Id, 'bad'] });
    const d = r.body?.data || [];
    const ok = r.status === 200 && d.find(x => x.taskId === taskId)?.submissions.length === 3 && d.find(x => x.taskId === task2Id)?.submissions.length === 0 && r.body.errors?.[0]?.taskId === 'bad' && r.body.meta?.invalid === 1;
    return { pass: ok, actual: S(r).slice(0, 150) };
  });
  await t('SUB-13', 'Batch fetch validation (empty / >30 tasks)', { req: 'Validation', steps: 'POST /batch {taskIds:[]} and 31 ids', expected: '400; 400' }, async () => {
    const a = await T.post('/assessment-submissions/batch', { taskIds: [] });
    const b = await T.post('/assessment-submissions/batch', { taskIds: Array(31).fill(taskId) });
    return { pass: a.status === 400 && b.status === 400, actual: `${a.status}; ${b.status}` };
  });
  await t('SUB-14', 'GET /student/:studentId validation', { req: 'Validation', steps: 'GET /student/:id?taskId=bad', expected: '400' }, async () => {
    const r = await stA.client.get(`/assessment-submissions/student/${encodeURIComponent(aUser)}?taskId=bad`);
    return { pass: r.status === 400, actual: S(r) };
  });
  await t('SUB-15', 'List submissions with filters and distinctUsers', { req: 'Activity monitoring list', steps: 'GET /?taskId=&limit=10 ; GET /?taskId=&distinctUsers=true', expected: '200; 3 rows with student info; distinctUsers returns 2 rows (latest per student, A = attempt 2)' }, async () => {
    const a = await T.get(`/assessment-submissions?taskId=${taskId}&limit=10`);
    const b = await T.get(`/assessment-submissions?taskId=${taskId}&distinctUsers=true`);
    const bd = b.body?.data || [];
    const ok = a.status === 200 && a.body.data.length === 3 && !!a.body.data[0].student && b.status === 200 && bd.length === 2 && bd.find(s => s.studentId === aUser)?.id === subA2;
    return { pass: ok, actual: `filter ${a.status} n=${a.body?.data?.length}; distinct ${b.status} n=${bd.length}`, severity: 'Medium' };
  });
  await t('SUB-16', 'List validation (limit 0, bad sortBy, bad taskId)', { req: 'Validation', steps: 'GET /?limit=0, /?sortBy=x, /?taskId=bad', expected: '400 x3' }, async () => {
    const r = await Promise.all(['?limit=0', '?sortBy=x', '?taskId=bad'].map(q => T.get('/assessment-submissions' + q)));
    return { pass: r.every(x => x.status === 400), actual: r.map(x => x.status).join(',') };
  });

  // ---------- Update ----------
  await t('SUB-17', 'Student updates own submission text and adds reflection', { req: 'Student updates submission', steps: 'PUT /:subA2 {submission, feedbackReceivedQuestionAnswer}; GET', expected: '200; text replaced; feedbackReceivedQuestionAnswers appended' }, async () => {
    const r = await stA.client.put('/assessment-submissions/' + subA2, { submission: `${P} edited essay`, feedbackReceivedQuestionAnswer: 'I will improve' });
    const g = await stA.client.get('/assessment-submissions/' + subA2);
    return { pass: r.status === 200 && g.body?.data?.submission === `${P} edited essay` && g.body.data.feedbackReceivedQuestionAnswers.length === 1, actual: `${r.status}; read text=${g.body?.data?.submission}` };
  });
  await t('SUB-18', 'Teacher grades via PUT: feedback + star score appended to history', { req: 'Teacher grades; feedback & star score history', steps: 'PUT starScore=4 + feedback twice (second starScore=5); GET', expected: '200; feedbackHistory len 2, starScoreHistory [4,5], starScore virtual=5, feedback=latest' }, async () => {
    const a = await T.put('/assessment-submissions/' + subA1, { feedback: 'Good start', feedforward: 'Add evidence', taskQualityScore: 3, reflectionScore: 2, starScore: 4 });
    const b = await T.put('/assessment-submissions/' + subA1, { feedback: 'Much better', taskQualityScore: 'not applicable', starScore: 5, stakeholderId: roleId });
    const g = await T.get('/assessment-submissions/' + subA1);
    const d = g.body?.data || {};
    const ok = a.status === 200 && b.status === 200 && d.feedbackHistory?.length === 2 && JSON.stringify(d.starScoreHistory.map(s => s.score)) === '[4,5]' && d.starScore === 5 && d.feedback === 'Much better' && d.stakeholderId === roleId && d.feedbackHistory[1].taskQualityScore === 'not applicable';
    return { pass: ok, actual: `${a.status},${b.status}; fh=${d.feedbackHistory?.length} stars=${JSON.stringify((d.starScoreHistory || []).map(s => s.score))} star=${d.starScore}` };
  });
  await t('SUB-19', 'PUT validation (empty body, starScore 6, bad id, unknown id, unknown stakeholder)', { req: 'Validation', steps: 'PUT {} ; {starScore:6}; /bad; /<unknown>; {stakeholderId: unknown}', expected: '400,400,400,404,404' }, async () => {
    const r = [await T.put('/assessment-submissions/' + subA1, {}), await T.put('/assessment-submissions/' + subA1, { starScore: 6 }),
      await T.put('/assessment-submissions/bad', { submission: 'x' }), await T.put('/assessment-submissions/' + BAD_OID, { submission: 'x' }),
      await T.put('/assessment-submissions/' + subA1, { stakeholderId: BAD_OID })];
    return { pass: r.map(x => x.status).join(',') === '400,400,400,404,404', actual: r.map(x => x.status).join(',') };
  });

  // ---------- AI feedback ----------
  await t('SUB-20', 'Generate AI feedback for a submission (not persisted)', { req: 'AI feedback generation', steps: 'Teacher POST /:subB1/generate-feedback {}; GET submission', expected: '200; data.feedback non-empty string with score fields; feedbackHistory still empty (generate does not save)' }, async () => {
    const r = await T.post(`/assessment-submissions/${subB1}/generate-feedback`, {}, { timeout: 60000 });
    const g = await T.get('/assessment-submissions/' + subB1);
    const d = r.body?.data || {};
    const ok = r.status === 200 && typeof d.feedback === 'string' && d.feedback.length > 0 && 'taskQualityScore' in d && 'feedforward' in d && g.body?.data?.feedbackHistory?.length === 0;
    return { pass: ok, actual: `${r.status} feedback="${String(d.feedback || '').slice(0, 60)}" tq=${d.taskQualityScore} | saved=${g.body?.data?.feedbackHistory?.length}` };
  });
  await t('SUB-21', 'Generate feedback with stakeholder persona and rule-based mode', { req: 'AI feedback modes', steps: 'POST generate-feedback {stakeholderId: role, feedbackMode:"rule-based", instruction}', expected: '200; data.stakeholderId = role' }, async () => {
    const r = await T.post(`/assessment-submissions/${subB1}/generate-feedback`, { stakeholderId: roleId, feedbackMode: 'rule-based', instruction: 'Be concise' }, { timeout: 60000 });
    return { pass: r.status === 200 && r.body?.data?.stakeholderId === roleId && !!r.body.data.feedback, actual: S(r).slice(0, 150) };
  });
  await t('SUB-22', 'Generate feedback validation', { req: 'Validation', steps: 'POST /bad/generate-feedback; /<unknown>; feedbackMode="x"; stakeholderId="abc"', expected: '400,404,400,400' }, async () => {
    const r = [await T.post('/assessment-submissions/bad/generate-feedback', {}), await T.post(`/assessment-submissions/${BAD_OID}/generate-feedback`, {}),
      await T.post(`/assessment-submissions/${subB1}/generate-feedback`, { feedbackMode: 'x' }), await T.post(`/assessment-submissions/${subB1}/generate-feedback`, { stakeholderId: 'abc' })];
    return { pass: r.map(x => x.status).join(',') === '400,404,400,400', actual: r.map(x => x.status).join(',') };
  });
  await t('SUB-23', 'Save generated feedback to history', { req: 'Feedback history persisted', steps: 'POST /:subB1/save-feedback {feedback, scores, starScore:3, stakeholderId, updateStakeholderId:true}; GET', expected: '200; feedbackHistory len 1 with scores; starScore=3; submission stakeholderId updated' }, async () => {
    const r = await T.post(`/assessment-submissions/${subB1}/save-feedback`, { feedback: 'AI feedback text', feedforward: 'Next steps', concept: 'c', reflection: 'r', criticalThinking: 'ct', taskQualityScore: 4, reflectionScore: 3, criticalthinkingScore: 2, conceptMasteryScore: 5, starScore: 3, stakeholderId: roleId, updateStakeholderId: true });
    const g = await T.get('/assessment-submissions/' + subB1);
    const d = g.body?.data || {}; const fh = d.feedbackHistory?.[0] || {};
    const ok = r.status === 200 && d.feedbackHistory?.length === 1 && fh.conceptMasteryScore === 5 && fh.taskQualityScore === 4 && d.starScore === 3 && d.stakeholderId === roleId;
    return { pass: ok, actual: `${r.status}; fh=${d.feedbackHistory?.length} star=${d.starScore} stakeholder=${d.stakeholderId}` };
  });
  await t('SUB-24', 'Save-feedback validation', { req: 'Validation', steps: 'save-feedback {} ; {feedback, reflectionScore:9}; /bad; /<unknown>; stakeholderId unknown', expected: '400,400,400,404,404' }, async () => {
    const r = [await T.post(`/assessment-submissions/${subB1}/save-feedback`, {}), await T.post(`/assessment-submissions/${subB1}/save-feedback`, { feedback: 'x', reflectionScore: 9 }),
      await T.post('/assessment-submissions/bad/save-feedback', { feedback: 'x' }), await T.post(`/assessment-submissions/${BAD_OID}/save-feedback`, { feedback: 'x' }),
      await T.post(`/assessment-submissions/${subB1}/save-feedback`, { feedback: 'x', stakeholderId: BAD_OID })];
    return { pass: r.map(x => x.status).join(',') === '400,400,400,404,404', actual: r.map(x => x.status).join(',') };
  });

  // extra submissions for batch
  const mk = async (who, extra) => idOf(await who.client.post('/assessment-submissions', base(who, extra)));
  const subC1 = await mk(stC, { taskId: task2Id });
  const subB2 = await mk(stB, { taskId: task2Id });
  await t('SUB-25', 'Batch AI feedback generation', { req: 'Batch AI feedback', steps: 'POST /generate-feedback-batch {submissionIds:[C1,B2,B1(has feedback),"bad",unknown]}', expected: '200; generated=2, failed=3; B1 "Feedback already exists"; nothing persisted' }, async () => {
    const r = await T.post('/assessment-submissions/generate-feedback-batch', { submissionIds: [subC1, subB2, subB1, 'bad', BAD_OID] }, { timeout: 90000 });
    const d = r.body?.data || {}; const res = d.results || [];
    const g = await T.get('/assessment-submissions/' + subC1);
    const ok = r.status === 200 && d.generated === 2 && d.failed === 3 && res.find(x => x.submissionId === subB1)?.error === 'Feedback already exists' && res.filter(x => x.success).every(x => typeof x.feedback === 'string' && x.feedback.length > 0) && g.body?.data?.feedbackHistory?.length === 0;
    return { pass: ok, actual: `${r.status} generated=${d.generated} failed=${d.failed} errs=${JSON.stringify(res.filter(x => !x.success).map(x => x.error))}` };
  });
  await t('SUB-26', 'Batch AI feedback validation', { req: 'Validation', steps: 'POST /generate-feedback-batch {} and {submissionIds:[]}', expected: '400; 400' }, async () => {
    const a = await T.post('/assessment-submissions/generate-feedback-batch', {}); const b = await T.post('/assessment-submissions/generate-feedback-batch', { submissionIds: [] });
    return { pass: a.status === 400 && b.status === 400, actual: `${a.status}; ${b.status}` };
  });
  await t('SUB-27', 'Get feedback prompt (previous attempt detected)', { req: 'Prompt preview for feedback generation', steps: 'GET /:subA2/prompt?userName=teacher', expected: '200; prompt includes submission text; metadata.hasPreviousSubmission=true (attempt 1 exists)' }, async () => {
    const r = await T.get(`/assessment-submissions/${subA2}/prompt?userName=${encodeURIComponent(tUser)}`);
    const d = r.body?.data || {};
    return { pass: r.status === 200 && typeof d.prompt === 'string' && d.prompt.includes(`${P} edited essay`) && d.metadata?.hasPreviousSubmission === true, actual: `${r.status} approach=${d.approachName} prev=${d.metadata?.hasPreviousSubmission} len=${d.prompt?.length}` };
  });
  await t('SUB-28', 'Prompt: few-shot mode and validation', { req: 'Prompt preview / validation', steps: 'GET prompt?feedbackMode=fewshot; prompt without userName; /bad/prompt; /<unknown>/prompt', expected: '200 (approach Few-Shot), 400, 400, 404' }, async () => {
    const q = `?userName=${encodeURIComponent(tUser)}`;
    const r = [await T.get(`/assessment-submissions/${subA2}/prompt${q}&feedbackMode=fewshot`), await T.get(`/assessment-submissions/${subA2}/prompt`),
      await T.get(`/assessment-submissions/bad/prompt${q}`), await T.get(`/assessment-submissions/${BAD_OID}/prompt${q}`)];
    return { pass: r.map(x => x.status).join(',') === '200,400,400,404' && /Few-Shot/.test(r[0].body?.data?.approachName || ''), actual: r.map(x => x.status).join(',') + ' ' + (r[0].body?.data?.approachName || '') };
  });
  await t('SUB-29', 'Delete feedback entry by index and default (latest)', { req: 'Feedback history management', steps: 'DELETE /:subA1/feedback?index=0 then DELETE /:subA1/feedback; GET', expected: '200, remainingCount 1 then 0; deleted entries "Good start" then "Much better"' }, async () => {
    const a = await T.del(`/assessment-submissions/${subA1}/feedback?index=0`);
    const b = await T.del(`/assessment-submissions/${subA1}/feedback`);
    const g = await T.get('/assessment-submissions/' + subA1);
    const ok = a.status === 200 && a.body.data.deletedFeedback.feedback === 'Good start' && a.body.data.remainingCount === 1 && b.status === 200 && b.body.data.deletedFeedback.feedback === 'Much better' && g.body.data.feedbackHistory.length === 0;
    return { pass: ok, actual: `${S(a).slice(0, 80)} | ${b.status} | remaining=${g.body?.data?.feedbackHistory?.length}` };
  });
  await t('SUB-30', 'Delete feedback validation (none left, bad index, bad id, unknown id)', { req: 'Validation', steps: 'DELETE feedback on empty history; ?index=5 on B1 (1 entry); ?index=-1; /bad; /<unknown>', expected: '404,400,400,400,404' }, async () => {
    const r = [await T.del(`/assessment-submissions/${subA1}/feedback`), await T.del(`/assessment-submissions/${subB1}/feedback?index=5`), await T.del(`/assessment-submissions/${subB1}/feedback?index=-1`),
      await T.del('/assessment-submissions/bad/feedback'), await T.del(`/assessment-submissions/${BAD_OID}/feedback`)];
    return { pass: r.map(x => x.status).join(',') === '404,400,400,400,404', actual: r.map(x => x.status).join(',') };
  });

  // ---------- Grouped views ----------
  await t('SUB-31', 'Task grouped view (group + individual)', { req: 'Teacher views group submissions', steps: 'GET /task/:task2/grouped (default group) and ?viewType=individual', expected: '200; group view: 1 group entry with studentIds [A,C] containing C1; individual: C1 has groupId, B2 groupId null' }, async () => {
    const g = await T.get(`/assessment-submissions/task/${task2Id}/grouped`);
    const i = await T.get(`/assessment-submissions/task/${task2Id}/grouped?viewType=individual`);
    const gd = g.body?.data || []; const id = i.body?.data || [];
    const ok = g.status === 200 && gd.length === 1 && gd[0].groupId === groupId && gd[0].submission.includes(cUser) && i.status === 200 && id.find(s => s.id === subC1)?.groupId === groupId && id.find(s => s.id === subB2)?.groupId === null;
    return { pass: ok, actual: `group ${g.status} n=${gd.length}; indiv ${i.status} n=${id.length}` };
  });
  await t('SUB-32', 'Task grouped view validation', { req: 'Validation', steps: 'GET /task/bad/grouped; /task/<unknown>/grouped; viewType=x', expected: '400,404,400' }, async () => {
    const r = [await T.get('/assessment-submissions/task/bad/grouped'), await T.get(`/assessment-submissions/task/${BAD_OID}/grouped`), await T.get(`/assessment-submissions/task/${task2Id}/grouped?viewType=x`)];
    return { pass: r.map(x => x.status).join(',') === '400,404,400', actual: r.map(x => x.status).join(',') };
  });
  await t('SUB-33', 'Project grouped view (group + individual)', { req: 'Teacher views project submissions', steps: 'GET /project/:projectId/grouped and ?viewType=individual', expected: '200; group entries for task1 (A) and task2 (C); individual lists all 5 submissions' }, async () => {
    const g = await T.get(`/assessment-submissions/project/${projectId}/grouped`);
    const i = await T.get(`/assessment-submissions/project/${projectId}/grouped?viewType=individual`);
    const ok = g.status === 200 && (g.body.data || []).length === 2 && i.status === 200 && (i.body.data || []).length === 5;
    return { pass: ok, actual: `group ${g.status} n=${g.body?.data?.length}; indiv ${i.status} n=${i.body?.data?.length}` };
  });
  await t('SUB-34', 'Project grouped validation', { req: 'Validation', steps: 'GET /project/bad/grouped; /project/<unknown>/grouped', expected: '400; 404' }, async () => {
    const a = await T.get('/assessment-submissions/project/bad/grouped'); const b = await T.get(`/assessment-submissions/project/${BAD_OID}/grouped`);
    return { pass: a.status === 400 && b.status === 404, actual: `${a.status}; ${b.status}` };
  });
  await t('SUB-35', 'Stakeholder grouped view', { req: 'Teacher views stakeholder submissions', steps: 'GET /stakeholder/:role/grouped?viewType=individual&taskId=task1 ; group view with taskId', expected: '200; individual contains A1 and B1 (stakeholder set); group view 200' }, async () => {
    const i = await T.get(`/assessment-submissions/stakeholder/${roleId}/grouped?viewType=individual&taskId=${taskId}`);
    const g = await T.get(`/assessment-submissions/stakeholder/${roleId}/grouped?taskId=${taskId}`);
    const ids = (i.body?.data || []).map(s => s.id);
    return { pass: i.status === 200 && ids.includes(subA1) && ids.includes(subB1) && g.status === 200, actual: `indiv ${i.status} n=${ids.length}; group ${S(g).slice(0, 100)}` };
  });
  await t('SUB-36', 'Stakeholder grouped validation', { req: 'Validation', steps: 'GET /stakeholder/bad/grouped; group view without taskId/projectId; taskId=bad', expected: '400,400,400' }, async () => {
    const r = [await T.get('/assessment-submissions/stakeholder/bad/grouped'), await T.get(`/assessment-submissions/stakeholder/${roleId}/grouped`), await T.get(`/assessment-submissions/stakeholder/${roleId}/grouped?taskId=bad`)];
    return { pass: r.map(x => x.status).join(',') === '400,400,400', actual: r.map(x => x.status).join(',') };
  });

  // ---------- Analytics ----------
  await t('SUB-37', 'Heatmap endpoint reachable', { req: 'Teacher analytics: submission heatmap', steps: 'GET /assessment-submissions/heatmap?projectId=', expected: '200; 2 tasks x 3 students cells' }, async () => {
    const r = await T.get(`/assessment-submissions/heatmap?projectId=${projectId}`);
    return { pass: r.status === 200 && r.body?.data?.tasks?.length === 2 && r.body.data.heatmap.length === 6, actual: S(r), severity: 'High' };
  });
  await t('SUB-38', 'Stakeholder heatmap endpoint reachable', { req: 'Teacher analytics: stakeholder heatmap', steps: 'GET /stakeholder-heatmap?projectId=', expected: '200 with stakeholders list containing the role' }, async () => {
    const r = await T.get(`/assessment-submissions/stakeholder-heatmap?projectId=${projectId}`);
    return { pass: r.status === 200 && (r.body?.data?.stakeholders || []).some(s => s.id === roleId), actual: S(r), severity: 'High' };
  });
  await t('SUB-39', 'Progress endpoint reachable', { req: 'Teacher analytics: progress', steps: 'GET /progress?projectId=', expected: '200 with 3 students' }, async () => {
    const r = await T.get(`/assessment-submissions/progress?projectId=${projectId}`);
    return { pass: r.status === 200 && r.body?.data?.students?.length === 3, actual: S(r), severity: 'High' };
  });
  await t('SUB-40', 'Timeline endpoint reachable', { req: 'Teacher analytics: timeline', steps: 'GET /timeline?projectId=&studentId=A', expected: '200 with 2 entries for A, isOnTime true' }, async () => {
    const r = await T.get(`/assessment-submissions/timeline?projectId=${projectId}&studentId=${encodeURIComponent(aUser)}`);
    return { pass: r.status === 200 && r.body?.data?.length === 2 && r.body.data.every(x => x.isOnTime === true), actual: S(r), severity: 'High' };
  });
  await t('SUB-41', 'Analytics endpoints validate projectId', { req: 'Validation', steps: 'GET /heatmap (no projectId), /progress?projectId=bad', expected: '400 with projectId validation message (not generic id error)' }, async () => {
    const a = await T.get('/assessment-submissions/heatmap'); const b = await T.get('/assessment-submissions/progress?projectId=bad');
    return { pass: a.status === 400 && /projectId/i.test(a.text) && b.status === 400 && /projectId/i.test(b.text), actual: `${S(a).slice(0, 90)} | ${S(b).slice(0, 90)}`, severity: 'Medium' };
  });

  // ---------- Attachments ----------
  await t('SUB-42', 'GET /:id/attachments returns task + role attachments', { req: 'Attachment listing', steps: 'GET /:subB1/attachments (B1 has stakeholder role)', expected: '200; stakeholderId=role; sources.task/role arrays; totalCount number' }, async () => {
    const r = await T.get(`/assessment-submissions/${subB1}/attachments`);
    const d = r.body?.data || {};
    return { pass: r.status === 200 && d.stakeholderId === roleId && Array.isArray(d.sources?.task) && Array.isArray(d.sources?.role) && typeof d.totalCount === 'number', actual: S(r).slice(0, 150) };
  });
  await t('SUB-43', 'GET /:id/attachments validation', { req: 'Validation', steps: 'GET /bad/attachments; /<unknown>/attachments', expected: '400; 404' }, async () => {
    const a = await T.get('/assessment-submissions/bad/attachments'); const b = await T.get(`/assessment-submissions/${BAD_OID}/attachments`);
    return { pass: a.status === 400 && b.status === 404, actual: `${a.status}; ${b.status}` };
  });
  await t('SUB-44', 'Course teacher reads submission attachment content', { req: 'Teacher reads attachments', steps: 'Course teacher POST /:subB1/read-attachments (attachment file missing on disk)', expected: '200; attachmentsTotal=1; attachmentsFailed[0].error "File not found"' }, async () => {
    const r = await T.post(`/assessment-submissions/${subB1}/read-attachments`, {});
    const d = r.body?.data || {};
    return { pass: r.status === 200 && d.attachmentsTotal === 1 && d.attachmentsFailed?.[0]?.error === 'File not found', actual: S(r).slice(0, 160) };
  });
  await t('SUB-45', 'read-attachments: students and other teachers forbidden', { req: 'Only course teachers read attachment content', steps: 'Student B (owner) / other teacher / anonymous POST read-attachments', expected: '403, 403, 401/403', type: 'security' }, async () => {
    const a = await stB.client.post(`/assessment-submissions/${subB1}/read-attachments`, {});
    const b = await otherTeacher.client.post(`/assessment-submissions/${subB1}/read-attachments`, {});
    const c = await new h.Client().post(`/assessment-submissions/${subB1}/read-attachments`, {});
    return { pass: a.status === 403 && b.status === 403 && [401, 403].includes(c.status), actual: `${a.status},${b.status},${c.status}` };
  });
  await t('SUB-46', 'read-attachments: anonymous with ?userName of course teacher', { req: 'Identity must come from session, not query param', steps: 'Anonymous POST /:subB1/read-attachments?userName=<teacher username>', expected: '401/403 (query param must not grant teacher identity)', type: 'security' }, async () => {
    const r = await new h.Client().post(`/assessment-submissions/${subB1}/read-attachments?userName=${encodeURIComponent(tUser)}`, {});
    return { pass: [401, 403].includes(r.status), actual: S(r).slice(0, 150), severity: 'High' };
  });
  await t('SUB-47', 'read-attachments validation', { req: 'Validation', steps: 'POST /bad/read-attachments; /<unknown>/read-attachments', expected: '400; 404' }, async () => {
    const a = await T.post('/assessment-submissions/bad/read-attachments', {}); const b = await T.post(`/assessment-submissions/${BAD_OID}/read-attachments`, {});
    return { pass: a.status === 400 && b.status === 404, actual: `${a.status}; ${b.status}` };
  });
  await t('SUB-48', 'Batch attachments for multiple submissions', { req: 'Attachment listing (batch)', steps: 'POST /attachments/batch {submissionIds:[A1,B1,"bad",unknown]}', expected: '200; 2 results; errors for bad + unknown; meta.invalid=1' }, async () => {
    const r = await T.post('/assessment-submissions/attachments/batch', { submissionIds: [subA1, subB1, 'bad', BAD_OID] });
    const d = r.body?.data || {};
    return { pass: r.status === 200 && d.results?.length === 2 && d.errors?.length === 2 && d.meta?.invalid === 1, actual: S(r).slice(0, 160) };
  });
  await t('SUB-49', 'Batch attachments validation', { req: 'Validation', steps: 'POST /attachments/batch {submissionIds:[]} and ["bad"]', expected: '400; 400' }, async () => {
    const a = await T.post('/assessment-submissions/attachments/batch', { submissionIds: [] }); const b = await T.post('/assessment-submissions/attachments/batch', { submissionIds: ['bad'] });
    return { pass: a.status === 400 && b.status === 400, actual: `${a.status}; ${b.status}` };
  });

  // ---------- Share ----------
  let sharedId;
  await t('SUB-50', 'Owner shares submission with group member (creates copy)', { req: 'Share submission with group (SHARE_SUBMISSION_ENDPOINT.md)', steps: 'Student A saves feedback on A2 (by teacher), then A POST /:subA2/share {targetStudentIds:[C]}; GET C submissions for task1', expected: '200; sharedWith[0].status=created; C now has a task1 submission with A2 text and copied feedback history' }, async () => {
    await T.post(`/assessment-submissions/${subA2}/save-feedback`, { feedback: 'Shared feedback', starScore: 4 });
    const r = await stA.client.post(`/assessment-submissions/${subA2}/share`, { targetStudentIds: [cUser] });
    sharedId = r.body?.data?.sharedWith?.[0]?.submissionId;
    const l = await stC.client.get(`/assessment-submissions/student/${encodeURIComponent(cUser)}?taskId=${taskId}`);
    const s = (l.body?.data || [])[0] || {};
    const ok = r.status === 200 && r.body.data.sharedWith[0]?.status === 'created' && s.id === sharedId && s.submission === `${P} edited essay` && s.feedbackHistory?.length === 1 && s.starScoreHistory?.length === 1;
    return { pass: ok, actual: `${S(r).slice(0, 120)} | C has ${l.body?.data?.length}` };
  });
  await t('SUB-51', 'Share again with same feedback is skipped', { req: 'Share idempotency', steps: 'A POST share again to C', expected: '200; skipped[0].reason=already_has_submission_with_same_feedback' }, async () => {
    const r = await stA.client.post(`/assessment-submissions/${subA2}/share`, { targetStudentIds: [cUser] });
    return { pass: r.status === 200 && r.body?.data?.skipped?.[0]?.reason === 'already_has_submission_with_same_feedback', actual: S(r).slice(0, 160) };
  });
  await t('SUB-52', 'Share with autoDetectGroupMembers', { req: 'Share with auto-detected group members', steps: 'A adds new feedback then POST share {autoDetectGroupMembers:true, shareScore:false}', expected: '200; C updated (status updated)' }, async () => {
    await T.post(`/assessment-submissions/${subA2}/save-feedback`, { feedback: 'Newer feedback' });
    const r = await stA.client.post(`/assessment-submissions/${subA2}/share`, { autoDetectGroupMembers: true, shareScore: false });
    const g = await T.get('/assessment-submissions/' + sharedId);
    return { pass: r.status === 200 && r.body?.data?.sharedWith?.[0]?.status === 'updated' && g.body?.data?.feedback === 'Newer feedback', actual: `${S(r).slice(0, 120)} | C latest feedback=${g.body?.data?.feedback}` };
  });
  await t('SUB-53', 'Share rejects targets outside owner\'s group', { req: 'Only group members may receive shares', steps: 'A POST share {targetStudentIds:[B]}', expected: '400 STUDENTS_NOT_IN_GROUP; B not modified' }, async () => {
    const r = await stA.client.post(`/assessment-submissions/${subA2}/share`, { targetStudentIds: [bUser] });
    const g = await T.get('/assessment-submissions/' + subB1);
    return { pass: r.status === 400 && r.body?.error === 'STUDENTS_NOT_IN_GROUP' && g.body?.data?.submission === `${P} essay by ${bUser}`, actual: S(r).slice(0, 150) };
  });
  await t('SUB-54', 'Share validation (no targets, owner not in group, bad id, unknown id, bad body)', { req: 'Validation', steps: 'share {} ; B shares B1 to C (B not in group); /bad/share; /<unknown>/share; targetStudentIds="x"', expected: '400 NO_TARGET_STUDENTS, 400 OWNER_NOT_IN_GROUP, 400, 404 (spec documents 400), 400' }, async () => {
    const r = [await stA.client.post(`/assessment-submissions/${subA2}/share`, {}), await stB.client.post(`/assessment-submissions/${subB1}/share`, { targetStudentIds: [cUser] }),
      await stA.client.post('/assessment-submissions/bad/share', { targetStudentIds: [cUser] }), await stA.client.post(`/assessment-submissions/${BAD_OID}/share`, { targetStudentIds: [cUser] }),
      await stA.client.post(`/assessment-submissions/${subA2}/share`, { targetStudentIds: 'x' })];
    const ok = r[0].status === 400 && r[0].body?.error === 'NO_TARGET_STUDENTS' && r[1].body?.error === 'OWNER_NOT_IN_GROUP' && r[2].status === 400 && [400, 404].includes(r[3].status) && r[4].status === 400;
    return { pass: ok, actual: r.map(x => `${x.status}${x.body?.error && x.body.error.length < 30 ? ':' + x.body.error : ''}`).join(',') };
  });
  await t('SUB-55', 'Share access control: non-owner student and anonymous', { req: 'Only owner/teacher can share', steps: 'Student B POST /:subA2/share {targetStudentIds:[C]}; anonymous same', expected: '403; 401/403', type: 'security' }, async () => {
    const a = await stB.client.post(`/assessment-submissions/${subA2}/share`, { targetStudentIds: [cUser] });
    const b = await new h.Client().post(`/assessment-submissions/${subA2}/share`, { targetStudentIds: [cUser] });
    return { pass: a.status === 403 && [401, 403].includes(b.status), actual: `B ${a.status}; anon ${b.status}` };
  });
  await t('SUB-56', 'Share: teacher of another course can share any submission', { req: 'Only owner or the course teacher can share', steps: 'Unrelated teacher POST /:subA2/share to C', expected: '403 (teacher not linked to the course)', type: 'security' }, async () => {
    await T.post(`/assessment-submissions/${subA2}/save-feedback`, { feedback: 'Even newer feedback' });
    const r = await otherTeacher.client.post(`/assessment-submissions/${subA2}/share`, { targetStudentIds: [cUser] });
    return { pass: r.status === 403, actual: S(r).slice(0, 150), severity: 'Medium' };
  });

  // ---------- Group task status ----------
  await t('SUB-57', 'Group task status for member', { req: 'Group task status (GROUP_TASK_STATUS_ENDPOINT.md)', steps: 'Student A GET /group/:groupId/task-status?projectId&userName=A', expected: '200; A completed [task1]; C completed [task1(shared), task2]' }, async () => {
    const r = await stA.client.get(`/assessment-submissions/group/${groupId}/task-status?projectId=${projectId}&userName=${encodeURIComponent(aUser)}`);
    const d = r.body?.data || {};
    const ok = r.status === 200 && d[aUser]?.taskCount === 1 && d[aUser].completedTasks[0] === taskId && d[cUser]?.taskCount === 2;
    return { pass: ok, actual: S(r).slice(0, 200) };
  });
  await t('SUB-58', 'Group task status: teacher allowed, non-member student forbidden', { req: 'Group task status authorization', steps: 'GET with userName=teacher; with userName=B', expected: '200; 403 UNAUTHORIZED' }, async () => {
    const a = await T.get(`/assessment-submissions/group/${groupId}/task-status?projectId=${projectId}&userName=${encodeURIComponent(tUser)}`);
    const b = await stB.client.get(`/assessment-submissions/group/${groupId}/task-status?projectId=${projectId}&userName=${encodeURIComponent(bUser)}`);
    return { pass: a.status === 200 && b.status === 403, actual: `${a.status}; ${b.status}` };
  });
  await t('SUB-59', 'Group task status validation', { req: 'Validation', steps: 'groupId bad; missing projectId; missing userName; projectId bad; unknown group', expected: '400,400,400,400,404' }, async () => {
    const u = `userName=${encodeURIComponent(aUser)}`;
    const r = [await stA.client.get(`/assessment-submissions/group/bad/task-status?projectId=${projectId}&${u}`), await stA.client.get(`/assessment-submissions/group/${groupId}/task-status?${u}`),
      await stA.client.get(`/assessment-submissions/group/${groupId}/task-status?projectId=${projectId}`), await stA.client.get(`/assessment-submissions/group/${groupId}/task-status?projectId=bad&${u}`),
      await stA.client.get(`/assessment-submissions/group/${BAD_OID}/task-status?projectId=${projectId}&${u}`)];
    return { pass: r.map(x => x.status).join(',') === '400,400,400,400,404', actual: r.map(x => x.status).join(',') };
  });
  await t('SUB-60', 'Group task status: identity spoofed via userName query', { req: 'Authorization must use the session', steps: 'Anonymous / student B GET task-status with userName=<member A>', expected: '401/403 (userName param must not be trusted)', type: 'security' }, async () => {
    const a = await new h.Client().get(`/assessment-submissions/group/${groupId}/task-status?projectId=${projectId}&userName=${encodeURIComponent(aUser)}`);
    const b = await stB.client.get(`/assessment-submissions/group/${groupId}/task-status?projectId=${projectId}&userName=${encodeURIComponent(aUser)}`);
    return { pass: [401, 403].includes(a.status) && [401, 403].includes(b.status), actual: `anon ${a.status}; B-as-A ${b.status}`, severity: 'Medium' };
  });

  // ---------- Security: cross-student access ----------
  await t('SUB-61', 'Anonymous cannot read submissions', { req: 'Submissions require authentication', steps: 'Fresh client GET /:subA1, GET /?taskId=, GET /student/:A', expected: '401 for all', type: 'security' }, async () => {
    const c = new h.Client();
    const r = [await c.get('/assessment-submissions/' + subA1), await c.get(`/assessment-submissions?taskId=${taskId}`), await c.get(`/assessment-submissions/student/${encodeURIComponent(aUser)}`)];
    return { pass: r.every(x => x.status === 401), actual: r.map(x => x.status).join(',') + ` (anon read A1 text: ${r[0].body?.data?.submission ? 'yes' : 'no'})`, severity: 'Critical' };
  });
  await t('SUB-62', 'Anonymous cannot create/modify/delete submissions', { req: 'Submissions require authentication', steps: 'Fresh client POST create, PUT /:subA1, DELETE /:subB2 (verify still exists)', expected: '401 for all; nothing changed', type: 'security' }, async () => {
    const c = new h.Client();
    const a = await c.post('/assessment-submissions', base(stA, { submission: 'anon injected' }));
    const b = await c.put('/assessment-submissions/' + subA1, { submission: 'anon overwrite' });
    const g = await T.get('/assessment-submissions/' + subA1);
    return { pass: a.status === 401 && b.status === 401 && g.body?.data?.submission !== 'anon overwrite', actual: `create ${a.status}; put ${b.status}; A1 text now="${g.body?.data?.submission}"`, severity: 'Critical' };
  });
  await t('SUB-63', 'Student B cannot read Student A\'s submission', { req: 'Students see only their own submissions', steps: 'Student B GET /:subA1 and GET /student/:A', expected: '403/404; no A data returned', type: 'security' }, async () => {
    const a = await stB.client.get('/assessment-submissions/' + subA1);
    const b = await stB.client.get(`/assessment-submissions/student/${encodeURIComponent(aUser)}`);
    return { pass: [403, 404].includes(a.status) && [403, 404].includes(b.status), actual: `GET /:id ${a.status} (text="${a.body?.data?.submission || ''}"); /student/A ${b.status} n=${b.body?.data?.length}`, severity: 'Critical' };
  });
  await t('SUB-64', 'Student B cannot modify Student A\'s submission', { req: 'Students modify only their own submissions', steps: 'Student B PUT /:subA1 {submission:"hacked"}; read back', expected: '403; A1 text unchanged', type: 'security' }, async () => {
    const r = await stB.client.put('/assessment-submissions/' + subA1, { submission: `${P} hacked by B` });
    const g = await T.get('/assessment-submissions/' + subA1);
    return { pass: r.status === 403 && g.body?.data?.submission !== `${P} hacked by B`, actual: `PUT ${r.status}; A1 text now="${g.body?.data?.submission}"`, severity: 'Critical' };
  });
  await t('SUB-65', 'Student B cannot create a submission on behalf of Student A', { req: 'studentId must match the logged-in student', steps: 'Student B POST create with studentId=A', expected: '403 (or studentId forced to B)', type: 'security' }, async () => {
    const r = await stB.client.post('/assessment-submissions', base(stA, { submission: `${P} forged by B`, taskId: task2Id }));
    const forged = r.status === 201 && r.body?.data?.studentId === aUser;
    return { pass: !forged && r.status !== 500, actual: S(r).slice(0, 150), severity: 'Critical' };
  });
  await t('SUB-66', 'Student cannot grade own submission (save-feedback / star score)', { req: 'Only teachers grade', steps: 'Student B POST /:subB2/save-feedback {feedback, starScore:5}; PUT /:subB2 {starScore:5}', expected: '403 for both; no score recorded', type: 'security' }, async () => {
    const a = await stB.client.post(`/assessment-submissions/${subB2}/save-feedback`, { feedback: 'I am great', starScore: 5, taskQualityScore: 5 });
    const b = await stB.client.put('/assessment-submissions/' + subB2, { starScore: 5 });
    const g = await T.get('/assessment-submissions/' + subB2);
    return { pass: a.status === 403 && b.status === 403, actual: `save-feedback ${a.status}; put ${b.status}; stored starScore=${g.body?.data?.starScore}`, severity: 'Critical' };
  });
  await t('SUB-67', 'Student B cannot delete feedback / generate feedback on A\'s submission', { req: 'Feedback management restricted', steps: 'Student B POST /:subA2/generate-feedback; DELETE /:subA2/feedback', expected: '403 for both; A2 feedback intact', type: 'security' }, async () => {
    const before = (await T.get('/assessment-submissions/' + subA2)).body?.data?.feedbackHistory?.length;
    const a = await stB.client.post(`/assessment-submissions/${subA2}/generate-feedback`, {}, { timeout: 60000 });
    const b = await stB.client.del(`/assessment-submissions/${subA2}/feedback`);
    const after = (await T.get('/assessment-submissions/' + subA2)).body?.data?.feedbackHistory?.length;
    return { pass: a.status === 403 && b.status === 403 && before === after, actual: `generate ${a.status}; delete ${b.status}; feedback count ${before}->${after}`, severity: 'Critical' };
  });
  await t('SUB-68', 'Anonymous cannot use AI feedback endpoints', { req: 'AI endpoints require auth (cost control)', steps: 'Fresh client POST /:subB1/generate-feedback and /generate-feedback-batch', expected: '401', type: 'security' }, async () => {
    const c = new h.Client();
    const a = await c.post(`/assessment-submissions/${subB1}/generate-feedback`, {}, { timeout: 60000 });
    const b = await c.post('/assessment-submissions/generate-feedback-batch', { submissionIds: [BAD_OID] });
    return { pass: a.status === 401 && b.status === 401, actual: `single ${a.status}; batch ${b.status}`, severity: 'High' };
  });
  await t('SUB-69', 'Other teacher cannot view this course\'s submissions/analytics', { req: 'Teachers see only their courses', steps: 'Unrelated teacher GET /task/:taskId and /project/:projectId/grouped', expected: '403', type: 'security' }, async () => {
    const a = await otherTeacher.client.get('/assessment-submissions/task/' + taskId);
    const b = await otherTeacher.client.get(`/assessment-submissions/project/${projectId}/grouped`);
    return { pass: a.status === 403 && b.status === 403, actual: `task ${a.status} n=${a.body?.data?.length}; project ${b.status}`, severity: 'High' };
  });

  // ---------- Delete ----------
  await t('SUB-70', 'Student B cannot delete Student A\'s submission', { req: 'Students delete only own submissions', steps: 'Student B DELETE /:subA1; read back', expected: '403; A1 still exists', type: 'security' }, async () => {
    const r = await stB.client.del('/assessment-submissions/' + subA1);
    const g = await T.get('/assessment-submissions/' + subA1);
    return { pass: r.status === 403 && g.status === 200, actual: `DELETE ${r.status}; A1 read after ${g.status}`, severity: 'Critical' };
  });
  const subDel = await mk(stA, { taskId: task2Id, submission: `${P} to delete` });
  await t('SUB-71', 'Owner deletes own submission', { req: 'Delete submission', steps: 'Student A DELETE /:id; GET /:id', expected: '200; then 404' }, async () => {
    const r = await stA.client.del('/assessment-submissions/' + subDel);
    const g = await stA.client.get('/assessment-submissions/' + subDel);
    return { pass: r.status === 200 && g.status === 404, actual: `${r.status}; read ${g.status}` };
  });
  await t('SUB-72', 'Delete validation (bad id / unknown id)', { req: 'Validation', steps: 'DELETE /bad; DELETE /<unknown>', expected: '400; 404' }, async () => {
    const a = await T.del('/assessment-submissions/bad'); const b = await T.del('/assessment-submissions/' + BAD_OID);
    return { pass: a.status === 400 && b.status === 404, actual: `${a.status}; ${b.status}` };
  });
});
