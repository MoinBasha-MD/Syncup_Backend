/**
 * Lightweight in-process request metrics for the admin dashboard.
 * Rolling 60s window: requests/min, 5xx/min, p95 latency.
 */

const WINDOW_MS = 60 * 1000;
const PRUNE_INTERVAL_MS = 10 * 1000;

// [{t, ms, status5xx}]
let samples = [];
let lastPrune = 0;

const prune = (now) => {
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  const cutoff = now - WINDOW_MS;
  let i = 0;
  while (i < samples.length && samples[i].t < cutoff) i++;
  if (i > 0) samples = samples.slice(i);
};

/** Express middleware — mount early in server.js. */
const requestCounter = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const now = Date.now();
    samples.push({ t: now, ms, status5xx: res.statusCode >= 500 });
    prune(now);
  });
  next();
};

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(idx, 0)];
};

const snapshot = () => {
  const now = Date.now();
  prune(now);
  const cutoff = now - WINDOW_MS;
  const window = samples.filter(s => s.t >= cutoff);
  return {
    windowSeconds: WINDOW_MS / 1000,
    requestsPerMinute: window.length,
    errors5xxPerMinute: window.filter(s => s.status5xx).length,
    p95LatencyMs: Math.round(percentile(window.map(s => s.ms), 95) * 100) / 100,
    at: new Date(now).toISOString(),
  };
};

// test hook
const _reset = () => { samples = []; lastPrune = 0; };

module.exports = { requestCounter, snapshot, _reset };
