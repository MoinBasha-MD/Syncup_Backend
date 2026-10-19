const express = require('express');
const {
  requireAdminV2,
  requirePermission,
  requireStepUp,
  requireReason,
  audit,
  ipAllowlist,
} = require('../../middleware/adminV2Auth');
const { adminV2ErrorHandler } = require('../../utils/adminV2Response');

const authRoutes = require('./auth');
const me = require('../../controllers/adminV2/meController');
const admins = require('../../controllers/adminV2/adminsController');
const dashboard = require('../../controllers/adminV2/dashboardController');
const users = require('../../controllers/adminV2/usersController');
const moderation = require('../../controllers/adminV2/moderationController');
const broadcasts = require('../../controllers/adminV2/broadcastsController').v2;
const system = require('../../controllers/adminV2/systemController');
const auditCtl = require('../../controllers/adminV2/auditController');

const router = express.Router();

// Reinstate needs users.suspend for suspended targets, users.ban for
// banned/deleted ones — resolved from the target's current state.
const reinstatePermission = async (req, res, next) => {
  try {
    const User = require('../../models/userModel');
    const { isValidObjectId, fail } = require('../../utils/adminV2Response');
    let user = await User.findOne({ userId: req.params.userId }).select('accountStatus userId').lean();
    if (!user && isValidObjectId(req.params.userId)) {
      user = await User.findById(req.params.userId).select('accountStatus userId').lean();
    }
    if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found');
    const state = user.accountStatus?.state || 'active';
    const needed = state === 'suspended' ? 'users.suspend' : 'users.ban';
    const effective = req.adminPermissions || [];
    if (!effective.includes('*') && !effective.includes(needed)) {
      return fail(res, 403, 'FORBIDDEN', 'Insufficient permissions');
    }
    next();
  } catch (error) {
    next(error);
  }
};

const allowlist = ipAllowlist();
if (allowlist) router.use(allowlist);

// ---- auth (public; per-route rate limits inside auth.js) ----
router.use('/auth', authRoutes);

// ---- everything below requires an admin access token ----
router.use(requireAdminV2);

// Me
router.get('/me', me.getMe);
router.delete('/me/sessions/:id', me.deleteMySession);
router.post('/me/password', requireStepUp, audit('me.password_change', { targetType: 'admin' }), me.changeMyPassword);

// Admins & devices
router.get('/admins', requirePermission('admins.manage'), admins.listAdmins);
router.post('/admins', requirePermission('admins.manage'), requireStepUp,
  audit('admin.create', { targetType: 'admin', getTargetId: req => req.body?.username }), admins.createAdmin);
router.patch('/admins/:id', requirePermission('admins.manage'), requireStepUp, requireReason,
  audit('admin.update', { targetType: 'admin', getTargetId: req => req.params.id }), admins.patchAdmin);
router.post('/admins/:id/revoke-sessions', requirePermission('admins.manage'), requireStepUp, requireReason,
  audit('admin.revoke_sessions', { targetType: 'admin', getTargetId: req => req.params.id }), admins.revokeAdminSessions);
router.get('/devices/pending', requirePermission('admins.manage'), admins.listPendingDevices);
router.post('/devices/:adminId/:deviceId/approve', requirePermission('admins.manage'), requireStepUp,
  audit('admin.device_approve', { targetType: 'admin', getTargetId: req => `${req.params.adminId}/${req.params.deviceId}` }), admins.approveDevice);
router.post('/devices/:adminId/:deviceId/deny', requirePermission('admins.manage'), requireStepUp,
  audit('admin.device_deny', { targetType: 'admin', getTargetId: req => `${req.params.adminId}/${req.params.deviceId}` }), admins.denyDevice);
router.post('/devices/:adminId/:deviceId/revoke', requirePermission('admins.manage'), requireStepUp,
  audit('admin.device_revoke', { targetType: 'admin', getTargetId: req => `${req.params.adminId}/${req.params.deviceId}` }), admins.revokeDevice);

// Dashboard & analytics
router.get('/dashboard/overview', requirePermission('system.read'), dashboard.getOverview);
router.get('/analytics/timeseries', requirePermission('system.read'), dashboard.getTimeseries);

// Users — order matters: /users/sync before /users/:userId
router.get('/users', requirePermission('users.read'), users.listUsers);
router.get('/users/sync', requirePermission('users.read'), users.syncUsers);
router.get('/users/:userId', requirePermission('users.read'), users.getUser360);
router.get('/users/:userId/audit', requirePermission('audit.read'), users.getUserAudit);
router.patch('/users/:userId', requirePermission('users.write'), requireReason,
  audit('user.update', { targetType: 'user', getTargetId: req => req.params.userId }), users.patchUser);
router.post('/users/:userId/suspend', requirePermission('users.suspend'), requireReason,
  audit('user.suspend', { targetType: 'user', getTargetId: req => req.params.userId }), users.suspendUser);
router.post('/users/:userId/ban', requirePermission('users.ban'), requireStepUp, requireReason,
  audit('user.ban', { targetType: 'user', getTargetId: req => req.params.userId }), users.banUser);
