const mongoose = require('mongoose');
const Course = require('../src/models/Course');
const Task = require('../src/models/Task');
const Submission = require('../src/models/Submission');
const {
  deriveTaskStatus,
  endOfOsloDay,
  decisionFields,
  buildGroupTaskStatuses,
  courseConfigSchema,
} = require('../src/utils/course2027');

const projectId = new mongoose.Types.ObjectId();
const taskId = new mongoose.Types.ObjectId();

describe('2027 course fields stay off existing documents', () => {
  test('a 2026 course, task, and submission still validate', () => {
    const course = new Course({ name: 'Existing', teacherIds: ['teacher@usn.no'] });
    const task = new Task({
      projectId,
      description: 'Write an essay',
      keyword: 'essay',
      submissionDeadline: new Date('2026-03-01T22:59:00.000Z'),
    });
    const submission = new Submission({
      taskId,
      studentId: 'student@usn.no',
      studentName: 'Student',
      submission: 'My essay',
    });

    expect(course.validateSync()).toBeUndefined();
    expect(task.validateSync()).toBeUndefined();
    expect(submission.validateSync()).toBeUndefined();
    expect(course.config).toBeUndefined();
    expect(task.why).toBeUndefined();
    expect(task.tool).toBeUndefined();
    expect(task.revisedDeadline).toBeUndefined();
    expect(submission.decisionStatus).toBeUndefined();
    expect(submission.score).toBeUndefined();
    expect(submission.reflection).toBeUndefined();
  });

  test('new paths have no default, so a later save does not fill them in', () => {
    expect(Course.schema.path('config').options.default).toBeUndefined();
    expect(Task.schema.path('why').options.default).toBeUndefined();
    expect(Task.schema.path('order').options.default).toBeUndefined();
    expect(Task.schema.path('tool').options.default).toBeUndefined();
    expect(Task.schema.path('revisedDeadline').options.default).toBeUndefined();
    expect(Submission.schema.path('decisionStatus').options.default).toBeUndefined();
    expect(Submission.schema.path('score').options.default).toBeUndefined();
    expect(Submission.schema.path('reflection').options.default).toBeUndefined();
    expect(Task.schema.path('why').isRequired).toBe(false);
    expect(Submission.schema.path('decisionStatus').isRequired).toBe(false);
    expect(Submission.schema.path('decisionStatus').enumValues).toEqual(['waiting', 'approved', 'returned']);
  });
});

describe('late rule in Europe/Oslo', () => {
  const deadline = '2027-02-12T22:59:00.000Z';
  const summerDeadline = '2027-04-09T21:59:00.000Z';

  test('end of 12 Feb 2027 is still that evening in Oslo (CET)', () => {
    const end = endOfOsloDay(new Date(deadline));
    expect(end.toISOString()).toBe('2027-02-12T22:59:59.999Z');
  });

  test('end of 9 Apr 2027 is 23:59 Oslo (CEST)', () => {
    const end = endOfOsloDay(new Date(summerDeadline));
    expect(end.toISOString()).toBe('2027-04-09T21:59:59.999Z');
  });

  test('a deadline today is open until the Oslo day ends', () => {
    expect(deriveTaskStatus(
      { submittedAt: null, deadline },
      new Date('2027-02-12T22:30:00.000Z')
    )).toBe('open');
  });

  test('the same task is late the next Oslo morning', () => {
    expect(deriveTaskStatus(
      { submittedAt: null, deadline },
      new Date('2027-02-12T23:30:00.000Z')
    )).toBe('late');
  });

  test('a summer deadline follows daylight saving time', () => {
    expect(deriveTaskStatus(
      { submittedAt: null, deadline: summerDeadline },
      new Date('2027-04-09T21:30:00.000Z')
    )).toBe('open');
    expect(deriveTaskStatus(
      { submittedAt: null, deadline: summerDeadline },
      new Date('2027-04-09T22:30:00.000Z')
    )).toBe('late');
  });

  test('a revised deadline is the day that counts', () => {
    expect(deriveTaskStatus({
      submittedAt: null,
      deadline,
      revisedDeadline: '2027-02-20T22:59:00.000Z',
    }, new Date('2027-02-13T12:00:00.000Z'))).toBe('open');
  });

  test('a handed-in task is never late', () => {
    const submittedAt = '2027-02-20T10:00:00.000Z';
    expect(deriveTaskStatus(
      { submittedAt, deadline, approval: null },
      new Date('2027-02-21T12:00:00.000Z')
    )).toBe('submitted');
    expect(deriveTaskStatus(
      { submittedAt, deadline, approval: 'approved' },
      new Date('2027-02-21T12:00:00.000Z')
    )).toBe('approved');
    expect(deriveTaskStatus(
      { submittedAt, deadline, approval: 'returned' },
      new Date('2027-02-21T12:00:00.000Z')
    )).toBe('returned');
  });
});

