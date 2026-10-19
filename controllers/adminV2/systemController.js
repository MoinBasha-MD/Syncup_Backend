const os = require('os');
const mongoose = require('mongoose');
const { execFile } = require('child_process');
const { monitorEventLoopDelay } = require('perf_hooks');
const SystemSetting = require('../../models/SystemSetting');
const fcmCleanup = require('../../services/fcmCleanup');
const { client: redisClient } = require('../../config/redis');
const { ok, fail, handle } = require('../../utils/adminV2Response');
const { bustMaintenanceCache } = require('../../middleware/maintenanceMode');

// Event-loop lag histogram — started once at module load
const loopHistogram = monitorEventLoopDelay({ resolution: 20 });
loopHistogram.enable();

const execFileAsync = (cmd, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 3000, ...options }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });

const mongoPing = async () => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return { readyState: mongoose.connection.readyState, ok: false };
    }
    const start = Date.now();
    await mongoose.connection.db.admin().ping();
    return { readyState: 1, ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return { readyState: mongoose.connection.readyState, ok: false, error: error.message };
  }
};

const redisPing = async () => {
  try {
    if (process.env.REDIS_ENABLED === 'false') return { status: 'disabled' };
    if (!redisClient.isOpen) return { status: 'unavailable' };
    const start = Date.now();
    await redisClient.ping();
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
};

const pm2Info = async () => {
  try {
    const { stdout } = await execFileAsync('pm2', ['jlist']);
    const list = JSON.parse(stdout);
    return list.map(p => ({
      name: p.name,
      pid: p.pid,
      status: p.pm2_env?.status,
      restarts: p.pm2_env?.restart_time,
      uptime: p.pm2_env?.pm_uptime,
      memory: p.monit?.memory,
      cpu: p.monit?.cpu,
    }));
  } catch {
    return null;
  }
};

const getHealth = handle(async (req, res) => {
  const mem = process.memoryUsage();
  const sockets = (() => {
    try { return require('../../socketManager').getUserSockets().size; } catch { return 0; }
  })();

  const [mongo, redis, pm2] = await Promise.all([mongoPing(), redisPing(), pm2Info()]);

  return ok(res, {
    uptime: process.uptime(),
    node: process.version,
    memory: {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
    },
    cpuUsage: process.cpuUsage(),
    loadavg: os.loadavg(),
    totalmem: os.totalmem(),
    freemem: os.freemem(),
    cpus: os.cpus().length,
    eventLoopLagMs: {
      p50: loopHistogram.percentile(50) / 1e6,
      p99: loopHistogram.percentile(99) / 1e6,
    },
    mongo,
    redis,
    sockets,
    pm2,
  });
});

// ---- flags ------------------------------------------------------------------

const getFlags = handle(async (req, res) => {
  const value = await SystemSetting.getValue('flags', {});
  return ok(res, value || {});
});

const putFlags = handle(async (req, res) => {
  const { flags } = req.body || {};
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) {
    return fail(res, 400, 'BAD_REQUEST', 'flags must be an object');
  }
  for (const [key, value] of Object.entries(flags)) {
    if (!['boolean', 'string', 'number'].includes(typeof value)) {
      return fail(res, 400, 'BAD_REQUEST', `flag '${key}' must be boolean, string or number`);
    }
  }
  res.locals.auditBefore = await SystemSetting.getValue('flags', {});
  await SystemSetting.setValue('flags', flags, String(req.admin._id));
  res.locals.auditAfter = flags;
  return ok(res, flags);
});

// ---- maintenance -------------------------------------------------------------

const getMaintenanceSetting = handle(async (req, res) => {
  const value = await SystemSetting.getValue('maintenance', null);
  return ok(res, value || { enabled: false });
});

