const fs = require('fs');
const MetricSample = require('../../models/MetricSample');
const JobRun = require('../../models/JobRun');
const { ok, fail, handle } = require('../../utils/adminV2Response');

const RANGES = { '1h': 3600 * 1000, '24h': 24 * 3600 * 1000, '7d': 7 * 24 * 3600 * 1000 };
const BUCKET_MS = 5 * 60 * 1000;
const NUMERIC_FIELDS = [
  'cpuPct', 'rssBytes', 'heapUsedBytes', 'load1', 'requestsPerMinute',
  'p50LatencyMs', 'p95LatencyMs', 'p99LatencyMs', 'errors5xxPerMinute',
  'errors4xxPerMinute', 'errorRatePct', 'onlineUsers', 'activeSockets',
  'pm2Restarts', 'diskUsedPct', 'mongoReadyState', 'mongoPingMs',
];

const getMetricHistory = handle(async (req, res) => {
  const range = req.query.range || '24h';
  const windowMs = RANGES[range];
  if (!windowMs) {
    return fail(res, 400, 'BAD_REQUEST', `range must be one of: ${Object.keys(RANGES).join(', ')}`);
  }
  const since = new Date(Date.now() - windowMs);
  const samples = await MetricSample.find({ at: { $gte: since } }).sort({ at: 1 }).lean();

  const buckets = new Map();
  for (const sample of samples) {
    const key = Math.floor(sample.at.getTime() / BUCKET_MS) * BUCKET_MS;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { at: new Date(key).toISOString(), count: 0, totals: {} };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    for (const field of NUMERIC_FIELDS) {
      if (typeof sample[field] === 'number') {
        bucket.totals[field] = (bucket.totals[field] || 0) + sample[field];
      }
    }
  }

  const rows = [...buckets.values()]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((bucket) => {
      const row = { at: bucket.at };
      for (const field of NUMERIC_FIELDS) {
        row[field] = bucket.totals[field] === undefined
          ? null
          : Math.round((bucket.totals[field] / bucket.count) * 100) / 100;
      }
      return row;
    });

  return ok(res, rows);
});

const getJobs = handle(async (_req, res) => {
  const jobs = await JobRun.find().sort({ name: 1 }).lean();
  return ok(res, jobs.map((job) => ({
    name: job.name,
    lastRunAt: job.lastRunAt,
    lastStatus: job.lastStatus,
    lastError: job.lastError,
    lastDurationMs: job.lastDurationMs,
  })));
});

const BACKUP_FILE = process.env.BACKUP_STATUS_FILE || '/var/backups/syncup/status.json';

const getBackups = handle(async (_req, res) => {
  try {
    const raw = await fs.promises.readFile(BACKUP_FILE, 'utf8');
    const status = JSON.parse(raw);
    const last = status.lastSuccessAt ? new Date(status.lastSuccessAt) : null;
    const ageMs = last ? Date.now() - last.getTime() : null;
    return ok(res, {
      available: true,
      lastSuccessAt: status.lastSuccessAt ?? null,
      sizeBytes: status.sizeBytes ?? null,
      verifiedAt: status.verifiedAt ?? null,
      ok: Boolean(last && !isNaN(last.getTime()) && ageMs < 24 * 3600 * 1000),
    });
  } catch {
    return ok(res, { available: false });
  }
});

module.exports = { getMetricHistory, getJobs, getBackups };
