/**
 * Ops agent — a separate PM2 process that can manage the backend itself
 * (a route inside the backend can't start the backend after stopping it).
 *
 * Binds 127.0.0.1 only; nginx proxies https://api.crackman.in/ops/ → here.
 * Same envelope, same tokens, same step-up flow as /api/admin/v2.
 *
 * Degraded mode: when Mongo is unreachable only a small read/control subset
 * is exposed, permissions come from the JWT role claim, and audit entries are
 * queued to logs/ops-audit-pending.jsonl until Mongo returns.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const os = require('os');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const http = require('http');
const https = require('https');
const mongoose = require('mongoose');

const { getAdminJwtSecret, getTotpEncKey, ADMIN_JWT_AUDIENCE } = require('../config/adminSecrets');
const { effectivePermissions } = require('../config/adminPermissions');
const { ok, fail } = require('../utils/adminV2Response');
const { verifyAdminAccessToken, requireReason } = require('../middleware/adminV2Auth');
const { run, redact } = require('./run');
const parsers = require('./parsers');
const pendingAudit = require('./pendingAudit');
const deploy = require('./deploy');

// Fail-fast secret validation (production throws if unset/weak).
getAdminJwtSecret();
if (process.env.NODE_ENV === 'production') getTotpEncKey();

const REPO_DIR = path.join(__dirname, '..');
const PORT = parseInt(process.env.OPS_AGENT_PORT || '5055', 10);
const BACKEND_PORT = parseInt(process.env.PORT || '5000', 10);
const STEPUP_AUDIENCE = 'syncup-admin-stepup';

const SERVICE_ALLOWLIST = ['nginx', 'mongod', 'redis-server', 'redis'];

const LOG_SOURCES = {
  'server-out': { cmd: 'tail', args: (n) => ['-n', String(n), '/root/.pm2/logs/server-out.log'] },
  'server-error': { cmd: 'tail', args: (n) => ['-n', String(n), '/root/.pm2/logs/server-error.log'] },
  'ops-agent-out': { cmd: 'tail', args: (n) => ['-n', String(n), '/root/.pm2/logs/ops-agent-out.log'] },
  'ops-agent-error': { cmd: 'tail', args: (n) => ['-n', String(n), '/root/.pm2/logs/ops-agent-error.log'] },
  'nginx-error': { cmd: 'tail', args: (n) => ['-n', String(n), '/var/log/nginx/error.log'] },
  'nginx-access': { cmd: 'tail', args: (n) => ['-n', String(n), '/var/log/nginx/access.log'] },
  mongod: { cmd: 'journalctl', args: (n) => ['-u', 'mongod', '-n', String(n), '--no-pager'], fallback: '/var/log/mongodb/mongod.log' },
};

// Routes reachable while Mongo is down (access JWT still verified; step-up
// JWT still verified — both short-lived and device-bound).
const DEGRADED_ALLOWED = new Set([
  'GET /ops/status',
  'GET /ops/host',
  'GET /ops/services',
  'GET /ops/logs',
  'POST /ops/backend/start',
  'POST /ops/backend/restart',
  'POST /ops/services/mongod/restart',
]);

// ---- mongo -----------------------------------------------------------------

const isMongoConnected = () => mongoose.connection?.readyState === 1;

const connectMongo = async () => {
  try {
    if (!process.env.MONGO_URI) return;
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    console.log('[OPS] Mongo connected');
    pendingAudit.flushPending()
      .then(r => { if (r.flushed) console.log(`[OPS] flushed ${r.flushed} pending audit entries`); })
      .catch(() => {});
  } catch (error) {
    console.error('[OPS] Mongo connect failed, degraded mode:', error.message);
  }
};
mongoose.connection?.on?.('connected', () => {
  pendingAudit.flushPending().catch(() => {});
});

// ---- auth ------------------------------------------------------------------

const bearer = (req) => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
};

const opsAuth = async (req, res, next) => {
  const token = bearer(req);
  if (!token) return fail(res, 401, 'UNAUTHENTICATED', 'No token provided');

  if (isMongoConnected()) {
    try {
      const { decoded, admin, session, device } = await verifyAdminAccessToken(token);
      req.admin = admin;
      req.adminPermissions = effectivePermissions(admin);
      req.adminDevice = device;
      req.adminSessionId = session._id;
      req.adminClaims = decoded;
      req.degraded = false;
      return next();
    } catch (error) {
      if (error && error.status) return fail(res, error.status, error.code, error.message);
      console.error('[OPS AUTH]', error);
      return fail(res, 500, 'INTERNAL_ERROR', 'Authentication failed');
    }
  }

  // Degraded: signature-only verification, permissions from the role claim.
  let decoded;
  try {
    decoded = jwt.verify(token, getAdminJwtSecret(), { audience: ADMIN_JWT_AUDIENCE });
  } catch {
    return fail(res, 401, 'UNAUTHENTICATED', 'Invalid or expired token');
  }
  if (decoded.typ !== 'admin_access' || !decoded.sub) {
    return fail(res, 401, 'UNAUTHENTICATED', 'Invalid token type');
  }
  req.degraded = true;
  req.adminClaims = decoded;
  req.admin = { _id: decoded.sub, username: decoded.sub, role: decoded.role || 'admin' };
  req.adminDevice = { deviceId: decoded.did };
  req.adminPermissions =
    decoded.role === 'owner' ? ['*'] :
    decoded.role === 'super_admin' ? ['ops.read'] : [];

  const key = `${req.method} ${req.path}`;
  if (!DEGRADED_ALLOWED.has(key)) {
    return fail(res, 503, 'OPS_DEGRADED', 'Database unreachable — limited controls');
  }
  return next();
};

const opsPerm = (...perms) => (req, res, next) => {
  const eff = req.adminPermissions || [];
  if (eff.includes('*') || perms.every(p => eff.includes(p))) return next();
  return fail(res, 403, 'FORBIDDEN', 'Insufficient permissions');
};

const ownerOnly = (req, res, next) => {
  if (req.admin?.role === 'owner') return next();
  return fail(res, 403, 'FORBIDDEN', 'Owner only');
};

/** Step-up verification that works in degraded mode too (JWT-only checks). */
const opsStepUp = (req, res, next) => {
  const token = req.headers['x-admin-stepup'];
  if (!token) return fail(res, 403, 'STEP_UP_REQUIRED', 'Step-up authentication required');
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

/** Audit wrapper — Mongo when connected, pending JSONL in degraded mode. */
const opsAudit = (action, { targetType, getTargetId } = {}) => (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const entry = {
      adminId: req.admin?._id,
      adminUsername: req.admin?.username,
      adminRole: req.admin?.role,
      deviceId: req.adminDevice?.deviceId,
      ip: req.ip,
      action,
      targetType,
      targetId: typeof getTargetId === 'function' ? getTargetId(req) : undefined,
      reason: req.body?.reason,
      after: res.locals.auditAfter,
      result: res.statusCode < 400 ? 'success' : 'failure',
    };
    if (isMongoConnected()) {
      require('../services/adminAudit').recordAdminAction(entry)
        .catch(e => console.error(`[OPS AUDIT] ${action}:`, e.message));
    } else {
      pendingAudit.writePending(entry);
    }
    return originalJson(body);
  };
  next();
};

