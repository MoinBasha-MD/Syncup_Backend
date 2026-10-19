const crypto = require('crypto');
const mongoose = require('mongoose');
const AdminAuditLog = require('../models/AdminAuditLog');

const GENESIS_HASH = '0'.repeat(64);
const SENSITIVE_KEY = /pass(word)?|secret|token|otp|totp|recovery|code/i;
const REDACTED = '[REDACTED]';

// Fields that participate in the hash chain (in a fixed order)
const HASH_FIELDS = [
  'seq', 'at', 'adminId', 'adminUsername', 'adminRole', 'deviceId', 'ip', 'action',
  'targetType', 'targetId', 'reason', 'before', 'after', 'result', 'meta'
];

/**
 * Recursively replace values of sensitive-looking keys with '[REDACTED]'.
 */
const redact = (value) => {
  if (Array.isArray(value)) return value.map(redact);
  if (value instanceof Date || value instanceof mongoose.Types.ObjectId) return value;
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(item);
    }
    return out;
  }
  return value;
};

/**
 * Deterministic JSON: recursively sorted keys, Dates as ISO strings,
 * ObjectIds as hex strings.
 */
const normalize = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalize(value[key]);
    }
    return out;
  }
  return value;
};

const canonicalJSON = (value) => JSON.stringify(normalize(value));

const hashPayload = (doc) => ({
  seq: doc.seq,
  at: doc.at,
  adminId: doc.adminId,
  adminUsername: doc.adminUsername,
  adminRole: doc.adminRole,
  deviceId: doc.deviceId,
  ip: doc.ip,
  action: doc.action,
  targetType: doc.targetType,
  targetId: doc.targetId,
  reason: doc.reason,
  before: doc.before,
  after: doc.after,
  result: doc.result,
  meta: doc.meta
});

const computeHash = (doc) =>
  crypto.createHash('sha256')
    .update((doc.prevHash || '') + canonicalJSON(hashPayload(doc)))
    .digest('hex');

const appendEntry = async (entry) => {
  const last = await AdminAuditLog
    .findOne({})
    .sort({ seq: -1 })
    .select('seq hash')
    .lean();

  const seq = last ? last.seq + 1 : 1;
  const prevHash = last ? last.hash : GENESIS_HASH;

  const doc = {
    seq,
    at: entry.at ? new Date(entry.at) : new Date(),
    adminId: entry.adminId,
    adminUsername: entry.adminUsername,
    adminRole: entry.adminRole,
    deviceId: entry.deviceId,
    ip: entry.ip,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId != null ? String(entry.targetId) : undefined,
    reason: entry.reason,
    before: redact(entry.before),
    after: redact(entry.after),
    result: entry.result,
    meta: redact(entry.meta),
    prevHash
  };
  doc.hash = computeHash(doc);

  return AdminAuditLog.create(doc);
};

// Serialize appends so seq/prevHash reads are race-free inside the process
let writeQueue = Promise.resolve();

/**
 * Append a tamper-evident audit entry.
 * @param {Object} entry - { adminId, adminUsername, adminRole, deviceId, ip,
 *   action, targetType, targetId, reason, before, after, result, meta, at }
 */
const recordAdminAction = (entry) => {
  const run = writeQueue.then(async () => {
    try {
      const doc = await appendEntry(entry);
      try {
        require('./adminSocket').emitAdminEvent('audit:new', {
          seq: doc.seq, action: doc.action, adminUsername: doc.adminUsername,
          targetType: doc.targetType, targetId: doc.targetId, result: doc.result,
        });
      } catch { /* socket layer optional */ }
      return doc;
    } catch (error) {
      // Duplicate seq (e.g. a concurrent writer in another process beat us) —
      // re-read the tail and retry once.
      if (error && error.code === 11000) {
        return appendEntry(entry);
      }
      throw error;
    }
  });
  writeQueue = run.catch(() => {});
  return run;
};

/**
 * Walk the log in seq order and recompute every hash/link.
 * @returns {Promise<{ok: boolean, checked: number, brokenAtSeq: number|null}>}
 */
const verifyAuditChain = async ({ batchSize = 500 } = {}) => {
  let checked = 0;
  let lastSeq = 0;
  let expectedPrev = GENESIS_HASH;

  for (;;) {
    const docs = await AdminAuditLog
      .find({ seq: { $gt: lastSeq } })
      .sort({ seq: 1 })
      .limit(batchSize)
      .lean();

    if (docs.length === 0) break;

    for (const doc of docs) {
      checked += 1;
      const tampered = doc.prevHash !== expectedPrev || doc.hash !== computeHash(doc);
      if (tampered) {
        return { ok: false, checked, brokenAtSeq: doc.seq };
      }
      expectedPrev = doc.hash;
      lastSeq = doc.seq;
    }

    if (docs.length < batchSize) break;
  }

  return { ok: true, checked, brokenAtSeq: null };
};

module.exports = {
  recordAdminAction,
  verifyAuditChain,
  canonicalJSON,
  HASH_FIELDS
};
