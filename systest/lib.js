// Shared harness for AI4EDU system tests.
// Each suite: const { suite } = require('../lib'); suite('BE-COURSES', async (t, h) => { ... });
// t(id, title, {req, steps, expected, severity}, async () => actual)  -> fn returns {pass:boolean, actual:string}
const __ROOT = require('path').resolve(__dirname, '.');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BE_URL || 'http://localhost:3000';
const API = BASE + '/api/v1';
const RESULTS_DIR = `${__ROOT}/results/suites`;
fs.mkdirSync(RESULTS_DIR, { recursive: true });

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (this.cookie) headers.cookie = this.cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); }
    const full = url.startsWith('http') ? url : API + url;
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(full, { method, headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(opts.timeout || 30000) });
    } catch (e) { return { status: 0, error: e.message, ms: Date.now() - t0, body: null, text: '' }; }
    const sc = res.headers.getSetCookie?.() || [];
    if (sc.length) this.cookie = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, body: json, text, headers: res.headers, ms: Date.now() - t0 };
  }
  get(u, o) { return this.req('GET', u, undefined, o); }
  post(u, b, o) { return this.req('POST', u, b, o); }
  put(u, b, o) { return this.req('PUT', u, b, o); }
  patch(u, b, o) { return this.req('PATCH', u, b, o); }
  del(u, b, o) { return this.req('DELETE', u, b, o); }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Create and log in a user of the given type; returns {client, user, email, password}
async function makeUser(type = 'teacher', prefix = 'st') {
  const c = new Client();
  const email = `${prefix}-${type}-${uid()}@systest.local`;
  const password = 'Passw0rd!';
  const r = await c.post('/auth/register', { name: `${prefix} ${type}`, email, password, type });
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${r.text.slice(0, 200)}`);
  return { client: c, email, password, username: email, user: r.body.user };
}

const short = (r) => r ? `${r.status} ${(r.text || r.error || '').replace(/\s+/g, ' ').slice(0, 220)}` : 'no response';

function suite(name, fn) {
  const results = [];
  const t = async (id, title, meta, run) => {
    const rec = { suite: name, id, title, requirement: meta.req || '', steps: meta.steps || '', expected: meta.expected || '',
      type: meta.type || 'functional', severity: meta.severity || '', actual: '', status: 'FAIL' };
    try {
      const out = await run();
      rec.actual = out.actual; rec.status = out.pass ? 'PASS' : (out.blocked ? 'BLOCKED' : 'FAIL');
      if (out.severity) rec.severity = out.severity;
    } catch (e) { rec.actual = 'EXCEPTION: ' + e.message; rec.status = 'FAIL'; }
    results.push(rec);
    console.log(`${rec.status.padEnd(7)} ${id} ${title}${rec.status !== 'PASS' ? '  -> ' + rec.actual.slice(0, 200) : ''}`);
    return rec;
  };
  (async () => {
    const h = { Client, makeUser, uid, short, API, BASE };
    try { await fn(t, h); } catch (e) { console.error('SUITE CRASH', e); results.push({ suite: name, id: name + '-CRASH', title: 'suite crashed', actual: e.stack, status: 'FAIL' }); }
    fs.writeFileSync(path.join(RESULTS_DIR, name + '.json'), JSON.stringify(results, null, 2));
    const s = results.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
    console.log(`\n${name}: ${JSON.stringify(s)}`);
    process.exit(0);
  })();
}

module.exports = { suite, Client, makeUser, uid, short, API, BASE };
