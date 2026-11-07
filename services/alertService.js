const Alert = require('../models/Alert');

const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Write an alert unless an identical dedupeKey fired within the last hour.
 * Samplers call this every 30s, so dedupe is what keeps the feed readable.
 */
const recordAlert = async ({ severity = 'warning', source, dedupeKey, message }) => {
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const existing = await Alert.findOne({ dedupeKey, createdAt: { $gte: since } }).lean();
  if (existing) return existing;
  return Alert.create({ severity, source, dedupeKey, message });
};

module.exports = { recordAlert };
