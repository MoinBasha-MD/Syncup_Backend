const os = require('os');
const fs = require('fs');
const tls = require('tls');
const mongoose = require('mongoose');
const { execFile } = require('child_process');
const MetricSample = require('../models/MetricSample');
const { snapshot } = require('./adminMetrics');
const { recordAlert } = require('./alertService');

const TICK_MS = 30 * 1000;
const PM2_CACHE_MS = 5 * 60 * 1000;
const TLS_CHECK_MS = 30 * 60 * 1000;
const BACKUP_STATUS_FILE = process.env.BACKUP_STATUS_FILE || '/var/backups/syncup/status.json';
const TLS_HOST = process.env.TLS_HOST || 'api.crackman.in';

let timer = null;
let previousCpu = process.cpuUsage();
let previousCpuAt = Date.now();
let pm2Cache = { at: 0, restarts: null };
let previousPm2Restarts = null;
let lastTlsCheck = 0;
let lastTlsDays = null;

const readPm2Restarts = () =>
  new Promise((resolve) => {
    if (Date.now() - pm2Cache.at < PM2_CACHE_MS) return resolve(pm2Cache.restarts);
    execFile('pm2', ['jlist'], { timeout: 4000 }, (error, stdout) => {
      if (error) return resolve(pm2Cache.restarts);
      try {
        const list = JSON.parse(stdout);
        const server = list.find((process) => process.name === 'server');
        const restarts = server?.pm2_env?.restart_time ?? null;
        pm2Cache = { at: Date.now(), restarts };
        resolve(restarts);
      } catch {
        resolve(pm2Cache.restarts);
      }
    });
  });

const diskUsedPct = async () => {
  try {
    const stats = await fs.promises.statfs('/');
    const used = stats.blocks - stats.bavail;
    return Math.round((used / stats.blocks) * 1000) / 10;
  } catch {
    return null;
  }
};

const mongoPing = async () => {
  const readyState = mongoose.connection.readyState;
  if (readyState !== 1) return { readyState, ms: null };
  const start = Date.now();
  try {
    await mongoose.connection.db.admin().ping();
    return { readyState: 1, ms: Date.now() - start };
  } catch {
    return { readyState, ms: null };
  }
};

const readBackupStatus = async () => {
  try {
    return JSON.parse(await fs.promises.readFile(BACKUP_STATUS_FILE, 'utf8'));
  } catch {
    return null;
  }
};

const tlsDaysRemaining = () =>
  new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const socket = tls.connect(
      443,
      TLS_HOST,
      { servername: TLS_HOST, timeout: 6000 },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          const days = Math.floor((new Date(cert.valid_to) - Date.now()) / 86400000);
          socket.end();
          done(days);
        } catch {
          socket.destroy();
          done(null);
        }
      },
    );
    socket.on('error', () => done(null));
    socket.on('timeout', () => {
      socket.destroy();
      done(null);
    });
  });

const onlineUsers = () => {
  try {
    return require('../socketManager').getUserSockets().size;
  } catch {
    return 0;
  }
};

