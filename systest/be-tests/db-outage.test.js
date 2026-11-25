// DB outage: shuts MongoDB down, checks API behaviour, then waits for the operator/script to restart it.
// Restart command (run separately ~20 s after starting this suite):
//   mongod --dbpath <data> --port 27017 --bind_ip 127.0.0.1 --replSet rs0
const { suite } = require('../lib');
const { MongoClient } = require('mongodb');
suite('BE-DBOUT', async (t, h) => {
  const T = (await h.makeUser('teacher', 'dbout')).client;
  const mc = await MongoClient.connect('mongodb://127.0.0.1:27017/?replicaSet=rs0');
  await mc.db('admin').command({ shutdown: 1, force: true }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));
  await t('ROB-22', 'Database down: API fails fast with a clean error', { req: 'Graceful handling of DB outage', steps: 'Shut MongoDB down; GET /courses; POST /auth/login', expected: 'Clean 503/5xx JSON within a few seconds, no stack trace', type: 'robustness' }, async () => {
    const r = await T.get('/courses', { timeout: 45000 });
    const l = await new h.Client().post('/auth/login', { username: 'x@y.z', password: 'whatever' }, { timeout: 45000 });
    const leak = /stack|ECONNREFUSED|127\.0\.0\.1/.test(r.text + l.text);
    return { pass: r.status >= 500 && r.ms < 10000 && !leak, actual: `GET /courses -> ${r.status || r.error} after ${(r.ms / 1000).toFixed(1)} s: ${(r.text || '').slice(0, 110)} | login -> ${l.status} after ${(l.ms / 1000).toFixed(1)} s: ${(l.text || '').slice(0, 110)}`, severity: 'Medium' };
  });
  await t('ROB-23', 'Health endpoint reports database outage', { req: 'Monitoring can detect DB outage', steps: 'GET /health while DB down', expected: 'Non-200 or a db:down field', type: 'robustness' }, async () => {
    const r = await new h.Client().get(h.BASE + '/health');
    return { pass: r.status !== 200 || /db|database|mongo/i.test(r.text), actual: `${r.status} ${r.text.slice(0, 120)}`, severity: 'Low' };
  });
  await t('ROB-24', 'API recovers automatically when the database returns', { req: 'Self-healing without restart', steps: 'Restart MongoDB; poll GET /courses', expected: '200 again within 60 s of DB being back, without restarting Node', type: 'robustness' }, async () => {
    const t0 = Date.now(); let r;
    for (let i = 0; i < 120; i++) { r = await T.get('/courses', { timeout: 5000 }); if (r.status === 200) break; await new Promise(s => setTimeout(s, 1000)); }
    return { pass: r.status === 200, actual: `${r.status} after ${((Date.now() - t0) / 1000).toFixed(0)} s of polling (DB restarted ~20 s into the outage)` };
  });
});
