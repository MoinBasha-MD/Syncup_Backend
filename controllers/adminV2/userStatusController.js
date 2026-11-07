const mongoose = require('mongoose');
const User = require('../../models/userModel');
const StatusHistory = require('../../models/statusHistoryModel');
const { broadcastStatusUpdate } = require('../../socketManager');
const { ok, fail, handle, parseLimit, escapeRegex } = require('../../utils/adminV2Response');

const STATUS_VALUES = new Set(['available', 'busy', 'away', 'dnd', 'offline', 'do not disturb']);

const normalizeStatus = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 32) return null;
  return STATUS_VALUES.has(trimmed.toLowerCase()) ? trimmed : null;
};

// undefined/invalid sentinel: `undefined` = invalid, `null` = clear.
const parseUntil = (value) => {
  if (value === null || value === '' || value === undefined) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return undefined;
  return date;
};

const findUserByParam = async (param) => {
  let user = await User.findOne({ userId: param });
  if (!user && mongoose.isValidObjectId(param)) user = await User.findById(param);
  return user;
};

const recordHistory = async (user, status, customStatus, statusUntil) => {
  const now = new Date();
  const endTime = statusUntil || new Date(now.getTime() + 24 * 60 * 60 * 1000);
  try {
    await StatusHistory.create({
      user: user._id,
      userId: user.userId,
      status,
      customStatus: customStatus || '',
      startTime: now,
      endTime,
      duration: Math.max(0, Math.floor((endTime.getTime() - now.getTime()) / 60000)),
    });
  } catch (error) {
    console.error('⚠️ [ADMIN STATUS] history write failed:', error.message);
  }
};

const emitStatus = async (req, user, status, customStatus, statusUntil) => {
  try {
    await broadcastStatusUpdate(
      user,
      { status, customStatus: customStatus || '', statusUntil, mainStatus: status },
      { visibility: 'all_contacts' },
    );
  } catch (error) {
    console.error('⚠️ [ADMIN STATUS] broadcast failed:', error.message);
  }
  try {
    req.app.get('io')?.emit('user:status_updated', {
      userId: user.userId,
      name: user.name,
      status,
      customStatus: customStatus || '',
      statusUntil,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
    });
  } catch {
    // socket layer optional
  }
};

const toRow = (user) => ({
  userId: user.userId,
  name: user.name,
  profileImage: user.profileImage,
  status: user.status,
  customStatus: user.customStatus,
  statusUntil: user.statusUntil,
  mainStatus: user.mainStatus,
  isOnline: user.isOnline,
  lastSeen: user.lastSeen,
});

const listStatusUsers = handle(async (req, res) => {
  const limit = parseLimit(req.query.limit);
  const filter = {};
  if (typeof req.query.q === 'string' && req.query.q.trim()) {
    const rx = new RegExp(escapeRegex(req.query.q.trim()), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { phoneNumber: rx }, { userId: rx }];
  }
  if (req.query.online === 'true') filter.isOnline = true;
  if (req.query.online === 'false') filter.isOnline = false;
  if (req.query.cursor && mongoose.isValidObjectId(req.query.cursor)) {
    filter._id = { $lt: new mongoose.Types.ObjectId(req.query.cursor) };
  }

  const users = await User.find(filter)
    .select('userId name profileImage status customStatus statusUntil mainStatus isOnline lastSeen')
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();

  const page = users.slice(0, limit);
  const nextCursor = users.length > limit ? String(page[page.length - 1]._id) : null;
  return ok(res, page.map(toRow), nextCursor);
});

const statusStats = handle(async (_req, res) => {
  const [total, online, rows] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isOnline: true }),
    User.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);
  const byStatus = {};
  for (const row of rows) byStatus[row._id || 'available'] = row.count;
  return ok(res, { total, online, byStatus });
});

const updateUserStatus = handle(async (req, res) => {
  const user = await findUserByParam(req.params.userId);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found');

  const status = normalizeStatus(req.body?.status);
  if (!status) return fail(res, 400, 'BAD_REQUEST', 'status is not a known availability value');

  const customStatus =
    typeof req.body?.customStatus === 'string' ? req.body.customStatus.slice(0, 100) : '';
  const until = parseUntil(req.body?.statusUntil);
  if (until === undefined) return fail(res, 400, 'BAD_REQUEST', 'statusUntil must be an ISO date or null');
  if (until && until.getTime() <= Date.now()) {
    return fail(res, 400, 'BAD_REQUEST', 'statusUntil must be in the future');
  }

  res.locals.auditBefore = {
    status: user.status,
    customStatus: user.customStatus,
    statusUntil: user.statusUntil,
  };
  user.status = status;
  user.customStatus = customStatus;
  user.statusUntil = until;
  user.mainStatus = status;
  await user.save();
  res.locals.auditAfter = { status, customStatus, statusUntil: until };

  await recordHistory(user, status, customStatus, until);
  await emitStatus(req, user, status, customStatus, until);

  return ok(res, { userId: user.userId, status, customStatus, statusUntil: until });
});

const bulkUpdateStatus = handle(async (req, res) => {
  const raw = req.body?.userIds;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) {
    return fail(res, 400, 'BAD_REQUEST', 'userIds must be an array of 1-100 ids');
  }
  const userIds = [...new Set(raw.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
  if (userIds.length === 0) return fail(res, 400, 'BAD_REQUEST', 'userIds is empty');

  const status = normalizeStatus(req.body?.status);
  if (!status) return fail(res, 400, 'BAD_REQUEST', 'status is not a known availability value');

  const customStatus =
    typeof req.body?.customStatus === 'string' ? req.body.customStatus.slice(0, 100) : '';
  const until = parseUntil(req.body?.statusUntil);
  if (until === undefined) return fail(res, 400, 'BAD_REQUEST', 'statusUntil must be an ISO date or null');
  if (until && until.getTime() <= Date.now()) {
    return fail(res, 400, 'BAD_REQUEST', 'statusUntil must be in the future');
  }

  const users = await User.find({ userId: { $in: userIds } });
  if (users.length === 0) return fail(res, 404, 'NOT_FOUND', 'No matching users');

  res.locals.auditBefore = { requested: userIds.length, matched: users.length };
  await User.updateMany(
    { userId: { $in: users.map((user) => user.userId) } },
    { $set: { status, customStatus, statusUntil: until, mainStatus: status } },
  );

  for (const user of users) {
    await recordHistory(user, status, customStatus, until);
    await emitStatus(req, user, status, customStatus, until);
  }

  res.locals.auditAfter = { updated: users.length, status };
  return ok(res, { updated: users.length, requested: userIds.length });
});

const statusHistory = handle(async (req, res) => {
  const user = await findUserByParam(req.params.userId);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found');
  const limit = parseLimit(req.query.limit, { fallback: 50, max: 200 });
  const history = await StatusHistory.find({ userId: user.userId })
    .sort({ startTime: -1 })
    .limit(limit)
    .lean();
  return ok(res, history);
});

module.exports = {
  listStatusUsers,
  statusStats,
  updateUserStatus,
  bulkUpdateStatus,
  statusHistory,
  // test hooks
  _internal: { normalizeStatus, parseUntil, STATUS_VALUES },
};
