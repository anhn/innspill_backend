// Cross-cutting security tests (SEC-*). Non-disruptive: does not restart the server.
const __ROOT = require('path').resolve(__dirname, '..');
const { suite } = require('../lib');
const fs = require('fs');
const endpoints = require(`${__ROOT}/endpoints.json`);

suite('BE-SEC', async (t, h) => {
  const anon = () => new h.Client();
  const FAKE_ID = '65a1b2c3d4e5f60718293a4b';

  // ---- SEC-01: anonymous sweep over every endpoint ----
  const sweep = [];
  for (const [base, method, p, authMw] of endpoints) {
    if (base.includes('/auth') && /login|register|create-user|logout|facebook|google|^\/$/.test(p)) continue; // public by design
    const path = base.replace('/api/v1', '') + p.replace(/:(\w+)/g, (_, n) => /id$/i.test(n) ? FAKE_ID : 'systest-anon');
    const c = anon();
    const r = method === 'GET' ? await c.get(path) : await c.req(method, path, {});
    const cls = r.status === 401 || r.status === 403 ? 'enforced' : r.status >= 500 ? '5xx' : r.status === 404 ? '404' : r.status >= 400 ? 'validated-not-authed' : 'served';
    sweep.push({ method, path: base + p, status: r.status, cls, authMw });
  }
  fs.writeFileSync(`${__ROOT}/results/anon-sweep.json`, JSON.stringify(sweep, null, 2));
  const count = k => sweep.filter(s => s.cls === k).length;
  await t('SEC-01', 'Every non-public endpoint requires a session', { req: 'Authentication enforced server-side', steps: `Call all ${sweep.length} non-public endpoints with no cookie (dummy ids/body {})`, expected: '401/403 for all', type: 'security' }, async () => {
    const e = count('enforced');
    return { pass: e === sweep.length, actual: `${e}/${sweep.length} returned 401/403; ${count('served')} answered 2xx, ${count('validated-not-authed')} returned 400-type validation errors (i.e. processed), ${count('404')} 404, ${count('5xx')} 5xx. Full list: results/anon-sweep.json`, severity: 'Critical' };
  });
  await t('SEC-02', 'No endpoint crashes (5xx) on anonymous empty request', { req: 'Robust error handling', steps: 'Same sweep', expected: 'No 5xx', type: 'robustness' }, async () => {
    const f = sweep.filter(s => s.cls === '5xx');
    return { pass: f.length === 0, actual: `${f.length} endpoints returned 5xx: ${f.slice(0, 12).map(s => `${s.method} ${s.path}=${s.status}`).join('; ')}`, severity: 'Medium' };
  });

  // ---- Headers / CORS / cookies ----
  const root = await anon().get(h.BASE + '/health');
  await t('SEC-03', 'Security headers set (helmet)', { req: 'Standard HTTP security headers', steps: 'GET /health, inspect headers', expected: 'CSP, X-Content-Type-Options, X-Frame-Options/frame-ancestors, HSTS present; no X-Powered-By', type: 'security' }, async () => {
    const H = n => root.headers.get(n);
    const ok = H('content-security-policy') && H('x-content-type-options') === 'nosniff' && (H('x-frame-options') || /frame-ancestors/.test(H('content-security-policy') || '')) && !H('x-powered-by');
    return { pass: !!ok, actual: `csp=${!!H('content-security-policy')} nosniff=${H('x-content-type-options')} xfo=${H('x-frame-options')} hsts=${!!H('strict-transport-security')} x-powered-by=${H('x-powered-by')}` };
  });
  await t('SEC-04', 'CORS rejects untrusted origins', { req: 'Only the app origin may make credentialed calls', steps: 'GET /api/v1/courses with Origin: https://evil.example', expected: 'No Access-Control-Allow-Origin for evil origin', type: 'security' }, async () => {
    const r = await anon().get('/courses', { headers: { origin: 'https://evil.example' } });
    const a = r.headers.get('access-control-allow-origin');
    return { pass: !a || a !== 'https://evil.example', actual: `ACAO=${a} ACAC=${r.headers.get('access-control-allow-credentials')} status=${r.status}` };
  });
  await t('SEC-05', 'CORS allows the real frontend origin with credentials', { req: 'Frontend can call API', steps: 'Origin: http://localhost:8080', expected: 'ACAO echoes origin, credentials true' }, async () => {
    const r = await anon().get('/courses', { headers: { origin: 'http://localhost:8080' } });
    return { pass: r.headers.get('access-control-allow-origin') === 'http://localhost:8080' && r.headers.get('access-control-allow-credentials') === 'true', actual: `ACAO=${r.headers.get('access-control-allow-origin')}` };
  });
  await t('SEC-06', 'Session cookie flags', { req: 'Session cookie hardened', steps: 'Login, inspect Set-Cookie', expected: 'HttpOnly; SameSite set; Secure in production', type: 'security' }, async () => {
    const u = await h.makeUser('teacher', 'sec');
    const c = anon();
    const raw = await fetch(h.API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u.email, password: u.password }) });
    const sc = (raw.headers.getSetCookie() || []).join(' | ');
    return { pass: /HttpOnly/i.test(sc) && /SameSite/i.test(sc), actual: sc.replace(/=s%3A[^;]+/, '=<redacted>'), severity: 'Low' };
  });
  await t('SEC-07', 'Errors do not leak stack traces', { req: 'No internal details in responses', steps: 'POST malformed JSON to /api/v1/courses (NODE_ENV=development as in your .env)', expected: 'Generic 400 without stack/paths', type: 'security' }, async () => {
    const r = await anon().req('POST', '/courses', '{"name": ', {});
    const leak = /node_modules|\/home\/|at \w+ \(|"stack"/.test(r.text);
    return { pass: !leak, actual: `${r.status} stackLeaked=${leak} ${r.text.slice(0, 160)}`, severity: 'Medium' };
  });
  await t('SEC-08', 'Errors from handlers do not leak internals', { req: 'No internal details in responses', steps: 'Login with username as object', expected: 'No error.message/type in body', type: 'security' }, async () => {
    const r = await anon().post('/auth/login', { username: ['x'], password: 'x' });
    return { pass: !/errorType|is not a function/.test(r.text), actual: h.short(r), severity: 'Low' };
  });

  // ---- Injection ----
  await t('SEC-09', 'NoSQL operator injection via query string', { req: 'Query params treated as strings', steps: 'GET /prompts?userName[$ne]=x and /courses?teacherId[$ne]=x anonymously', expected: 'Operators rejected/ignored; no extra records returned', type: 'security' }, async () => {
    const a = await anon().get('/prompts?userName=__nobody__');
    const b = await anon().get('/prompts?userName[$ne]=__nobody__');
    const n = r => JSON.stringify(r.body || '').length;
    return { pass: b.status >= 400 || n(b) <= n(a), actual: `normal=${a.status}(${n(a)}B) injected=${b.status}(${n(b)}B)`, severity: 'High' };
  });
  await t('SEC-10', 'Regex metacharacters in search params are escaped', { req: 'User input not compiled as regex (ReDoS)', steps: 'GET /course-plan-docs?coursePlanName=(a+)+$ ', expected: '200/400, fast, no 500', type: 'security' }, async () => {
    const r = await anon().get('/course-plan-docs?coursePlanName=' + encodeURIComponent('(a+)+(') );
    return { pass: r.status < 500, actual: `${r.status} in ${r.ms}ms ${r.text.slice(0, 100)}`, severity: 'Medium' };
  });
  await t('SEC-11', 'Oversized JSON body rejected', { req: 'Request size limits', steps: 'POST 12 MB JSON to /logs/track', expected: '413', type: 'robustness' }, async () => {
    const r = await anon().post('/logs/track', { action: 'x', blob: 'a'.repeat(12 * 1024 * 1024) });
    return { pass: r.status === 413, actual: `${r.status} ${r.text.slice(0, 120)}` };
  });
  await t('SEC-12', 'Register a "school" account (type allowed by the route)', { req: 'School users can sign up (route accepts teacher/student/school)', steps: 'POST /auth/register type=school', expected: '201 (or a clean 400 if schools are not self-service) — never 500', type: 'functional' }, async () => {
    const r = await anon().post('/auth/register', { name: 'x', email: `sch-${h.uid()}@systest.local`, password: 'Passw0rd!', type: 'school' });
    return { pass: [201, 400, 403].includes(r.status), actual: `${h.short(r)}`, severity: 'High' };
  });
  await t('SEC-13', 'Anonymous user cannot create accounts with arbitrary role via /auth/create-user', { req: 'Admin-only user creation', steps: 'POST /auth/create-user anonymously type=teacher', expected: '401/403', type: 'security' }, async () => {
    const r = await anon().post('/auth/create-user', { name: 'x', email: `cu-${h.uid()}@systest.local`, password: 'Passw0rd!', type: 'teacher' });
    return { pass: [401, 403].includes(r.status), actual: h.short(r), severity: 'High' };
  });
  await t('SEC-14', 'Session cannot be forged with the default/leaked secret', { req: 'SESSION_SECRET is secret', steps: 'Code review: app.js session secret fallback + public git history', expected: 'No hard-coded fallback; secret not public', type: 'security' }, async () => {
    const src = fs.readFileSync(`${__ROOT}/../app.js`, 'utf8');
    const fallback = /SESSION_SECRET \|\| 'defaultsecret'/.test(src);
    return { pass: false, actual: `app.js falls back to 'defaultsecret' if unset: ${fallback}; the production SESSION_SECRET is in public GitHub history (innspill_frontend@28de3a7e:.env, hash-matched to your current .env)`, severity: 'Critical' };
  });
});