const raiseAlerts = async ({ sample, backup, tlsDays }) => {
  if (sample.mongoReadyState !== 1) {
    await recordAlert({
      severity: 'critical',
      source: 'mongo',
      dedupeKey: 'mongo-down',
      message: 'MongoDB is not connected (readyState ' + sample.mongoReadyState + ')',
    });
  }
  if (typeof sample.diskUsedPct === 'number' && sample.diskUsedPct >= 80) {
    const critical = sample.diskUsedPct >= 90;
    await recordAlert({
      severity: critical ? 'critical' : 'warning',
      source: 'disk',
      dedupeKey: critical ? 'disk-full' : 'disk-high',
      message: `Root disk at ${sample.diskUsedPct}% (threshold ${critical ? 90 : 80}%)`,
    });
  }
  if (typeof sample.errorRatePct === 'number' && sample.errorRatePct > 5) {
    await recordAlert({
      severity: 'warning',
      source: 'api',
      dedupeKey: 'api-error-rate',
      message: `API 5xx rate is ${sample.errorRatePct}% over the last 60s`,
    });
  }
  if (previousPm2Restarts !== null && typeof sample.pm2Restarts === 'number' && sample.pm2Restarts > previousPm2Restarts) {
    await recordAlert({
      severity: 'info',
      source: 'pm2',
      dedupeKey: 'pm2-restart',
      message: `server restarted (${sample.pm2Restarts - previousPm2Restarts} new restart(s))`,
    });
  }
  if (backup?.lastSuccessAt) {
    const ageHours = (Date.now() - new Date(backup.lastSuccessAt).getTime()) / 3600000;
    if (ageHours > 24) {
      await recordAlert({
        severity: ageHours > 48 ? 'critical' : 'warning',
        source: 'backup',
        dedupeKey: 'backup-overdue',
        message: `Last successful backup was ${Math.round(ageHours)}h ago`,
      });
    }
  }
  if (typeof tlsDays === 'number' && tlsDays <= 30) {
    await recordAlert({
      severity: tlsDays <= 7 ? 'critical' : 'warning',
      source: 'tls',
      dedupeKey: 'tls-expiry',
      message: `TLS certificate for ${TLS_HOST} expires in ${tlsDays} days`,
    });
  }
};

const sampleOnce = async () => {
  const now = Date.now();
  const cpu = process.cpuUsage(previousCpu);
  const elapsedUs = Math.max((now - previousCpuAt) * 1000, 1);
  const cpuPct = Math.min(100, Math.round(((cpu.user + cpu.system) / elapsedUs) * 1000) / 10);
  previousCpu = process.cpuUsage();
  previousCpuAt = now;

  const memory = process.memoryUsage();
  const metrics = snapshot();
  const [pm2Restarts, disk, mongo] = await Promise.all([
    readPm2Restarts(),
    diskUsedPct(),
    mongoPing(),
  ]);

  const sample = {
    at: new Date(now),
    cpuPct,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    load1: os.loadavg()[0],
    requestsPerMinute: metrics.requestsPerMinute,
    p50LatencyMs: metrics.p50LatencyMs,
    p95LatencyMs: metrics.p95LatencyMs,
    p99LatencyMs: metrics.p99LatencyMs,
    errors5xxPerMinute: metrics.errors5xxPerMinute,
    errors4xxPerMinute: metrics.errors4xxPerMinute,
    errorRatePct: metrics.errorRatePct,
    onlineUsers: onlineUsers(),
    activeSockets: metrics.activeSockets,
    pm2Restarts,
    diskUsedPct: disk,
    mongoReadyState: mongo.readyState,
    mongoPingMs: mongo.ms,
  };

  await MetricSample.create(sample);

  const backup = await readBackupStatus();
  let tlsDays = lastTlsDays;
  if (now - lastTlsCheck > TLS_CHECK_MS) {
    lastTlsCheck = now;
    tlsDays = await tlsDaysRemaining();
    lastTlsDays = tlsDays;
  }

  await raiseAlerts({ sample, backup, tlsDays });
  previousPm2Restarts = typeof pm2Restarts === 'number' ? pm2Restarts : previousPm2Restarts;
  return sample;
};

const startMetricsSampler = async () => {
  if (timer) return;
  const tick = async () => {
    try {
      await sampleOnce();
    } catch (error) {
      console.error('⚠️ [METRICS] sample failed:', error.message);
    }
  };
  await tick();
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  console.log('✅ [METRICS] sampler started (30s interval, 7d retention)');
};

const stopMetricsSampler = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

// test hook
const _reset = () => {
  pm2Cache = { at: 0, restarts: null };
  previousPm2Restarts = null;
  lastTlsCheck = 0;
  lastTlsDays = null;
};

module.exports = { startMetricsSampler, stopMetricsSampler, sampleOnce, _reset };
