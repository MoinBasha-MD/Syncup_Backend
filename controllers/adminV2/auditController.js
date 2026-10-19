const AdminAuditLog = require('../../models/AdminAuditLog');
const { verifyAuditChain } = require('../../services/adminAudit');
const { ok, handle, parseLimit } = require('../../utils/adminV2Response');

const listAudit = handle(async (req, res) => {
  const { adminId, action, targetType, targetId, from, to, cursor } = req.query;
  const limit = parseLimit(req.query.limit);

  const filter = {};
  if (adminId) filter.adminId = adminId;
  if (action) filter.action = action;
  if (targetType) filter.targetType = targetType;
  if (targetId) filter.targetId = targetId;
  if (from || to) {
    filter.at = {};
    if (from) {
      const d = new Date(from);
      if (!isNaN(d)) filter.at.$gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!isNaN(d)) filter.at.$lte = d;
    }
  }
  if (cursor) {
    const seq = parseInt(cursor, 10);
    if (!isNaN(seq)) filter.seq = { $lt: seq };
  }

  const docs = await AdminAuditLog.find(filter)
    .sort({ seq: -1 })
    .limit(limit + 1)
    .lean();

  const page = docs.slice(0, limit);
  const nextCursor = docs.length > limit ? String(page[page.length - 1].seq) : null;
  return ok(res, page, nextCursor);
});

const verify = handle(async (req, res) => {
  return ok(res, await verifyAuditChain());
});

module.exports = { listAudit, verify };
