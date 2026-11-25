const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { suite } = require('../lib');

const idOf = (r) => r?.body?.data?.id || r?.body?.data?._id;

function zipStore(name, data) {
  const nameBuf = Buffer.from(name);
  const body = Buffer.from(data);
  const crc = zlib.crc32(body);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const localPart = Buffer.concat([local, nameBuf, body]);
  const centralPart = Buffer.concat([central, nameBuf]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, eocd]);
}

suite('BE-EXERCISE', async (t, h) => {
  const P = 'ex-' + h.uid();
  const teacher = await h.makeUser('teacher', P);
  const student = await h.makeUser('student', P + 's');
  const T = teacher.client;
  const S = student.client;
  const studentId = student.user.username;

  const course = await T.post('/courses', { name: `${P} course`, academicYear: '2027', university: 'Systest U', teacherIds: [teacher.user.username] });
  const courseId = idOf(course);
  if (!courseId) throw new Error('course create failed ' + h.short(course));
  const project = await T.post('/projects', { projectTitle: `${P} project`, courseId, learningOutcome: 'Submit the repository', teacherId: teacher.user.username });
  const projectId = idOf(project);
  if (!projectId) throw new Error('project create failed ' + h.short(project));
  const mkTask = async (title) => {
    const r = await T.post('/assessment-tasks', {
      projectId,
      taskTitle: title,
      description: 'Hand in the exercise',
      keyword: title,
      submissionDeadline: new Date(Date.now() + 7 * 864e5).toISOString(),
      evaluationCriteria: 'The code is present',
      status: 'published',
    });
    const id = idOf(r);
    if (!id) throw new Error('task create failed ' + h.short(r));
    return id;
  };
  const githubTask = await mkTask(`${P} exercise github`);
  const zipTask = await mkTask(`${P} exercise zip`);
  const repo = 'https://github.com/octocat/Hello-World';

  await t('EX-01', 'Student submits an exercise with a GitHub link', {
    req: 'A student can hand in an exercise as a GitHub repository link',
    steps: 'POST /assessment-submissions with repoUrl and no essay text; GET the submission; teacher lists the task',
    expected: '201; repoUrl stored; submission text is the link; teacher list includes it',
  }, async () => {
    const r = await S.post('/assessment-submissions', {
      taskId: githubTask,
      studentId,
      studentName: student.user.fullName || studentId,
      repoUrl: repo,
    });
    const id = idOf(r);
    const g = id ? await S.get('/assessment-submissions/' + id) : null;
    const list = await T.get('/assessment-submissions/task/' + githubTask);
    const row = (list.body?.data || []).find((item) => item.id === id);
    const ok = r.status === 201 && g?.status === 200 && g.body.data.repoUrl === repo && g.body.data.submission === repo && g.body.data.codebase === null && row?.repoUrl === repo;
    return { pass: !!ok, actual: `create ${h.short(r).slice(0, 160)} | get ${g?.status} repo=${g?.body?.data?.repoUrl} | list ${list.status}` };
  });

  await t('EX-02', 'Student submits an exercise as a zip under 10 MB', {
    req: 'A student can upload a codebase smaller than 10 MB and attach it to an exercise',
    steps: 'POST /assessment/upload with a small .zip; POST the submission with that codebase; GET the file',
    expected: 'upload 200; submission 201 with fileId and fileSize; file downloads',
  }, async () => {
    const zip = zipStore('src/app.js', 'console.log("exercise")\n');
    const fd = new FormData();
    fd.append('file', new Blob([zip], { type: 'application/zip' }), `${P}-code.zip`);
    const up = await S.post('/assessment/upload', fd);
    const file = up.body?.data;
    const r = await S.post('/assessment-submissions', {
      taskId: zipTask,
      studentId,
      studentName: student.user.fullName || studentId,
      submission: 'Codebase for exercise 2',
      codebase: file,
    });
    const id = idOf(r);
    const g = id ? await S.get('/assessment-submissions/' + id) : null;
    const stored = g?.body?.data?.codebase;
    const dl = stored?.fileUrl ? await fetch(stored.fileUrl).catch(() => null) : null;
    const ok = up.status === 200 && zip.length < 10 * 1024 * 1024 && r.status === 201 && stored?.fileName === `${P}-code.zip` && stored.fileSize === zip.length && dl?.status === 200;
    return { pass: !!ok, actual: `upload ${up.status} size=${file?.fileSize} | create ${r.status} stored=${stored?.fileSize} | GET ${dl?.status}` };
  });

  await t('EX-03', 'A non-GitHub link and a loose source file are rejected', {
    req: 'Only a github.com repository link or a .zip codebase is accepted',
    steps: 'POST repoUrl=https://example.com/repo; POST upload app.js',
    expected: '400 for the link; 400 for the .js upload',
  }, async () => {
    const link = await S.post('/assessment-submissions', {
      taskId: githubTask,
      studentId,
      studentName: studentId,
      repoUrl: 'https://example.com/not-github',
    });
    const fd = new FormData();
    fd.append('file', new Blob(['console.log(1)'], { type: 'text/javascript' }), `${P}-app.js`);
    const js = await S.post('/assessment/upload', fd);
    return { pass: link.status === 400 && /github/.test(link.text) && (js.status === 400 || js.status === 415), actual: `link ${link.status} ${link.text.slice(0, 120)} | js ${js.status}` };
  });

  await t('EX-04', 'A codebase over 10 MB is rejected', {
    req: 'Codebase uploads stay under 10 MB',
    steps: 'POST /assessment/upload with an 11 MB .zip',
    expected: '413 or 400; the file is not stored',
  }, async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 65);
    const fd = new FormData();
    fd.append('file', new Blob([big], { type: 'application/zip' }), `${P}-big.zip`);
    const r = await S.post('/assessment/upload', fd, { timeout: 60000 });
    const dir = path.join(__dirname, '../../uploads/assessment');
    const left = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.startsWith(`${P}-big`)) : [];
    return { pass: (r.status === 413 || r.status === 400) && left.length === 0, actual: `${r.status} ${r.text.slice(0, 120)} leftover=${left.length}` };
  });

  await t('EX-05', 'The student has both exercises on their list', {
    req: 'Submitted exercises stay on the student',
    steps: 'GET /assessment-submissions/student/:id',
    expected: '200; one GitHub submission and one zip submission',
  }, async () => {
    const r = await S.get('/assessment-submissions/student/' + encodeURIComponent(studentId));
    const rows = r.body?.data || [];
    const github = rows.find((row) => row.repoUrl === repo);
    const zip = rows.find((row) => row.codebase && row.codebase.fileName === `${P}-code.zip`);
    return { pass: r.status === 200 && !!github && !!zip && rows.length >= 2, actual: `${r.status} n=${rows.length} github=${!!github} zip=${!!zip}` };
  });
});
