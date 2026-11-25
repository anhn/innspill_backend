const { suite } = require('../lib');
const { MongoClient, ObjectId } = require('mongodb');
const WebSocket = require('ws');

suite('BE-COLLAB', async (t, h) => {
  const P = 'collab-' + h.uid();
  const mc = await MongoClient.connect('mongodb://127.0.0.1:27017/?replicaSet=rs0');
  const db = mc.db('ai4edu_database');
  const users = db.collection('ai4edu_user');
  const fakeId = new ObjectId().toString();

  // ---------- fixtures ----------
  const teacher = await h.makeUser('teacher', P);
  const teacher2 = await h.makeUser('teacher', P);
  const courseId = (await db.collection('courses').insertOne({ name: P + ' course', academicYear: '2026', university: 'SysTest U', teacherIds: [teacher.email], teacherId: teacher.email, createdAt: new Date(), updatedAt: new Date() })).insertedId.toString();
  const course2Id = (await db.collection('courses').insertOne({ name: P + ' course2', academicYear: '2026', university: 'SysTest U', teacherIds: [teacher2.email], createdAt: new Date(), updatedAt: new Date() })).insertedId.toString();
  const projectId = (await db.collection('projects').insertOne({ courseId: new ObjectId(courseId), projectTitle: P + ' project', courseDescription: 'Desc ' + P, learningOutcome: 'LO', keyMilestones: 'M1', createdAt: new Date(), updatedAt: new Date() })).insertedId.toString();

  async function makeStudent(tag, remark) {
    const c = new h.Client();
    const email = `${P}-${tag}-${h.uid()}@systest.local`;
    const r = await c.post('/auth/register', { name: `${P} ${tag}`, email, password: 'Passw0rd!', type: 'student', remark });
    if (r.status !== 201) throw new Error('student register failed ' + h.short(r));
    const doc = await users.findOne({ username: email });
    return { client: c, email, username: email, id: doc._id.toString() };
  }
  const s = [];
  for (let i = 0; i < 6; i++) s.push(await makeStudent('s' + i, courseId));
  const outsider = await makeStudent('out', course2Id);

  // =====================================================================
  // STUDENT GROUPS
  // =====================================================================
  let groupId;
  await t('GRP-01', 'Create student group (teacher)', { req: 'Teacher can create a group of >=2 students in a course', steps: 'POST /student-groups {courseId,name,studentIds:[2 usernames]}; read back GET /student-groups/:id', expected: '201, data.id, studentNames resolved; GET returns same group' }, async () => {
    const r = await teacher.client.post('/student-groups', { courseId, name: P + ' G1', description: 'first', studentIds: [s[0].username, s[1].username] });
    groupId = r.body?.data?.id;
    const g = groupId ? await teacher.client.get('/student-groups/' + groupId) : null;
    return { pass: r.status === 201 && !!groupId && g?.status === 200 && g.body.data.studentIds.length === 2 && g.body.data.studentNames[0] === `${P} s0` && g.body.data.createdBy !== 'system', actual: `create ${h.short(r)} | get ${g ? g.status : '-'} createdBy=${g?.body?.data?.createdBy}` };
  });
  await t('GRP-02', 'Create group rejects fewer than 2 students', { req: 'Group needs >=2 students', steps: 'POST with 1 studentId', expected: '400' }, async () => {
    const r = await teacher.client.post('/student-groups', { courseId, name: P + ' bad', studentIds: [s[2].username] });
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('GRP-03', 'Create group rejects missing name/courseId', { req: 'Required fields validated', steps: 'POST {studentIds} only', expected: '400' }, async () => {
    const r = await teacher.client.post('/student-groups', { studentIds: [s[2].username, s[3].username] });
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('GRP-04', 'Create group with invalid courseId format', { req: 'ObjectId validation', steps: 'courseId="abc"', expected: '400' }, async () => {
    const r = await teacher.client.post('/student-groups', { courseId: 'abc', name: P + ' x', studentIds: [s[2].username, s[3].username] });
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('GRP-05', 'Create group with non-existent course', { req: 'Course must exist', steps: 'courseId = random ObjectId', expected: '404' }, async () => {
    const r = await teacher.client.post('/student-groups', { courseId: fakeId, name: P + ' x', studentIds: [s[2].username, s[3].username] });
    return { pass: r.status === 404, actual: h.short(r) };
  });
  await t('GRP-06', 'Create group with non-existent project', { req: 'Project must exist if given', steps: 'projectId = random ObjectId', expected: '404' }, async () => {
    const r = await teacher.client.post('/student-groups', { courseId, projectId: fakeId, name: P + ' x', studentIds: [s[2].username, s[3].username] });
    return { pass: r.status === 404, actual: h.short(r) };
  });
  await t('GRP-07', 'Create group rejects unknown / non-student IDs', { req: 'Members must be existing students', steps: 'studentIds include teacher username + garbage', expected: '400 with invalidIds' }, async () => {
    const r = await teacher.client.post('/student-groups', { courseId, name: P + ' x', studentIds: [teacher.username, 'nobody-' + P] });
    return { pass: r.status === 400 && r.body?.invalidIds?.length === 2, actual: h.short(r) };
  });
  await t('GRP-08', 'Duplicate group name in same course rejected', { req: 'Group names unique per course', steps: 'Create again with same name', expected: '409' }, async () => {
    const r = await teacher.client.post('/student-groups', { courseId, name: P + ' G1', studentIds: [s[2].username, s[3].username] });
    return { pass: r.status === 409, actual: h.short(r) };
  });
  await t('GRP-09', 'Student cannot be in two active groups of same course/project', { req: 'One active group per student per course/project', steps: 'Create G-dup with s0 (already in G1)', expected: '409' }, async () => {
    const r = await teacher.client.post('/student-groups', { courseId, name: P + ' Gdup', studentIds: [s[0].username, s[2].username] });
    return { pass: r.status === 409, actual: h.short(r) };
  });
  await t('GRP-10', 'Student-group conflict check also applies to ObjectId vs username of same student', { req: 'Same student cannot be in two groups regardless of ID form', steps: 'Create group with s0 referenced by _id (G1 holds username)', expected: '409' }, async () => {
    const r = await teacher.client.post('/student-groups', { courseId, name: P + ' Gidform', studentIds: [s[0].id, s[4].id] });
    const ok = r.status === 409;
    if (r.body?.data?.id) await teacher.client.del('/student-groups/' + r.body.data.id);
    return { pass: ok, actual: h.short(r), severity: 'Medium' };
  });
  await t('GRP-11', 'List groups by course', { req: 'Groups listed per course', steps: 'GET /student-groups/course/:courseId', expected: '200, includes G1' }, async () => {
    const r = await teacher.client.get('/student-groups/course/' + courseId);
    return { pass: r.status === 200 && r.body.data.some(g => g.id === groupId), actual: `${r.status} count=${r.body?.data?.length}` };
  });
  await t('GRP-12', 'List groups with invalid courseId', { req: 'ObjectId validation', steps: 'GET /student-groups/course/xyz', expected: '400' }, async () => {
    const r = await teacher.client.get('/student-groups/course/xyz');
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('GRP-13', 'Get group: invalid id 400, unknown id 404', { req: 'ObjectId validation / not found', steps: 'GET /student-groups/xyz and /:randomId', expected: '400 / 404' }, async () => {
    const a = await teacher.client.get('/student-groups/xyz');
    const b = await teacher.client.get('/student-groups/' + fakeId);
    return { pass: a.status === 400 && b.status === 404, actual: `${a.status} / ${b.status}` };
  });
  await t('GRP-14', 'Update group name/description persists', { req: 'Edit group', steps: 'PUT /student-groups/:id {name,description}; GET', expected: '200, persisted' }, async () => {
    const r = await teacher.client.put('/student-groups/' + groupId, { name: P + ' G1-renamed', description: 'changed' });
    const g = await teacher.client.get('/student-groups/' + groupId);
    return { pass: r.status === 200 && g.body?.data?.name === P + ' G1-renamed' && g.body.data.description === 'changed', actual: `${h.short(r)} | name=${g.body?.data?.name}` };
  });
  await t('GRP-15', 'Update group with empty body rejected', { req: 'At least one field required', steps: 'PUT {}', expected: '400' }, async () => {
    const r = await teacher.client.put('/student-groups/' + groupId, {});
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('GRP-16', 'Update non-existent group', { req: 'Not found', steps: 'PUT /:randomId', expected: '404' }, async () => {
    const r = await teacher.client.put('/student-groups/' + fakeId, { name: 'x' });
    return { pass: r.status === 404, actual: h.short(r) };
  });
  await t('GRP-17', 'Assign students to group', { req: 'Add members', steps: 'POST /:id/students {studentIds:[s2]}; GET /:id/students', expected: '200; group has 3 members with emails' }, async () => {
    const r = await teacher.client.post(`/student-groups/${groupId}/students`, { studentIds: [s[2].username] });
    const g = await teacher.client.get(`/student-groups/${groupId}/students`);
    return { pass: r.status === 200 && g.status === 200 && g.body.data.length === 3 && g.body.data.every(x => x.email), actual: `${h.short(r).slice(0, 80)} | members=${g.body?.data?.length}` };
  });
  await t('GRP-18', 'Assign accepts singular studentId form', { req: 'Accepts {studentId}', steps: 'POST {studentId:s3}', expected: '200, 4 members' }, async () => {
    const r = await teacher.client.post(`/student-groups/${groupId}/students`, { studentId: s[3].username });
    return { pass: r.status === 200 && r.body?.data?.studentIds?.length === 4, actual: h.short(r).slice(0, 150) };
  });
  await t('GRP-19', 'Assign students already in group rejected', { req: 'No duplicates', steps: 'POST studentIds [s0]', expected: '400' }, async () => {
    const r = await teacher.client.post(`/student-groups/${groupId}/students`, { studentIds: [s[0].username] });
    return { pass: r.status === 400, actual: h.short(r).slice(0, 150) };
  });
  await t('GRP-20', 'Assign with empty studentIds / unknown student', { req: 'Validation', steps: 'POST {studentIds:[]}, POST {studentIds:["nobody"]}', expected: '400 / 400' }, async () => {
    const a = await teacher.client.post(`/student-groups/${groupId}/students`, { studentIds: [] });
    const b = await teacher.client.post(`/student-groups/${groupId}/students`, { studentIds: ['nobody-' + P] });
    return { pass: a.status === 400 && b.status === 400, actual: `${a.status} / ${b.status}` };
  });
  await t('GRP-21', 'Assign to non-existent group', { req: 'Not found', steps: 'POST /:randomId/students', expected: '404' }, async () => {
    const r = await teacher.client.post(`/student-groups/${fakeId}/students`, { studentIds: [s[4].username] });
    return { pass: r.status === 404, actual: h.short(r).slice(0, 150) };
  });
  await t('GRP-22', 'Remove students from group', { req: 'Remove members', steps: 'DELETE /:id/students {studentIds:[s3]}; GET', expected: '200; 3 members remain' }, async () => {
    const r = await teacher.client.del(`/student-groups/${groupId}/students`, { studentIds: [s[3].username] });
    const g = await teacher.client.get('/student-groups/' + groupId);
    return { pass: r.status === 200 && g.body?.data?.studentIds?.length === 3 && !g.body.data.studentIds.includes(s[3].username), actual: `${h.short(r).slice(0, 100)} | n=${g.body?.data?.studentIds?.length}` };
  });
  await t('GRP-23', 'Removing students below 2 members rejected', { req: 'Group keeps >=2 members', steps: 'DELETE remove 2 of 3', expected: '400, group unchanged' }, async () => {
    const r = await teacher.client.del(`/student-groups/${groupId}/students`, { studentIds: [s[1].username, s[2].username] });
    const g = await teacher.client.get('/student-groups/' + groupId);
    return { pass: r.status === 400 && g.body?.data?.studentIds?.length === 3, actual: `${h.short(r).slice(0, 120)} | n=${g.body?.data?.studentIds?.length}` };
  });
  await t('GRP-24', 'Removing ALL students from group handled cleanly', { req: 'Code comment: allow empty group, else should be 400 – never 500', steps: 'Create temp group of 2, DELETE both members', expected: '200 (empty) or 400 – not 500' }, async () => {
    const c = await teacher.client.post('/student-groups', { courseId, name: P + ' Gtmp', studentIds: [s[4].username, s[5].username] });
    const id = c.body?.data?.id;
    const r = await teacher.client.del(`/student-groups/${id}/students`, { studentIds: [s[4].username, s[5].username] });
    await teacher.client.del('/student-groups/' + id);
    return { pass: [200, 400].includes(r.status), actual: `create ${c.status}; remove-all ${h.short(r)}`, severity: 'Medium' };
  });
  await t('GRP-25', 'Remove students validation', { req: 'Validation', steps: 'DELETE /:id/students {} and /xyz/students', expected: '400 / 400' }, async () => {
    const a = await teacher.client.del(`/student-groups/${groupId}/students`, {});
    const b = await teacher.client.del(`/student-groups/xyz/students`, { studentIds: ['a'] });
    return { pass: a.status === 400 && b.status === 400, actual: `${a.status} / ${b.status}` };
  });
  await t('GRP-26', 'Unassigned students for course', { req: 'List course students not in any group', steps: 'GET /student-groups/course/:courseId/unassigned-students', expected: '200; s3,s4,s5 listed, s0 not; no password field' }, async () => {
    // G1 has no projectId -> unassigned (no projectId filter) should exclude its members
    const r = await teacher.client.get(`/student-groups/course/${courseId}/unassigned-students`);
    const names = (r.body?.data || []).map(x => x.username);
    return { pass: r.status === 200 && names.includes(s[3].username) && !names.includes(s[0].username) && !/password/.test(r.text), actual: `${r.status} unassigned=${names.length}` };
  });
  await t('GRP-27', 'Unassigned students invalid courseId', { req: 'Validation', steps: 'GET /course/xyz/unassigned-students', expected: '400' }, async () => {
    const r = await teacher.client.get(`/student-groups/course/xyz/unassigned-students`);
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('GRP-28', 'Deactivated group hidden by default, shown with includeInactive', { req: 'isActive filter', steps: 'PUT isActive=false; list; list ?includeInactive=true; re-activate', expected: 'hidden, then shown' }, async () => {
    await teacher.client.put('/student-groups/' + groupId, { isActive: false });
    const a = await teacher.client.get('/student-groups/course/' + courseId);
    const b = await teacher.client.get('/student-groups/course/' + courseId + '?includeInactive=true');
    await teacher.client.put('/student-groups/' + groupId, { isActive: true });
    return { pass: !a.body.data.some(g => g.id === groupId) && b.body.data.some(g => g.id === groupId), actual: `default has=${a.body.data.some(g => g.id === groupId)} inactive has=${b.body.data.some(g => g.id === groupId)}` };
  });
  await t('GRP-29', 'Student groups: access control (anonymous / other teacher)', { req: 'Only course teacher may read/modify groups', steps: 'Anonymous GET /:id and POST create; teacher2 (other course) PUT rename G1', expected: '401/403 for all', type: 'security', severity: 'Critical' }, async () => {
    const anonGet = await new h.Client().get('/student-groups/' + groupId);
    const anonCreate = await new h.Client().post('/student-groups', { courseId, name: P + ' anon', studentIds: [s[4].username, s[5].username] });
    const other = await teacher2.client.put('/student-groups/' + groupId, { description: 'hijacked by teacher2' });
    if (anonCreate.body?.data?.id) await teacher.client.del('/student-groups/' + anonCreate.body.data.id);
    const blocked = [anonGet, anonCreate, other].every(r => [401, 403].includes(r.status));
    return { pass: blocked, actual: `anon GET ${anonGet.status}; anon POST ${anonCreate.status} createdBy=${anonCreate.body?.data?.createdBy}; teacher2 PUT ${other.status}` };
  });

  // =====================================================================
  // PLANNING POKER  (group G1 members: s0, s1, s2)
  // =====================================================================
  const q = (u) => `?userName=${encodeURIComponent(u.username)}`;
  let taskId;
  await t('PKR-01', 'Create planning poker task (group member)', { req: 'Group members create estimation tasks', steps: 'POST /planning-poker/tasks?userName=s0 {groupId,title}; GET tasks', expected: '201, status voting, listed for group' }, async () => {
    const r = await s[0].client.post('/planning-poker/tasks' + q(s[0]), { groupId, title: P + ' story', description: 'd' });
    taskId = r.body?.data?.id;
    const l = await s[0].client.get(`/planning-poker/tasks/group/${groupId}` + q(s[0]));
    return { pass: r.status === 201 && r.body.data.status === 'voting' && r.body.data.totalMembers === 3 && l.body?.data?.some(x => x.id === taskId), actual: `${h.short(r).slice(0, 120)} | list ${l.status}` };
  });
  await t('PKR-02', 'Create task: missing title / invalid groupId / no userName', { req: 'Validation', steps: 'POST {groupId}, POST {groupId:"x",title}, anon POST without userName', expected: '400 / 400 / 400' }, async () => {
    const a = await s[0].client.post('/planning-poker/tasks' + q(s[0]), { groupId });
    const b = await s[0].client.post('/planning-poker/tasks' + q(s[0]), { groupId: 'x', title: 't' });
    const c = await new h.Client().post('/planning-poker/tasks', { groupId, title: 't' });
    return { pass: a.status === 400 && b.status === 400 && c.status === 400, actual: `${a.status} / ${b.status} / ${c.status}` };
  });
  await t('PKR-03', 'Non-member cannot create task', { req: 'Membership check', steps: 'outsider POST task in G1', expected: '403' }, async () => {
    const r = await outsider.client.post('/planning-poker/tasks' + q(outsider), { groupId, title: 'x' });
    return { pass: r.status === 403, actual: h.short(r) };
  });
  await t('PKR-04', 'Session user identified without ?userName (session fallback)', { req: 'Logged-in user identity taken from session', steps: 's0 GET /tasks/group/:id without userName query', expected: '200 (session username used)', severity: 'Medium' }, async () => {
    const r = await s[0].client.get(`/planning-poker/tasks/group/${groupId}`);
    return { pass: r.status === 200, actual: h.short(r).slice(0, 150) };
  });
  await t('PKR-05', 'Submit vote and votes hidden from others until reveal', { req: 'Votes secret until revealed', steps: 's0 votes 5, s1 votes 8; s1 lists tasks', expected: '200; s1 sees only own vote, voteCount=2' }, async () => {
    const a = await s[0].client.post('/planning-poker/votes' + q(s[0]), { taskId, groupId, vote: 5 });
    const b = await s[1].client.post('/planning-poker/votes' + q(s[1]), { taskId, groupId, vote: 8 });
    const l = await s[1].client.get(`/planning-poker/tasks/group/${groupId}` + q(s[1]));
    const tk = l.body?.data?.find(x => x.id === taskId);
    return { pass: a.status === 200 && b.status === 200 && tk?.votes?.length === 1 && tk.votes[0].userId === s[1].username && tk.voteCount === 2 && tk.canReveal === true, actual: `votes ${a.status}/${b.status}; visible=${tk?.votes?.length} count=${tk?.voteCount}` };
  });
  await t('PKR-06', 'Re-voting updates existing vote (no duplicate)', { req: 'One vote per user', steps: 's1 votes 13; read DB', expected: '200; 2 votes total, s1=13' }, async () => {
    const r = await s[1].client.post('/planning-poker/votes' + q(s[1]), { taskId, groupId, vote: 13 });
    const doc = await db.collection('planning_poker_tasks').findOne({ _id: new ObjectId(taskId) });
    const v = doc.votes.find(x => x.userId === s[1].username);
    return { pass: r.status === 200 && doc.votes.length === 2 && v.vote === 13, actual: `${r.status} votes=${doc.votes.length} s1=${v?.vote}` };
  });
  await t('PKR-07', 'Invalid vote values rejected', { req: 'Only Fibonacci 1..21 or "?"', steps: 'vote 4, vote "abc", missing vote', expected: '400 each' }, async () => {
    const rs = await Promise.all([4, 'abc', undefined].map(v => s[2].client.post('/planning-poker/votes' + q(s[2]), { taskId, groupId, vote: v })));
    return { pass: rs.every(r => r.status === 400), actual: rs.map(r => r.status).join(' / ') };
  });
  await t('PKR-08', 'Vote on non-existent task / invalid id', { req: 'Validation', steps: 'vote with random taskId; taskId="x"', expected: '404 / 400' }, async () => {
    const a = await s[2].client.post('/planning-poker/votes' + q(s[2]), { taskId: fakeId, groupId, vote: 3 });
    const b = await s[2].client.post('/planning-poker/votes' + q(s[2]), { taskId: 'x', groupId, vote: 3 });
    return { pass: a.status === 404 && b.status === 400, actual: `${a.status} / ${b.status}` };
  });
  await t('PKR-09', 'Only task creator can reveal', { req: 'Moderator-only reveal', steps: 's1 POST /tasks/:id/reveal', expected: '403' }, async () => {
    const r = await s[1].client.post(`/planning-poker/tasks/${taskId}/reveal` + q(s[1]));
    return { pass: r.status === 403, actual: h.short(r) };
  });
  await t('PKR-10', 'Reveal votes computes average', { req: 'Reveal shows all votes + average', steps: 's2 votes "?"; creator s0 reveals', expected: '200, revealed, 3 votes visible, average (5+13)/2=9' }, async () => {
    await s[2].client.post('/planning-poker/votes' + q(s[2]), { taskId, groupId, vote: '?' });
    const r = await s[0].client.post(`/planning-poker/tasks/${taskId}/reveal` + q(s[0]));
    const d = r.body?.data;
    return { pass: r.status === 200 && d?.status === 'revealed' && d.votes.length === 3 && d.averageVote === 9 && d.allMembersVoted === true, actual: `${r.status} status=${d?.status} votes=${d?.votes?.length} avg=${d?.averageVote}` };
  });
  await t('PKR-11', 'Cannot vote or reveal again after reveal', { req: 'State transition voting->revealed', steps: 's1 votes; s0 reveals again', expected: '409 / 409' }, async () => {
    const a = await s[1].client.post('/planning-poker/votes' + q(s[1]), { taskId, groupId, vote: 1 });
    const b = await s[0].client.post(`/planning-poker/tasks/${taskId}/reveal` + q(s[0]));
    return { pass: a.status === 409 && b.status === 409, actual: `${a.status} / ${b.status}` };
  });
  await t('PKR-12', 'Clear votes resets task (creator only)', { req: 'Re-estimation', steps: 's1 clear (403); s0 clear; read DB', expected: '403; 200, votes=[], status voting, averageVote removed' }, async () => {
    const a = await s[1].client.post(`/planning-poker/tasks/${taskId}/clear` + q(s[1]));
    const b = await s[0].client.post(`/planning-poker/tasks/${taskId}/clear` + q(s[0]));
    const doc = await db.collection('planning_poker_tasks').findOne({ _id: new ObjectId(taskId) });
    return { pass: a.status === 403 && b.status === 200 && doc.votes.length === 0 && doc.status === 'voting' && doc.revealed === false && doc.averageVote == null, actual: `${a.status} / ${h.short(b).slice(0, 100)} | db votes=${doc.votes.length} status=${doc.status} avg=${doc.averageVote}` };
  });
  await t('PKR-13', 'Reveal/clear/delete with invalid or unknown taskId', { req: 'Validation', steps: 'reveal /x, clear /:random, delete /:random', expected: '400 / 404 / 404' }, async () => {
    const a = await s[0].client.post(`/planning-poker/tasks/x/reveal` + q(s[0]));
    const b = await s[0].client.post(`/planning-poker/tasks/${fakeId}/clear` + q(s[0]));
    const c = await s[0].client.del(`/planning-poker/tasks/${fakeId}` + q(s[0]));
    return { pass: a.status === 400 && b.status === 404 && c.status === 404, actual: `${a.status} / ${b.status} / ${c.status}` };
  });
  await t('PKR-14', 'Online presence: mark online, list, mark offline', { req: 'Online members tracking', steps: 'POST members/online (s0,s1); GET; DELETE s1; GET', expected: 'list has s0,s1 then only s0' }, async () => {
    await s[0].client.post(`/planning-poker/groups/${groupId}/members/online` + q(s[0]));
    const p = await s[1].client.post(`/planning-poker/groups/${groupId}/members/online` + q(s[1]));
    const g1 = await s[0].client.get(`/planning-poker/groups/${groupId}/members/online` + q(s[0]));
    const d = await s[1].client.del(`/planning-poker/groups/${groupId}/members/online` + q(s[1]));
    const g2 = await s[0].client.get(`/planning-poker/groups/${groupId}/members/online` + q(s[0]));
    const a = g1.body?.data || [], b = g2.body?.data || [];
    return { pass: p.status === 200 && d.status === 200 && a.includes(s[0].username) && a.includes(s[1].username) && b.includes(s[0].username) && !b.includes(s[1].username), actual: `before=${a.length} after=${b.length}` };
  });
  await t('PKR-15', 'Online presence: non-member 403, invalid groupId 400', { req: 'Membership/validation', steps: 'outsider GET online; GET /groups/x/members/online', expected: '403 / 400' }, async () => {
    const a = await outsider.client.get(`/planning-poker/groups/${groupId}/members/online` + q(outsider));
    const b = await s[0].client.get(`/planning-poker/groups/x/members/online` + q(s[0]));
    return { pass: a.status === 403 && b.status === 400, actual: `${a.status} / ${b.status}` };
  });
  await t('PKR-16', 'Delete task: non-creator 403, creator 200 and removed', { req: 'Creator deletes task', steps: 's1 DELETE (403); s0 DELETE; check DB', expected: '403; 200; doc gone' }, async () => {
    const a = await s[1].client.del(`/planning-poker/tasks/${taskId}` + q(s[1]));
    const b = await s[0].client.del(`/planning-poker/tasks/${taskId}` + q(s[0]));
    const doc = await db.collection('planning_poker_tasks').findOne({ _id: new ObjectId(taskId) });
    return { pass: a.status === 403 && b.status === 200 && !doc, actual: `${a.status} / ${b.status} / db=${doc ? 'exists' : 'gone'}` };
  });
  await t('PKR-17', 'Planning poker: identity spoofing via ?userName (anonymous / non-member)', { req: 'Identity must come from session; anonymous and non-members must be rejected', steps: 'Fresh client (no session) GET tasks + POST task with ?userName=<member>; outsider (logged in) creates task with ?userName=s0 then deletes s0-owned task', expected: '401/403 for all', type: 'security', severity: 'Critical' }, async () => {
    const anon = new h.Client();
    const g = await anon.get(`/planning-poker/tasks/group/${groupId}` + q(s[0]));
    const c = await anon.post('/planning-poker/tasks' + q(s[0]), { groupId, title: 'anon-spoof ' + P });
    const own = await s[0].client.post('/planning-poker/tasks' + q(s[0]), { groupId, title: 'victim ' + P });
    const del = await outsider.client.del(`/planning-poker/tasks/${own.body?.data?.id}` + q(s[0]));
    if (c.body?.data?.id) await s[0].client.del(`/planning-poker/tasks/${c.body.data.id}` + q(s[0]));
    if (del.status !== 200 && own.body?.data?.id) await s[0].client.del(`/planning-poker/tasks/${own.body.data.id}` + q(s[0]));
    const blocked = [g, c, del].every(r => [401, 403].includes(r.status));
    return { pass: blocked, actual: `anon GET ${g.status}; anon POST ${c.status} createdBy=${c.body?.data?.createdBy}; outsider DELETE s0 task ${del.status}` };
  });
  await t('PKR-18', 'WebSocket endpoint ws://localhost:3000/planning-poker served', { req: 'Frontend usePlanningPokerWebSocket + PLANNING_POKER_WEBSOCKET_BACKEND_SPECIFICATION.md require real-time WS at /planning-poker?groupId&userName', steps: 'Open ws://localhost:3000/planning-poker?groupId=G1&userName=s0 with s0 cookie; send {type:"join"}', expected: 'Connection opens (101 Switching Protocols); server accepts join' }, async () => {
    const url = `ws://localhost:3000/planning-poker?groupId=${groupId}&userName=${encodeURIComponent(s[0].username)}`;
    const res = await new Promise((resolve) => {
      const ws = new WebSocket(url, { headers: { cookie: s[0].client.cookie } });
      const done = (v) => { try { ws.terminate(); } catch {} resolve(v); };
      const timer = setTimeout(() => done({ ok: false, info: 'timeout (no handshake within 5s)' }), 5000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'join', groupId, userName: s[0].username }));
        ws.once('message', (m) => { clearTimeout(timer); done({ ok: true, info: 'open; first msg ' + String(m).slice(0, 100) }); });
        setTimeout(() => { clearTimeout(timer); done({ ok: true, info: 'open; no message within 2s' }); }, 2000);
      });
      ws.on('unexpected-response', (req, r) => { clearTimeout(timer); done({ ok: false, info: `HTTP ${r.statusCode} (upgrade refused)` }); });
      ws.on('error', (e) => { clearTimeout(timer); done({ ok: false, info: 'error ' + e.message }); });
    });
    return { pass: res.ok, actual: res.info, severity: 'High' };
  });

  // =====================================================================
  // SWOT ANALYSIS
  // =====================================================================
  await t('SWT-01', 'Get guidelines', { req: 'SWOT guide content', steps: 'GET /swot-analysis/guidelines', expected: '200 with 4 sections' }, async () => {
    const r = await new h.Client().get('/swot-analysis/guidelines');
    const sec = r.body?.data?.explanation?.sections || {};
    return { pass: r.status === 200 && ['strengths', 'weaknesses', 'opportunities', 'threats'].every(k => sec[k]), actual: h.short(r).slice(0, 100) };
  });
  await t('SWT-02', 'Individual SWOT empty before first save', { req: 'Default empty SWOT', steps: 's0 GET /group/:id?viewType=individual', expected: '200, id null, empty arrays' }, async () => {
    const r = await s[0].client.get(`/swot-analysis/group/${groupId}` + q(s[0]) + '&viewType=individual');
    return { pass: r.status === 200 && r.body.data.id === null && r.body.data.strengths.length === 0, actual: h.short(r).slice(0, 150) };
  });
  await t('SWT-03', 'Save SWOT (strings + object items) and read back', { req: 'Student saves individual SWOT', steps: 's0 POST {strengths:["A",{text:"B"}],weaknesses:["W"],isComplete:true}; GET individual', expected: '200; persisted strengths [A,B], isComplete true' }, async () => {
    const r = await s[0].client.post(`/swot-analysis/group/${groupId}` + q(s[0]), { strengths: ['A', { text: 'B', id: 1 }], weaknesses: ['W'], opportunities: [], threats: ['T'], isComplete: true });
    const g = await s[0].client.get(`/swot-analysis/group/${groupId}` + q(s[0]));
    const d = g.body?.data;
    return { pass: r.status === 200 && d?.strengths?.join() === 'A,B' && d.isComplete === true && !!d.id, actual: `${r.status} | read ${JSON.stringify(d?.strengths)} complete=${d?.isComplete}` };
  });
  await t('SWT-04', 'Re-saving SWOT updates (upsert, single doc)', { req: 'One SWOT per user per group', steps: 's0 POST again with different strengths; count docs', expected: '200; 1 doc, strengths replaced' }, async () => {
    const r = await s[0].client.post(`/swot-analysis/group/${groupId}` + q(s[0]), { strengths: ['C'] });
    const n = await db.collection('swot_analyses').countDocuments({ groupId: new ObjectId(groupId), userId: s[0].username });
    const doc = await db.collection('swot_analyses').findOne({ groupId: new ObjectId(groupId), userId: s[0].username });
    return { pass: r.status === 200 && n === 1 && doc.strengths.join() === 'C' && doc.isComplete === false, actual: `${r.status} docs=${n} strengths=${doc?.strengths}` };
  });
  await t('SWT-05', 'Aggregated SWOT across members', { req: 'Group view aggregates contributions', steps: 's1 saves; s0 GET ?viewType=aggregated', expected: '200; 2 contributors, completionRate 66.7, items attributed' }, async () => {
    await s[1].client.post(`/swot-analysis/group/${groupId}` + q(s[1]), { strengths: ['D'], threats: ['E'] });
    const r = await s[0].client.get(`/swot-analysis/group/${groupId}` + q(s[0]) + '&viewType=aggregated');
    const d = r.body?.data;
    return { pass: r.status === 200 && d?.totalContributors === 2 && d.totalMembers === 3 && d.strengths.some(x => x.text === 'D' && x.contributedBy === s[1].username), actual: `${r.status} contributors=${d?.totalContributors} members=${d?.totalMembers} rate=${d?.completionRate}` };
  });
  await t('SWT-06', 'Save SWOT validation (empty body / bad item type / invalid groupId)', { req: 'Validation', steps: 'POST {}, POST {strengths:[123]}, POST /group/x', expected: '400 / 400 / 400' }, async () => {
    const a = await s[0].client.post(`/swot-analysis/group/${groupId}` + q(s[0]), {});
    const b = await s[0].client.post(`/swot-analysis/group/${groupId}` + q(s[0]), { strengths: [123] });
    const c = await s[0].client.post(`/swot-analysis/group/x` + q(s[0]), { strengths: ['a'] });
    return { pass: a.status === 400 && b.status === 400 && c.status === 400, actual: `${a.status} / ${b.status} / ${c.status}` };
  });
  await t('SWT-07', 'Non-member cannot read or write group SWOT', { req: 'Membership check', steps: 'outsider GET/POST G1 SWOT', expected: '403 / 403' }, async () => {
    const a = await outsider.client.get(`/swot-analysis/group/${groupId}` + q(outsider) + '&viewType=aggregated');
    const b = await outsider.client.post(`/swot-analysis/group/${groupId}` + q(outsider), { strengths: ['x'] });
    return { pass: a.status === 403 && b.status === 403, actual: `${a.status} / ${b.status}` };
  });
  await t('SWT-08', 'Project description', { req: 'Show project context', steps: 'GET /project/:projectId/description', expected: '200, title/description from project' }, async () => {
    const r = await s[0].client.get(`/swot-analysis/project/${projectId}/description` + q(s[0]));
    return { pass: r.status === 200 && r.body.data.title === P + ' project' && r.body.data.description === 'Desc ' + P, actual: h.short(r).slice(0, 150) };
  });
  await t('SWT-09', 'Project description invalid / unknown id', { req: 'Validation', steps: 'GET /project/x/description, /project/:random/description', expected: '400 / 404' }, async () => {
    const a = await s[0].client.get(`/swot-analysis/project/x/description` + q(s[0]));
    const b = await s[0].client.get(`/swot-analysis/project/${fakeId}/description` + q(s[0]));
    return { pass: a.status === 400 && b.status === 404, actual: `${a.status} / ${b.status}` };
  });
  await t('SWT-10', 'SWOT: anonymous read + overwrite of another member\'s SWOT via ?userName', { req: 'Identity from session; anon rejected; cannot write as another user', steps: 'Fresh client GET aggregated ?userName=s0; outsider POST ?userName=s1 overwriting s1 SWOT', expected: '401/403; s1 SWOT unchanged', type: 'security', severity: 'Critical' }, async () => {
    const a = await new h.Client().get(`/swot-analysis/group/${groupId}` + q(s[0]) + '&viewType=aggregated');
    const b = await outsider.client.post(`/swot-analysis/group/${groupId}` + q(s[1]), { strengths: ['OVERWRITTEN BY OUTSIDER'] });
    const doc = await db.collection('swot_analyses').findOne({ groupId: new ObjectId(groupId), userId: s[1].username });
    const blocked = [401, 403].includes(a.status) && [401, 403].includes(b.status);
    return { pass: blocked, actual: `anon GET ${a.status} (items=${a.body?.data?.totalItems}); outsider POST as s1 ${b.status}; s1 strengths now ${JSON.stringify(doc?.strengths)}` };
  });

  // =====================================================================
  // STUDENTS
  // =====================================================================
  await t('STU-01', 'List students by course', { req: 'Teacher lists course students', steps: 'GET /students?courseId=', expected: '200, 6 students, no password field' }, async () => {
    const r = await teacher.client.get('/students?courseId=' + courseId);
    return { pass: r.status === 200 && r.body.data.length === 6 && !/password/i.test(r.text), actual: `${r.status} n=${r.body?.data?.length}` };
  });
  await t('STU-02', 'List students: missing / invalid courseId', { req: 'Validation', steps: 'GET /students, GET /students?courseId=x', expected: '400 / 400' }, async () => {
    const a = await teacher.client.get('/students');
    const b = await teacher.client.get('/students?courseId=x');
    return { pass: a.status === 400 && b.status === 400, actual: `${a.status} / ${b.status}` };
  });
  await t('STU-03', 'Update student info persists', { req: 'Teacher edits student', steps: 'PUT /students/:id {fullName,email}; read DB', expected: '200; persisted' }, async () => {
    const newEmail = `${P}-s5new@systest-example.com`;
    const r = await teacher.client.put('/students/' + s[5].id, { fullName: 'Renamed S5', email: newEmail });
    const doc = await users.findOne({ _id: new ObjectId(s[5].id) });
    return { pass: r.status === 200 && doc.fullName === 'Renamed S5' && doc.email === newEmail, actual: `${h.short(r).slice(0, 100)} | db=${doc.fullName},${doc.email}` };
  });
  await t('STU-04', 'Update student validation', { req: 'Validation', steps: 'PUT /students/x; PUT {}; PUT {email:"bad"}; PUT teacher id; PUT random id', expected: '400 / 400 / 400 / 404 / 404' }, async () => {
    const tId = (await users.findOne({ username: teacher.username }))._id.toString();
    const rs = [await teacher.client.put('/students/x', { fullName: 'a' }), await teacher.client.put('/students/' + s[5].id, {}), await teacher.client.put('/students/' + s[5].id, { email: 'bad' }), await teacher.client.put('/students/' + tId, { fullName: 'a' }), await teacher.client.put('/students/' + fakeId, { fullName: 'a' })];
    return { pass: rs.map(r => r.status).join() === '400,400,400,404,404', actual: rs.map(r => r.status).join(' / ') };
  });
  await t('STU-05', 'Update student to duplicate email handled', { req: 'Email unique; conflict should be 409/400 not 500', steps: 'PUT s4 email = s0 email', expected: '409 or 400' }, async () => {
    const r = await teacher.client.put('/students/' + s[4].id, { email: s[0].email });
    return { pass: [400, 409].includes(r.status), actual: h.short(r), severity: 'Medium' };
  });
  const victim = await makeStudent('victim', course2Id);
  await t('STU-06', 'Students: access control (anonymous / other course teacher)', { req: 'Only authorised teacher of the course may list/edit/delete students', steps: 'Anon GET /students?courseId; anon PUT s4; teacher2 (course2) PUT s4 fullName', expected: '401/403 for all; s4 unchanged', type: 'security', severity: 'Critical' }, async () => {
    const a = await new h.Client().get('/students?courseId=' + courseId);
    const b = await new h.Client().put('/students/' + s[4].id, { fullName: 'anon-edit' });
    const c = await teacher2.client.put('/students/' + s[4].id, { fullName: 'teacher2-edit', remark: course2Id });
    const doc = await users.findOne({ _id: new ObjectId(s[4].id) });
    const blocked = [a, b, c].every(r => [401, 403].includes(r.status));
    return { pass: blocked, actual: `anon GET ${a.status} (n=${a.body?.data?.length}); anon PUT ${b.status}; teacher2 PUT ${c.status}; s4 now fullName="${doc.fullName}" remark=${doc.remark === course2Id ? 'course2' : 'course1'}` };
  });
  await t('STU-07', 'Delete student: a student cannot delete another student', { req: 'Only authorised staff may delete accounts', steps: 'Student s0 DELETE /students/:victimId', expected: '401/403; victim still exists', type: 'security', severity: 'Critical' }, async () => {
    const r = await s[0].client.del('/students/' + victim.id);
    const doc = await users.findOne({ _id: new ObjectId(victim.id) });
    return { pass: [401, 403].includes(r.status) && !!doc, actual: `${h.short(r)} | victim ${doc ? 'exists' : 'DELETED'}` };
  });
  await t('STU-08', 'Delete student (teacher) and validation', { req: 'Teacher removes student', steps: 'DELETE /students/x; DELETE teacher id; DELETE s5; DB check; DELETE s5 again', expected: '400; 404; 200 + gone; 404' }, async () => {
    const tId = (await users.findOne({ username: teacher.username }))._id.toString();
    const a = await teacher.client.del('/students/x');
    const b = await teacher.client.del('/students/' + tId);
    const c = await teacher.client.del('/students/' + s[5].id);
    const doc = await users.findOne({ _id: new ObjectId(s[5].id) });
    const d = await teacher.client.del('/students/' + s[5].id);
    return { pass: a.status === 400 && b.status === 404 && c.status === 200 && !doc && d.status === 404, actual: `${a.status} / ${b.status} / ${c.status} db=${doc ? 'exists' : 'gone'} / ${d.status}` };
  });

  // =====================================================================
  // USERS
  // =====================================================================
  let newUserId;
  const newUname = `${P}-adm-${h.uid()}`;
  await t('USR-01', 'List users (filters, sort, limit)', { req: 'Admin/school user list', steps: 'GET /users?courseId=..&type=student&sortBy=date_created&sortOrder=asc&limit=3', expected: '200, <=3 students of course, courseName resolved' }, async () => {
    const r = await teacher.client.get(`/users?courseId=${courseId}&type=student&sortBy=date_created&sortOrder=asc&limit=3`);
    const d = r.body?.data || [];
    return { pass: r.status === 200 && d.length === 3 && d.every(u => u.type === 'student' && u.courseName === P + ' course'), actual: `${r.status} n=${d.length} courseName=${d[0]?.courseName}` };
  });
  await t('USR-02', 'List users invalid query', { req: 'Validation', steps: 'GET /users?type=hacker, ?limit=0', expected: '400 / 400' }, async () => {
    const a = await teacher.client.get('/users?type=hacker');
    const b = await teacher.client.get('/users?limit=0');
    return { pass: a.status === 400 && b.status === 400, actual: `${a.status} / ${b.status}` };
  });
  await t('USR-03', 'Create user (hashed password stored, not returned)', { req: 'Admin creates users', steps: 'POST /users {username,email,password,type:student,remark}; check DB', expected: '201; no password in response; DB password bcrypt' }, async () => {
    const r = await teacher.client.post('/users', { username: newUname, email: newUname + "@systest-example.com", fullName: 'New U', password: 'Passw0rd!', type: 'student', remark: courseId });
    newUserId = r.body?.data?.id;
    const doc = newUserId ? await users.findOne({ _id: new ObjectId(newUserId) }) : null;
    return { pass: r.status === 201 && !/password/i.test(r.text) && /^\$2[aby]\$/.test(doc?.password || ''), actual: `${h.short(r).slice(0, 120)} | db pw prefix ${(doc?.password || '').slice(0, 4)}` };
  });
  await t('USR-04', 'Create user validation and duplicates', { req: 'Validation / uniqueness', steps: 'POST {} ; short password; same username again', expected: '400 / 400 / 409' }, async () => {
    const a = await teacher.client.post('/users', {});
    const b = await teacher.client.post('/users', { username: 'x' + P, email: `x${P}@systest-example.com`, password: '123', type: 'student' });
    const c = await teacher.client.post('/users', { username: newUname, email: `other-${P}@systest-example.com`, password: 'Passw0rd!', type: 'student' });
    return { pass: a.status === 400 && b.status === 400 && c.status === 409, actual: `${a.status} / ${b.status} / ${c.status}` };
  });
  await t('USR-05', 'Update user persists (incl. password change works for login)', { req: 'Admin edits users', steps: 'PUT /users/:id {fullName,password}; login with new password', expected: '200; fullName persisted; login 200' }, async () => {
    const r = await teacher.client.put('/users/' + newUserId, { fullName: 'Edited U', password: 'NewPassw0rd!' });
    const doc = await users.findOne({ _id: new ObjectId(newUserId) });
    const l = await new h.Client().post('/auth/login', { username: newUname, password: 'NewPassw0rd!' });
    return { pass: r.status === 200 && doc.fullName === 'Edited U' && l.status === 200 && !/password/i.test(r.text), actual: `${r.status} fullName=${doc.fullName} login=${l.status}` };
  });
  await t('USR-06', 'Update user validation', { req: 'Validation', steps: 'PUT /users/x; PUT {}; PUT /users/:random', expected: '400 / 400 / 404' }, async () => {
    const a = await teacher.client.put('/users/x', { fullName: 'a' });
    const b = await teacher.client.put('/users/' + newUserId, {});
    const c = await teacher.client.put('/users/' + fakeId, { fullName: 'a' });
    return { pass: a.status === 400 && b.status === 400 && c.status === 404, actual: `${a.status} / ${b.status} / ${c.status}` };
  });
  await t('USR-07', 'Assign / unassign course', { req: 'Assign course via remark', steps: 'POST /users/:id/assign-course {courseId:course2}; then {courseId:""}; DB', expected: '200 remark=course2; 200 remark=""' }, async () => {
    const a = await teacher.client.post(`/users/${newUserId}/assign-course`, { courseId: course2Id });
    const d1 = await users.findOne({ _id: new ObjectId(newUserId) });
    const b = await teacher.client.post(`/users/${newUserId}/assign-course`, { courseId: '' });
    const d2 = await users.findOne({ _id: new ObjectId(newUserId) });
    return { pass: a.status === 200 && d1.remark === course2Id && b.status === 200 && d2.remark === '', actual: `${a.status} ${d1.remark === course2Id} / ${b.status} '${d2.remark}'` };
  });
  await t('USR-08', 'Assign course validation', { req: 'Validation', steps: 'assign-course courseId="x"; /users/x/assign-course; /users/:random/assign-course', expected: '400 / 400 / 404' }, async () => {
    const a = await teacher.client.post(`/users/${newUserId}/assign-course`, { courseId: 'x' });
    const b = await teacher.client.post(`/users/x/assign-course`, { courseId: course2Id });
    const c = await teacher.client.post(`/users/${fakeId}/assign-course`, { courseId: course2Id });
    return { pass: a.status === 400 && b.status === 400 && c.status === 404, actual: `${a.status} / ${b.status} / ${c.status}` };
  });
  await t('USR-09', 'Assign course to non-existent course id', { req: 'Course must exist', steps: 'assign-course courseId=random ObjectId', expected: '404 (course not found)' }, async () => {
    const r = await teacher.client.post(`/users/${newUserId}/assign-course`, { courseId: fakeId });
    return { pass: r.status === 404, actual: h.short(r).slice(0, 150), severity: 'Medium' };
  });
  await t('USR-10', 'Password hashes never returned by /users endpoints', { req: 'No credential leakage', steps: 'GET /users (all), POST, PUT, assign-course responses scanned for "password" / "$2b$"', expected: 'No password/hash in any response', type: 'security' }, async () => {
    const all = await teacher.client.get('/users');
    const p = await teacher.client.put('/users/' + newUserId, { fullName: 'Scan' });
    const a = await teacher.client.post(`/users/${newUserId}/assign-course`, { courseId: '' });
    const leak = [all, p, a].filter(r => /"password"|\$2[aby]\$/.test(r.text));
    return { pass: leak.length === 0, actual: `list ${all.status} (${all.body?.data?.length} users); leaks in ${leak.length} responses`, severity: 'Critical' };
  });
  await t('USR-11', 'Users: anonymous can list all users (PII exposure)', { req: 'User directory requires admin/school auth', steps: 'Fresh client GET /users', expected: '401/403', type: 'security', severity: 'Critical' }, async () => {
    const r = await new h.Client().get('/users');
    return { pass: [401, 403].includes(r.status), actual: `${r.status} users=${r.body?.data?.length} sampleKeys=${Object.keys(r.body?.data?.[0] || {}).join(',')}` };
  });
  await t('USR-12', 'Users: student can create an admin account (privilege escalation)', { req: 'Only admins create users / grant admin', steps: 'Student s0 POST /users {type:"admin"}; login as it', expected: '401/403; no admin created', type: 'security', severity: 'Critical' }, async () => {
    const un = `${P}-evil-${h.uid()}`;
    const r = await s[0].client.post('/users', { username: un, email: un + "@systest-example.com", password: 'Passw0rd!', type: 'admin' });
    const l = await new h.Client().post('/auth/login', { username: un, password: 'Passw0rd!' });
    return { pass: [401, 403].includes(r.status), actual: `create ${r.status} type=${r.body?.data?.type}; login ${l.status} role=${l.body?.user?.role}` };
  });
  await t('USR-13', 'Users: student can modify another user (reset password / elevate to admin)', { req: 'Non-admin cannot modify other users', steps: 'Student s0 PUT /users/<teacher2 id> {password,type:"admin"}; login teacher2 with new pw', expected: '401/403; teacher2 unchanged', type: 'security', severity: 'Critical' }, async () => {
    const t2 = await users.findOne({ username: teacher2.username });
    const r = await s[0].client.put('/users/' + t2._id, { password: 'Hijacked1!', type: 'admin' });
    const l = await new h.Client().post('/auth/login', { username: teacher2.username, password: 'Hijacked1!' });
    const after = await users.findOne({ _id: t2._id });
    return { pass: [401, 403].includes(r.status) && l.status !== 200, actual: `PUT ${r.status}; login with hijacked pw ${l.status}; teacher2 type now ${after.type}` };
  });
  await t('USR-14', 'Users: anonymous can delete any user', { req: 'Non-admin cannot delete users', steps: 'Fresh client DELETE /users/<newUserId>; DB check', expected: '401/403; user still exists', type: 'security', severity: 'Critical' }, async () => {
    const r = await new h.Client().del('/users/' + newUserId);
    const doc = await users.findOne({ _id: new ObjectId(newUserId) });
    return { pass: [401, 403].includes(r.status) && !!doc, actual: `${h.short(r)} | user ${doc ? 'exists' : 'DELETED'}` };
  });
  await t('USR-15', 'Delete user (happy path) and not-found', { req: 'Admin deletes user', steps: 'DELETE /users/:id (fresh user); DB; DELETE again; DELETE /users/x', expected: '200 gone; 404; 400' }, async () => {
    const un = `${P}-del-${h.uid()}`;
    const c = await teacher.client.post('/users', { username: un, email: un + "@systest-example.com", password: 'Passw0rd!', type: 'student' });
    const id = c.body?.data?.id;
    const a = await teacher.client.del('/users/' + id);
    const doc = await users.findOne({ _id: new ObjectId(id) });
    const b = await teacher.client.del('/users/' + id);
    const x = await teacher.client.del('/users/x');
    return { pass: a.status === 200 && !doc && b.status === 404 && x.status === 400, actual: `${a.status} db=${doc ? 'exists' : 'gone'} / ${b.status} / ${x.status}` };
  });

  // =====================================================================
  // NOTIFICATIONS
  // =====================================================================
  let notifId, tNotifId;
  await t('NTF-01', 'Create student notification (authenticated)', { req: 'Notifications can be created', steps: 'teacher POST /notifications {recipientType:student,studentId:s0,title,message}', expected: '201; read false; stored' }, async () => {
    const r = await teacher.client.post('/notifications', { recipientType: 'student', studentId: s[0].username, title: P + ' hello', message: 'msg', important: false, metadata: { k: P } });
    notifId = r.body?.data?.id;
    const doc = notifId ? await db.collection('notifications').findOne({ _id: new ObjectId(notifId) }) : null;
    return { pass: r.status === 201 && doc?.read === false && doc.studentId === s[0].username, actual: h.short(r).slice(0, 150) };
  });
  await t('NTF-02', 'Create notification validation', { req: 'Validation', steps: 'POST {}; recipientType student without studentId; recipientType=admin', expected: '400 each' }, async () => {
    const rs = [await teacher.client.post('/notifications', {}), await teacher.client.post('/notifications', { recipientType: 'student', title: 'a', message: 'b' }), await teacher.client.post('/notifications', { recipientType: 'admin', title: 'a', message: 'b' })];
    return { pass: rs.every(r => r.status === 400), actual: rs.map(r => r.status).join(' / ') };
  });
  await t('NTF-03', 'Create notification requires session', { req: 'Protected endpoint', steps: 'Fresh client POST', expected: '401' }, async () => {
    const r = await new h.Client().post('/notifications', { recipientType: 'student', studentId: s[0].username, title: 'a', message: 'b' });
    return { pass: r.status === 401, actual: h.short(r) };
  });
  await t('NTF-04', 'Get student notifications (+ read filter)', { req: 'Student inbox', steps: 'GET /notifications/student/:username; ?read=true', expected: '200, includes notif; read=true list excludes it' }, async () => {
    const a = await s[0].client.get('/notifications/student/' + encodeURIComponent(s[0].username));
    const b = await s[0].client.get('/notifications/student/' + encodeURIComponent(s[0].username) + '?read=true');
    return { pass: a.status === 200 && a.body.data.some(n => n.id === notifId) && b.status === 200 && !b.body.data.some(n => n.id === notifId), actual: `${a.status} n=${a.body?.data?.length} / read=true n=${b.body?.data?.length}` };
  });
  await t('NTF-05', 'Get teacher notifications', { req: 'Teacher inbox', steps: 'Create teacher notif; GET /notifications/teacher/:username', expected: '200 includes it' }, async () => {
    const c = await s[0].client.post('/notifications', { recipientType: 'teacher', teacherId: teacher.username, title: P + ' t', message: 'm' });
    tNotifId = c.body?.data?.id;
    const r = await teacher.client.get('/notifications/teacher/' + encodeURIComponent(teacher.username));
    return { pass: c.status === 201 && r.status === 200 && r.body.data.some(n => n.id === tNotifId), actual: `create ${c.status}; list ${r.status} n=${r.body?.data?.length}` };
  });
  await t('NTF-06', 'GET /notifications?userName resolves user type', { req: 'Backward-compatible inbox', steps: 'GET ?userName=s0; ?userName=teacher; ?userName=unknown; no userName', expected: '200 (s0 notif) / 200 (teacher notif) / 404 / 400' }, async () => {
    const a = await s[0].client.get('/notifications?userName=' + encodeURIComponent(s[0].username));
    const b = await teacher.client.get('/notifications?userName=' + encodeURIComponent(teacher.username));
    const c = await teacher.client.get('/notifications?userName=nobody-' + P);
    const d = await teacher.client.get('/notifications');
    return { pass: a.body?.data?.some(n => n.id === notifId) && b.body?.data?.some(n => n.id === tNotifId) && c.status === 404 && d.status === 400, actual: `${a.status} / ${b.status} / ${c.status} / ${d.status}` };
  });
  await t('NTF-07', 'Mark notification read (owner)', { req: 'Recipient marks read', steps: 's0 PUT /notifications/:id/read; DB', expected: '200; read true, readAt set' }, async () => {
    const r = await s[0].client.put(`/notifications/${notifId}/read`);
    const doc = await db.collection('notifications').findOne({ _id: new ObjectId(notifId) });
    return { pass: r.status === 200 && doc.read === true && !!doc.readAt, actual: `${r.status} read=${doc.read}` };
  });
  await t('NTF-08', 'Toggle important (owner) twice', { req: 'Star/unstar', steps: 's0 PUT /:id/important x2', expected: 'true then false; persisted' }, async () => {
    const a = await s[0].client.put(`/notifications/${notifId}/important`);
    const b = await s[0].client.put(`/notifications/${notifId}/important`);
    const doc = await db.collection('notifications').findOne({ _id: new ObjectId(notifId) });
    return { pass: a.body?.data?.important === true && b.body?.data?.important === false && doc.important === false, actual: `${a.status}:${a.body?.data?.important} / ${b.status}:${b.body?.data?.important}` };
  });
  await t('NTF-09', 'Mark read / important: invalid id, unknown id', { req: 'Validation', steps: 'PUT /x/read; PUT /<24 non-hex chars>/read; PUT /:random/important', expected: '400 / 400 / 404' }, async () => {
    const a = await s[0].client.put(`/notifications/x/read`);
    const b = await s[0].client.put(`/notifications/zzzzzzzzzzzzzzzzzzzzzzzz/read`);
    const c = await s[0].client.put(`/notifications/${fakeId}/important`);
    return { pass: a.status === 400 && b.status === 400 && c.status === 404, actual: `${a.status} / ${b.status} / ${c.status}` };
  });
  await t('NTF-10', 'Notifications: other user cannot mark read; anonymous cannot write', { req: 'Ownership enforced on writes', steps: 's1 PUT s0 notif /important; anon PUT /read', expected: '403 / 401', type: 'security' }, async () => {
    const a = await s[1].client.put(`/notifications/${notifId}/important`);
    const b = await new h.Client().put(`/notifications/${notifId}/read`);
    return { pass: a.status === 403 && b.status === 401, actual: `${a.status} / ${b.status}` };
  });
  await t('NTF-11', 'Notifications: anonymous / other user can read someone else\'s inbox', { req: 'Inbox readable only by its owner', steps: 'Fresh client GET /notifications/student/<s0>; s1 GET /notifications?userName=<teacher>', expected: '401/403', type: 'security', severity: 'High' }, async () => {
    const a = await new h.Client().get('/notifications/student/' + encodeURIComponent(s[0].username));
    const b = await s[1].client.get('/notifications?userName=' + encodeURIComponent(teacher.username));
    return { pass: [401, 403].includes(a.status) && [401, 403].includes(b.status), actual: `anon GET s0 inbox ${a.status} (n=${a.body?.data?.length}); s1 GET teacher inbox ${b.status} (n=${b.body?.data?.length})` };
  });
  await t('NTF-12', 'Notifications: any logged-in user can send arbitrary notifications to anyone', { req: 'Only teachers/system may create notifications for others', steps: 'Student s1 POST notification to student s0 with phishing link', expected: '403', type: 'security', severity: 'Medium' }, async () => {
    const r = await s[1].client.post('/notifications', { recipientType: 'student', studentId: s[0].username, title: 'Reset your password', message: 'click', link: 'https://evil.example' });
    return { pass: r.status === 403, actual: h.short(r).slice(0, 150) };
  });

  // ---------- cleanup (own prefix only) ----------
  try {
    const gids = (await db.collection('student_groups').find({ courseId: { $in: [new ObjectId(courseId), new ObjectId(course2Id)] } }).toArray()).map(g => g._id);
    await db.collection('planning_poker_tasks').deleteMany({ groupId: { $in: gids } });
    await db.collection('swot_analyses').deleteMany({ groupId: { $in: gids } });
    await db.collection('student_groups').deleteMany({ _id: { $in: gids } });
    await db.collection('notifications').deleteMany({ title: { $regex: '^(' + P + '|Reset your password$)' }, $or: [{ studentId: { $regex: '^' + P } }, { teacherId: { $regex: '^' + P } }] });
  } catch (e) { console.error('cleanup', e.message); }
  await mc.close();
});
