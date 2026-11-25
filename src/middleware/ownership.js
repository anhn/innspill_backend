const {
  actingUsername,
  actingRole,
  isStaffRole,
  resolveFilterUsername,
  forbidIdentitySpoof,
  forbidUserIdSpoof,
  forbidStudentClassMetrics,
  forbidNonStaffList,
} = require("./requestIdentity");

/** Query/body param must match session user unless staff */
function enforceUsernameParam(field = "userName") {
  return (req, res, next) => {
    const raw =
      req.query[field] ??
      req.body?.[field] ??
      (field === "userName" ? req.query.username : undefined) ??
      (field === "userName" ? req.body?.username : undefined);
    if (raw && forbidIdentitySpoof(req, res, raw)) return;
    const allowed = raw ? resolveFilterUsername(req, raw) : actingUsername(req);
    if (!allowed && !isStaffRole(actingRole(req))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    req.effectiveUsername = allowed || actingUsername(req);
    next();
  };
}

function enforceStudentIdParam(field = "studentId") {
  return (req, res, next) => {
    const raw =
      req.params[field] ??
      req.query[field] ??
      req.body?.[field];
    if (raw && forbidIdentitySpoof(req, res, raw)) return;
    const allowed = raw ? resolveFilterUsername(req, raw) : actingUsername(req);
    if (!allowed && !isStaffRole(actingRole(req))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    req.effectiveStudentId = allowed || actingUsername(req);
    next();
  };
}

function enforceStudentIdBody(field = "studentId") {
  return (req, res, next) => {
    const raw = req.body?.[field];
    if (!raw) return next();
    if (forbidIdentitySpoof(req, res, raw)) return;
    req.body[field] = resolveFilterUsername(req, raw) || raw;
    next();
  };
}

function requireStaffOnly() {
  return (req, res, next) => {
    if (forbidStudentClassMetrics(req, res)) return;
    next();
  };
}

function enforceUserIdBody(field = "userId") {
  return (req, res, next) => {
    const raw = req.body?.[field];
    if (!raw) {
      if (req.session?.userId) req.body[field] = req.session.userId;
      return next();
    }
    if (forbidUserIdSpoof(req, res, raw)) return;
    next();
  };
}

module.exports = {
  enforceUsernameParam,
  enforceStudentIdParam,
  enforceStudentIdBody,
  enforceUserIdBody,
  requireStaffOnly,
  forbidNonStaffList,
  isStaffRole,
  actingUsername,
  resolveFilterUsername,
  forbidIdentitySpoof,
};