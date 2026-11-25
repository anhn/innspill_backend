/**
 * Per-user limits for expensive calls (AI generation, GitHub link checks).
 *
 * Counted per logged-in user, not per IP: on campus many students share one address.
 * Each limiter has a per-minute and a per-day budget; staff get larger budgets.
 * Counters live in memory, so they reset when the server restarts and are per process.
 * Set the numbers with environment variables (see LIMITS below).
 */
const { actingRole, isStaffRole } = require('./requestIdentity');

const num = (name, fallback) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const LIMITS = {
  ai: {
    perMinute: num('AI_LIMIT_PER_MINUTE', 15),
    perDay: num('AI_LIMIT_PER_DAY', 200),
    staffPerMinute: num('AI_LIMIT_STAFF_PER_MINUTE', 60),
    staffPerDay: num('AI_LIMIT_STAFF_PER_DAY', 2000),
  },
  activity: {
    perMinute: num('ACTIVITY_LIMIT_PER_MINUTE', 300),
    perDay: num('ACTIVITY_LIMIT_PER_DAY', 50000),
    staffPerMinute: num('ACTIVITY_LIMIT_PER_MINUTE', 300),
    staffPerDay: num('ACTIVITY_LIMIT_PER_DAY', 50000),
  },
  links: {
    perMinute: num('LINK_LIMIT_PER_MINUTE', 30),
    perDay: num('LINK_LIMIT_PER_DAY', 600),
    staffPerMinute: num('LINK_LIMIT_STAFF_PER_MINUTE', 60),
    staffPerDay: num('LINK_LIMIT_STAFF_PER_DAY', 2000),
  },
};

const counters = new Map(); // `${name}:${user}` -> { minuteStart, minute, day, dayCount }
const today = () => new Date().toISOString().slice(0, 10);

function userKey(req) {
  return req.session?.userId || req.session?.username || `ip:${req.ip}`;
}

/** Middleware: count this request against the user's budget for `name`; 429 when it is used up. */
function limit(name, { methods = ['POST'] } = {}) {
  const cfg = LIMITS[name];
  return (req, res, next) => {
    if (!methods.includes(req.method)) return next();
    const staff = isStaffRole(actingRole(req));
    const perMinute = staff ? cfg.staffPerMinute : cfg.perMinute;
    const perDay = staff ? cfg.staffPerDay : cfg.perDay;
    const key = `${name}:${userKey(req)}`;
    const now = Date.now();
    const c = counters.get(key) || { minuteStart: now, minute: 0, day: today(), dayCount: 0 };
    if (now - c.minuteStart >= 60000) {
      c.minuteStart = now;
      c.minute = 0;
    }
    if (c.day !== today()) {
      c.day = today();
      c.dayCount = 0;
    }
    if (c.dayCount >= perDay) {
      counters.set(key, c);
      return res.status(429).json({ success: false, message: `You have used today's limit of ${perDay} ${name === 'ai' ? 'AI requests' : 'link checks'}. Try again tomorrow, or ask your teacher.` });
    }
    if (c.minute >= perMinute) {
      const wait = Math.ceil((60000 - (now - c.minuteStart)) / 1000);
      res.set('Retry-After', String(wait));
      counters.set(key, c);
      return res.status(429).json({ success: false, message: `Too many requests. Try again in ${wait} seconds.` });
    }
    c.minute += 1;
    c.dayCount += 1;
    counters.set(key, c);
    return next();
  };
}

// Drop old counters once an hour so the map does not grow without bound.
setInterval(() => {
  const d = today();
  for (const [key, c] of counters) if (c.day !== d) counters.delete(key);
}, 60 * 60 * 1000).unref();

module.exports = { limit, LIMITS, _counters: counters, userKey };
