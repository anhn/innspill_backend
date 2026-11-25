// Load / stress / spike / soak tests with autocannon. Run alone (no other suites running).
const __ROOT = require('path').resolve(__dirname, '..');
const autocannon = require('autocannon');
const { MongoClient } = require('mongodb');
const { execSync } = require('child_process');
const fs = require('fs');
const BASE = 'http://localhost:3000';
const API = BASE + '/api/v1';
const OUT = `${__ROOT}/results`;
const results = [];
const rss = () => { try { const pid = execSync("pgrep -f 'node app.js'").toString().trim().split('\n')[0]; return Math.round(parseInt(execSync(`ps -o rss= -p ${pid}`).toString()) / 1024); } catch { return -1; } };

function run(opts) {
  return new Promise(res => autocannon({ ...opts, url: opts.url.startsWith('http') ? opts.url : API + opts.url }, (e, r) => res(r)));
}
async function scenario(id, title, opts, slo) {
  const before = rss();
  const r = await run(opts);
  const total = r.requests.total;
  const non2xx = r.non2xx + r.timeouts; // autocannon 'errors' already includes timeouts
  const rec = { id, title, connections: opts.connections, duration_s: opts.duration, total, rps: Math.round(r.requests.average),
    p50: r.latency.p50, p97_5: r.latency.p97_5, p99: r.latency.p99, max: r.latency.max, errors: r.errors, timeouts: r.timeouts,
    non2xx: r.non2xx, errorRate: +(100 * non2xx / Math.max(1, total + r.timeouts)).toFixed(2), codes: Object.fromEntries(Object.entries(r).filter(([k]) => /^\dxx$/.test(k))), rssBeforeMB: before, rssAfterMB: rss() };
  rec.slo = slo; rec.status = (rec.errorRate <= slo.maxErrorPct && rec.p97_5 <= slo.p97_5) ? 'PASS' : 'FAIL';
  results.push(rec);
  console.log(`${rec.status} ${id} ${title}: ${rec.rps} req/s, p50 ${rec.p50}ms, p97.5 ${rec.p97_5}ms, p99 ${rec.p99}ms, err ${rec.errorRate}% (${JSON.stringify(rec.codes)}), RSS ${before}->${rec.rssAfterMB}MB`);
  fs.writeFileSync(`${OUT}/stress.json`, JSON.stringify(results, null, 2));
}

(async () => {
  // Users + session cookie
  const email = `stress-${Date.now()}@systest.local`;
  await fetch(API + '/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Stress', email, password: 'Passw0rd!' }) });
  const lr = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: email, password: 'Passw0rd!' }) });
  const cookie = lr.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const H = { cookie, 'content-type': 'application/json' };

  // Volume: seed realistic data so list/aggregation endpoints have something to chew on
  const mc = await MongoClient.connect('mongodb://127.0.0.1:27017/?replicaSet=rs0'); const db = mc.db('ai4edu_database');
  const N = 20000; const now = Date.now();
  const logs = Array.from({ length: N }, (_, i) => ({ action: ['login', 'create-course-plan', 'generate-quiz', 'asks'][i % 4], userId: `vol-user-${i % 400}`, username: `vol-user-${i % 400}`, timestamp: new Date(now - i * 60000), success: i % 17 !== 0, metadata: { volume: true } }));
  const seeded = await db.collection('courses').countDocuments({ courseId: /^vol-c-/ });
  if (!seeded) await db.collection('action_log').insertMany(logs);
  const courses = Array.from({ length: 2000 }, (_, i) => ({ courseId: `vol-c-${i}`, name: `Volume course ${i}`, code: `VOL${i}`, academicYear: '2026-2027', university: 'USN', teacherIds: [], createdAt: new Date(), updatedAt: new Date() }));
  if (!seeded) await db.collection('courses').insertMany(courses);
  const cols = (await db.listCollections().toArray()).map(c => c.name); console.log('collections:', cols.join(','));
  await mc.close();

  const S = (p97, err = 1) => ({ p97_5: p97, maxErrorPct: err });
  await scenario('ST-01', 'Baseline GET /health', { url: BASE + '/health', connections: 50, duration: 15 }, S(100));
  await scenario('ST-02', 'Read: GET /courses (2,000+ courses, no pagination)', { url: '/courses', connections: 25, duration: 20, headers: H }, S(1000));
  await scenario('ST-03', 'Write: POST /logs/track', { url: '/logs/track', method: 'POST', connections: 25, duration: 20, headers: H, body: JSON.stringify({ sessionId: 'stress', action: 'login', endpoint: '/auth/login', method: 'POST', success: true, metadata: { a: 1 } }) }, S(500));
  await scenario('ST-04', 'Auth: POST /auth/login (bcrypt)', { url: '/auth/login', method: 'POST', connections: 20, duration: 20, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: email, password: 'Passw0rd!' }) }, S(1500));
  await scenario('ST-05', 'Aggregation: GET /logs/stats over 20k logs', { url: '/logs/stats', connections: 10, duration: 20, headers: H }, S(2000));
  await scenario('ST-06', 'Aggregation: GET /logs/actions?limit=1000', { url: '/logs/actions?limit=1000', connections: 10, duration: 20, headers: H }, S(2000));
  for (const [i, u] of (process.env.EXTRA_URLS || '').split(',').filter(Boolean).entries())
    await scenario(`ST-0${7 + i}`, `Aggregation: GET ${u}`, { url: u, connections: 10, duration: 20, headers: H }, S(3000));
  await scenario('ST-10', 'AI path (mock upstream ~0 ms): POST /prompts/revise', { url: '/prompts/revise', method: 'POST', connections: 20, duration: 20, headers: H, body: JSON.stringify({ prompt: 'write an essay', userName: email }) }, S(1500));
  await scenario('ST-11', 'Spike: 500 concurrent connections on GET /courses', { url: '/courses', connections: 500, duration: 20, headers: H, timeout: 30 }, S(10000, 5));
  await scenario('ST-12', 'Soak: 60 s mixed read load (30 conn)', { url: '/courses', connections: 30, duration: 60, headers: H, requests: [{ method: 'GET', path: '/api/v1/courses' }, { method: 'GET', path: '/api/v1/logs/stats' }, { method: 'POST', path: '/api/v1/logs/track', body: JSON.stringify({ sessionId: 'stress', action: 'login', endpoint: '/auth/login', method: 'POST', success: true, metadata: { a: 1 } }) }] }, S(3000));
  const alive = (await fetch(BASE + '/health').catch(() => null))?.status;
  console.log('server alive after stress:', alive, 'RSS MB', rss());
  fs.writeFileSync(`${OUT}/stress.json`, JSON.stringify({ scenarios: results, aliveAfter: alive, rssAfterMB: rss() }, null, 2));
})();
