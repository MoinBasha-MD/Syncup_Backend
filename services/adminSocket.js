const os = require('os');
const jwt = require('jsonwebtoken');
const { getAdminJwtSecret, ADMIN_JWT_AUDIENCE } = require('../config/adminSecrets');

/**
 * /admin socket namespace: live metrics + admin events for SyncUp Command.
 * Handshake expects an admin access JWT (same checks as requireAdminV2).
 */

let adminNs = null;
let metricsTimer = null;
let connectedAdmins = 0;

const TICK_MS = 5000;

const startTicker = (io) => {
  if (metricsTimer) return;
  metricsTimer = setInterval(() => {
    if (!adminNs || connectedAdmins < 1) return;
    let onlineUsers = 0;
    let sockets = 0;
    try {
      onlineUsers = require('../socketManager').getUserSockets().size;
      sockets = io.engine.clientsCount;
    } catch { /* socket manager may not be ready */ }
    let metrics = null;
    try {
      metrics = require('./adminMetrics').snapshot();
    } catch { /* metrics optional */ }
    const mem = process.memoryUsage();
    adminNs.emit('metrics:tick', {
      onlineUsers,
      sockets,
      ...metrics,
      memory: { rss: mem.rss, heapUsed: mem.heapUsed },
      loadavg: os.loadavg(),
      adminsConnected: connectedAdmins,
      at: new Date().toISOString(),
    });
  }, TICK_MS);
  metricsTimer.unref();
};

const initAdminSocket = (io) => {
  if (adminNs) return adminNs;
  adminNs = io.of('/admin');

  adminNs.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('UNAUTHENTICATED'));

      const decoded = jwt.verify(token, getAdminJwtSecret(), { audience: ADMIN_JWT_AUDIENCE });
      if (decoded.typ !== 'admin_access' || !decoded.sub) {
        return next(new Error('UNAUTHENTICATED'));
      }

      const Admin = require('../models/Admin');
      const AdminSession = require('../models/AdminSession');
      const admin = await Admin.findById(decoded.sub).lean();
      if (!admin || !admin.isActive) return next(new Error('UNAUTHENTICATED'));
      if ((decoded.tv || 0) < (admin.tokenVersion || 0)) return next(new Error('TOKEN_REVOKED'));

      const session = await AdminSession.findById(decoded.sid).lean();
      if (!session || session.revokedAt || session.rotatedAt || session.expiresAt <= new Date()) {
        return next(new Error('SESSION_REVOKED'));
      }

      const device = (admin.devices || []).find(d => d.deviceId === decoded.did);
      if (!device || device.status !== 'approved') return next(new Error('DEVICE_NOT_APPROVED'));

      socket.admin = { id: String(admin._id), username: admin.username, role: admin.role, deviceId: device.deviceId };
      next();
    } catch (error) {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  adminNs.on('connection', (socket) => {
    connectedAdmins += 1;
    socket.on('disconnect', () => { connectedAdmins = Math.max(0, connectedAdmins - 1); });
  });

  startTicker(io);
  return adminNs;
};

/** Fire-and-forget event push to every connected admin. */
const emitAdminEvent = (name, payload) => {
  try {
    if (adminNs) adminNs.emit(name, { ...payload, at: new Date().toISOString() });
  } catch (error) {
    console.error(`❌ [ADMIN SOCKET] emit ${name} failed:`, error.message);
  }
};

module.exports = { initAdminSocket, emitAdminEvent };
