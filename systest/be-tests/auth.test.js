const { suite } = require('../lib');
const { MongoClient } = require('mongodb');

suite('BE-AUTH', async (t, h) => {
  const c = new h.Client();
  const email = `auth-${h.uid()}@systest.local`;
  const pw = 'Passw0rd!';

  await t('AUTH-01', 'Register new teacher account', { req: 'Users can register with name, email, password', steps: 'POST /auth/register valid body', expected: '201, user returned with role teacher, session cookie set' }, async () => {
    const r = await c.post('/auth/register', { name: 'Auth Tester', email, password: pw });
    return { pass: r.status === 201 && r.body?.user?.role === 'teacher' && !!c.cookie, actual: h.short(r) };
  });
  await t('AUTH-02', 'Reject duplicate email registration', { req: 'Email must be unique', steps: 'Register same email twice', expected: '409' }, async () => {
    const r = await new h.Client().post('/auth/register', { name: 'Dup', email, password: pw });
    return { pass: r.status === 409, actual: h.short(r) };
  });
  await t('AUTH-03', 'Reject duplicate email with different case', { req: 'Email uniqueness is case-insensitive', steps: 'Register EMAIL in upper case', expected: '409' }, async () => {
    const r = await new h.Client().post('/auth/register', { name: 'Dup', email: email.toUpperCase(), password: pw });
    return { pass: r.status === 409, actual: h.short(r) };
  });
  await t('AUTH-04', 'Reject invalid email format', { req: 'Email format validated', steps: 'Register email "not-an-email"', expected: '400' }, async () => {
    const r = await new h.Client().post('/auth/register', { name: 'X', email: 'not-an-email', password: pw });
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('AUTH-05', 'Reject password shorter than 6 chars', { req: 'Minimum password length 6', steps: 'Register with "12345"', expected: '400' }, async () => {
    const r = await new h.Client().post('/auth/register', { name: 'X', email: `s-${h.uid()}@systest.local`, password: '12345' });
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('AUTH-06', 'Reject missing required fields', { req: 'Name, email, password required', steps: 'Register with {}', expected: '400' }, async () => {
    const r = await new h.Client().post('/auth/register', {});
    return { pass: r.status === 400, actual: h.short(r) };
  });
  await t('AUTH-07', 'Reject invalid user type (e.g. admin)', { req: 'Only teacher/student/school types allowed', steps: 'Register type=admin', expected: '400', type: 'security' }, async () => {
    const r = await new h.Client().post('/auth/register', { name: 'X', email: `a-${h.uid()}@systest.local`, password: pw, type: 'admin' });
    return { pass: r.status === 400, actual: h.short(r) };
  });
  const login = new h.Client();
  await t('AUTH-08', 'Login with valid credentials', { req: 'Users log in with username/email + password', steps: 'POST /auth/login', expected: '200, sessionId, cookie' }, async () => {
    const r = await login.post('/auth/login', { username: email, password: pw });
    return { pass: r.status === 200 && r.body?.success && !!login.cookie, actual: h.short(r) };
  });
  await t('AUTH-09', 'Login is case-insensitive on username', { req: 'Login by email regardless of case', steps: 'Login with upper-case email', expected: '200' }, async () => {
    const r = await new h.Client().post('/auth/login', { username: email.toUpperCase(), password: pw });
    return { pass: r.status === 200, actual: h.short(r) };
  });
  await t('AUTH-10', 'Reject wrong password', { req: 'Invalid credentials rejected', steps: 'Login with wrong password', expected: '401 generic message' }, async () => {
    const r = await new h.Client().post('/auth/login', { username: email, password: 'wrong-pass' });
    return { pass: r.status === 401 && /Invalid username or password/.test(r.text), actual: h.short(r) };
  });
  await t('AUTH-11', 'Unknown user gets same error as wrong password', { req: 'No user enumeration on login', steps: 'Login unknown user', expected: '401 identical message', type: 'security' }, async () => {
    const r = await new h.Client().post('/auth/login', { username: 'nobody-' + h.uid(), password: 'x' });
    return { pass: r.status === 401 && /Invalid username or password/.test(r.text), actual: h.short(r) };
  });
  await t('AUTH-12', 'GET /auth/me returns logged-in user', { req: 'Current user endpoint', steps: 'Login then GET /auth/me', expected: 'success true with user id' }, async () => {
    const r = await login.get('/auth/me');
    return { pass: r.status === 200 && r.body?.success === true && !!r.body?.user?.id, actual: h.short(r) };
  });
  await t('AUTH-13', 'GET /auth/me without session returns no user', { req: 'Anonymous has no user', steps: 'GET /auth/me fresh client', expected: 'success false / user null' }, async () => {
    const r = await new h.Client().get('/auth/me');
    return { pass: r.body?.success === false || r.status === 401, actual: h.short(r) };
  });
  await t('AUTH-14', 'Change password (authenticated)', { req: 'Users can change password', steps: 'POST /auth/change-password with current+new', expected: '200, new password works' }, async () => {
    const r = await login.post('/auth/change-password', { currentPassword: pw, newPassword: 'NewPassw0rd!', confirmPassword: 'NewPassw0rd!' });
    const l = await new h.Client().post('/auth/login', { username: email, password: 'NewPassw0rd!' });
    return { pass: r.status === 200 && l.status === 200, actual: `change: ${h.short(r)} | relogin: ${l.status}` };
  });
  await t('AUTH-15', 'Change password requires authentication', { req: 'Protected endpoint', steps: 'POST /auth/change-password anonymously', expected: '401', type: 'security' }, async () => {
    const r = await new h.Client().post('/auth/change-password', { currentPassword: 'x', newPassword: 'yyyyyy' });
    return { pass: r.status === 401, actual: h.short(r) };
  });
  await t('AUTH-17', 'Registration date for logged-in user', { req: 'Registration date endpoint (session-based)', steps: 'Login, GET /auth/registration-date', expected: '200 with registrationDate' }, async () => {
    const r = await login.get('/auth/registration-date');
    return { pass: r.status === 200 && !!r.body?.data?.registrationDate, actual: h.short(r) };
  });
  await t('AUTH-16', 'Logout destroys session', { req: 'Logout ends session', steps: 'GET /auth/logout then /auth/me', expected: 'me returns no user' }, async () => {
    const r = await login.get('/auth/logout');
    const me = await login.get('/auth/me');
    return { pass: [200, 302].includes(r.status) && me.body?.success !== true, actual: `logout ${r.status}; me after: ${h.short(me)}` };
  });
  await t('AUTH-18', 'Login rejects non-string username (NoSQL injection)', { req: 'Input type validation', steps: 'Login with username={"$ne":null}', expected: '400 (not 500, not success)', type: 'security' }, async () => {
    const r = await new h.Client().post('/auth/login', { username: { $ne: null }, password: { $ne: null } });
    return { pass: r.status === 400 || r.status === 401, actual: h.short(r), severity: r.status === 200 ? 'Critical' : 'Low' };
  });
  // Legacy plaintext-password users (as created by scripts/seed-users.js)
  const mc = await MongoClient.connect('mongodb://127.0.0.1:27017/?replicaSet=rs0');
  const legacy = 'legacy-' + h.uid();
  await mc.db('ai4edu_database').collection('ai4edu_user').insertOne({ username: legacy, password: 'usn2025', type: 'teacher', remark: 'testing', date_created: new Date() });
  await t('AUTH-19', 'Seeded (plaintext-password) users can log in', { req: 'scripts/seed-users.js creates usable accounts', steps: 'Insert user as seed script does, login', expected: '200 – code comment says plaintext passwords are supported for backward compatibility', type: 'security' }, async () => {
    const r = await new h.Client().post('/auth/login', { username: legacy, password: 'usn2025' });
    return { pass: r.status === 200, actual: h.short(r) };
  });
  const stored = await mc.db('ai4edu_database').collection('ai4edu_user').findOne({ username: email.toLowerCase() });
  await t('AUTH-20', 'Passwords stored hashed (bcrypt)', { req: 'Passwords never stored in plaintext', steps: 'Inspect stored user after register', expected: 'password starts with $2', type: 'security' }, async () => {
    return { pass: /^\$2[aby]\$/.test(stored?.password || ''), actual: `stored prefix: ${(stored?.password || 'none').slice(0, 4)}…` };
  });
  await mc.close();
  await t('AUTH-21', 'OAuth Google redirect initiates', { req: 'Social login (Google)', steps: 'GET /auth/google', expected: '302 to accounts.google.com' }, async () => {
    const r = await new h.Client().get('/auth/google');
    const loc = r.headers?.get('location') || '';
    return { pass: r.status === 302 && loc.includes('accounts.google.com'), actual: `${r.status} -> ${loc.slice(0, 80)}` };
  });
  await t('AUTH-22', 'OAuth Facebook redirect initiates', { req: 'Social login (Facebook)', steps: 'GET /auth/facebook', expected: '302 to facebook.com' }, async () => {
    const r = await new h.Client().get('/auth/facebook');
    const loc = r.headers?.get('location') || '';
    return { pass: r.status === 302 && loc.includes('facebook.com'), actual: `${r.status} -> ${loc.slice(0, 80)}` };
  });
});
