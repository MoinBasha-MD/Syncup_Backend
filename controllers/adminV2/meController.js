const AdminSession = require('../../models/AdminSession');
const { ok, fail, handle } = require('../../utils/adminV2Response');
const { effectivePermissions } = require('../../config/adminPermissions');
const { recordAdminAction } = require('../../services/adminAudit');

const publicDevice = (d) => ({
  deviceId: d.deviceId,
  name: d.name,
  status: d.status,
  approvedAt: d.approvedAt,
  lastSeenAt: d.lastSeenAt,
  revokedAt: d.revokedAt,
});

const getMe = handle(async (req, res) => {
  const admin = req.admin;
  const sessions = await AdminSession.find({ adminId: admin._id, revokedAt: null, expiresAt: { $gt: new Date() } })
    .select('deviceId createdAt expiresAt ip ua')
    .sort({ createdAt: -1 })
    .lean();

  return ok(res, {
    id: admin._id,
    username: admin.username,
    email: admin.email,
    role: admin.role,
    permissions: effectivePermissions(admin),
    totpEnrolled: admin.totp?.enabled === true,
    lastLogin: admin.lastLogin,
    devices: (admin.devices || []).map(publicDevice),
    sessions: sessions.map(s => ({
      id: s._id,
      deviceId: s.deviceId,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      ip: s.ip,
      ua: s.ua,
      current: String(s._id) === String(req.adminSessionId),
    })),
  });
});

const deleteMySession = handle(async (req, res) => {
  const session = await AdminSession.findOne({ _id: req.params.id, adminId: req.admin._id });
  if (!session) return fail(res, 404, 'NOT_FOUND', 'Session not found');
  session.revokedAt = new Date();
  await session.save();

  recordAdminAction({
    adminId: req.admin._id, adminUsername: req.admin.username, adminRole: req.admin.role,
    deviceId: req.adminDevice?.deviceId, ip: req.ip,
    action: 'me.session_revoke', targetType: 'admin', targetId: req.admin._id, result: 'success',
  }).catch(e => console.error('❌ [AUDIT]', e.message));

  return ok(res, { revoked: true });
});

const changeMyPassword = handle(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return fail(res, 400, 'BAD_REQUEST', 'currentPassword and newPassword are required');
  }
  if (newPassword.length < 12) {
    return fail(res, 400, 'PASSWORD_TOO_SHORT', 'New password must be at least 12 characters');
  }

  const admin = req.admin;
  if (!(await admin.comparePassword(currentPassword))) {
    return fail(res, 401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  }

  admin.password = newPassword;
  admin.tokenVersion = (admin.tokenVersion || 0) + 1;
  await admin.save();

  // Revoke every other session — the current one dies via tv bump anyway on
  // next request, but revoke it too except keep none: kill all for safety.
  await AdminSession.updateMany(
    { adminId: admin._id, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );

  recordAdminAction({
    adminId: admin._id, adminUsername: admin.username, adminRole: admin.role,
    deviceId: req.adminDevice?.deviceId, ip: req.ip,
    action: 'me.password_change', targetType: 'admin', targetId: admin._id, result: 'success',
  }).catch(e => console.error('❌ [AUDIT]', e.message));

  return ok(res, { changed: true });
});

module.exports = { getMe, deleteMySession, changeMyPassword };