router.post('/users/:userId/reinstate', reinstatePermission, requireReason,
  audit('user.reinstate', { targetType: 'user', getTargetId: req => req.params.userId }), users.reinstateUser);
router.post('/users/:userId/force-logout', requirePermission('users.forceLogout'), requireReason,
  audit('user.force_logout', { targetType: 'user', getTargetId: req => req.params.userId }), users.forceLogout);
router.delete('/users/:userId', requirePermission('users.delete'), requireStepUp, requireReason,
  audit('user.delete', { targetType: 'user', getTargetId: req => req.params.userId }), users.deleteUser);
router.post('/users/:userId/restore', requirePermission('users.delete'), requireStepUp, requireReason,
  audit('user.restore', { targetType: 'user', getTargetId: req => req.params.userId }), users.restoreUser);
router.get('/users/:userId/export', requirePermission('users.export'), requireStepUp,
  audit('user.export', { targetType: 'user', getTargetId: req => req.params.userId }), users.exportUser);
router.get('/users/:userId/content', requirePermission('content.read'), users.listUserContent);
router.get('/users/:userId/messages/meta', requirePermission('messages.meta'),
  audit('user.messages_meta_view', { targetType: 'user', getTargetId: req => req.params.userId }), users.messageMeta);
router.post('/users/:userId/impersonate', requirePermission('users.impersonate'), requireStepUp, requireReason,
  audit('user.impersonate', { targetType: 'user', getTargetId: req => req.params.userId }), users.impersonate);
router.post('/users/:userId/notify', requirePermission('broadcasts.send'),
  audit('user.notify', { targetType: 'user', getTargetId: req => req.params.userId }), users.notifyUser);

// Moderation
router.get('/reports', requirePermission('reports.read'), moderation.listReports);
router.post('/reports/:rippleId/resolve', requirePermission('reports.resolve'), requireReason,
  audit('report.resolve', { targetType: 'ripple', getTargetId: req => req.params.rippleId }), moderation.resolveReports);
router.get('/content', requirePermission('content.read'), moderation.listContent);
router.post('/content/:type/:id/takedown', requirePermission('content.moderate'), requireReason,
  audit('content.takedown', { targetType: 'content', getTargetId: req => `${req.params.type}:${req.params.id}` }), moderation.takedown);
router.post('/content/:type/:id/restore', requirePermission('content.moderate'), requireReason,
  audit('content.restore', { targetType: 'content', getTargetId: req => `${req.params.type}:${req.params.id}` }), moderation.restore);

// Broadcasts
router.get('/broadcasts', requirePermission('broadcasts.send'), broadcasts.list);
router.post('/broadcasts', requirePermission('broadcasts.send'),
  audit('broadcast.create'), broadcasts.create);
router.get('/broadcasts/stats', requirePermission('broadcasts.send'), broadcasts.stats);
router.get('/broadcasts/templates', requirePermission('broadcasts.send'), broadcasts.templates);
router.get('/broadcasts/scheduled', requirePermission('broadcasts.send'), broadcasts.scheduled);
router.patch('/broadcasts/:id/cancel', requirePermission('broadcasts.send'),
  audit('broadcast.cancel', { targetType: 'broadcast', getTargetId: req => req.params.id }), broadcasts.cancel);
router.get('/broadcasts/:id/analytics', requirePermission('broadcasts.send'), broadcasts.analytics);
router.patch('/broadcasts/:id', requirePermission('broadcasts.send'),
  audit('broadcast.update', { targetType: 'broadcast', getTargetId: req => req.params.id }), broadcasts.update);
router.delete('/broadcasts/:id', requirePermission('broadcasts.send'),
  audit('broadcast.delete', { targetType: 'broadcast', getTargetId: req => req.params.id }), broadcasts.delete);

// System
router.get('/system/health', requirePermission('system.read'), system.getHealth);
router.get('/system/flags', requirePermission('system.read'), system.getFlags);
router.put('/system/flags', requirePermission('system.write'), requireStepUp,
  audit('system.flags_update'), system.putFlags);
router.get('/system/maintenance', requirePermission('system.read'), system.getMaintenanceSetting);
router.put('/system/maintenance', requirePermission('system.write'), requireStepUp, requireReason,
  audit('system.maintenance_update'), system.putMaintenance);
router.post('/system/cache/flush', requirePermission('system.write'), requireStepUp, requireReason,
  audit('system.cache_flush'), system.cacheFlush);
router.get('/system/fcm/stats', requirePermission('system.read'), system.getFcmStats);
router.post('/system/fcm/cleanup', requirePermission('system.write'), requireStepUp, requireReason,
  audit('system.fcm_cleanup'), system.fcmCleanupRoute);
router.post('/system/restart', requirePermission('system.restart'), requireStepUp, requireReason,
  audit('system.restart'), system.restartServer);

// Audit
router.get('/audit', requirePermission('audit.read'), auditCtl.listAudit);
router.get('/audit/verify', requirePermission('audit.read'), auditCtl.verify);

router.use(adminV2ErrorHandler);

module.exports = router;