describe('teacher queue', () => {
  test('an ungraded submission is waiting and nothing is stored to say so', () => {
    const view = decisionFields({
      datetime: '2027-03-01T10:00:00.000Z',
      feedbackHistory: [],
      starScoreHistory: [],
    }, new Date('2027-03-04T10:00:00.000Z'));
    expect(view.decision.status).toBe('waiting');
    expect(view.decision.daysWaiting).toBe(3);
    expect(view.decision.score).toBeNull();
  });

  test('a 2026 submission that already has a score is not relabelled', () => {
    const view = decisionFields({
      datetime: '2026-02-01T10:00:00.000Z',
      feedbackHistory: [{ taskQualityScore: 4, reflectionScore: 3, reflection: 'solid' }],
      starScoreHistory: [],
    });
    expect(view.decision.status).toBeNull();
    expect(view.decision.daysWaiting).toBeNull();
    expect(view.decision.score).toBeNull();
  });

  test('a stored decision wins over the feedback history', () => {
    const view = decisionFields({
      datetime: '2027-03-01T10:00:00.000Z',
      decisionStatus: 'approved',
      score: 5,
      reflection: 4,
      decidedAt: '2027-03-02T10:00:00.000Z',
      decidedBy: 'ta@usn.no',
      feedbackHistory: [{ taskQualityScore: 5, reflectionScore: 4 }],
    });
    expect(view.decision).toMatchObject({
      status: 'approved',
      score: 5,
      reflection: 4,
      daysWaiting: 0,
      decidedBy: 'ta@usn.no',
    });
  });
});

describe('group task status', () => {
  test('returns why, tool, revised deadline, and does not mark a submitted task late', () => {
    const id = new mongoose.Types.ObjectId();
    const tasks = [{
      _id: id,
      order: '1.1',
      why: 'The interview feeds the stories.',
      tool: 're-studio',
      submissionDeadline: new Date('2027-02-12T22:59:00.000Z'),
      revisedDeadline: null,
      status: 'published',
    }];
    const submissions = [{
      taskId: id,
      studentId: 'group01@tdt4242.ntnu.no',
      datetime: new Date('2027-02-20T18:00:00.000Z'),
    }];
    const [row] = buildGroupTaskStatuses(tasks, submissions, [], new Date('2027-02-21T12:00:00.000Z'));
    expect(row).toMatchObject({
      order: '1.1',
      why: 'The interview feeds the stories.',
      tool: 're-studio',
      status: 'submitted',
      inProgress: false,
      daysWaiting: 0,
    });
    expect(row.daysWaiting).toBe(0);
  });

  test('started work with no submission is in progress, and late once the day has ended', () => {
    const id = new mongoose.Types.ObjectId();
    const tasks = [{
      _id: id,
      submissionDeadline: new Date('2027-02-12T22:59:00.000Z'),
      status: 'published',
    }];
    const open = buildGroupTaskStatuses(
      tasks,
      [],
      [{ taskId: id }],
      new Date('2027-02-12T12:00:00.000Z')
    )[0];
    const late = buildGroupTaskStatuses(
      tasks,
      [],
      [{ taskId: id }],
      new Date('2027-02-13T08:00:00.000Z')
    )[0];
    expect(open.status).toBe('open');
    expect(open.inProgress).toBe(true);
    expect(late.status).toBe('late');
    expect(late.inProgress).toBe(true);
  });
});

describe('course config', () => {
  test('accepts the 2027 home config and rejects a partial one', () => {
    const config = {
      id: 'tdt4242-2027',
      title: 'Advanced Software Engineering (2027)',
      language: 'en',
      structure: {
        kind: 'exercises',
        groups: [{ id: 'exercise-1', title: 'Exercise 1', taskIds: ['1.1'] }],
      },
      tools: ['re-studio'],
      personas: ['Kari'],
      grading: 'approve',
      about: ['One product through the semester.'],
    };
    expect(courseConfigSchema.validate(config).error).toBeUndefined();
    expect(courseConfigSchema.validate({ id: 'tdt4242-2027' }).error).toBeDefined();
  });
});
