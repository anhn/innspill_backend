jest.mock('../src/models/ToolEvent', () => ({ create: jest.fn(() => Promise.resolve()), insertMany: jest.fn(() => Promise.resolve()), find: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn() }));
jest.mock('../src/models/Task', () => ({ findById: jest.fn(() => ({ select: () => ({ lean: () => Promise.resolve({ projectId: 'p1', order: '2.2' }) }) })) }));
jest.mock('../src/models/Project', () => ({ findById: jest.fn(() => ({ select: () => ({ lean: () => Promise.resolve({ courseId: 'c1' }) }) })) }));
jest.mock('../src/models/Course', () => ({ findById: jest.fn(() => ({ lean: () => Promise.resolve({ teacherIds: ['teacher-a'] }) })) }));
const express = require('express');
const request = require('supertest');
const ToolEvent = require('../src/models/ToolEvent');
const { capData, trackRoute } = require('../src/utils/activity');
const routes = require('../src/routes/activity');
const { _counters } = require('../src/middleware/aiLimits');

const app = (user) => {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => { req.session = user ? { userId: 'u1', username: user.name, userRole: user.role } : {}; next(); });
  a.use('/activity', routes);
  return a;
};
const flush = () => new Promise((r) => setImmediate(() => setImmediate(r)));

beforeEach(() => { jest.clearAllMocks(); _counters.clear(); });

test('capData drops secrets and caps long text', () => {
  const { data } = capData({ password: 'x', note: 'a'.repeat(30000), nested: { token: 't', ok: 1 } });
  expect(data.password).toBeUndefined();
  expect(data.nested).toEqual({ ok: 1 });
  expect(data.note.length).toBeLessThan(20100);
});

test('trackRoute logs only successful answers, with the user from the session', async () => {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => { req.session = { userId: 'u1', username: 'stud', userRole: 'student' }; next(); });
  a.post('/ok', trackRoute('hand-in', (req, body) => ({ taskId: '0123456789abcdef01234567', data: { id: body.id } })), (req, res) => res.status(201).json({ id: 'x1' }));
  a.post('/bad', trackRoute('hand-in'), (req, res) => res.status(409).json({ success: false }));
  await request(a).post('/ok').send({});
  await request(a).post('/bad').send({});
  await flush(); await flush();
  expect(ToolEvent.create).toHaveBeenCalledTimes(1);
  const doc = ToolEvent.create.mock.calls[0][0];
  expect(doc).toMatchObject({ username: 'stud', event: 'hand-in', course: 'c1', task: '2.2', source: 'server' });
  expect(doc.data.id).toBe('x1');
});

test('POST /activity stores client events for the session user, not the body', async () => {
  const res = await request(app({ name: 'stud', role: 'student' })).post('/activity').send({ events: [{ event: 'click', tool: 'review', data: { label: 'Run' }, username: 'someone-else' }] });
  expect(res.status).toBe(201);
  const docs = ToolEvent.insertMany.mock.calls[0][0];
  expect(docs[0]).toMatchObject({ username: 'stud', source: 'client', event: 'click', tool: 'review' });
});

test('POST /activity needs a login and a valid batch', async () => {
  expect((await request(app(null)).post('/activity').send({ events: [{ event: 'x' }] })).status).toBe(401);
  expect((await request(app({ name: 's', role: 'student' })).post('/activity').send({ events: [] })).status).toBe(400);
});

test('students cannot read the course log; teachers only their course', async () => {
  ToolEvent.find.mockReturnValue({ sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }) });
  ToolEvent.countDocuments.mockResolvedValue(0);
  expect((await request(app({ name: 's', role: 'student' })).get('/activity?course=0123456789abcdef01234567')).status).toBe(403);
  expect((await request(app({ name: 'teacher-a', role: 'teacher' })).get('/activity')).status).toBe(400);
  expect((await request(app({ name: 'teacher-a', role: 'teacher' })).get('/activity?course=0123456789abcdef01234567')).status).toBe(200);
  expect((await request(app({ name: 'teacher-b', role: 'teacher' })).get('/activity?course=0123456789abcdef01234567')).status).toBe(403);
});
