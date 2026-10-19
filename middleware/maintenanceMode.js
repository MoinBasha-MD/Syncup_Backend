const jwt = require('jsonwebtoken');
const SystemSetting = require('../models/SystemSetting');

const CACHE_TTL_MS = 15 * 1000;
let cached = { at: 0, value: null };

const bustMaintenanceCache = () => {
  cached = { at: 0, value: null };
};

const getMaintenance = async () => {
  if (Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const value = await SystemSetting.getValue('maintenance', null);
  cached = { at: Date.now(), value };
  return value;
};

const isMaintenanceActive = (settings, now = new Date()) =>
  !!settings?.enabled && (!settings.until || new Date(settings.until) > now);

/** Bearer userId claim for allowlist checks (best-effort, never throws). */
const bearerUserId = (req) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return null;
    const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    return decoded.userId || null;
  } catch {
    return null;
  }
};

const isAllowedUser = (settings, userId) =>
  !!userId && Array.isArray(settings.allowUserIds) && settings.allowUserIds.includes(userId);

/**
 * Returns 503 for user-facing /api requests while maintenance mode is on.
 * Admin API, health endpoints and allowlisted userIds pass through.
 * Mount at `app.use('/api', maintenanceMode)` — req.path is relative to /api.
 */
const maintenanceMode = async (req, res, next) => {
  try {
    // Admin API and health checks always get through
    if (req.path.startsWith('/admin') || req.path.startsWith('/health')) return next();

    const settings = await getMaintenance();
    if (!isMaintenanceActive(settings)) return next();
    if (isAllowedUser(settings, bearerUserId(req))) return next();
    return res.status(503).json({
      success: false,
      code: 'MAINTENANCE',
      message: settings.message || 'SyncUp is under maintenance. Please try again later.',
      until: settings.until || null,
    });
  } catch (error) {
    console.error('❌ [MAINTENANCE] check failed:', error.message);
    return next();
  }
};

module.exports = {
  maintenanceMode,
  getMaintenance,
  isMaintenanceActive,
  isAllowedUser,
  bearerUserId,
  bustMaintenanceCache,
};
