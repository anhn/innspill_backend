const { suite } = require('../lib');
const { MongoClient, ObjectId } = require('mongodb');

suite('BE-MON', async (t, h) => {
  const mc = await MongoClient.connect('mongodb://127.0.0.1:27017/?replicaSet=rs0');
  const db = mc.db('ai4edu_database');
  const P = 'mon-' + h.uid();
  const anon = () => new h.Client();
  const sec = { type: 'security' };

  // ================= SYS (app.js) =================
  await t('SYS-01', 'GET / returns API index', { req: 'Root endpoint lists API', steps: 'GET /', expected: '200 success, endpoints map' }, async () => {
    const r = await anon().get(h.BASE + '/');
    return { pass: r.status === 200 && r.body?.success && !!r.body?.endpoints?.health, actual: h.short(r) };
  });
  await t('SYS-02', 'GET /health returns ok', { req: 'Health check', steps: 'GET /health', expected: '200 success, timestamp' }, async () => {
    const r = await anon().get(h.BASE + '/health');
    return { pass: r.status === 200 && r.body?.success === true && !!r.body?.timestamp, actual: h.short(r) + ` (${r.ms}ms)` };
  });
  await t('SYS-03', 'Unknown path returns JSON 404', { req: '404 handler', steps: 'GET /api/v1/does-not-exist', expected: '404 JSON error Endpoint not found' }, async () => {
    const r = await anon().get('/does-not-exist-' + P);
    return { pass: r.status === 404 && r.body?.error === 'Endpoint not found', actual: h.short(r) };
  });
  await t('SYS-04', 'Malformed JSON body handled by global error handler', { req: 'Global error handler', steps: 'POST /user-feedback with body "{bad"', expected: '400 JSON {success:false}' }, async () => {
    const r = await anon().post('/user-feedback', '{bad');
    return { pass: r.status === 400 && r.body?.success === false, actual: h.short(r) };
  });
  await t('SYS-05', 'Global error handler does not leak stack traces', { req: 'No internal details in errors', steps: 'POST malformed JSON, inspect body', expected: 'no "stack" field / file paths in response', type: 'security', severity: 'Low' }, async () => {
    const r = await anon().post('/user-feedback', '{bad');
    const leak = !!r.body?.stack || /node_modules|\/home\//.test(r.text);
    return { pass: !leak, actual: `${r.status} stack present=${!!r.body?.stack}; ${(r.body?.stack || '').slice(0, 100)}` };
  });

  // ================= Seed monitoring dataset in isolated window (Feb 2009) =================
  const W = 'startDate=2009-02-01&endDate=2009-02-28';
  // remove leftovers of earlier (crashed) runs of this suite, prefix-filtered
  await db.collection('action_log').deleteMany({ 'metadata.p': { $regex: '^mon-' }, endpoint: { $regex: '^/api/v1/mon-' } });
  await db.collection('user_feedback').deleteMany({ userId: { $regex: '^mon-' } });
  await db.collection('ai4edu_user').deleteMany({ remark: { $regex: '^mon-' }, username: { $regex: '^mon-' } });
  const uA = `${P}-ua`, uB = `${P}-ub`, uC = `${P}-uc`;
  await db.collection('ai4edu_user').insertMany([uA, uB, uC].map(u => ({ username: u, email: u, fullName: u, password: 'x', type: 'teacher', remark: P, date_created: new Date('2009-02-05T12:00:00Z') })));
  const log = (o) => ({ ipAddress: '127.0.0.1', endpoint: '/api/v1/' + P, method: 'POST', success: true, metadata: { p: P }, ...o });
  await db.collection('action_log').insertMany([
    log({ userId: uA, sessionId: P + '-s1', action: 'general-chat', timestamp: new Date('2009-02-10T10:00:00Z'), tokenUsageInternal: { promptTokens: 100, completionTokens: 50 }, processingTime: 2000 }),
    log({ userId: uA, sessionId: P + '-s1', action: 'revise-prompt', timestamp: new Date('2009-02-10T10:10:00Z'), tokenUsageInternal: { promptTokens: 200, completionTokens: 100 }, processingTime: 4000 }),
    log({ userId: uB, sessionId: P + '-s2', action: 'generate-worksheet', timestamp: new Date('2009-02-28T12:00:00Z'), tokenUsageInternal: { promptTokens: 300, completionTokens: 150 }, processingTime: 6000 }),
    log({ sessionId: P + '-s3', action: 'login', timestamp: new Date('2009-02-12T08:00:00Z') }),
  ]);
  await db.collection('user_feedback').insertMany([
    { userId: P, experienceRating: 4, aiCompetenceRating: 5, learningRating: 3, createdAt: new Date('2009-02-07T12:00:00Z'), updatedAt: new Date() },
    { userId: P, experienceRating: 2, aiCompetenceRating: 4, learningRating: 3, createdAt: new Date('2009-02-07T13:00:00Z'), updatedAt: new Date() },
  ]);
  const teacher = await h.makeUser('teacher', P);

  // ================= MON =================
  let pu;
  await t('MON-01', 'platform-usage computes correct aggregates', { req: 'Active users, registrations, session duration, feedback averages', steps: 'Seed 4 logs (2 users, sessions 600s/0s/0s), 3 users, 2 feedback in Feb 2009; GET platform-usage?period=monthly&' + W, expected: '200; activeUsers=2, newRegistrations=3, averageSessionDuration=200, ratings exp=3 ai=4.5 learn=3' }, async () => {
    const r = await teacher.client.get(`/monitoring/platform-usage?period=monthly&${W}`); pu = r;
    const d = r.body?.data || {};
    const f = d.averageFeedbackRatings || {};
    const ok = r.status === 200 && d.activeUsers === 2 && d.newRegistrations === 3 && d.averageSessionDuration === 200 && f.experienceRating === 3 && f.aiCompetenceRating === 4.5 && f.learningRating === 3;
    return { pass: ok, actual: `${r.status} ${r.ms}ms active=${d.activeUsers} reg=${d.newRegistrations} avgSess=${d.averageSessionDuration} fb=${JSON.stringify(f)}` };
  });
  await t('MON-02', 'platform-usage dailyBreakdown covers requested dates', { req: 'Daily breakdown for the period', steps: 'Inspect dailyBreakdown of MON-01 (activity on 2009-02-28 by userB)', expected: 'dates 2009-02-01..2009-02-28; entry 2009-02-28 has activeUsers=1', severity: 'Medium' }, async () => {
    const b = pu?.body?.data?.dailyBreakdown || [];
    const first = b[0]?.date, last = b[b.length - 1]?.date;
    const d28 = b.find(x => x.date === '2009-02-28');
    return { pass: first === '2009-02-01' && last === '2009-02-28' && d28?.activeUsers === 1, actual: `len=${b.length} first=${first} last=${last} feb28=${JSON.stringify(d28)}` };
  });
  await t('MON-03', 'module-usage maps actions to modules correctly', { req: 'Module usage by users', steps: 'GET module-usage?period=monthly&' + W, expected: '200; aiLiteracy=1, prompting=1, worksheets=1, assessment=0; usernames resolved' }, async () => {
    const r = await teacher.client.get(`/monitoring/module-usage?period=monthly&${W}`);
    const m = r.body?.data?.modulesObject || {};
    const ok = r.status === 200 && m.aiLiteracy?.totalActions === 1 && m.prompting?.totalActions === 1 && m.worksheets?.totalActions === 1 && m.assessment?.totalActions === 0
      && m.aiLiteracy?.uniqueUsers === 1 && m.aiLiteracy.actionsByUser[0]?.username === uA;
    return { pass: ok, actual: `${r.status} ${r.ms}ms ` + JSON.stringify(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [v.totalActions, v.uniqueUsers, v.actionsByUser?.[0]?.username]]))) };
  });
  await t('MON-04', 'module-usage userId filter', { req: 'Filter by user', steps: `GET module-usage ... &userId=${uA}`, expected: 'aiLiteracy=1, prompting=1, worksheets=0' }, async () => {
    const r = await teacher.client.get(`/monitoring/module-usage?period=monthly&${W}&userId=${encodeURIComponent(uA)}`);
    const m = r.body?.data?.modulesObject || {};
    return { pass: r.status === 200 && m.aiLiteracy?.totalActions === 1 && m.prompting?.totalActions === 1 && m.worksheets?.totalActions === 0, actual: `${r.status} ${r.ms}ms ai=${m.aiLiteracy?.totalActions} pr=${m.prompting?.totalActions} ws=${m.worksheets?.totalActions}` };
  });
  await t('MON-05', 'llm-usage token/time totals', { req: 'LLM usage by module and user', steps: 'GET llm-usage?period=monthly&' + W, expected: '200; summary req=600 resp=300 count=3 time=12s; byUser uA 300/150, uB 300/150' }, async () => {
    const r = await teacher.client.get(`/monitoring/llm-usage?period=monthly&${W}`);
    const d = r.body?.data || {}; const s = d.summary || {};
    const ua = (d.byUser || []).find(u => u.userId === uA), ub = (d.byUser || []).find(u => u.userId === uB);
    const ok = r.status === 200 && s.totalRequestSize === 600 && s.totalResponseSize === 300 && s.totalRequestCount === 3 && s.totalProcessingTime === 12
      && ua?.totalRequestSize === 300 && ua?.totalResponseSize === 150 && ua?.username === uA && ub?.totalRequestSize === 300;
    return { pass: ok, actual: `${r.status} ${r.ms}ms summary=${JSON.stringify(s)} uA=${JSON.stringify(ua && [ua.totalRequestSize, ua.totalResponseSize, ua.username])}` };
  });
  await t('MON-06', 'llm-usage module filter', { req: 'Filter by module', steps: 'GET llm-usage ... &module=worksheets', expected: 'summary count=1 req=300' }, async () => {
    const r = await teacher.client.get(`/monitoring/llm-usage?period=monthly&${W}&module=worksheets`);
    const s = r.body?.data?.summary || {};
    return { pass: r.status === 200 && s.totalRequestCount === 1 && s.totalRequestSize === 300, actual: `${r.status} ${r.ms}ms ${JSON.stringify(s)}` };
  });
  await t('MON-07', 'Monitoring query validation', { req: 'Reject invalid params', steps: 'platform-usage without period; period=daily; startDate=notadate; llm-usage module=foo', expected: '400 for each' }, async () => {
    const rs = await Promise.all([
      teacher.client.get('/monitoring/platform-usage'), teacher.client.get('/monitoring/module-usage?period=daily'),
      teacher.client.get('/monitoring/platform-usage?period=weekly&startDate=notadate'), teacher.client.get('/monitoring/llm-usage?period=weekly&module=foo')]);
    return { pass: rs.every(r => r.status === 400), actual: rs.map(r => r.status).join(',') };
  });
  await t('MON-08', 'Weekly default range works', { req: 'Default period range', steps: 'GET platform-usage?period=weekly', expected: '200 with 8 daily entries' }, async () => {
    const r = await teacher.client.get('/monitoring/platform-usage?period=weekly');
    return { pass: r.status === 200 && Array.isArray(r.body?.data?.dailyBreakdown) && r.body.data.dailyBreakdown.length >= 7, actual: `${r.status} ${r.ms}ms days=${r.body?.data?.dailyBreakdown?.length}` };
  });
  await t('MON-09', 'dashboard returns endpoint pointers', { req: 'Dashboard endpoint', steps: 'GET dashboard?period=weekly; and without period', expected: '200 with endpoints; 400 without period' }, async () => {
    const r = await teacher.client.get('/monitoring/dashboard?period=weekly');
    const b = await teacher.client.get('/monitoring/dashboard');
    return { pass: r.status === 200 && !!r.body?.endpoints?.llmUsage && b.status === 400, actual: `${h.short(r).slice(0, 120)} | noPeriod ${b.status}` };
  });

  // ================= LIT =================
  const lu = await h.makeUser('teacher', P);
  const me = (await lu.client.get('/auth/me')).body?.user?.id;
  await t('LIT-01', 'Save AI literacy progress for session user', { req: 'Track AI literacy progress', steps: 'POST /ai-literacy/status {progress:50, metadata}; GET /ai-literacy/status', expected: '200 status in_progress, progress 50; read-back equals' }, async () => {
    const r = await lu.client.post('/ai-literacy/status', { progress: 50, metadata: { level: 2 } });
    const g = await lu.client.get('/ai-literacy/status');
    return { pass: r.status === 200 && r.body?.data?.status === 'in_progress' && g.body?.data?.progress === 50 && g.body?.data?.userId === me, actual: `post ${h.short(r).slice(0, 120)} | get ${g.status} ${g.body?.data?.status}/${g.body?.data?.progress}` };
  });
  await t('LIT-02', 'progress=100 auto-completes', { req: 'Completion state transition', steps: 'POST {progress:100}', expected: 'status completed, completionDate set' }, async () => {
    const r = await lu.client.post('/ai-literacy/status', { progress: 100 });
    const doc = await db.collection('ai_literacy_status').findOne({ userId: new ObjectId(me) });
    return { pass: r.body?.data?.status === 'completed' && !!doc?.completionDate, actual: `${r.status} ${r.body?.data?.status} db.completionDate=${doc?.completionDate}` };
  });
  await t('LIT-03', 'status=not_started resets progress', { req: 'Reset state', steps: 'POST {status:not_started}', expected: 'progress 0, completionDate null' }, async () => {
    const r = await lu.client.post('/ai-literacy/status', { status: 'not_started' });
    return { pass: r.body?.data?.progress === 0 && r.body?.data?.completionDate === null, actual: h.short(r).slice(0, 160) };
  });
  await t('LIT-04', 'AI literacy validation', { req: 'Reject invalid input', steps: 'status=foo; progress=150; anonymous no userId; userId=bad; userId=nonexistent', expected: '400,400,400,400,404' }, async () => {
    const rs = [await lu.client.post('/ai-literacy/status', { status: 'foo' }), await lu.client.post('/ai-literacy/status', { progress: 150 }),
      await anon().post('/ai-literacy/status', { progress: 10 }), await anon().post('/ai-literacy/status', { userId: 'bad', progress: 10 }),
      await anon().post('/ai-literacy/status', { userId: new ObjectId().toString(), progress: 10 })];
    return { pass: rs.map(r => r.status).join(',') === '400,400,400,400,404', actual: rs.map(r => r.status).join(',') };
  });
  await t('LIT-05', 'GET /status/:userId', { req: 'Read status by user', steps: 'GET own id; invalid id; non-existent id; fresh user default', expected: '200 matches; 400; 404; default not_started' }, async () => {
    const fresh = await h.makeUser('student', P); const fid = (await fresh.client.get('/auth/me')).body?.user?.id;
    const a = await lu.client.get('/ai-literacy/status/' + me), b = await lu.client.get('/ai-literacy/status/bad'),
      c = await lu.client.get('/ai-literacy/status/' + new ObjectId()), d = await lu.client.get('/ai-literacy/status/' + fid);
    return { pass: a.status === 200 && a.body?.data?.status === 'not_started' && a.body?.data?.id && b.status === 400 && c.status === 404 && d.body?.data?.status === 'not_started' && !d.body?.data?.id, actual: `${a.status},${b.status},${c.status},${d.status}/${d.body?.data?.status}` };
  });
  await t('LIT-06', 'AI literacy stats are computed correctly', { req: 'Completion statistics', steps: 'stats before; 2 new users post completed / progress 40; stats after; compare to DB', expected: 'total +2, completed +1, inProgress +1; averageProgress equals DB average' }, async () => {
    const before = (await anon().get('/ai-literacy/stats')).body?.data || {};
    const x = await h.makeUser('student', P), y = await h.makeUser('student', P);
    await x.client.post('/ai-literacy/status', { status: 'completed' }); await y.client.post('/ai-literacy/status', { progress: 40 });
    const r = await anon().get('/ai-literacy/stats'); const a = r.body?.data || {};
    const all = await db.collection('ai_literacy_status').find().toArray();
    const avg = Math.round(all.reduce((s, d) => s + d.progress, 0) / all.length * 100) / 100;
    const ok = a.total - before.total === 2 && a.completed - before.completed === 1 && a.inProgress - before.inProgress === 1 && a.averageProgress === avg && a.total === all.length;
    return { pass: ok, actual: `${r.status} ${r.ms}ms before=${JSON.stringify(before)} after=${JSON.stringify(a)} dbAvg=${avg}` };
  });
  await t('LIT-07', 'Stats filter validation', { req: 'Query validation', steps: 'GET stats?status=foo; ?minProgress=200; ?status=completed', expected: '400,400,200 (only completed counted)' }, async () => {
    const a = await anon().get('/ai-literacy/stats?status=foo'), b = await anon().get('/ai-literacy/stats?minProgress=200'), c = await anon().get('/ai-literacy/stats?status=completed');
    return { pass: a.status === 400 && b.status === 400 && c.status === 200 && c.body?.data?.total === c.body?.data?.completed, actual: `${a.status},${b.status},${c.status} ${JSON.stringify(c.body?.data)}` };
  });
  await t('LIT-08', 'Cannot modify/read another user\'s AI literacy status', { ...sec, req: 'Users only change their own progress', steps: 'Anonymous POST {userId:victim, status:completed}; other user POST same; anonymous GET /status?userId=victim', expected: '401/403, victim unchanged', severity: 'High' }, async () => {
    const victim = await h.makeUser('teacher', P); const vid = (await victim.client.get('/auth/me')).body?.user?.id;
    const a = await anon().post('/ai-literacy/status', { userId: vid, status: 'completed' });
    const b = await lu.client.post('/ai-literacy/status', { userId: vid, progress: 7 });
    const c = await anon().get('/ai-literacy/status?userId=' + vid);
    const doc = await db.collection('ai_literacy_status').findOne({ userId: new ObjectId(vid) });
    return { pass: [401, 403].includes(a.status) && [401, 403].includes(b.status) && !doc, actual: `anonPOST ${a.status}, otherUserPOST ${b.status}, anonGET ${c.status}; victim doc now=${doc ? doc.status + '/' + doc.progress : 'none'}` };
  });

  // ================= UFB =================
  const C = new ObjectId().toString();
  let fb1;
  await t('UFB-01', 'Submit feedback (UI payload)', { req: 'Users rate the platform', steps: 'POST /user-feedback {3 ratings, reflections, courseId} with session', expected: '201, persisted with ratings, userId = session user' }, async () => {
    const r = await teacher.client.post('/user-feedback', { experienceRating: 5, aiCompetenceRating: 4, learningRating: 3, openEndedReflections: P + ' great', courseId: C });
    fb1 = r.body?.data?.id;
    const doc = fb1 && await db.collection('user_feedback').findOne({ _id: new ObjectId(fb1) });
    return { pass: r.status === 201 && doc?.experienceRating === 5 && !!doc?.userId, actual: `${h.short(r).slice(0, 150)} | db userId=${doc?.userId}` };
  });
  await t('UFB-02', 'Feedback records username of logged-in user', { req: 'Feedback attributed to user', steps: 'Inspect UFB-01 record (no username in body)', expected: `username = ${teacher.username}`, severity: 'Low' }, async () => {
    const doc = fb1 && await db.collection('user_feedback').findOne({ _id: new ObjectId(fb1) });
    return { pass: doc?.username === teacher.username, actual: `username=${doc?.username}` };
  });
  await anon().post('/user-feedback', { experienceRating: 4, aiCompetenceRating: 4, learningRating: 2, courseId: C, username: P + '-anon' });
  await anon().post('/user-feedback', { experienceRating: 3, aiCompetenceRating: 1, learningRating: 1, courseId: C });
  await t('UFB-03', 'Feedback validation', { req: 'Ratings 1-5 integers', steps: 'rating 6; missing learningRating; 3.5; courseId=bad; projectId=bad', expected: '400 for all' }, async () => {
    const base = { experienceRating: 3, aiCompetenceRating: 3, learningRating: 3 };
    const rs = await Promise.all([{ ...base, experienceRating: 6 }, { experienceRating: 3, aiCompetenceRating: 3 }, { ...base, learningRating: 3.5 }, { ...base, courseId: 'bad' }, { ...base, projectId: 'bad' }].map(b => anon().post('/user-feedback', b)));
    return { pass: rs.every(r => r.status === 400), actual: rs.map(r => r.status).join(',') };
  });
  await t('UFB-04', 'List feedback filtered by course with pagination', { req: 'List feedback', steps: `GET /user-feedback?courseId=C; ?courseId=C&limit=1`, expected: 'total 3, newest first; limit=1 -> 1 item hasMore true' }, async () => {
    const r = await teacher.client.get('/user-feedback?courseId=' + C), p = await teacher.client.get(`/user-feedback?courseId=${C}&limit=1`);
    return { pass: r.status === 200 && r.body?.pagination?.total === 3 && r.body.data.length === 3 && p.body?.data?.length === 1 && p.body?.pagination?.hasMore === true, actual: `${r.status} total=${r.body?.pagination?.total} | limit1 len=${p.body?.data?.length} hasMore=${p.body?.pagination?.hasMore}` };
  });
  await t('UFB-05', 'List validation', { req: 'Query validation', steps: '?projectId=bad; ?limit=0; ?limit=101', expected: '400,400,400' }, async () => {
    const rs = await Promise.all(['projectId=bad', 'limit=0', 'limit=101'].map(q => anon().get('/user-feedback?' + q)));
    return { pass: rs.every(r => r.status === 400), actual: rs.map(r => r.status).join(',') };
  });
  await t('UFB-06', 'Feedback stats computed correctly', { req: 'Aggregated rating statistics', steps: 'GET /user-feedback/stats?courseId=C (ratings 5/4/3, 4/4/2, 3/1/1)', expected: 'count 3, avg exp 4, ai 3, learn 2; distributions exact' }, async () => {
    const r = await anon().get('/user-feedback/stats?courseId=' + C); const d = r.body?.data || {}; const dist = d.ratingDistribution || {};
    const ok = d.totalCount === 3 && d.averageExperienceRating === 4 && d.averageAiCompetenceRating === 3 && d.averageLearningRating === 2
      && JSON.stringify(dist.experienceRating) === '{"1":0,"2":0,"3":1,"4":1,"5":1}' && JSON.stringify(dist.aiCompetenceRating) === '{"1":1,"2":0,"3":0,"4":2,"5":0}';
    return { pass: ok, actual: `${r.status} ${r.ms}ms ${JSON.stringify(d).slice(0, 220)}` };
  });
  await t('UFB-07', 'Stats: empty set and invalid id', { req: 'Edge cases', steps: 'stats?courseId=<unused>; stats?courseId=bad', expected: '200 zeros; 400' }, async () => {
    const a = await anon().get('/user-feedback/stats?courseId=' + new ObjectId()), b = await anon().get('/user-feedback/stats?courseId=bad');
    return { pass: a.status === 200 && a.body?.data?.totalCount === 0 && b.status === 400, actual: `${a.status} count=${a.body?.data?.totalCount}; ${b.status}` };
  });
  await t('UFB-08', 'Feedback list not readable anonymously / by other users', { ...sec, req: 'Personal feedback is private', steps: 'Anonymous GET /user-feedback?courseId=C; student GET same', expected: '401/403', severity: 'High' }, async () => {
    const a = await anon().get('/user-feedback?courseId=' + C);
    const s = await h.makeUser('student', P); const b = await s.client.get('/user-feedback?courseId=' + C);
    return { pass: [401, 403].includes(a.status) && [401, 403].includes(b.status), actual: `anon ${a.status} items=${a.body?.data?.length} sample=${JSON.stringify(a.body?.data?.[0] && { userId: a.body.data[0].userId, refl: a.body.data[0].openEndedReflections })}; student ${b.status}` };
  });

  // ================= Student metrics seed =================
  const s1 = await h.makeUser('student', P), s2 = await h.makeUser('student', P);
  const course = await teacher.client.post('/courses', { name: P + ' course', academicYear: '2026', university: 'Sys U' });
  const courseId = course.body?.data?.id;
  const proj = await teacher.client.post('/projects', { projectTitle: P + ' proj', courseId });
  const projectId = proj.body?.data?.id;
  const t1 = await teacher.client.post('/assessment-tasks', { projectId, taskTitle: 'T1', description: 'd', keyword: 'k1', submissionDeadline: '2020-01-01T00:00:00Z' });
  const t2 = await teacher.client.post('/assessment-tasks', { projectId, taskTitle: 'T2', description: 'd', keyword: 'k2', submissionDeadline: '2030-01-01T00:00:00Z' });
  const task1 = t1.body?.data?.id, task2 = t2.body?.data?.id;
  if (!projectId || !task1 || !task2) throw new Error(`seed failed course=${course.status} proj=${proj.status} ${proj.text.slice(0, 100)} t1=${t1.status}`);
  const fh = (tq, rs, cm) => [{ feedback: 'f', concept: 'C1', taskQualityScore: tq, reflectionScore: rs, conceptMasteryScore: cm, criticalthinkingScore: null, createdAt: new Date() }];
  const sub = (o) => ({ taskId: new ObjectId(task1), studentName: 'x', submission: P, attemptNumber: 1, submissionQuestionAnswers: [], feedbackReceivedQuestionAnswers: [], starScoreHistory: [], createdAt: new Date(), updatedAt: new Date(), ...o });
  await db.collection('submissions').insertMany([
    sub({ studentId: s1.username, datetime: new Date('2026-10-01T10:00:00Z'), feedbackHistory: fh(2, 3, 4), starScoreHistory: [{ score: 3, createdAt: new Date() }], submissionQuestionAnswers: [{ answer: 'a', answeredAt: new Date() }] }),
    sub({ studentId: s1.username, datetime: new Date('2026-10-02T10:00:00Z'), attemptNumber: 2, feedbackHistory: fh(4, 5, 2), starScoreHistory: [{ score: 5, createdAt: new Date() }] }),
    sub({ studentId: s2.username, datetime: new Date('2026-10-03T10:00:00Z'), feedbackHistory: fh(3, 1, 3) }),
  ]);
  const now = new Date();
  await db.collection('chat_sessions').insertOne({ title: P, sender: s1.username, stakeholderId: new ObjectId(), projectId: new ObjectId(projectId), participants: [], startTime: now, endTime: null,
    chatItems: [0, 1, 2].map(i => ({ _id: new ObjectId(), sender: s1.username, message: 'm' + i, timestamp: new Date(now.getTime() + i * 60000) })), metadata: {}, createdAt: now, updatedAt: now });
  const quizId = new ObjectId();
  await db.collection('quizzes').insertOne({ _id: quizId, name: P + ' quiz', projectId: new ObjectId(projectId), questions: [{ id: 'q1', question: 'Q?', options: ['a', 'b'], correctAnswer: 1 }], history: [], createdAt: now, updatedAt: now });
  await db.collection('quiz_submissions').insertOne({ quizId, studentId: s1.username, answers: { q1: 1 }, score: 80, isSubmitted: true, submittedAt: now, startedAt: now, createdAt: now, updatedAt: now });
  const groupId = new ObjectId();
  await db.collection('student_groups').insertOne({ _id: groupId, courseId: new ObjectId(courseId), projectId: new ObjectId(projectId), name: P + ' G', description: '', studentIds: [s1.username, s2.username], createdBy: P, isActive: true, createdAt: now, updatedAt: now });
  const PQ = `projectId=${projectId}`;

  // ================= MET =================
  await t('MET-01', 'progress-student individual + group metrics', { req: 'Student workspace progress', steps: `GET progress-student?${PQ}&userName=s1 (2 subs star 3,5; 1 chat 3 msgs; quiz 80; group with s2)`, expected: 'indiv: tasksDone1 late0 total2 avg4 fb2 subs2 qAns1 msgs3 sessMonth1 quiz80; group: tasksDone1 subs3 avg4 msgs3 quizAvg80' }, async () => {
    const r = await s1.client.get(`/student-metrics/progress-student?${PQ}&userName=${encodeURIComponent(s1.username)}`);
    const i = r.body?.data?.individualMetrics || {}; const g = r.body?.data?.groupMetrics?.[0] || {};
    const ok = r.status === 200 && i.tasksDone === 1 && i.tasksLate === 0 && i.totalTasks === 2 && i.averageScore === 4 && i.feedbackReceivedCount === 2 && i.submissionsCount === 2
      && i.submissionQuestionsAnsweredCount === 1 && i.conversationMessagesCount === 3 && i.conversationSessionsPerMonth === 1 && i.quizScoreLatest === 80
      && g.tasksDone === 1 && g.submissionsCount === 3 && g.averageScore === 4 && g.conversationMessagesCount === 3 && g.quizScoreLatestAverage === 80 && g.memberCount === 2;
    return { pass: ok, actual: `${r.status} ${r.ms}ms indiv=${JSON.stringify(i)} group=${JSON.stringify(g)}`.slice(0, 600) };
  });
  await t('MET-02', 'progress-student validation & not found', { req: 'Validation', steps: 'missing userName; projectId=bad; nonexistent project; studentId != userName', expected: '400,400,404,403' }, async () => {
    const rs = [await s1.client.get(`/student-metrics/progress-student?${PQ}`), await s1.client.get('/student-metrics/progress-student?projectId=bad&userName=x'),
      await s1.client.get(`/student-metrics/progress-student?projectId=${new ObjectId()}&userName=x`), await s1.client.get(`/student-metrics/progress-student?${PQ}&userName=a&studentId=b`)];
    return { pass: rs.map(r => r.status).join(',') === '400,400,404,403', actual: rs.map(r => r.status).join(',') };
  });
  await t('MET-03', 'progress-student blocks reading another student\'s metrics', { ...sec, req: 'Students only see their own metrics', steps: 'Anonymous and s2 session GET progress-student?userName=<s1>', expected: '401/403', severity: 'High' }, async () => {
    const a = await anon().get(`/student-metrics/progress-student?${PQ}&userName=${encodeURIComponent(s1.username)}&scope=individual`);
    const b = await s2.client.get(`/student-metrics/progress-student?${PQ}&userName=${encodeURIComponent(s1.username)}&scope=individual`);
    return { pass: [401, 403].includes(a.status) && [401, 403].includes(b.status), actual: `anon ${a.status} subs=${a.body?.data?.individualMetrics?.submissionsCount}; s2 ${b.status} avg=${b.body?.data?.individualMetrics?.averageScore}` };
  });
  await t('MET-04', 'windowed student metrics (custom window)', { req: 'Windowed performance metrics', steps: `GET windowed?${PQ}&studentId=s1&windowType=custom&startDate=2026-09-01&endDate=2026-10-31`, expected: 'taskQuality mean3 latest4 count2; behavioral subs2 revisions1 timeliness0; summary totalSubmissions2' }, async () => {
    const r = await teacher.client.get(`/student-metrics/windowed?${PQ}&studentId=${encodeURIComponent(s1.username)}&windowType=custom&startDate=2026-09-01&endDate=2026-10-31`);
    const m = r.body?.data?.windows?.[0]?.metrics || {};
    const ok = r.status === 200 && m.taskQualityScore?.mean === 3 && m.taskQualityScore?.latest === 4 && m.taskQualityScore?.count === 2 && m.behavioral?.submissionCount === 2 && m.behavioral?.revisionCount === 1 && m.behavioral?.timelinessRate === 0 && r.body?.data?.summary?.totalSubmissions === 2;
    return { pass: ok, actual: `${r.status} ${r.ms}ms tq=${JSON.stringify(m.taskQualityScore)} beh=${JSON.stringify(m.behavioral)}` };
  });
  await t('MET-05', 'windowed class metrics', { req: 'Class-level windowed metrics', steps: 'Same without studentId', expected: 'totalStudents 2; classMetrics.taskQualityScore.mean 3 count 2; submissionCount 3' }, async () => {
    const r = await teacher.client.get(`/student-metrics/windowed?${PQ}&windowType=custom&startDate=2026-09-01&endDate=2026-10-31`);
    const w = r.body?.data?.windows?.[0] || {};
    return { pass: r.status === 200 && r.body?.data?.totalStudents === 2 && w.classMetrics?.taskQualityScore?.mean === 3 && w.classMetrics?.taskQualityScore?.count === 2 && w.submissionCount === 3, actual: `${r.status} ${r.ms}ms students=${r.body?.data?.totalStudents} tq=${JSON.stringify(w.classMetrics?.taskQualityScore)?.slice(0, 120)} subs=${w.submissionCount}` };
  });
  await t('MET-06', 'windowed validation', { req: 'Validation', steps: 'custom without dates (defaults derived from tasks); windowType=foo; projectId=bad; nonexistent project', expected: '200,400,400,404' }, async () => {
    const rs = [await anon().get(`/student-metrics/windowed?${PQ}&windowType=custom`), await anon().get(`/student-metrics/windowed?${PQ}&windowType=foo`),
      await anon().get('/student-metrics/windowed?projectId=bad&windowType=daily'), await anon().get(`/student-metrics/windowed?projectId=${new ObjectId()}&windowType=daily`)];
    return { pass: rs.map(r => r.status).join(',') === '200,400,400,404', actual: rs.map(r => r.status).join(',') };
  });
  await t('MET-07', 'progress-masterview class aggregates', { req: 'Progress masterview', steps: `GET progress-masterview?${PQ}&windowType=weekly`, expected: 'task1 avgTaskQuality 3, avgReflection 3, subs 3, students 2; concept C1 median 3 students 2; uptake classRate 1 studentsWithData 1; stakeholder totalStudents 1' }, async () => {
    const r = await teacher.client.get(`/student-metrics/progress-masterview?${PQ}&windowType=weekly`);
    const m = r.body?.data?.metrics || {}; const tp = (m.taskPerformance || []).find(x => x.taskId === task1) || {}; const c = (m.conceptPerformance || [])[0] || {};
    const ok = r.status === 200 && tp.averageTaskQuality === 3 && tp.averageReflection === 3 && tp.submissionCount === 3 && tp.studentCount === 2 && c.concept === 'C1' && c.boxplot?.median === 3 && c.studentCount === 2
      && m.feedbackUptake?.classAverageImprovementRate === 1 && m.feedbackUptake?.studentsWithData === 1 && m.stakeholderInteraction?.totalStudents === 1 && (m.taskPerformance || []).length === 2;
    return { pass: ok, actual: `${r.status} ${r.ms}ms task=${JSON.stringify(tp)} concept=${JSON.stringify(c).slice(0, 120)} uptake=${JSON.stringify(m.feedbackUptake)}`.slice(0, 600) };
  });
  await t('MET-08', 'progress-masterview student view includes class averages', { req: 'Student vs class comparison', steps: `...&studentId=s1`, expected: 'viewType student; task1 subs 2 avgTQ 3; classAverages present' }, async () => {
    const r = await teacher.client.get(`/student-metrics/progress-masterview?${PQ}&windowType=monthly&studentId=${encodeURIComponent(s1.username)}`);
    const tp = (r.body?.data?.metrics?.taskPerformance || []).find(x => x.taskId === task1) || {};
    return { pass: r.status === 200 && r.body?.data?.viewType === 'student' && tp.submissionCount === 2 && tp.averageTaskQuality === 3 && !!r.body?.data?.classAverages, actual: `${r.status} ${r.ms}ms ${JSON.stringify(tp)}` };
  });
  await t('MET-09', 'progress-masterview validation', { req: 'Validation', steps: 'missing windowType; projectId=bad; nonexistent', expected: '400,400,404' }, async () => {
    const rs = [await anon().get(`/student-metrics/progress-masterview?${PQ}`), await anon().get('/student-metrics/progress-masterview?projectId=bad&windowType=weekly'), await anon().get(`/student-metrics/progress-masterview?projectId=${new ObjectId()}&windowType=weekly`)];
    return { pass: rs.map(r => r.status).join(',') === '400,400,404', actual: rs.map(r => r.status).join(',') };
  });
  await t('MET-10', 'progress-masterview/grouped group aggregates', { req: 'Grouped progress', steps: `GET grouped?courseId&projectId&windowType=weekly&viewType=group`, expected: 'totalGroups 1, totalStudents 2; group avgTQ 3, avgRefl 3, subs 3, completed 1/2, rate 0.5' }, async () => {
    const r = await teacher.client.get(`/student-metrics/progress-masterview/grouped?courseId=${courseId}&${PQ}&windowType=weekly&viewType=group`);
    const s = r.body?.data?.summary || {}; const g = r.body?.data?.groups?.[0]?.metrics || {};
    const ok = r.status === 200 && s.totalGroups === 1 && s.totalStudents === 2 && g.averageTaskQualityScore === 3 && g.averageReflectionScore === 3 && g.totalSubmissions === 3 && g.completedTasks === 1 && g.totalTasks === 2 && g.completionRate === 0.5;
    return { pass: ok, actual: `${r.status} ${r.ms}ms summary=${JSON.stringify(s)} g=${JSON.stringify(g)}` };
  });
  await t('MET-11', 'grouped validation', { req: 'Validation', steps: 'courseId=bad; missing viewType; groupId=bad; unknown course', expected: '400,400,400, 200 with 0 groups' }, async () => {
    const rs = [await anon().get('/student-metrics/progress-masterview/grouped?courseId=bad&windowType=weekly&viewType=group'), await anon().get(`/student-metrics/progress-masterview/grouped?courseId=${courseId}&windowType=weekly`),
      await anon().get(`/student-metrics/progress-masterview/grouped?courseId=${courseId}&${PQ}&groupId=bad&windowType=weekly&viewType=group`), await anon().get(`/student-metrics/progress-masterview/grouped?courseId=${new ObjectId()}&windowType=weekly&viewType=group`)];
    return { pass: rs.slice(0, 3).every(r => r.status === 400) && rs[3].status === 200 && rs[3].body?.data?.summary?.totalGroups === 0, actual: rs.map(r => r.status).join(',') };
  });
  await t('MET-12', 'progress-detail/grouped task breakdown', { req: 'Group detail', steps: `GET progress-detail/grouped?courseId&groupId&windowType=weekly`, expected: 'metrics avgTQ 3 subs 3; task1 breakdown s1 count 2 latest TQ 4; s2 TQ 3' }, async () => {
    const r = await teacher.client.get(`/student-metrics/progress-detail/grouped?courseId=${courseId}&groupId=${groupId}&windowType=weekly`);
    const tb = (r.body?.data?.taskBreakdown || []).find(x => x.taskId === task1) || {}; const st1 = (tb.students || []).find(x => x.studentId === s1.username) || {}; const st2 = (tb.students || []).find(x => x.studentId === s2.username) || {};
    const ok = r.status === 200 && r.body?.data?.metrics?.averageTaskQualityScore === 3 && r.body?.data?.metrics?.totalSubmissions === 3 && st1.submissionCount === 2 && st1.taskQualityScore === 4 && st2.taskQualityScore === 3;
    return { pass: ok, actual: `${r.status} ${r.ms}ms metrics=${JSON.stringify(r.body?.data?.metrics)} s1=${JSON.stringify(st1)}`.slice(0, 500) };
  });
  await t('MET-13', 'progress-detail/grouped validation', { req: 'Validation', steps: 'groupId=bad; nonexistent group; missing groupId', expected: '400,404,400' }, async () => {
    const rs = [await anon().get(`/student-metrics/progress-detail/grouped?courseId=${courseId}&groupId=bad&windowType=weekly`), await anon().get(`/student-metrics/progress-detail/grouped?courseId=${courseId}&groupId=${new ObjectId()}&windowType=weekly`), await anon().get(`/student-metrics/progress-detail/grouped?courseId=${courseId}&windowType=weekly`)];
    return { pass: rs.map(r => r.status).join(',') === '400,404,400', actual: rs.map(r => r.status).join(',') };
  });
  await t('MET-14', 'Class/group metrics not readable anonymously or by students', { ...sec, req: 'Only teachers of the course see class metrics', steps: 'Anonymous GET progress-detail/grouped; student s2 GET progress-masterview (class)', expected: '401/403', severity: 'High' }, async () => {
    const a = await anon().get(`/student-metrics/progress-detail/grouped?courseId=${courseId}&groupId=${groupId}&windowType=weekly`);
    const b = await s2.client.get(`/student-metrics/progress-masterview?${PQ}&windowType=weekly`);
    return { pass: [401, 403].includes(a.status) && [401, 403].includes(b.status), actual: `anon ${a.status} names=${JSON.stringify(a.body?.data?.studentNames)}; student ${b.status} viewType=${b.body?.data?.viewType}` };
  });

  // ================= MON activity (uses data above) =================
  await t('MON-10', 'activity/ai-literacy lists users with progress', { req: 'Monitor AI literacy activity', steps: 'GET activity/ai-literacy?limit=1000; find LIT user; sortBy=foo', expected: '200, entry with username + progress 0 (after reset); 400 for bad sortBy' }, async () => {
    const r = await teacher.client.get('/monitoring/activity/ai-literacy?limit=1000'); const b = await teacher.client.get('/monitoring/activity/ai-literacy?sortBy=foo');
    const e = (r.body?.data || []).find(x => x.userId === me);
    return { pass: r.status === 200 && e?.username === lu.username && e?.progress === 0 && b.status === 400, actual: `${r.status} ${r.ms}ms n=${r.body?.data?.length} entry=${JSON.stringify(e)}; bad ${b.status}` };
  });
  await t('MET-15', 'POST /prompts/revise is logged for prompt-revision monitoring', { req: 'Prompt revision usage tracked', steps: 'Teacher POST /prompts/revise; GET monitoring/activity/prompt-revision?limit=1000', expected: 'entry with userId=teacher id, username resolved, action revise-prompt' }, async () => {
    const tid = (await teacher.client.get('/auth/me')).body?.user?.id;
    const rv = await teacher.client.post('/prompts/revise', { prompt: 'Write a quiz about ' + P, userName: teacher.username });
    await new Promise(r => setTimeout(r, 500));
    const r = await teacher.client.get('/monitoring/activity/prompt-revision?limit=1000');
    const e = (r.body?.data || []).find(x => x.userId === tid);
    return { pass: rv.status === 200 && e?.username === teacher.username && e?.action === 'revise-prompt', actual: `revise ${rv.status}; activity ${r.status} ${r.ms}ms entry=${JSON.stringify(e)}` };
  });
  await t('MON-11', 'activity/chat-sessions reports message counts', { req: 'Monitor chat sessions', steps: 'GET activity/chat-sessions?limit=1000; find s1', expected: 'entry for s1 with messageCount 3, username resolved' }, async () => {
    const r = await teacher.client.get('/monitoring/activity/chat-sessions?limit=1000');
    const e = (r.body?.data || []).find(x => x.userId === s1.username);
    return { pass: r.status === 200 && e?.messageCount === 3 && e?.username === s1.username, actual: `${r.status} ${r.ms}ms entry=${JSON.stringify(e)}` };
  });
  await t('MON-12', 'activity/quiz-completions shows score and quiz title', { req: 'Monitor quiz completions', steps: 'GET activity/quiz-completions?limit=1000; find s1', expected: 'entry s1 score 80, quizTitle = quiz name, username resolved', severity: 'Low' }, async () => {
    const r = await teacher.client.get('/monitoring/activity/quiz-completions?limit=1000');
    const e = (r.body?.data || []).find(x => x.userId === s1.username);
    return { pass: r.status === 200 && e?.score === 80 && e?.quizTitle === P + ' quiz' && e?.username === s1.username, actual: `${r.status} ${r.ms}ms entry=${JSON.stringify(e)}` };
  });
  await t('MON-13', 'activity/management-tools responds & validates', { req: 'Monitor management tools', steps: 'GET ?toolType=swot; ?toolType=foo', expected: '200 array; 400' }, async () => {
    const a = await teacher.client.get('/monitoring/activity/management-tools?toolType=swot'), b = await teacher.client.get('/monitoring/activity/management-tools?toolType=foo');
    return { pass: a.status === 200 && Array.isArray(a.body?.data) && b.status === 400, actual: `${a.status} ${a.ms}ms n=${a.body?.data?.length}; ${b.status}` };
  });
  await t('MON-14', 'Monitoring endpoints require admin authentication', { ...sec, req: 'Platform monitoring (other users\' activity, usernames, token usage) is admin-only', steps: 'Anonymous GET llm-usage, activity/ai-literacy, chat-sessions, quiz-completions; student session GET module-usage', expected: '401/403 for all', severity: 'Critical' }, async () => {
    const c = anon();
    const rs = await Promise.all([c.get(`/monitoring/llm-usage?period=monthly&${W}`), c.get('/monitoring/activity/ai-literacy'), c.get('/monitoring/activity/chat-sessions'), c.get('/monitoring/activity/quiz-completions'), s2.client.get(`/monitoring/module-usage?period=monthly&${W}`)]);
    const leaked = (rs[0].body?.data?.byUser || []).map(u => u.username).slice(0, 2);
    return { pass: rs.every(r => [401, 403].includes(r.status)), actual: rs.map(r => r.status).join(',') + ` leaked usernames e.g. ${JSON.stringify(leaked)}, ai-literacy entries=${rs[1].body?.data?.length}, chat=${rs[2].body?.data?.length}` };
  });

  // cleanup own seeded data (prefix-filtered)
  try {
    await db.collection('action_log').deleteMany({ 'metadata.p': P });
    await db.collection('user_feedback').deleteMany({ userId: P });
    await db.collection('ai4edu_user').deleteMany({ remark: P, username: { $regex: '^' + P } });
  } catch {}
  await mc.close();
});