// ---- helpers ---------------------------------------------------------------

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    console.error('[OPS]', req.path, error);
    return fail(res, 500, 'INTERNAL_ERROR', error.message);
  }
};

const getPm2Apps = async () => {
  const res = await run('pm2', ['jlist'], { timeoutMs: 15000 });
  if (!res.ok) return null;
  return parsers.parsePm2Jlist(res.stdout);
};

const findBackendApp = (apps) => (apps || []).find(a => a.name === 'server') || null;

const waitForBackendStatus = async (wanted, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  let apps = null;
  while (Date.now() < deadline) {
    apps = await getPm2Apps();
    const server = findBackendApp(apps);
    if (server && (!wanted || server.status === wanted)) return server;
    await new Promise(r => setTimeout(r, 1000));
  }
  return findBackendApp(apps);
};

// ---- app -------------------------------------------------------------------

const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));
  app.use(rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false }));
  app.use(opsAuth);

  // ---------------------------------------------------------------- status
  app.get('/ops/status', wrap(async (_req, res) => {
    const apps = await getPm2Apps();
    return ok(res, {
      agentUptime: process.uptime(),
      mongoConnected: isMongoConnected(),
      degraded: !isMongoConnected(),
      backend: findBackendApp(apps),
      at: new Date().toISOString(),
    });
  }));

  // ------------------------------------------------------------------ host
  app.get('/ops/host', opsPerm('ops.read'), wrap(async (_req, res) => {
    const [osReleaseRes, meminfoRes, dev1] = await Promise.all([
      run('cat', ['/etc/os-release']),
      run('cat', ['/proc/meminfo']),
      run('cat', ['/proc/net/dev']),
    ]);
    await new Promise(r => setTimeout(r, 1000));
    const dev2 = await run('cat', ['/proc/net/dev']);
    const elapsed = dev2.durationMs + 1000;

    const osr = parsers.parseOsRelease(osReleaseRes.stdout);
    const mem = parsers.parseMeminfo(meminfoRes.stdout);
    const rates = parsers.netRates(parsers.parseNetDev(dev1.stdout), parsers.parseNetDev(dev2.stdout), elapsed);
    const uptimeSec = os.uptime();

    return ok(res, {
      hostname: os.hostname(),
      os: osr.PRETTY_NAME || os.type(),
      kernel: os.release(),
      uptimeSec,
      bootTime: new Date(Date.now() - uptimeSec * 1000).toISOString(),
      cpu: { model: os.cpus()[0]?.model, cores: os.cpus().length },
      loadavg: os.loadavg(),
      memory: mem,
      network: rates,
      at: new Date().toISOString(),
    });
  }));

  // ------------------------------------------------------------------ disk
  app.get('/ops/disk', opsPerm('ops.read'), wrap(async (_req, res) => {
    const dirs = [
      { key: 'uploads', path: path.join(REPO_DIR, 'uploads') },
      { key: 'repo_logs', path: path.join(REPO_DIR, 'logs') },
      { key: 'pm2_logs', path: '/root/.pm2/logs' },
      { key: 'var_log', path: '/var/log' },
    ];
    // Mongo dbPath — /etc/mongod.conf if readable, else default.
    let mongoPath = '/var/lib/mongodb';
    try {
      const conf = fs.readFileSync('/etc/mongod.conf', 'utf8');
      const m = conf.match(/^\s*dbPath:\s*(\S+)/m);
      if (m) mongoPath = m[1];
    } catch { /* default */ }
    dirs.push({ key: 'mongo', path: mongoPath });

    const [dfRes, dfInodeRes, ...duResults] = await Promise.all([
      run('df', ['-kP', '-x', 'tmpfs', '-x', 'devtmpfs']),
      run('df', ['-iP', '/']),
      ...dirs.map(d => run('du', ['-sk', d.path], { timeoutMs: 15000 })),
    ]);

    const inodes = parsers.parseDf(dfInodeRes.stdout)[0] || null;

    return ok(res, {
      mounts: parsers.parseDf(dfRes.stdout),
      directories: dirs.map((d, i) => ({
        key: d.key,
        path: d.path,
        sizeBytes: duResults[i].ok
          ? parseInt(duResults[i].stdout.trim().split(/\s+/)[0], 10) * 1024
          : null,
      })),
      rootInodes: inodes ? { usedPct: inodes.usePct } : null,
    });
  }));

  // -------------------------------------------------------------- processes
  app.get('/ops/processes', opsPerm('ops.read'), wrap(async (req, res) => {
    const sort = req.query.sort === 'mem' ? '-pmem' : '-pcpu';
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const ps = await run('ps', ['-eo', 'pid,user,pcpu,pmem,rss,etime,comm', `--sort=${sort}`]);
    return ok(res, parsers.parsePs(ps.stdout).slice(0, limit));
  }));

  // ------------------------------------------------------------------- pm2
  app.get('/ops/pm2', opsPerm('ops.read'), wrap(async (_req, res) => {
    const apps = await getPm2Apps();
    if (apps === null) return fail(res, 502, 'PM2_UNAVAILABLE', 'pm2 jlist failed');
    return ok(res, apps);
  }));

  // -------------------------------------------------------------- services
  app.get('/ops/services', opsPerm('ops.read'), wrap(async (_req, res) => {
    const services = await Promise.all(SERVICE_ALLOWLIST.map(async (name) => {
      const [active, enabled, show] = await Promise.all([
        run('systemctl', ['is-active', name]),
        run('systemctl', ['is-enabled', name]),
        run('systemctl', ['show', name, '-p', 'ActiveEnterTimestamp,MainPID,MemoryCurrent']),
      ]);
      const props = parsers.parseSystemctlShow(show.stdout);
      const notInstalled = /not-found|could not be found|invalid argument/i.test(enabled.stderr + active.stderr)
        || (!show.ok && !Object.keys(props).length);
      return {
        name,
        installed: !notInstalled,
        active: active.stdout.trim(),
        enabled: enabled.stdout.trim(),
        activeSince: props.ActiveEnterTimestamp || null,
        mainPid: parseInt(props.MainPID, 10) || null,
        memoryBytes: props.MemoryCurrent && props.MemoryCurrent !== '[not set]'
          ? parseInt(props.MemoryCurrent, 10) : null,
      };
    }));
    return ok(res, services);
  }));

  // -------------------------------------------------------------------- tls
  app.get('/ops/tls', opsPerm('ops.read'), wrap(async (_req, res) => {
    const info = await new Promise((resolve, reject) => {
      const socket = tls.connect(443, 'api.crackman.in', { servername: 'api.crackman.in', timeout: 10000 }, () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve({
          subject: cert.subject,
          issuer: cert.issuer,
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
          daysRemaining: Math.floor((new Date(cert.valid_to) - Date.now()) / 86400000),
          san: (cert.subjectaltname || '').split(',').map(s => s.trim().replace(/^DNS:/, '')),
        });
      });
      socket.on('error', reject);
      socket.on('timeout', () => { socket.destroy(); reject(new Error('TLS connect timeout')); });
    });
    return ok(res, info);
  }));

  // ------------------------------------------------------------------- logs
  app.get('/ops/logs', ownerOnly, wrap(async (req, res) => {
    const source = String(req.query.source || 'server-out');
    const lines = parseInt(req.query.lines, 10) || 200;
    const src = LOG_SOURCES[source];
    if (!src) return fail(res, 400, 'BAD_REQUEST', `source must be one of: ${Object.keys(LOG_SOURCES).join(', ')}`);
    if (!Number.isInteger(lines) || lines < 1 || lines > 2000) {
      return fail(res, 400, 'BAD_REQUEST', 'lines must be an integer 1-2000');
    }
    let result = await run(src.cmd, src.args(lines), { timeoutMs: 15000 });
    if (!result.ok && src.fallback) {
      result = await run('tail', ['-n', String(lines), src.fallback], { timeoutMs: 15000 });
    }
    res.locals.auditAfter = { source, lines };
    return ok(res, { source, lines: result.stdout.split('\n'), ok: result.ok });
  }));

  // -------------------------------------------------------------------- git
  app.get('/ops/git', opsPerm('ops.read'), wrap(async (req, res) => {
    if (req.query.fetch === '1') {
      await run('git', ['fetch', '--quiet'], { cwd: REPO_DIR, timeoutMs: 30000 });
    }
    const [branch, log, status, upstream] = await Promise.all([
      run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO_DIR }),
      run('git', ['log', '-1', '--format=%H%n%s%n%aI'], { cwd: REPO_DIR }),
      run('git', ['status', '--porcelain'], { cwd: REPO_DIR }),
      run('git', ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], { cwd: REPO_DIR }),
    ]);
    const [sha, subject, date] = (log.stdout || '').split('\n');
    const counts = upstream.ok ? upstream.stdout.trim().split(/\s+/).map(Number) : [null, null];
    return ok(res, {
      branch: branch.stdout.trim(),
      head: { sha: sha?.trim(), subject, date },
      dirtyFiles: status.stdout.split('\n').filter(Boolean).length,
      behind: counts[0],
      ahead: counts[1],
    });
  }));

  // --------------------------------------------------------- backend control
  for (const verb of ['start', 'stop', 'restart', 'reload']) {
    app.post(`/ops/backend/${verb}`, opsPerm('ops.control'), opsStepUp, requireReason,
      opsAudit(`ops.backend_${verb}`, { targetType: 'service', getTargetId: () => 'server' }),
      wrap(async (_req, res) => {
        const result = await run('pm2', [verb, 'server'], { timeoutMs: 60000 });
        if (!result.ok) return fail(res, 502, 'PM2_FAILED', result.stderr || 'pm2 command failed');
        const wanted = verb === 'stop' ? 'stopped' : 'online';
        const status = await waitForBackendStatus(wanted === 'online' ? 'online' : null);
        return ok(res, {
          verb,
          backend: status,
          warning: verb === 'stop'
            ? 'The user-facing API is now DOWN — users lose access until you start it again.'
            : undefined,
        });
      }));
  }

  // --------------------------------------------------------- service restart
  app.post('/ops/services/:name/restart', opsPerm('ops.control'), opsStepUp, requireReason,
    opsAudit('ops.service_restart', { targetType: 'service', getTargetId: (req) => req.params.name }),
    wrap(async (req, res) => {
      const { name } = req.params;
      if (!SERVICE_ALLOWLIST.includes(name)) {
        return fail(res, 400, 'BAD_REQUEST', `service must be one of: ${SERVICE_ALLOWLIST.join(', ')}`);
      }
      const installed = await run('systemctl', ['status', name], { timeoutMs: 10000 });
      if (installed.code === 4 || /could not be found/i.test(installed.stderr + installed.stdout)) {
        return fail(res, 404, 'NOT_INSTALLED', `${name} is not installed`);
      }
      if (name === 'nginx') {
        const test = await run('nginx', ['-t'], { timeoutMs: 15000 });
        if (!test.ok) {
          return fail(res, 400, 'NGINX_CONFIG_INVALID', redact(test.stderr || 'nginx -t failed'));
        }
      }
      const result = await run('systemctl', ['restart', name], { timeoutMs: 60000 });
      if (!result.ok) return fail(res, 502, 'RESTART_FAILED', result.stderr || 'restart failed');
      const active = await run('systemctl', ['is-active', name]);
      return ok(res, { name, active: active.stdout.trim() });
    }));

  // -------------------------------------------------------------- log flush
  app.post('/ops/logs/flush', opsPerm('ops.control'), opsStepUp, requireReason,
    opsAudit('ops.logs_flush', { targetType: 'service', getTargetId: (req) => req.body?.app }),
    wrap(async (req, res) => {
      const appName = req.body?.app;
      if (!['server', 'ops-agent'].includes(appName)) {
        return fail(res, 400, 'BAD_REQUEST', "app must be 'server' or 'ops-agent'");
      }
      const result = await run('pm2', ['flush', appName], { timeoutMs: 30000 });
      if (!result.ok) return fail(res, 502, 'PM2_FAILED', result.stderr || 'pm2 flush failed');
      return ok(res, { flushed: appName });
    }));

  // ------------------------------------------------------------------ deploy
  app.post('/ops/deploy', opsPerm('ops.deploy'), opsStepUp, requireReason,
    opsAudit('ops.deploy_start', { targetType: 'service', getTargetId: () => 'server' }),
    wrap(async (req, res) => {
      let job;
      try {
        job = deploy.startDeploy({
          repoDir: REPO_DIR,
          backendPort: BACKEND_PORT,
          onDone: (j) => {
            const entry = {
              adminId: req.admin?._id, adminUsername: req.admin?.username, adminRole: req.admin?.role,
              deviceId: req.adminDevice?.deviceId, ip: req.ip,
              action: 'ops.deploy_result', targetType: 'service', targetId: 'server',
              reason: req.body?.reason,
              after: { jobId: j.jobId, status: j.status, error: j.error, previousSha: j.previousSha, newSha: j.newSha },
              result: j.status === 'success' ? 'success' : 'failure',
            };
            if (isMongoConnected()) {
              require('../services/adminAudit').recordAdminAction(entry)
                .catch(e => console.error('[OPS AUDIT] deploy_result:', e.message));
            } else {
              pendingAudit.writePending(entry);
            }
          },
        });
      } catch (error) {
        if (error.code === 'DEPLOY_IN_PROGRESS') {
          return fail(res, 409, 'DEPLOY_IN_PROGRESS', error.message);
        }
        throw error;
      }
      return ok(res, { jobId: job.jobId });
    }));

  app.get('/ops/deploy/:jobId', opsPerm('ops.deploy'), wrap(async (req, res) => {
    const job = deploy.getJob(req.params.jobId);
    if (!job) return fail(res, 404, 'NOT_FOUND', 'Deploy job not found');
    return ok(res, job);
  }));

  app.get('/ops/deploy', opsPerm('ops.deploy'), wrap(async (_req, res) => ok(res, deploy.listJobs())));

  // ------------------------------------------------------------------- power
  app.post('/ops/power/reboot', ownerOnly, opsPerm('ops.power'), opsStepUp, requireReason,
    wrap(async (req, res) => {
      if (req.body?.confirm !== 'REBOOT') {
        return fail(res, 400, 'CONFIRMATION_REQUIRED', 'Body must include confirm: "REBOOT"');
      }
      // Audit BEFORE executing — the box goes away right after.
      const auditEntry = {
        adminId: req.admin?._id, adminUsername: req.admin?.username, adminRole: req.admin?.role,
        deviceId: req.adminDevice?.deviceId, ip: req.ip,
        action: 'ops.power_reboot', targetType: 'host', reason: req.body.reason, result: 'success',
      };
      if (isMongoConnected()) {
        await require('../services/adminAudit').recordAdminAction(auditEntry)
          .catch(e => console.error('[OPS AUDIT] reboot:', e.message));
      } else {
        pendingAudit.writePending(auditEntry);
      }
      res.status(202).json({ ok: true, data: { rebooting: true } });
      setTimeout(() => { run('shutdown', ['-r', 'now']).catch(() => {}); }, 2000);
    }));

  // ------------------------------------------------------------ agent restart
  app.post('/ops/agent/restart', opsPerm('ops.control'), opsStepUp, requireReason,
    opsAudit('ops.agent_restart', { targetType: 'service', getTargetId: () => 'ops-agent' }),
    wrap(async (_req, res) => {
      ok(res, { restarting: true });
      setTimeout(() => { run('pm2', ['restart', 'ops-agent'], { timeoutMs: 30000 }).catch(() => {}); }, 500);
    }));

  // 404 + error handler
  app.use((_req, res) => fail(res, 404, 'NOT_FOUND', 'Not found'));
  app.use((error, _req, res, _next) => {
    console.error('[OPS ERROR]', error);
    return fail(res, 500, 'INTERNAL_ERROR', 'Internal error');
  });

  return app;
};

const main = async () => {
  await connectMongo();
  const app = createApp();
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`🛰️  Ops agent listening on http://127.0.0.1:${PORT}/ops (mongo: ${mongoConnected ? 'connected' : 'degraded'})`);
  });
};

if (require.main === module) {
  main().catch((e) => { console.error('[OPS] fatal:', e); process.exit(1); });
}

module.exports = { createApp, connectMongo, isMongoConnected, SERVICE_ALLOWLIST, LOG_SOURCES, DEGRADED_ALLOWED };