const putMaintenance = handle(async (req, res) => {
  const { enabled, message, until, allowUserIds } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return fail(res, 400, 'BAD_REQUEST', 'enabled must be a boolean');
  }
  let untilDate = null;
  if (until) {
    untilDate = new Date(until);
    if (isNaN(untilDate.getTime())) return fail(res, 400, 'BAD_REQUEST', 'until must be an ISO date');
  }
  const value = {
    enabled,
    message: typeof message === 'string' ? message : '',
    until: untilDate,
    allowUserIds: Array.isArray(allowUserIds) ? allowUserIds.filter(u => typeof u === 'string') : [],
  };
  res.locals.auditBefore = await SystemSetting.getValue('maintenance', null);
  await SystemSetting.setValue('maintenance', value, String(req.admin._id));
  bustMaintenanceCache();
  res.locals.auditAfter = value;
  return ok(res, value);
});

// ---- cache flush --------------------------------------------------------------

const flushResponseCache = async () => {
  if (process.env.REDIS_ENABLED === 'false') return 0;
  if (!redisClient.isOpen) return 0;

  let deleted = 0;
  for (const pattern of ['*:GET:/*', '*:POST:/*']) {
    for await (const key of redisClient.scanIterator({ MATCH: pattern, COUNT: 500 })) {
      await redisClient.del(key);
      deleted += 1;
    }
  }
  return deleted;
};

const flushRippleFeed = async () => {
  // No dedicated invalidateRippleCache exists; ripple feed entries ride the
  // same response cache, keyed `userId:GET:/api/ripples*`.
  if (process.env.REDIS_ENABLED === 'false') return 0;
  if (!redisClient.isOpen) return 0;

  let deleted = 0;
  for await (const key of redisClient.scanIterator({ MATCH: '*:GET:/api/ripples*', COUNT: 500 })) {
    await redisClient.del(key);
    deleted += 1;
  }
  return deleted;
};

const cacheFlush = handle(async (req, res) => {
  const { scope } = req.body || {};
  let deleted;
  if (scope === 'response-cache') {
    deleted = await flushResponseCache();
  } else if (scope === 'ripple-feed') {
    deleted = await flushRippleFeed();
  } else {
    return fail(res, 400, 'BAD_REQUEST', "scope must be 'response-cache' or 'ripple-feed'");
  }
  res.locals.auditAfter = { scope, deleted };
  return ok(res, { scope, deleted });
});

// ---- fcm ----------------------------------------------------------------------

const getFcmStats = handle(async (req, res) => {
  return ok(res, await fcmCleanup.getTokenStats());
});

const fcmCleanupRoute = handle(async (req, res) => {
  const { mode, userId } = req.body || {};
  let result;
  if (mode === 'all') {
    result = await fcmCleanup.cleanAllTokens();
  } else if (mode === 'invalid') {
    result = await fcmCleanup.cleanInvalidTokens();
  } else if (mode === 'user') {
    if (typeof userId !== 'string' || !userId.trim()) {
      return fail(res, 400, 'BAD_REQUEST', 'userId is required for mode=user');
    }
    result = await fcmCleanup.cleanUserTokens(userId.trim());
    if (!result.matched) return fail(res, 404, 'NOT_FOUND', 'User not found');
  } else {
    return fail(res, 400, 'BAD_REQUEST', "mode must be 'all', 'invalid' or 'user'");
  }
  res.locals.auditAfter = { mode, userId, ...result };
  return ok(res, { mode, ...result });
});

// ---- restart --------------------------------------------------------------------

const restartServer = handle(async (req, res) => {
  res.locals.auditAfter = { restart: true };
  res.status(202);
  ok(res, { restarting: true });
  setTimeout(() => {
    execFile('pm2', ['reload', 'server'], (err) => {
      if (err) console.error('❌ [ADMIN V2] pm2 reload failed:', err.message);
      else console.log('✅ [ADMIN V2] pm2 reload server issued');
    });
  }, 500);
});

module.exports = {
  getHealth,
  getFlags,
  putFlags,
  getMaintenanceSetting,
  putMaintenance,
  cacheFlush,
  getFcmStats,
  fcmCleanupRoute,
  restartServer,
  // exported for unit tests
  _internal: { flushResponseCache, flushRippleFeed },
};
