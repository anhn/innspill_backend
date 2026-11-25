// Rate limiting & brute-force protection with the production default (100 req / 15 min per IP).
// Restarts the backend with default limits, then restores the high functional-test limit.
const __ROOT = require('path').resolve(__dirname, '..');
const { suite } = require('../lib');
const { execSync } = require('child_process');

suite('BE-RATE', async (t, h) => {
  execSync(`${__ROOT}/start-be.sh default`, { stdio: 'inherit' }); // RATE_LIMIT_MAX_REQUESTS unset -> default 100
  const email = `rl-${h.uid()}@systest.local`;
  const reg = await new h.Client().post('/auth/register', { name: 'RL', email, password: 'Passw0rd!' }, { headers: { 'x-forwarded-for': '10.9.9.9' } });

  await t('RATE-01', 'API rate limit enforced (100 req / 15 min per client)', { req: 'Abuse protection', steps: 'Send 110 GET /api/v1/courses from one client', expected: 'Requests after the 100th get 429', type: 'security' }, async () => {
    const codes = [];
    for (let i = 0; i < 110; i++) codes.push((await new h.Client().get('/courses')).status);
    const first429 = codes.indexOf(429);
    return { pass: first429 >= 95 && first429 <= 101, actual: `first 429 at request #${first429 + 1}; 429 count=${codes.filter(c => c === 429).length}` };
  });
  await t('RATE-02', 'Rate limit cannot be bypassed by spoofing X-Forwarded-For', { req: 'Limiter keyed on real client IP', steps: 'Same client (already limited) sends 50 requests, each with a random X-Forwarded-For', expected: 'Still 429', type: 'security' }, async () => {
    let ok = 0;
    for (let i = 0; i < 50; i++) { const r = await new h.Client().get('/courses', { headers: { 'x-forwarded-for': `203.0.113.${i}` } }); if (r.status === 200) ok++; }
    return { pass: ok === 0, actual: `${ok}/50 spoofed requests served with 200 (app.js sets 'trust proxy', 1 and the app is reachable directly)`, severity: ok ? 'High' : '' };
  });
  await t('RATE-03', 'Password brute force is throttled per account', { req: 'Login brute-force protection', steps: 'Rotate X-Forwarded-For; 300 wrong-password logins against one account, then correct password', expected: 'Account/attempts throttled or locked; not 300 free guesses', type: 'security' }, async () => {
    let tried = 0, limited = 0; const t0 = Date.now();
    for (let i = 0; i < 300; i++) {
      const r = await new h.Client().post('/auth/login', { username: email, password: 'guess' + i }, { headers: { 'x-forwarded-for': `198.51.${(i / 250) | 0}.${i % 250}` } });
      if (r.status === 401) tried++; else if (r.status === 429) limited++;
    }
    const ok = await new h.Client().post('/auth/login', { username: email, password: 'Passw0rd!' }, { headers: { 'x-forwarded-for': '192.0.2.77' } });
    return { pass: tried < 50, actual: `${tried} wrong guesses evaluated, ${limited} throttled in ${((Date.now() - t0) / 1000).toFixed(1)} s (≈${Math.round(tried / ((Date.now() - t0) / 1000))} guesses/s from one machine); correct login afterwards=${ok.status}; register=${reg.status}`, severity: 'High' };
  });
  await t('RATE-04', 'Expensive AI endpoints have tighter limits than reads', { req: 'Cost control on paid AI calls', steps: 'Code review of app.js limiter', expected: 'Separate, stricter limiter on AI routes', type: 'security' }, async () =>
    ({ pass: false, actual: 'Only one global limiter (app.js) for all /api/ routes; AI generation routes share the 100/15 min budget and need no login (see SEC-01, CHAT-19, SUB-68)', severity: 'Medium' }));

  execSync(`${__ROOT}/start-be.sh`, { stdio: 'inherit' }); // restore functional-test limit
});
