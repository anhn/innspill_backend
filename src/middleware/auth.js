/**
 * Authentication middleware
 */

function attachSessionUser(req) {
  if (req.session && req.session.userId) {
    const username = req.session.username || req.session.userName;
    req.user = {
      id: req.session.userId,
      username,
      email: req.session.userEmail || username,
      name: req.session.userName || username,
      role: req.session.userRole,
      provider: req.session.provider
    };
  }
}

/**
 * Check if user is authenticated
 */
const isAuthenticated = (req, res, next) => {
  attachSessionUser(req);
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({
    success: false,
    error: 'Authentication required'
  });
};

/**
 * Optional auth — attach user when session exists; never bypass auth by itself.
 */
const isOptionalAuth = (req, res, next) => {
  attachSessionUser(req);
  next();
};

/**
 * Require one of the given roles (uses req.session.userRole).
 */
const requireRole = (...roles) => (req, res, next) => {
  attachSessionUser(req);
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }
  const role = req.session.userRole;
  if (!roles.includes(role)) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden'
    });
  }
  return next();
};

const PUBLIC_API_PATTERNS = [
  { method: 'GET', pattern: /^\/auth\/?$/ },
  { method: 'POST', pattern: /^\/auth\/(login|register)$/ },
  { method: 'GET', pattern: /^\/auth\/(facebook|google)(\/callback)?$/ },
  { method: 'GET', pattern: /^\/auth\/logout$/ },
  { method: 'GET', pattern: /^\/auth\/me$/ }
];

function apiPathFromRequest(req) {
  const raw = (req.originalUrl || req.url || '').split('?')[0];
  const marker = '/api/v1';
  const idx = raw.indexOf(marker);
  if (idx === -1) return null;
  const path = raw.slice(idx + marker.length) || '/';
  return path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
}

function isPublicApiRoute(req) {
  const path = apiPathFromRequest(req);
  if (!path) return false;
  return PUBLIC_API_PATTERNS.some(
    (entry) => entry.method === req.method && entry.pattern.test(path)
  );
}

/**
 * Global gate for /api/v1 — reject unauthenticated access except public auth routes.
 */
const enforceApiAuthentication = (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next();
  }
  if (isPublicApiRoute(req)) {
    attachSessionUser(req);
    return next();
  }
  attachSessionUser(req);
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }
  return next();
};

/**
 * Get current user info (legacy helper)
 */
const getCurrentUser = (req, res) => {
  attachSessionUser(req);
  if (req.session && req.session.userId) {
    res.json({
      success: true,
      user: {
        id: req.session.userId,
        email: req.session.userEmail,
        name: req.session.userName || req.session.username,
        username: req.session.username,
        role: req.session.userRole,
        provider: req.session.provider
      }
    });
  } else {
    res.json({
      success: false,
      user: null
    });
  }
};

module.exports = {
  isAuthenticated,
  isOptionalAuth,
  requireRole,
  enforceApiAuthentication,
  attachSessionUser,
  getCurrentUser
};
