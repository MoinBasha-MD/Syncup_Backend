const mongoose = require('mongoose');
const Alert = require('../../models/Alert');
const { ok, fail, handle, parseLimit } = require('../../utils/adminV2Response');

const toAlert = (alert) => ({
  id: String(alert._id),
  severity: alert.severity,
  source: alert.source,
  message: alert.message,
  status: alert.status,
  createdAt: alert.createdAt,
  ackedBy: alert.ackedBy,
  ackedAt: alert.ackedAt,
  resolvedBy: alert.resolvedBy,
  resolvedAt: alert.resolvedAt,
});

const listAlerts = handle(async (req, res) => {
  const limit = parseLimit(req.query.limit);
  const filter = {};
  const status = req.query.status;
  if (status && status !== 'all') {
    if (!['open', 'acknowledged', 'resolved'].includes(status)) {
      return fail(res, 400, 'BAD_REQUEST', 'status must be open, acknowledged, resolved or all');
    }
    filter.status = status;
  }
  if (req.query.cursor && mongoose.isValidObjectId(req.query.cursor)) {
    filter._id = { $lt: new mongoose.Types.ObjectId(req.query.cursor) };
  }

  const docs = await Alert.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const page = docs.slice(0, limit);
  const nextCursor = docs.length > limit ? String(page[page.length - 1]._id) : null;
  return ok(res, page.map(toAlert), nextCursor);
});

const transition = (status, fields) => handle(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return fail(res, 400, 'BAD_REQUEST', 'Invalid alert id');
  }
  const alert = await Alert.findById(req.params.id);
  if (!alert) return fail(res, 404, 'NOT_FOUND', 'Alert not found');
  if (alert.status === 'resolved') return ok(res, toAlert(alert));
  alert.status = status;
  Object.assign(alert, fields(req));
  await alert.save();
  return ok(res, toAlert(alert));
});

const ackAlert = transition('acknowledged', (req) => ({
  ackedBy: req.admin?.username || String(req.admin?._id),
  ackedAt: new Date(),
}));

const resolveAlert = transition('resolved', (req) => ({
  resolvedBy: req.admin?.username || String(req.admin?._id),
  resolvedAt: new Date(),
}));

module.exports = { listAlerts, ackAlert, resolveAlert };
