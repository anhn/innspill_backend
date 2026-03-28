/**
 * Authentication middleware
 */

/**
 * Check if user is authenticated
 */
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.userId) {
    return next();
  } else {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }
};

/**
 * Check if user is authenticated (optional)
 */
const isOptionalAuth = (req, res, next) => {
  // Always pass through, but add user info if available
  if (req.session && req.session.userId) {
    req.user = {
      id: req.session.userId,
      email: req.session.userEmail,
      name: req.session.userName || req.session.username
    };
  }
  next();
};

/**
 * Get current user info
 */
const getCurrentUser = (req, res) => {
  if (req.session && req.session.userId) {
    res.json({
      success: true,
      user: {
        id: req.session.userId,
        email: req.session.userEmail,
        name: req.session.userName || req.session.username,
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
  getCurrentUser
};
