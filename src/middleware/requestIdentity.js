/**
 * Resolve acting user from session; reject identity spoofing from body/query.
 */
function actingUsername(req) {
  return req.user?.username || req.session?.username || null;
}

function actingRole(req) {
  return req.user?.role || req.session?.userRole || null;
}

function isStaffRole(role) {
  return role === "teacher" || role === "admin" || role === "school";
}

/**
 * @returns {string|null} allowed username to use in queries, or null if forbidden
 */
function resolveFilterUsername(req, requestedUsername) {
  const self = actingUsername(req);
  if (!self) return null;
  if (!requestedUsername || requestedUsername === self) return self;
  if (isStaffRole(actingRole(req))) return requestedUsername;
  return null;
}

function forbidIdentitySpoof(req, res, requestedUsername) {
  if (!requestedUsername) return false;
  const allowed = resolveFilterUsername(req, requestedUsername);
  if (allowed === null) {
    res.status(403).json({ success: false, message: "Forbidden" });
    return true;
  }
  return false;
}

function forbidUserIdSpoof(req, res, requestedUserId) {
  if (!requestedUserId) return false;
  const sessionId = req.session?.userId;
  if (!sessionId) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return true;
  }
  if (isStaffRole(actingRole(req))) return false;
  if (String(requestedUserId) !== String(sessionId)) {
    res.status(403).json({ success: false, message: "Forbidden" });
    return true;
  }
  return false;
}

/** Block students from class-wide / aggregate metrics views */
function forbidStudentClassMetrics(req, res) {
  if (isStaffRole(actingRole(req))) return false;
  res.status(403).json({ success: false, message: "Forbidden" });
  return true;
}

/** Non-staff may only list their own private records (e.g. user-feedback) */
function forbidNonStaffList(req, res) {
  if (isStaffRole(actingRole(req))) return false;
  res.status(403).json({ success: false, message: "Forbidden" });
  return true;
}

module.exports = {
  actingUsername,
  actingRole,
  isStaffRole,
  resolveFilterUsername,
  forbidIdentitySpoof,
  forbidUserIdSpoof,
  forbidStudentClassMetrics,
  forbidNonStaffList,
};
