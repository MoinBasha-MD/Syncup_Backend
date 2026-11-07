const mongoose = require('mongoose');

/**
 * One sampler tick. TTL-indexed for 7 days; the admin UI downsamples into
 * 5-minute buckets. No external TSDB required.
 */
const metricSampleSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true, default: Date.now },
    cpuPct: Number,
    rssBytes: Number,
    heapUsedBytes: Number,
    load1: Number,
    requestsPerMinute: Number,
    p50LatencyMs: Number,
    p95LatencyMs: Number,
    p99LatencyMs: Number,
    errors5xxPerMinute: Number,
    errors4xxPerMinute: Number,
    errorRatePct: Number,
    onlineUsers: Number,
    activeSockets: Number,
    pm2Restarts: Number,
    diskUsedPct: Number,
    mongoReadyState: Number,
    mongoPingMs: Number,
  },
  { versionKey: false },
);

metricSampleSchema.index({ at: -1 });
metricSampleSchema.index({ at: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('MetricSample', metricSampleSchema);
