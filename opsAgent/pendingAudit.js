const fs = require('fs');
const path = require('path');

/**
 * While Mongo is unreachable the agent can't write AdminAuditLog docs, so
 * degraded-mode actions are appended as JSON lines and flushed into the real
 * audit service once the connection returns.
 */

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const PENDING_FILE = path.join(LOGS_DIR, 'ops-audit-pending.jsonl');

const writePending = (entry) => {
  try {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFileSync(PENDING_FILE, JSON.stringify({ ...entry, pendingSince: new Date().toISOString() }) + '\n');
    return true;
  } catch (error) {
    console.error('[OPS] pending audit write failed:', error.message);
    return false;
  }
};

/** Flush every pending entry into recordAdminAction, then truncate the file. */
const flushPending = async () => {
  let lines;
  try {
    lines = fs.readFileSync(PENDING_FILE, 'utf8').split('\n').filter(Boolean);
  } catch {
    return { flushed: 0 };
  }
  if (!lines.length) return { flushed: 0 };

  const { recordAdminAction } = require('../services/adminAudit');
  let flushed = 0;
  const failed = [];
  for (const line of lines) {
    try {
      const { pendingSince, ...entry } = JSON.parse(line);
      await recordAdminAction({ ...entry, metadata: { ...(entry.metadata || {}), recordedOfflineAt: pendingSince } });
      flushed += 1;
    } catch {
      failed.push(line);
    }
  }
  try {
    fs.writeFileSync(PENDING_FILE, failed.map(l => l + '\n').join(''));
  } catch (error) {
    console.error('[OPS] pending audit truncate failed:', error.message);
  }
  return { flushed, remaining: failed.length };
};

module.exports = { writePending, flushPending, PENDING_FILE };
