const jwt = require('jsonwebtoken');
const { getAdminJwtSecret, ADMIN_JWT_AUDIENCE } = require('../config/adminSecrets');
const Admin = require('../models/Admin');
const AdminSession = require('../models/AdminSession');
const { effectivePermissions, hasPermission } = require('../config/adminPermissions');
const { fail } = require('../utils/adminV2Response');
const { recordAdminAction } = require('../services/adminAudit');

const ACCESS_AUDIENCE = ADMIN_JWT_AUDIENCE; // 'syncup-admin'
const STEPUP_AUDIENCE = 'syncup-admin-stepup';

const bearerToken = (req) => {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return null;
};

/**
 * Shared verification core — also used by opsAgent.
 * Returns { decoded, admin, session, device } or throws an object
 * { status, code, message } describing the failure.
 */
const verifyAdminAccessToken = async (token) => {
  if (!token) throw { status: 401, code: 'UNAUTHENTICATED', message: 'No token provided' };

  let decoded;
  try {
    decoded = jwt.verify(token, getAdminJwtSecret(), { audience: ACCESS_AUDIENCE });
  } catch {
    throw { status: 401, code: 'UNAUTHENTICATED', message: 'Invalid or expired token' };
  }

  if (decoded.typ !== 'admin_access' || !decoded.sub) {
    throw { status: 401, code: 'UNAUTHENTICATED', message: 'Invalid token type' };
  }

  const admin = await Admin.findById(decoded.sub);
  if (!admin || !admin.isActive) {
    throw { status: 401, code: 'UNAUTHENTICATED', message: 'Admin not found or deactivated' };
  }
  if ((decoded.tv || 0) < (admin.tokenVersion || 0)) {
    throw { status: 401, code: 'TOKEN_REVOKED', message: 'Token has been revoked' };
  }

  const session = await AdminSession.findById(decoded.sid).lean();
  if (!session || session.revokedAt || session.rotatedAt || session.expiresAt <= new Date()) {
    throw { status: 401, code: 'SESSION_REVOKED', message: 'Session is revoked or expired' };
  }

  const device = admin.devices.find(d => d.deviceId === decoded.did);
  if (!device || device.status !== 'approved') {
    throw { status: 403, code: 'DEVICE_NOT_APPROVED', message: 'Device is not approved' };
  }

  return { decoded, admin, session, device };
};

/**
 * Verify an admin access token and load the admin, its session and device.
 * Sets req.admin, req.adminPermissions, req.adminDevice, req.adminSessionId.
 */
const requireAdminV2 = async (req, res, next) => {
  try {
    const { admin, session, device } = await verifyAdminAccessToken(bearerToken(req));
    req.admin = admin;
    req.adminPermissions = effectivePermissions(admin);
    req.adminDevice = device;
    req.adminSessionId = session._id;
    next();
  } catch (error) {
    if (error && error.status) {
      return fail(res, error.status, error.code, error.message);
    }
    console.error('❌ [ADMIN V2 AUTH]', error);
    return fail(res, 500, 'INTERNAL_ERROR', 'Authentication failed');
  }
};

const requirePermission = (...perms) => (req, res, next) => {
  const effective = req.adminPermissions || [];
  const allowed = effective.includes('*') || perms.every(p => effective.includes(p));
  if (!allowed) {
    return fail(res, 403, 'FORBIDDEN', 'Insufficient permissions');
  }
  next();
};

/**
 * Destructive actions need a fresh step-up token in `X-Admin-StepUp`,
 * bound to the same admin and device.
 */
const requireStepUp = (req, res, next) => {
  const token = req.headers['x-admin-stepup'];
  if (!token) {
    return fail(res, 403, 'STEP_UP_REQUIRED', 'Step-up authentication required');
  }
  try {
    const decoded = jwt.verify(token, getAdminJwtSecret(), { audience: STEPUP_AUDIENCE });
    if (
      decoded.typ !== 'admin_stepup' ||
      String(decoded.sub) !== String(req.admin._id) ||
      decoded.did !== req.adminDevice.deviceId
    ) {
      return fail(res, 403, 'STEP_UP_REQUIRED', 'Step-up token does not match this device');
    }
    next();
  } catch {
    return fail(res, 403, 'STEP_UP_REQUIRED', 'Invalid or expired step-up token');
  }
};

const requireReason = (req, res, next) => {
  const reason = req.body?.reason;
  if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 500) {
    return fail(res, 400, 'REASON_REQUIRED', 'A reason (3-500 chars) is required');
  }
  req.body.reason = reason.trim();
  next();
};

/**
 * Wrap a mutating handler with an audit write. Handlers may set
 * res.locals.auditBefore / res.locals.auditAfter.
 */
const audit = (action, { targetType, getTargetId, captureBefore } = {}) => {
  return async (req, res, next) => {
    if (typeof captureBefore === 'function') {
      try {
        res.locals.auditBefore = await captureBefore(req);
      } catch (error) {
        console.error(`❌ [AUDIT] captureBefore failed for ${action}:`, error.message);
      }
    }
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const success = !res.statusCode || res.statusCode < 400;
      recordAdminAction({
        adminId: req.admin?._id,
        adminUsername: req.admin?.username,
        adminRole: req.admin?.role,
        deviceId: req.adminDevice?.deviceId,
        ip: req.ip,
        action,
        targetType,
        targetId: typeof getTargetId === 'function' ? getTargetId(req) : undefined,
        reason: req.body?.reason,
        before: res.locals.auditBefore,
        after: res.locals.auditAfter,
        result: success ? 'success' : 'failure',
      }).catch(error => console.error(`❌ [AUDIT] Failed to record ${action}:`, error.message));
      return originalJson(body);
    };
    next();
  };
};

/** Optional static IP allowlist for the whole v2 surface (off by default). */
const ipAllowlist = () => {
  const raw = process.env.ADMIN_IP_ALLOWLIST;
  if (!raw || !raw.trim()) return null;
  const allowed = new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress;
    if (!allowed.has(ip)) {
      return fail(res, 403, 'IP_NOT_ALLOWED', 'This IP is not allowed');
    }
    next();
  };
};

module.exports = {
  requireAdminV2,
  verifyAdminAccessToken,
  requirePermission,
  requireStepUp,
  requireReason,
  audit,
  ipAllowlist,
  hasPermission,
};
