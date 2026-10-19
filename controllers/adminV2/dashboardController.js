const mongoose = require('mongoose');
const User = require('../../models/userModel');
const Message = require('../../models/Message');
const FeedPost = require('../../models/FeedPost');
const Ripple = require('../../models/Ripple');
const RippleReport = require('../../models/RippleReport');
const RippleSupport = require('../../models/RippleSupport');
const { ok, fail, handle } = require('../../utils/adminV2Response');

const DAY_MS = 24 * 60 * 60 * 1000;

const metricsSnapshot = () => {
  try {
    return require('../../services/adminMetrics').snapshot();
  } catch {
    return null;
  }
};

const onlineNow = () => {
  try {
    return require('../../socketManager').getUserSockets().size;
  } catch {
    return 0;
  }
};

const getOverview = handle(async (req, res) => {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const dayAgo = new Date(now - DAY_MS);
  const weekAgo = new Date(now - 7 * DAY_MS);
  const monthAgo = new Date(now - 30 * DAY_MS);

  const [
    totalUsers, onlineUsers, signupsToday, dau, wau, mau,
    bannedCount, suspendedCount, openReports, messagesToday, postsToday, ripplesActive,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isOnline: true }),
    User.countDocuments({ createdAt: { $gte: startOfToday } }),
    User.countDocuments({ lastSeen: { $gte: dayAgo } }),
    User.countDocuments({ lastSeen: { $gte: weekAgo } }),
    User.countDocuments({ lastSeen: { $gte: monthAgo } }),
    User.countDocuments({ 'accountStatus.state': 'banned' }),
    User.countDocuments({ 'accountStatus.state': 'suspended' }),
    RippleReport.countDocuments({ status: { $in: ['open', 'reviewing'] } }),
    Message.countDocuments({ timestamp: { $gte: startOfToday } }),
    FeedPost.countDocuments({ createdAt: { $gte: startOfToday } }),
    Ripple.countDocuments({ lifecycle: 'active' }),
  ]);

  return ok(res, {
    totalUsers,
    onlineNow: onlineNow() || onlineUsers,
    signupsToday,
    dau, wau, mau,
    bannedCount,
    suspendedCount,
    openReports,
    messagesToday,
    postsToday,
    ripplesActive,
    metrics: metricsSnapshot(),
  });
});

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

const METRICS = {
  users: { model: User, dateField: 'createdAt' },
  messages: { model: Message, dateField: 'timestamp' },
  posts: { model: FeedPost, dateField: 'createdAt' },
  ripples: { model: Ripple, dateField: 'createdAt', match: { kind: 'ripple' } },
  shorts: { model: Ripple, dateField: 'createdAt', match: { kind: 'short' } },
  supports: { model: RippleSupport, dateField: 'createdAt' },
};

const getTimeseries = handle(async (req, res) => {
  const { metric, range = '30d' } = req.query;
  const def = METRICS[metric];
  if (!def) return fail(res, 400, 'BAD_REQUEST', `metric must be one of: ${Object.keys(METRICS).join(', ')}`);
  const days = RANGE_DAYS[range];
  if (!days) return fail(res, 400, 'BAD_REQUEST', `range must be one of: ${Object.keys(RANGE_DAYS).join(', ')}`);

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  const rows = await def.model.aggregate([
    { $match: { [def.dateField]: { $gte: start }, ...(def.match || {}) } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: `$${def.dateField}`, timezone: 'UTC' } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const byDate = new Map(rows.map(r => [r._id, r.count]));
  const series = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, count: byDate.get(key) || 0 });
  }

  return ok(res, series);
});

module.exports = { getOverview, getTimeseries };
