const Admin = require('../../models/Admin');
const AdminSession = require('../../models/AdminSession');
const { ok, fail, handle, isValidObjectId, escapeRegex, parseLimit } = require('../../utils/adminV2Response');
const { PERMISSIONS, effectivePermissions } = require('../../config/adminPermissions');
const { recordAdminAction } = require('../../services/adminAudit');

const VALID_ROLES = ['super_admin', 'admin', 'moderator', 'viewer'];
const PERMISSION_SET = new Set(PERMISSIONS);

const publicAdmin = (a) => ({
  id: a._id,
  username: a.username,
  email: a.email,
  role: a.role,
  grants: a.grants || [],
  isActive: a.isActive,
  totpEnrolled: a.totp?.enabled === true,
  deviceCount: (a.devices || []).length,
  lastLogin: a.lastLogin,
  createdAt: a.createdAt,
});

const emitAdminEvent = (name, payload) => {
  try {
    require('../../services/adminSocket').emitAdminEvent(name, payload);
  } catch (e) { /* socket layer optional */ }
};

const listAdmins = handle(async (req, res) => {
  const admins = await Admin.find().sort({ createdAt: -1 }).lean();
  return ok(res, admins.map(publicAdmin));
});

const getAdmin = handle(async (req, res) => {
  if (!isValidObjectId(req.params.id)) return fail(res, 400, 'BAD_REQUEST', 'Invalid admin id');
  const admin = await Admin.findById(req.params.id).lean();
  if (!admin) return fail(res, 404, 'NOT_FOUND', 'Admin not found');
  return ok(res, {
    ...publicAdmin(admin),
    devices: (admin.devices || []).map(d => ({
      deviceId: d.deviceId,
      name: d.name,
      status: d.status,
      addedAt: d.addedAt,
      lastSeenAt: d.lastSeenAt,
      revokedAt: d.revokedAt,
    })),
  });
});

const createAdmin = handle(async (req, res) => {
  const { username, password, email, role, grants } = req.body || {};

  if (role === 'owner') {
    return fail(res, 403, 'FORBIDDEN', 'The owner role cannot be assigned');
  }
  if (role === 'super_admin' && req.admin.role !== 'owner') {
    return fail(res, 403, 'FORBIDDEN', 'Only the owner can create super admins');
  }
  if (role && !VALID_ROLES.includes(role)) {
    return fail(res, 400, 'BAD_REQUEST', `role must be one of: ${VALID_ROLES.join(', ')}`);
  }
  if (typeof username !== 'string' || username.trim().length < 3) {
    return fail(res, 400, 'BAD_REQUEST', 'username is required (min 3 chars)');
  }
  if (typeof password !== 'string' || password.length < 12) {
    return fail(res, 400, 'PASSWORD_TOO_SHORT', 'Password must be at least 12 characters');
  }
  const cleanGrants = Array.isArray(grants) ? grants.filter(g => PERMISSION_SET.has(g)) : [];

  let admin;
  try {
    admin = await Admin.create({
      username: username.toLowerCase().trim(),
      password,
      email: typeof email === 'string' ? email.toLowerCase().trim() : undefined,
      role: role || 'admin',
      grants: cleanGrants,
      createdBy: req.admin._id,
    });
  } catch (error) {
    if (error.code === 11000) {
      return fail(res, 409, 'DUPLICATE', 'Username or email already exists');
    }
    throw error;
  }

  res.locals.auditAfter = publicAdmin(admin);
  return ok(res, publicAdmin(admin));
});

