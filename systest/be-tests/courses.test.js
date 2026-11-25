const __ROOT = require('path').resolve(__dirname, '..');
const { suite } = require('../lib');
const { MongoClient, ObjectId } = require('mongodb');

suite('BE-COURSES', async (t, h) => {
  const P = 'crs' + h.uid();
  const mc = await MongoClient.connect('mongodb://127.0.0.1:27017/?replicaSet=rs0');
  const db = mc.db('ai4edu_database');
  const teacherA = await h.makeUser('teacher', P);
  const teacherB = await h.makeUser('teacher', P);
  const A = teacherA.client, B = teacherB.client;
  const anon = () => new h.Client();
  const FAKE = new ObjectId().toString();
  const ok = (r, s) => r.status === s && r.body?.success === true;

  // ===================== COURSES =====================
  let courseId;
  const tIdA = teacherA.user?.id || teacherA.email;
  await t('CRS-01', 'Create course with all fields', { req: 'POST /courses creates course', steps: 'POST /courses {name, code, academicYear, university, teacherId}', expected: '201, data.id returned; course persisted in DB with teacherIds=[teacherId]' }, async () => {
    const r = await A.post('/courses', { name: `${P} Course`, code: 'C101', academicYear: '2026-2027', university: `${P}-Uni`, teacherId: tIdA });
    courseId = r.body?.data?.id;
    const doc = courseId ? await db.collection('courses').findOne({ _id: new ObjectId(courseId) }) : null;
    return { pass: r.status === 201 && doc?.name === `${P} Course` && doc?.teacherIds?.[0] === tIdA, actual: `${h.short(r)} | db teacherIds=${JSON.stringify(doc?.teacherIds)}` };
  });
  await t('CRS-02', 'Create course with only name (as UI sends when optional fields empty)', { req: 'Schema says code/academicYear/university optional; UI (SchoolCourses.tsx) omits empty fields', steps: 'POST /courses {name}', expected: '201 course created (or 400 if fields actually required) — not 500' }, async () => {
    const r = await A.post('/courses', { name: `${P} NameOnly` });
    if (r.body?.data?.id) await db.collection('courses').deleteOne({ _id: new ObjectId(r.body.data.id) });
    return { pass: r.status === 201 || r.status === 400, actual: h.short(r), severity: 'High' };
  });
  await t('CRS-03', 'Reject course without name', { req: 'name required', steps: 'POST /courses {code}', expected: '400' }, async () => {
    const r = await A.post('/courses', { code: 'X' });
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('CRS-04', 'Reject unknown field in course body', { req: 'Joi schema rejects unknown keys', steps: 'POST /courses {name, foo}', expected: '400' }, async () => {
    const r = await A.post('/courses', { name: 'x', foo: 'bar' });
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('CRS-05', 'List courses filtered by teacherId', { req: 'GET /courses supports teacherId filter', steps: 'GET /courses?teacherId=<A>', expected: '200, contains created course, count matches' }, async () => {
    const r = await A.get(`/courses?teacherId=${encodeURIComponent(tIdA)}`);
    const found = (r.body?.data || []).some(c => c.id === courseId);
    return { pass: ok(r, 200) && found && r.body.count === r.body.data.length, actual: `${r.status} count=${r.body?.count} found=${found}` };
  });
  await t('CRS-06', 'List courses filtered by university + academicYear', { req: 'Filters ANDed', steps: 'GET /courses?university=<P>-Uni&academicYear=2026-2027', expected: '200 exactly our course' }, async () => {
    const r = await A.get(`/courses?university=${P}-Uni&academicYear=2026-2027`);
    return { pass: ok(r, 200) && r.body.data.length === 1 && r.body.data[0].id === courseId, actual: `${r.status} count=${r.body?.count}` };
  });
  await t('CRS-07', 'List courses rejects unknown query param', { req: 'Query validation', steps: 'GET /courses?bogus=1', expected: '400' }, async () => {
    const r = await A.get('/courses?bogus=1');
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('CRS-08', 'Update course name/code', { req: 'PUT /courses/:id updates', steps: 'PUT {name, code}, read back from DB', expected: '200, DB updated' }, async () => {
    const r = await A.put(`/courses/${courseId}`, { name: `${P} Course v2`, code: 'C102' });
    const doc = await db.collection('courses').findOne({ _id: new ObjectId(courseId) });
    return { pass: ok(r, 200) && doc?.name === `${P} Course v2` && doc?.code === 'C102', actual: `${h.short(r)} | db name=${doc?.name}` };
  });
  await t('CRS-09', 'Update course with empty body rejected', { req: 'At least one field (min(1))', steps: 'PUT {}', expected: '400' }, async () => {
    const r = await A.put(`/courses/${courseId}`, {});
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('CRS-10', 'Update course invalid id / non-existent id', { req: 'ID validation', steps: 'PUT /courses/abc ; PUT /courses/<random oid>', expected: '400 ; 404' }, async () => {
    const r1 = await A.put('/courses/abc', { name: 'x' });
    const r2 = await A.put(`/courses/${FAKE}`, { name: 'x' });
    return { pass: r1.status === 400 && r2.status === 404, actual: `${r1.status} ; ${r2.status}` };
  });
  await t('CRS-11', 'Clearing academicYear via PUT', { req: 'Schema allows academicYear "" on update', steps: 'PUT {academicYear: ""}', expected: '200 (or 400 if field required) — not 500' }, async () => {
    const r = await A.put(`/courses/${courseId}`, { academicYear: '' });
    return { pass: r.status === 200 || r.status === 400, actual: h.short(r), severity: 'Medium' };
  });
  await t('CRS-12', 'Assign second teacher to course', { req: 'POST /courses/:id/assign-teacher', steps: 'assign teacherB', expected: '200, DB teacherIds has 2 entries' }, async () => {
    const r = await A.post(`/courses/${courseId}/assign-teacher`, { teacherId: 'teacherB-' + P });
    const doc = await db.collection('courses').findOne({ _id: new ObjectId(courseId) });
    return { pass: ok(r, 200) && doc?.teacherIds?.length === 2 && doc.teacherIds.includes('teacherB-' + P), actual: `${h.short(r)} | db=${JSON.stringify(doc?.teacherIds)}` };
  });
  await t('CRS-13', 'Assigning already-assigned teacher rejected', { req: 'No duplicate teachers', steps: 'assign teacherB again', expected: '400' }, async () => {
    const r = await A.post(`/courses/${courseId}/assign-teacher`, { teacherId: 'teacherB-' + P });
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('CRS-14', 'Assign teacher validation (missing teacherId / bad id / unknown course)', { req: 'Validation', steps: 'body {} ; id=abc ; id=<random>', expected: '400 ; 400 ; 404' }, async () => {
    const r1 = await A.post(`/courses/${courseId}/assign-teacher`, {});
    const r2 = await A.post('/courses/abc/assign-teacher', { teacherId: 'x' });
    const r3 = await A.post(`/courses/${FAKE}/assign-teacher`, { teacherId: 'x' });
    return { pass: r1.status === 400 && r2.status === 400 && r3.status === 404, actual: `${r1.status} ; ${r2.status} ; ${r3.status}` };
  });
  await t('CRS-15', 'Remove teacher from course', { req: 'DELETE /courses/:id/remove-teacher', steps: 'remove teacherB', expected: '200, DB teacherIds=[A]' }, async () => {
    const r = await A.del(`/courses/${courseId}/remove-teacher`, { teacherId: 'teacherB-' + P });
    const doc = await db.collection('courses').findOne({ _id: new ObjectId(courseId) });
    return { pass: ok(r, 200) && doc?.teacherIds?.length === 1 && doc.teacherIds[0] === tIdA, actual: `${h.short(r)} | db=${JSON.stringify(doc?.teacherIds)}` };
  });
  await t('CRS-16', 'Cannot remove last teacher', { req: 'Course must keep >= 1 teacher', steps: 'remove teacher A (only one left)', expected: '400, teacher still assigned' }, async () => {
    const r = await A.del(`/courses/${courseId}/remove-teacher`, { teacherId: tIdA });
    const doc = await db.collection('courses').findOne({ _id: new ObjectId(courseId) });
    return { pass: r.status === 400 && doc?.teacherIds?.length === 1, actual: h.short(r) };
  });
  await t('CRS-17', 'Remove non-assigned teacher returns 404', { req: 'Business rule', steps: 'remove unknown teacherId', expected: '404' }, async () => {
    const r = await A.del(`/courses/${courseId}/remove-teacher`, { teacherId: 'nobody' });
    return { pass: r.status === 404, actual: h.short(r) };
  });
  // student with remark = courseId
  const sc = new h.Client();
  const sEmail = `${P}-student-${h.uid()}@systest.local`;
  const sReg = await sc.post('/auth/register', { name: `${P} stu`, email: sEmail, password: 'Passw0rd!', type: 'student', remark: courseId });
  await t('CRS-18', 'Get courses by student username (remark=courseId)', { req: 'GET /courses/student/:username', steps: 'Register student with remark=courseId, GET', expected: '200, data=[course]' }, async () => {
    const r = await A.get(`/courses/student/${encodeURIComponent(sEmail.toLowerCase())}`);
    return { pass: ok(r, 200) && r.body.data?.[0]?.id === courseId, actual: `register ${sReg.status}; ${h.short(r)}` };
  });
  await t('CRS-19', 'Get courses for unknown student / teacher username', { req: 'Only students resolved', steps: 'GET /courses/student/nobody ; GET with teacher username', expected: '404 ; 404' }, async () => {
    const r1 = await A.get('/courses/student/nobody-' + P);
    const r2 = await A.get(`/courses/student/${encodeURIComponent(teacherA.email.toLowerCase())}`);
    return { pass: r1.status === 404 && r2.status === 404, actual: `${r1.status} ; ${r2.status}` };
  });
  await t('CRS-20', 'Courses access control (anonymous + other teacher)', { req: 'Only authenticated owners/admins can read/modify courses', steps: 'Anonymous GET /courses and PUT /courses/:id; teacher B PUT/assign-teacher on teacher A course', expected: '401 anonymous; 403 for teacher B', type: 'security' }, async () => {
    const r1 = await anon().get('/courses');
    const r2 = await anon().put(`/courses/${courseId}`, { name: `${P} Course v2` });
    const r3 = await B.post(`/courses/${courseId}/assign-teacher`, { teacherId: 'intruder-' + P });
    const pass = [401, 403].includes(r1.status) && [401, 403].includes(r2.status) && [401, 403].includes(r3.status);
    return { pass, actual: `anon GET ${r1.status} (count=${r1.body?.count}); anon PUT ${r2.status}; teacherB assign-teacher ${r3.status}`, severity: 'Critical' };
  });

  // ===================== EXERCISES =====================
  let exId;
  const exBody = { courseId, lectureLabel: 'L1', title: `${P} Ex`, description: 'Describe X', evaluationRank: 'A-F', aiSupportingStyles: ['Reflection'] };
  await t('EXR-01', 'Create exercise for course', { req: 'POST /exercises', steps: 'POST valid body', expected: '201, persisted in exercises collection' }, async () => {
    const r = await A.post('/exercises', exBody);
    exId = r.body?.data?.id;
    const doc = await db.collection('exercises').findOne({ title: `${P} Ex` });
    if (!exId && doc) exId = doc._id.toString();
    return { pass: r.status === 201 && !!doc, actual: `${h.short(r)} | db=${!!doc}`, severity: 'High' };
  });
  // seed an exercise directly so the read/update/delete tests are independent of EXR-01
  if (!exId) {
    const ins = await db.collection('exercises').insertOne({ courseId: new ObjectId(courseId), lectureLabel: 'L1', title: `${P} Ex`, description: 'Describe X', evaluationRank: 'A-F', aiSupportingStyles: ['Reflection'], createdAt: new Date(), updatedAt: new Date() });
    exId = ins.insertedId.toString();
  }
  await t('EXR-02', 'Create exercise validation', { req: 'Required fields / enums / course exists', steps: 'missing title ; bad evaluationRank ; bad aiSupportingStyles ; courseId=abc ; courseId=<random>', expected: '400 ; 400 ; 400 ; 400 ; 404' }, async () => {
    const { title, ...noTitle } = exBody;
    const r1 = await A.post('/exercises', noTitle);
    const r2 = await A.post('/exercises', { ...exBody, evaluationRank: 'Z' });
    const r3 = await A.post('/exercises', { ...exBody, aiSupportingStyles: ['Hack'] });
    const r4 = await A.post('/exercises', { ...exBody, courseId: 'abc' });
    const r5 = await A.post('/exercises', { ...exBody, courseId: FAKE });
    const s = [r1, r2, r3, r4, r5].map(r => r.status);
    return { pass: s.join() === '400,400,400,400,404', actual: s.join(' ; ') };
  });
  await t('EXR-03', 'List exercises by courseId', { req: 'GET /exercises?courseId=', steps: 'GET with our courseId', expected: '200, includes the exercise' }, async () => {
    const r = await A.get(`/exercises?courseId=${courseId}`);
    return { pass: ok(r, 200) && (r.body.data || []).some(e => e.id === exId), actual: h.short(r), severity: 'High' };
  });
  await t('EXR-04', 'List exercises validation', { req: 'courseId required & valid & existing', steps: 'no courseId ; courseId=abc ; courseId=<random>', expected: '400 ; 400 ; 404' }, async () => {
    const r1 = await A.get('/exercises');
    const r2 = await A.get('/exercises?courseId=abc');
    const r3 = await A.get(`/exercises?courseId=${FAKE}`);
    return { pass: r1.status === 400 && r2.status === 400 && r3.status === 404, actual: `${r1.status} ; ${r2.status} ; ${r3.status}` };
  });
  await t('EXR-05', 'Get exercise by id', { req: 'GET /exercises/:id', steps: 'GET own exercise', expected: '200, title matches' }, async () => {
    const r = await A.get(`/exercises/${exId}`);
    return { pass: ok(r, 200) && r.body.data?.title === `${P} Ex`, actual: h.short(r) };
  });
  await t('EXR-06', 'Get exercise invalid / unknown id', { req: 'ID validation', steps: 'GET /exercises/abc ; /<random>', expected: '400 ; 404' }, async () => {
    const r1 = await A.get('/exercises/abc');
    const r2 = await A.get(`/exercises/${FAKE}`);
    return { pass: r1.status === 400 && r2.status === 404, actual: `${r1.status} ; ${r2.status}` };
  });
  await t('EXR-07', 'Update exercise', { req: 'PUT /exercises/:id', steps: 'PUT {title, learningObjective:""}, read back', expected: '200, DB title updated, learningObjective null' }, async () => {
    const r = await A.put(`/exercises/${exId}`, { title: `${P} Ex v2`, learningObjective: '' });
    const doc = await db.collection('exercises').findOne({ _id: new ObjectId(exId) });
    return { pass: ok(r, 200) && doc?.title === `${P} Ex v2` && !doc.learningObjective, actual: `${h.short(r)} | db title=${doc?.title}` };
  });
  await t('EXR-08', 'Update exercise validation', { req: 'Validation', steps: 'PUT {} ; PUT {evaluationRank:"Z"} ; PUT /abc ; PUT /<random>', expected: '400 ; 400 ; 400 ; 404' }, async () => {
    const r1 = await A.put(`/exercises/${exId}`, {});
    const r2 = await A.put(`/exercises/${exId}`, { evaluationRank: 'Z' });
    const r3 = await A.put('/exercises/abc', { title: 'x' });
    const r4 = await A.put(`/exercises/${FAKE}`, { title: 'x' });
    const s = [r1, r2, r3, r4].map(r => r.status);
    return { pass: s.join() === '400,400,400,404', actual: s.join(' ; ') };
  });
  await t('EXR-09', 'Exercises access control (anonymous + other teacher)', { req: 'Only course teachers may read/modify exercises', steps: 'Anonymous GET /exercises/:id; anonymous PUT; teacher B PUT on teacher A exercise', expected: '401 ; 401 ; 403', type: 'security' }, async () => {
    const r1 = await anon().get(`/exercises/${exId}`);
    const r2 = await anon().put(`/exercises/${exId}`, { description: 'Describe X' });
    const r3 = await B.put(`/exercises/${exId}`, { lectureLabel: 'L1' });
    const pass = [r1, r2, r3].every(r => [401, 403].includes(r.status));
    return { pass, actual: `anon GET ${r1.status}; anon PUT ${r2.status}; teacherB PUT ${r3.status}`, severity: 'Critical' };
  });
  await t('EXR-10', 'Delete exercise', { req: 'DELETE /exercises/:id', steps: 'DELETE, then GET', expected: '200 then 404; removed from DB' }, async () => {
    const r = await A.del(`/exercises/${exId}`);
    const g = await A.get(`/exercises/${exId}`);
    const doc = await db.collection('exercises').findOne({ _id: new ObjectId(exId) });
    return { pass: ok(r, 200) && g.status === 404 && !doc, actual: `${h.short(r)} | get after ${g.status}` };
  });
  await t('EXR-11', 'Delete exercise invalid / unknown id', { req: 'ID validation', steps: 'DELETE /abc ; DELETE /<random>', expected: '400 ; 404' }, async () => {
    const r1 = await A.del('/exercises/abc');
    const r2 = await A.del(`/exercises/${FAKE}`);
    return { pass: r1.status === 400 && r2.status === 404, actual: `${r1.status} ; ${r2.status}` };
  });

  // ===================== COURSE-PLAN-DOCS =====================
  let docId;
  const sess = `${P}-sess`;
  const cpdBody = { coursePlanName: `${P} Plan`, sessionId: sess, versionType: 'original', title: 'Original plan', content: '# Plan\nWeek 1', userName: teacherA.email, teacherInfo: { country: 'NO' }, tags: ['t1'], metadata: { notes: 'n' } };
  await t('CPD-01', 'Save course plan document', { req: 'POST /course-plan-docs', steps: 'POST valid original version', expected: '201, documentId; persisted with userId of session, fileSize=content length' }, async () => {
    const r = await A.post('/course-plan-docs', cpdBody);
    docId = r.body?.documentId;
    const doc = docId ? await db.collection('course_plan_docs').findOne({ _id: new ObjectId(docId) }) : null;
    return { pass: r.status === 201 && doc?.sessionId === sess && doc?.metadata?.fileSize === cpdBody.content.length && !!doc?.userId, actual: `${h.short(r)} | db userId=${doc?.userId}` };
  });
  await t('CPD-02', 'Save doc validation (missing fields / bad versionType)', { req: 'Required fields and enum', steps: 'POST without content ; versionType=draft', expected: '400 ; 400' }, async () => {
    const { content, ...noContent } = cpdBody;
    const r1 = await A.post('/course-plan-docs', noContent);
    const r2 = await A.post('/course-plan-docs', { ...cpdBody, versionType: 'draft' });
    return { pass: r1.status === 400 && r2.status === 400, actual: `${r1.status} ; ${r2.status}` };
  });
  await t('CPD-03', 'Save doc with non-string content', { req: 'Input type validation', steps: 'POST content={a:1}', expected: '400 (not 500)' }, async () => {
    const r = await A.post('/course-plan-docs', { ...cpdBody, content: { a: 1 } });
    const id = r.body?.documentId; if (id) await db.collection('course_plan_docs').deleteOne({ _id: new ObjectId(id) });
    return { pass: r.status === 400, actual: h.short(r), severity: 'Medium' };
  });
  await t('CPD-04', 'Get doc by id', { req: 'GET /course-plan-docs/:id', steps: 'GET own doc', expected: '200, content matches' }, async () => {
    const r = await A.get(`/course-plan-docs/${docId}`);
    return { pass: ok(r, 200) && r.body.data?.content === cpdBody.content, actual: h.short(r) };
  });
  await t('CPD-05', 'Get doc unknown id / invalid id', { req: 'ID validation', steps: 'GET /<random> ; GET /abc', expected: '404 ; 400 (not 500)' }, async () => {
    const r1 = await A.get(`/course-plan-docs/${FAKE}`);
    const r2 = await A.get('/course-plan-docs/abc');
    return { pass: r1.status === 404 && r2.status === 400, actual: `${r1.status} ; ${h.short(r2)}`, severity: 'Medium' };
  });
  await t('CPD-06', 'List own docs filtered by sessionId', { req: 'GET /course-plan-docs?sessionId=', steps: 'GET as A with sessionId', expected: '200, total=1, our doc' }, async () => {
    const r = await A.get(`/course-plan-docs?sessionId=${sess}`);
    return { pass: ok(r, 200) && r.body.total === 1 && r.body.data[0]._id === docId, actual: `${r.status} total=${r.body?.total}` };
  });
  await t('CPD-07', 'List docs with non-numeric pagination', { req: 'Query validation', steps: 'GET ?page=abc&limit=xyz', expected: '400 or sane defaults (not 500)' }, async () => {
    const r = await A.get('/course-plan-docs?page=abc&limit=xyz');
    return { pass: r.status === 400 || r.status === 200, actual: h.short(r), severity: 'Medium' };
  });
  await t('CPD-08', 'List docs coursePlanName with regex metacharacters', { req: 'User input must not be used as raw regex', steps: 'GET ?coursePlanName=(', expected: '200 empty / 400 (not 500)', type: 'security' }, async () => {
    const r = await A.get('/course-plan-docs?coursePlanName=(');
    return { pass: r.status === 200 || r.status === 400, actual: h.short(r), severity: 'Medium' };
  });
  await t('CPD-09', 'Update doc (title + metadata merge)', { req: 'PATCH /course-plan-docs/:id', steps: 'PATCH {title, metadata:{agent}}; read back', expected: '200; title updated, metadata.notes kept, agent set' }, async () => {
    const r = await A.patch(`/course-plan-docs/${docId}`, { title: 'Original plan v2', metadata: { agent: 'x' } });
    const doc = await db.collection('course_plan_docs').findOne({ _id: new ObjectId(docId) });
    return { pass: ok(r, 200) && doc?.title === 'Original plan v2' && doc?.metadata?.notes === 'n' && doc?.metadata?.agent === 'x', actual: `${h.short(r)} | db metadata=${JSON.stringify(doc?.metadata)}` };
  });
  await t('CPD-10', 'Update ignores non-allowed fields (versionType, userId)', { req: 'Only allowed fields updatable', steps: 'PATCH {versionType:"revision", userId:"hacker"}', expected: '200; versionType & userId unchanged' }, async () => {
    const r = await A.patch(`/course-plan-docs/${docId}`, { versionType: 'revision', userId: 'hacker' });
    const doc = await db.collection('course_plan_docs').findOne({ _id: new ObjectId(docId) });
    return { pass: r.status === 200 && doc?.versionType === 'original' && doc?.userId !== 'hacker', actual: `${r.status} versionType=${doc?.versionType} userId=${doc?.userId}` };
  });
  await t('CPD-11', 'Update doc unknown / invalid id', { req: 'ID validation', steps: 'PATCH /<random> ; PATCH /abc', expected: '404 ; 400 (not 500)' }, async () => {
    const r1 = await A.patch(`/course-plan-docs/${FAKE}`, { title: 'x' });
    const r2 = await A.patch('/course-plan-docs/abc', { title: 'x' });
    return { pass: r1.status === 404 && r2.status === 400, actual: `${r1.status} ; ${h.short(r2)}`, severity: 'Medium' };
  });
  await t('CPD-12', 'Stats summary for current user', { req: 'GET /course-plan-docs/stats/summary', steps: 'GET as A', expected: '200, overall.totalDocuments=1, originalCount=1' }, async () => {
    const r = await A.get('/course-plan-docs/stats/summary');
    const o = r.body?.data?.overall;
    return { pass: ok(r, 200) && o?.totalDocuments === 1 && o?.originalCount === 1, actual: `${r.status} overall=${JSON.stringify(o)}` };
  });
  await t('CPD-13', 'Course plan docs access control (anonymous + other user)', { req: 'Users only see/modify their own course plan docs', steps: 'Anonymous GET /course-plan-docs (no filter); teacher B GET ?userName=<A>; teacher B GET /:id; teacher B PATCH A doc', expected: '401 anonymous; B sees none of A docs; 403 on B GET/PATCH by id', type: 'security' }, async () => {
    const r1 = await anon().get('/course-plan-docs?limit=5');
    const r2 = await B.get(`/course-plan-docs?userName=${encodeURIComponent(teacherA.email)}`);
    const r3 = await B.get(`/course-plan-docs/${docId}`);
    const r4 = await B.patch(`/course-plan-docs/${docId}`, { tags: ['t1'] });
    const leakB = (r2.body?.data || []).some(d => d._id === docId);
    const pass = [401, 403].includes(r1.status) && !leakB && [401, 403, 404].includes(r3.status) && [401, 403, 404].includes(r4.status);
    return { pass, actual: `anon list ${r1.status} total=${r1.body?.total}; B list-by-userName sees A doc=${leakB}; B GET ${r3.status}; B PATCH ${r4.status}`, severity: 'Critical' };
  });
  await t('CPD-14', 'Delete doc', { req: 'DELETE /course-plan-docs/:id', steps: 'DELETE then GET', expected: '200 then 404; removed from DB' }, async () => {
    const r = await A.del(`/course-plan-docs/${docId}`);
    const g = await A.get(`/course-plan-docs/${docId}`);
    return { pass: ok(r, 200) && g.status === 404, actual: `${h.short(r)} | get after ${g.status}` };
  });
  await t('CPD-15', 'Delete doc unknown / invalid id', { req: 'ID validation', steps: 'DELETE /<random> ; DELETE /abc', expected: '404 ; 400 (not 500)' }, async () => {
    const r1 = await A.del(`/course-plan-docs/${FAKE}`);
    const r2 = await A.del('/course-plan-docs/abc');
    return { pass: r1.status === 404 && r2.status === 400, actual: `${r1.status} ; ${h.short(r2)}`, severity: 'Medium' };
  });
  // anonymous delete of another user's doc
  const victim = await A.post('/course-plan-docs', { ...cpdBody, sessionId: sess + '-v' });
  await t('CPD-16', 'Anonymous cannot delete another user\'s doc', { req: 'Ownership enforced on delete (code has ownership check commented out)', steps: 'A creates doc; anonymous DELETE it', expected: '401/403, doc still exists', type: 'security' }, async () => {
    const id = victim.body?.documentId;
    const r = await anon().del(`/course-plan-docs/${id}`);
    const still = await db.collection('course_plan_docs').findOne({ _id: new ObjectId(id) });
    return { pass: [401, 403].includes(r.status) && !!still, actual: `${h.short(r)} | still exists=${!!still}`, severity: 'Critical' };
  });

  // ===================== LO-MAPPINGS =====================
  const now = new Date();
  const lomCourse = await db.collection('courses').insertOne({ name: `${P} LOM course`, academicYear: '2026', university: `${P}-Uni`, teacherIds: [tIdA], teacherId: tIdA, createdAt: now, updatedAt: now });
  const proj = await db.collection('projects').insertOne({ courseId: lomCourse.insertedId, projectTitle: `${P} Project`, learningOutcome: 'Learning objectives:\n1. Analyze market research data\n2. Present stakeholder interviews', teacherId: tIdA, attachments: [], availableStakeholders: [], createdAt: now, updatedAt: now });
  const projectId = proj.insertedId.toString();
  const task = await db.collection('tasks').insertOne({ projectId: proj.insertedId, taskTitle: 'Market research', description: 'Analyze market research data from survey', keyword: 'research', submissionDeadline: new Date(Date.now() + 864e5), createdAt: now, updatedAt: now });
  const role = await db.collection('roles').insertOne({ projectId: proj.insertedId, name: 'Stakeholder', persona: 'A stakeholder giving interviews', status: 'active', attachments: [], createdAt: now, updatedAt: now });
  const otherProj = await db.collection('projects').insertOne({ courseId: new ObjectId(), projectTitle: `${P} Other`, createdAt: now, updatedAt: now });
  const otherTask = await db.collection('tasks').insertOne({ projectId: otherProj.insertedId, description: 'x', keyword: 'x', submissionDeadline: now, createdAt: now, updatedAt: now });
  const taskId = task.insertedId.toString(), roleId = role.insertedId.toString();

  await t('LOM-01', 'Get mappings for project with none saved', { req: 'GET /lo-mappings/project/:id returns empty mappings', steps: 'GET before save', expected: '200, mappings=[]' }, async () => {
    const r = await A.get(`/lo-mappings/project/${projectId}`);
    return { pass: ok(r, 200) && Array.isArray(r.body.data?.mappings) && r.body.data.mappings.length === 0, actual: h.short(r) };
  });
  await t('LOM-02', 'Save LO mappings', { req: 'POST /lo-mappings upserts mapping', steps: 'POST {projectId, mappings:[{LO, taskIds, roleIds, quizQuestionIds}]}', expected: '200; lo_mappings doc persisted with ObjectIds' }, async () => {
    const r = await A.post('/lo-mappings', { projectId, mappings: [{ learningObjective: 'Analyze market research data', taskIds: [taskId], roleIds: [roleId], quizQuestionIds: ['q1'] }] });
    const doc = await db.collection('lo_mappings').findOne({ projectId: proj.insertedId });
    return { pass: ok(r, 200) && doc?.mappings?.[0]?.taskIds?.[0]?.toString() === taskId && doc.mappings[0].quizQuestionIds[0] === 'q1', actual: `${h.short(r)} | db=${!!doc}` };
  });
  await t('LOM-03', 'Saving again replaces (upsert, single doc per project)', { req: 'One mapping per project', steps: 'POST different mappings; count docs; GET', expected: '200; 1 doc; GET returns new mappings' }, async () => {
    const r = await A.post('/lo-mappings', { projectId, mappings: [{ learningObjective: 'Present stakeholder interviews', roleIds: [roleId] }, { learningObjective: 'Second LO' }] });
    const n = await db.collection('lo_mappings').countDocuments({ projectId: proj.insertedId });
    const g = await A.get(`/lo-mappings/project/${projectId}`);
    return { pass: ok(r, 200) && n === 1 && g.body?.data?.mappings?.length === 2 && g.body.data.mappings[0].roleIds[0] === roleId, actual: `${r.status}; docs=${n}; get mappings=${g.body?.data?.mappings?.length}` };
  });
  await t('LOM-04', 'Save validation (empty mappings / bad projectId / unknown project)', { req: 'Validation', steps: 'mappings=[] ; projectId=abc ; projectId=<random>', expected: '400 ; 400 ; 404' }, async () => {
    const r1 = await A.post('/lo-mappings', { projectId, mappings: [] });
    const r2 = await A.post('/lo-mappings', { projectId: 'abc', mappings: [{ learningObjective: 'x' }] });
    const r3 = await A.post('/lo-mappings', { projectId: FAKE, mappings: [{ learningObjective: 'x' }] });
    return { pass: r1.status === 400 && r2.status === 400 && r3.status === 404, actual: `${r1.status} ; ${r2.status} ; ${r3.status}` };
  });
  await t('LOM-05', 'Reject task/role from another project or invalid id', { req: 'taskIds/roleIds must belong to project', steps: 'taskIds=[other project task] ; roleIds=["abc"] ; taskIds=[<random>]', expected: '400 ; 400 ; 400' }, async () => {
    const r1 = await A.post('/lo-mappings', { projectId, mappings: [{ learningObjective: 'x', taskIds: [otherTask.insertedId.toString()] }] });
    const r2 = await A.post('/lo-mappings', { projectId, mappings: [{ learningObjective: 'x', roleIds: ['abc'] }] });
    const r3 = await A.post('/lo-mappings', { projectId, mappings: [{ learningObjective: 'x', taskIds: [FAKE] }] });
    return { pass: [r1, r2, r3].every(r => r.status === 400), actual: `${r1.status} ; ${r2.status} ; ${r3.status}` };
  });
  await t('LOM-06', 'Get mappings invalid projectId', { req: 'ID validation', steps: 'GET /lo-mappings/project/abc', expected: '400' }, async () => {
    const r = await A.get('/lo-mappings/project/abc');
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('LOM-07', 'Auto-map with keyword matching', { req: 'POST /lo-mappings/auto-map (keyword)', steps: 'POST {projectId}', expected: '200; 2 LOs parsed; LO1 maps the research task, LO2 maps the stakeholder role; action_log entry lo-auto-map' }, async () => {
    const r = await A.post('/lo-mappings/auto-map', { projectId });
    const m = r.body?.data?.mappings || [];
    await new Promise(res => setTimeout(res, 500));
    const log = await db.collection('action_log').findOne({ action: 'lo-auto-map', endpoint: /auto-map/, timestamp: { $gte: now } });
    return { pass: ok(r, 200) && r.body.data.method === 'keyword-matching' && m.length === 2 && m[0].taskIds.includes(taskId) && m[1].roleIds.includes(roleId) && !!log, actual: `${r.status} stats=${JSON.stringify(r.body?.data?.stats)} m=${JSON.stringify(m).slice(0, 160)} log=${!!log}` };
  });
  await t('LOM-08', 'Auto-map with OpenAI (mock)', { req: 'AI auto-mapping returns well-formed mappings', steps: 'POST {projectId, useOpenAI:true}', expected: '200, method=openai, mappings array with learningObjective/taskIds/roleIds/quizQuestionIds arrays' }, async () => {
    const r = await A.post('/lo-mappings/auto-map', { projectId, useOpenAI: true }, { timeout: 60000 });
    const m = r.body?.data?.mappings;
    const wf = Array.isArray(m) && m.length > 0 && m.every(x => typeof x.learningObjective === 'string' && Array.isArray(x.taskIds) && Array.isArray(x.roleIds) && Array.isArray(x.quizQuestionIds));
    return { pass: ok(r, 200) && r.body.data.method === 'openai' && wf, actual: `${r.status} ${JSON.stringify(m || r.body).slice(0, 200)}` };
  });
  const emptyProj = await db.collection('projects').insertOne({ courseId: new ObjectId(), projectTitle: `${P} Empty`, learningOutcome: '', createdAt: now, updatedAt: now });
  await t('LOM-09', 'Auto-map validation (no LOs / bad id / unknown / minKeywordLength<3)', { req: 'Validation & business rule', steps: 'project without LOs ; projectId=abc ; <random> ; minKeywordLength=1', expected: '400 ; 400 ; 404 ; 400' }, async () => {
    const r1 = await A.post('/lo-mappings/auto-map', { projectId: emptyProj.insertedId.toString() });
    const r2 = await A.post('/lo-mappings/auto-map', { projectId: 'abc' });
    const r3 = await A.post('/lo-mappings/auto-map', { projectId: FAKE });
    const r4 = await A.post('/lo-mappings/auto-map', { projectId, minKeywordLength: 1 });
    const s = [r1, r2, r3, r4].map(r => r.status);
    return { pass: s.join() === '400,400,404,400', actual: s.join(' ; ') };
  });
  await t('LOM-10', 'LO mappings access control (anonymous + other teacher)', { req: 'Only project owner may read/save LO mappings', steps: 'Anonymous GET mappings; anonymous POST save; teacher B POST save on A project', expected: '401 ; 401 ; 403', type: 'security' }, async () => {
    const r1 = await anon().get(`/lo-mappings/project/${projectId}`);
    const r2 = await anon().post('/lo-mappings', { projectId, mappings: [{ learningObjective: 'Present stakeholder interviews', roleIds: [roleId] }, { learningObjective: 'Second LO' }] });
    const r3 = await B.post('/lo-mappings', { projectId, mappings: [{ learningObjective: 'Present stakeholder interviews', roleIds: [roleId] }, { learningObjective: 'Second LO' }] });
    const pass = [r1, r2, r3].every(r => [401, 403].includes(r.status));
    return { pass, actual: `anon GET ${r1.status}; anon POST ${r2.status}; teacherB POST ${r3.status}`, severity: 'Critical' };
  });

  // ===================== LOGS =====================
  const lsess = `${P}-logsess`;
  const uA = await db.collection('ai4edu_user').findOne({ username: teacherA.email.toLowerCase() });
  const oidA = uA?._id?.toString();
  await t('LOG-01', 'Logs index lists endpoints', { req: 'GET /logs', steps: 'GET /logs', expected: '200 with endpoints map' }, async () => {
    const r = await A.get('/logs');
    return { pass: ok(r, 200) && !!r.body.endpoints?.track, actual: h.short(r) };
  });
  await t('LOG-02', 'Track login action', { req: 'POST /logs/track persists login/logout', steps: 'POST valid login event (userId = session user _id) with coursePlanName; query action_log', expected: '200; action_log has entry with our sessionId' }, async () => {
    const r = await A.post('/logs/track', { userId: oidA, sessionId: lsess, action: 'login', endpoint: '/auth/login', method: 'POST', success: true, coursePlanName: `${P} Plan`, timestamp: new Date().toISOString() });
    await new Promise(res => setTimeout(res, 300));
    const log = await db.collection('action_log').findOne({ sessionId: lsess });
    return { pass: ok(r, 200) && log?.action === 'login' && log?.userId === oidA, actual: `${h.short(r)} | db=${!!log}` };
  });
  await t('LOG-03', 'Track validation (bad action / missing sessionId / bad method)', { req: 'Joi validation', steps: 'action=hack ; no sessionId ; method=PATCH', expected: '400 ; 400 ; 400' }, async () => {
    const base = { sessionId: lsess, action: 'logout', endpoint: '/x', method: 'POST', success: true };
    const r1 = await A.post('/logs/track', { ...base, action: 'hack' });
    const { sessionId, ...noSess } = base;
    const r2 = await A.post('/logs/track', noSess);
    const r3 = await A.post('/logs/track', { ...base, method: 'PATCH' });
    return { pass: [r1, r2, r3].every(r => r.status === 400), actual: `${r1.status} ; ${r2.status} ; ${r3.status}` };
  });
  await t('LOG-04', 'Get action logs filtered by userId + action', { req: 'GET /logs/actions', steps: 'GET ?userId=<A>&action=login', expected: '200; tracked entry returned with username resolved; pagination present' }, async () => {
    const r = await A.get(`/logs/actions?userId=${oidA}&action=login`);
    const e = (r.body?.data?.logs || []).find(l => l.sessionId === lsess);
    return { pass: ok(r, 200) && !!e && !!r.body.data.pagination && e.username === teacherA.email.toLowerCase(), actual: `${r.status} found=${!!e} username=${e?.username}` };
  });
  await t('LOG-05', 'Action logs query validation', { req: 'Joi validation', steps: 'limit=0 ; limit=5000 ; startDate=notadate ; sortBy=userId', expected: '400 x4' }, async () => {
    const rs = await Promise.all(['limit=0', 'limit=5000', 'startDate=notadate', 'sortBy=userId'].map(q => A.get('/logs/actions?' + q)));
    return { pass: rs.every(r => r.status === 400), actual: rs.map(r => r.status).join(' ; ') };
  });
  await t('LOG-06', 'Usage stats for current user', { req: 'GET /logs/stats', steps: 'GET as A', expected: '200 with data' }, async () => {
    const r = await A.get('/logs/stats');
    return { pass: ok(r, 200) && !!r.body.data, actual: h.short(r) };
  });
  await t('LOG-07', 'Recent logs (last 24h) for current user', { req: 'GET /logs/recent', steps: 'GET as A', expected: '200; includes tracked entry' }, async () => {
    const r = await A.get('/logs/recent');
    const found = (r.body?.data?.logs || []).some(l => l.sessionId === lsess);
    return { pass: ok(r, 200) && found, actual: `${r.status} found=${found} n=${r.body?.data?.logs?.length}` };
  });
  await t('LOG-08', 'Course plan logs require coursePlanName', { req: 'GET /logs/course-plans', steps: 'GET without name ; GET ?coursePlanName=<P> Plan', expected: '400 ; 200 including tracked entry' }, async () => {
    const r1 = await A.get('/logs/course-plans');
    const r2 = await A.get(`/logs/course-plans?coursePlanName=${encodeURIComponent(P + ' Plan')}`);
    const found = (r2.body?.data?.logs || []).some(l => l.sessionId === lsess);
    return { pass: r1.status === 400 && ok(r2, 200) && found, actual: `${r1.status} ; ${r2.status} found=${found}` };
  });
  await t('LOG-09', 'Course plan logs with regex metacharacters / bad paging', { req: 'Input validation', steps: 'GET ?coursePlanName=( ; ?coursePlanName=x&limit=abc', expected: '200/400, not 500', type: 'security' }, async () => {
    const r1 = await A.get('/logs/course-plans?coursePlanName=(');
    const r2 = await A.get('/logs/course-plans?coursePlanName=x&limit=abc');
    return { pass: [r1, r2].every(r => r.status === 200 || r.status === 400), actual: `${h.short(r1)} ; ${h.short(r2)}`, severity: 'Medium' };
  });
  await t('LOG-10', 'Logs access control (anonymous read + forged write)', { req: 'Action logs (all users\' activity, IPs, userIds) are admin-only; track must not let callers log for other users', steps: 'Anonymous GET /logs/actions; teacher B GET /logs/actions?userId=<A>; anonymous POST /logs/track with userId=<A>', expected: '401/403 for reads; anonymous forged log rejected (401) or userId ignored', type: 'security' }, async () => {
    const r1 = await anon().get('/logs/actions?limit=5');
    const r2 = await B.get(`/logs/actions?userId=${oidA}`);
    const fsess = `${P}-forged`;
    const r3 = await anon().post('/logs/track', { userId: oidA, sessionId: fsess, action: 'logout', endpoint: '/auth/logout', method: 'GET', success: true });
    await new Promise(res => setTimeout(res, 300));
    const forged = await db.collection('action_log').findOne({ sessionId: fsess, userId: oidA });
    const bSees = (r2.body?.data?.logs || []).length;
    const pass = [401, 403].includes(r1.status) && ([401, 403].includes(r2.status) || bSees === 0) && !forged;
    return { pass, actual: `anon actions ${r1.status} (n=${r1.body?.data?.logs?.length}, ipAddress/userIds exposed); B reads A logs ${r2.status} n=${bSees}; anon forged track ${r3.status} persisted=${!!forged}`, severity: 'High' };
  });

  // ===================== FILES =====================
  let fname;
  const content = `hello ${P}`;
  await t('FIL-01', 'Upload file', { req: 'POST /files/upload multipart', steps: 'POST FormData file=note.txt', expected: '200, filename with unique suffix, size matches' }, async () => {
    const fd = new FormData(); fd.append('file', new Blob([content], { type: 'text/plain' }), `${P}-note.txt`);
    const r = await A.post('/files/upload', fd);
    fname = r.body?.filename;
    return { pass: r.status === 200 && r.body?.success && /^.+-\d+-\d+\.txt$/.test(fname || '') && r.body.size === content.length, actual: h.short(r) };
  });
  await t('FIL-02', 'Download uploaded file', { req: 'GET /files/:filename', steps: 'GET returned filename', expected: '200, text/plain, attachment, same content' }, async () => {
    const r = await A.get(`/files/${encodeURIComponent(fname)}`);
    return { pass: r.status === 200 && r.text === content && /text\/plain/.test(r.headers.get('content-type')) && /attachment/.test(r.headers.get('content-disposition') || ''), actual: `${r.status} ${r.headers?.get('content-type')} body=${r.text.slice(0, 40)}` };
  });
  await t('FIL-03', 'Upload without file', { req: 'File required', steps: 'POST multipart without file field', expected: '400' }, async () => {
    const fd = new FormData(); fd.append('other', 'x');
    const r = await A.post('/files/upload', fd);
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('FIL-04', 'Download non-existent file', { req: '404 for missing file', steps: 'GET /files/nope-<uid>.txt', expected: '404' }, async () => {
    const r = await A.get(`/files/nope-${P}.txt`);
    return { pass: r.status === 404, actual: h.short(r) };
  });
  await t('FIL-05', 'Path traversal via encoded ../ in filename', { req: 'No access outside uploads/assessment', steps: 'GET /files/..%2F..%2F..%2Fapp.js ; ..%2F..%2Fpackage.json ; ..%5C..%5Capp.js ; %2e%2e%2f%2e%2e%2f.env', expected: '400 (or 404); never file contents', type: 'security' }, async () => {
    const paths = ['..%2F..%2F..%2Fapp.js', '..%2F..%2Fpackage.json', '..%5C..%5C..%5Capp.js', '%2e%2e%2f%2e%2e%2f%2e%2e%2f.env', '..'];
    const rs = await Promise.all(paths.map(p => anon().get('/files/' + p)));
    const leaked = rs.some(r => r.status === 200 || /require\(|"dependencies"|OPENAI/.test(r.text));
    return { pass: !leaked && rs.every(r => [400, 404].includes(r.status)), actual: rs.map((r, i) => `${paths[i]}→${r.status}`).join(' ; '), severity: 'Critical' };
  });
  await t('FIL-06', 'Path traversal via double-encoding / absolute path / null byte', { req: 'No access outside uploads/assessment', steps: 'GET ..%252F..%252Fapp.js ; %2Fetc%2Fpasswd ; app.js%00.txt', expected: '400/404, no file contents, no 500', type: 'security' }, async () => {
    const paths = ['..%252F..%252F..%252Fapp.js', '%2Fetc%2Fpasswd', 'x%00.txt'];
    const rs = await Promise.all(paths.map(p => anon().get('/files/' + p)));
    const leaked = rs.some(r => r.status === 200 || /root:|require\(/.test(r.text));
    return { pass: !leaked && rs.every(r => [400, 404].includes(r.status)), actual: rs.map((r, i) => `${paths[i]}→${h.short(r).slice(0, 60)}`).join(' ; '), severity: 'Medium' };
  });
  await t('FIL-07', 'Upload with traversal in original filename stays in upload dir', { req: 'Uploaded file name must be sanitised', steps: 'Upload file named "../../<P>-evil.txt"', expected: '200 with filename containing no path separators; file not written outside uploads/assessment', type: 'security' }, async () => {
    const fd = new FormData(); fd.append('file', new Blob(['evil'], { type: 'text/plain' }), `../../${P}-evil.txt`);
    const r = await A.post('/files/upload', fd);
    const fs = require('fs');
    const outside = fs.readdirSync(`${__ROOT}/..`).some(f => f.includes(`${P}-evil`)) || fs.readdirSync(`${__ROOT}/../uploads`).some(f => f.includes(`${P}-evil`));
    const fnOk = r.body?.filename ? !/[\/\\]|\.\./.test(r.body.filename) : r.status === 400;
    return { pass: fnOk && !outside, actual: `${h.short(r)} | outside=${outside}` };
  });
  await t('FIL-08', 'Filename with CR/LF / quote does not break headers', { req: 'Robust header handling', steps: 'GET /files/<existing-name-like>%22%0d%0aX-Injected:1', expected: '400/404, no 500, no injected header', type: 'security' }, async () => {
    const r = await anon().get('/files/' + encodeURIComponent('a"\r\nX-Injected: 1.txt'));
    return { pass: [400, 404].includes(r.status) && !r.headers?.get('x-injected'), actual: h.short(r), severity: 'Low' };
  });
  await t('FIL-09', 'Files access control (anonymous upload/download)', { req: 'Uploads/attachments only for authenticated users', steps: 'Anonymous POST /files/upload; anonymous GET teacher A uploaded file', expected: '401 ; 401/403', type: 'security' }, async () => {
    const fd = new FormData(); fd.append('file', new Blob(['anon'], { type: 'text/plain' }), `${P}-anon.html`);
    const r1 = await anon().post('/files/upload', fd);
    const r2 = await anon().get(`/files/${encodeURIComponent(fname)}`);
    return { pass: [401, 403].includes(r1.status) && [401, 403].includes(r2.status), actual: `anon upload ${r1.status} (${r1.body?.filename || ''}); anon download A file ${r2.status}`, severity: 'High' };
  });

  // ===================== DELETE COURSE (last) =====================
  await t('CRS-21', 'Delete course invalid / unknown id', { req: 'ID validation', steps: 'DELETE /courses/abc ; /<random>', expected: '400 ; 404' }, async () => {
    const r1 = await A.del('/courses/abc');
    const r2 = await A.del(`/courses/${FAKE}`);
    return { pass: r1.status === 400 && r2.status === 404, actual: `${r1.status} ; ${r2.status}` };
  });
  await t('CRS-22', 'Anonymous / other teacher cannot delete course', { req: 'Only owner may delete', steps: 'Create course for A; teacher B DELETE it', expected: '403, course still exists', type: 'security' }, async () => {
    const c = await A.post('/courses', { name: `${P} Victim`, academicYear: '2026', university: `${P}-Uni`, teacherId: tIdA });
    const id = c.body?.data?.id;
    const r = await B.del(`/courses/${id}`);
    const still = id ? await db.collection('courses').findOne({ _id: new ObjectId(id) }) : null;
    if (still) await db.collection('courses').deleteOne({ _id: still._id });
    return { pass: [401, 403].includes(r.status) && !!still, actual: `${h.short(r)} | still exists=${!!still}`, severity: 'Critical' };
  });
  await t('CRS-23', 'Delete course', { req: 'DELETE /courses/:id', steps: 'DELETE then filter list', expected: '200; removed from DB' }, async () => {
    const r = await A.del(`/courses/${courseId}`);
    const doc = await db.collection('courses').findOne({ _id: new ObjectId(courseId) });
    return { pass: ok(r, 200) && !doc, actual: `${h.short(r)} | still exists=${!!doc}` };
  });
  await t('CRS-24', 'Deleting course leaves orphaned exercises', { req: 'Deleting a course should remove/block its exercises', steps: 'Seed exercise for course, DELETE course, check exercises', expected: 'No exercises left referencing deleted course (or delete blocked)', severity: 'Low' }, async () => {
    const c = await db.collection('courses').insertOne({ name: `${P} Orph`, academicYear: '2026', university: `${P}-Uni`, teacherIds: [tIdA] });
    await db.collection('exercises').insertOne({ courseId: c.insertedId, lectureLabel: 'L', title: `${P} orphan`, description: 'd' });
    const r = await A.del(`/courses/${c.insertedId}`);
    const orphans = await db.collection('exercises').countDocuments({ courseId: c.insertedId });
    await db.collection('exercises').deleteMany({ courseId: c.insertedId, title: `${P} orphan` });
    return { pass: r.status !== 200 || orphans === 0, actual: `delete ${r.status}; orphan exercises=${orphans}` };
  });

  // cleanup own data
  const pre = new RegExp('^' + P);
  await db.collection('courses').deleteMany({ name: pre });
  await db.collection('exercises').deleteMany({ title: pre });
  await db.collection('course_plan_docs').deleteMany({ coursePlanName: pre });
  await db.collection('lo_mappings').deleteMany({ projectId: { $in: [proj.insertedId, otherProj.insertedId, emptyProj.insertedId] } });
  await db.collection('tasks').deleteMany({ projectId: { $in: [proj.insertedId, otherProj.insertedId] } });
  await db.collection('roles').deleteMany({ projectId: proj.insertedId });
  await db.collection('projects').deleteMany({ projectTitle: pre });
  await mc.close();
});