const patchAdmin = handle(async (req, res) => {
  if (!isValidObjectId(req.params.id)) return fail(res, 400, 'BAD_REQUEST', 'Invalid admin id');
  const target = await Admin.findById(req.params.id);
  if (!target) return fail(res, 404, 'NOT_FOUND', 'Admin not found');

  res.locals.auditBefore = publicAdmin(target);

  if (target.role === 'owner') {
    return fail(res, 403, 'OWNER_IMMUTABLE', 'The owner account cannot be modified');
  }

  const { role, grants, isActive } = req.body || {};
  const requesterIsOwner = req.admin.role === 'owner';

  if (role !== undefined) {
    if (role === 'owner') return fail(res, 403, 'FORBIDDEN', 'The owner role cannot be assigned');
    if (!VALID_ROLES.includes(role)) return fail(res, 400, 'BAD_REQUEST', 'Invalid role');
    // Changing a super_admin's role or promoting to super_admin requires owner
    if ((target.role === 'super_admin' || role === 'super_admin') && !requesterIsOwner) {
      return fail(res, 403, 'FORBIDDEN', 'Only the owner can modify super admins');
    }
    target.role = role;
  } else if (target.role === 'super_admin' && !requesterIsOwner) {
    return fail(res, 403, 'FORBIDDEN', 'Only the owner can modify super admins');
  }

  if (grants !== undefined) {
    target.grants = Array.isArray(grants) ? grants.filter(g => PERMISSION_SET.has(g)) : [];
  }
  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') return fail(res, 400, 'BAD_REQUEST', 'isActive must be a boolean');
    target.isActive = isActive;
  }

  target.tokenVersion = (target.tokenVersion || 0) + 1;
  await target.save();

  res.locals.auditAfter = publicAdmin(target);
  return ok(res, publicAdmin(target));
});

const revokeAdminSessions = handle(async (req, res) => {
  if (!isValidObjectId(req.params.id)) return fail(res, 400, 'BAD_REQUEST', 'Invalid admin id');
  const target = await Admin.findById(req.params.id).select('role tokenVersion');
  if (!target) return fail(res, 404, 'NOT_FOUND', 'Admin not found');
  if (target.role === 'owner') {
    return fail(res, 403, 'OWNER_IMMUTABLE', 'The owner account cannot be modified');
  }
  if (target.role === 'super_admin' && req.admin.role !== 'owner') {
    return fail(res, 403, 'FORBIDDEN', 'Only the owner can modify super admins');
  }

  const result = await AdminSession.updateMany(
    { adminId: target._id, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  await Admin.findByIdAndUpdate(target._id, { $inc: { tokenVersion: 1 } });

  return ok(res, { revoked: result.modifiedCount });
});

const listPendingDevices = handle(async (req, res) => {
  const admins = await Admin.find({ 'devices.status': 'pending' })
    .select('username role devices')
    .lean();
  const pending = [];
  for (const admin of admins) {
    for (const d of admin.devices || []) {
      if (d.status === 'pending') {
        pending.push({
          adminId: admin._id,
          username: admin.username,
          role: admin.role,
          deviceId: d.deviceId,
          name: d.name,
          lastSeenAt: d.lastSeenAt,
        });
      }
    }
  }
  return ok(res, pending);
});

const deviceAction = (action) => handle(async (req, res) => {
  const { adminId, deviceId } = req.params;
  if (!isValidObjectId(adminId)) return fail(res, 400, 'BAD_REQUEST', 'Invalid admin id');

  const target = await Admin.findById(adminId);
  if (!target) return fail(res, 404, 'NOT_FOUND', 'Admin not found');
  if ((target.role === 'owner' || target.role === 'super_admin') && req.admin.role !== 'owner') {
    return fail(res, 403, 'FORBIDDEN', 'Only the owner can manage this admin\'s devices');
  }

  const device = (target.devices || []).find(d => d.deviceId === deviceId);
  if (!device) return fail(res, 404, 'NOT_FOUND', 'Device not found');

  if (action === 'approve') {
    device.status = 'approved';
    device.approvedAt = new Date();
    device.approvedBy = req.admin._id;
    device.revokedAt = undefined;
  } else if (action === 'deny') {
    device.status = 'revoked';
    device.revokedAt = new Date();
  } else { // revoke
    device.status = 'revoked';
    device.revokedAt = new Date();
    await AdminSession.updateMany(
      { adminId: target._id, deviceId, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
  }
  await target.save();

  emitAdminEvent('admin:device_updated', {
    adminId: String(target._id), username: target.username, deviceId, action, status: device.status,
  });

  return ok(res, { deviceId, status: device.status });
});

module.exports = {
  getAdmin,
  listAdmins,
  createAdmin,
  patchAdmin,
  revokeAdminSessions,
  listPendingDevices,
  approveDevice: deviceAction('approve'),
  denyDevice: deviceAction('deny'),
  revokeDevice: deviceAction('revoke'),
};
