const mongoose = require('mongoose');
const User = require('../../models/userModel');
const Friend = require('../../models/Friend');
const FeedPost = require('../../models/FeedPost');
const Ripple = require('../../models/Ripple');
const RippleReport = require('../../models/RippleReport');
const Message = require('../../models/Message');
const Comment = require('../../models/Comment');
const Story = require('../../models/storyModel');
const Notification = require('../../models/Notification');
const DeviceSession = require('../../models/DeviceSession');
const GroupMember = require('../../models/groupMemberModel');
const AdminAuditLog = require('../../models/AdminAuditLog');
const { ok, fail, handle, escapeRegex, parseLimit, isValidObjectId } = require('../../utils/adminV2Response');
const { getAccountBlock } = require('../../utils/accountState');
const { setAccountState, forceLogoutUser } = require('../../services/userSessionControl');
const { signImpersonationToken } = require('../../utils/generateToken');
const { dispatchNotification, CATEGORY_COLORS } = require('../../services/notificationDispatcher');

// ---- helpers ----------------------------------------------------------------

const maskPhone = (phone) => {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length <= 4) return '*'.repeat(digits.length);
  return `${digits.slice(0, 2)}${'*'.repeat(Math.max(digits.length - 4, 2))}${digits.slice(-2)}`;
};

const maskEmail = (email) => {
  if (!email) return null;
  const [local, domain] = String(email).split('@');
  if (!domain) return `${String(local || '')[0] || ''}***`;
  return `${local[0] || ''}***@${domain}`;
};

const slimUser = (u) => ({
  userId: u.userId,
  name: u.name,
  profileImage: u.profileImage,
  phoneMasked: maskPhone(u.phoneNumber),
  emailMasked: maskEmail(u.email),
  state: u.accountStatus?.state || 'active',
  isOnline: u.isOnline,
  lastSeen: u.lastSeen,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

const SLIM_SELECT = 'userId name profileImage phoneNumber email accountStatus isOnline lastSeen createdAt updatedAt';

const findUserByParam = async (param) => {
  let user = await User.findOne({ userId: param });
  if (!user && isValidObjectId(param)) {
    user = await User.findById(param);
  }
  return user;
};

// Explicit allowlist for the User 360 payload — no password, and no field whose
// name contains key/secret/otp/encrypt/hash/salt/token (tokenVersion and the
// summarized fcmTokens shape are the deliberate exceptions).
const user360 = (u, counts, sessions) => ({
  userId: u.userId,
  name: u.name,
  username: u.username,
  bio: u.bio,
  email: u.email,
  phoneNumber: u.phoneNumber,
  profileImage: u.profileImage,
  gender: u.gender,
  dateOfBirth: u.dateOfBirth,
  emailVerified: u.emailVerified,
  isPublic: u.isPublic,
  userRole: u.userRole,
  isOnline: u.isOnline,
  lastSeen: u.lastSeen,
  status: u.status,
  customStatus: u.customStatus,
  statusUntil: u.statusUntil,
  mainStatus: u.mainStatus,
  subStatus: u.subStatus,
  accountStatus: u.accountStatus || { state: 'active' },
  tokenVersion: u.tokenVersion || 0,
  deletedAt: u.deletedAt || null,
  devices: (u.deviceTokens || []).map(d => ({
    platform: d.platform,
    lastActive: d.lastActive,
    isActive: d.isActive,
  })),
  fcmTokens: {
    count: (u.fcmTokens || []).length,
    platforms: [...new Set((u.fcmTokens || []).map(t => t.platform))],
    lastUsed: (u.fcmTokens || []).reduce((max, t) => (!max || t.lastUsed > max ? t.lastUsed : max), null),
  },
  counts,
  sessions,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

// ---- list / sync ------------------------------------------------------------

const listUsers = handle(async (req, res) => {
  const { q, state, online, since, cursor } = req.query;
  const limit = parseLimit(req.query.limit);

  const filter = {};
  if (typeof q === 'string' && q.trim()) {
    const rx = new RegExp(escapeRegex(q.trim()), 'i');
    filter.$or = [
      { name: rx }, { email: rx }, { phoneNumber: rx }, { userId: rx }, { username: rx },
    ];
  }
  if (state && ['active', 'suspended', 'banned', 'deleted'].includes(state)) {
    filter['accountStatus.state'] = state;
  }
  if (online === 'true') filter.isOnline = true;
  if (online === 'false') filter.isOnline = false;
  if (since) {
    const sinceDate = new Date(since);
    if (!isNaN(sinceDate)) filter.updatedAt = { $gte: sinceDate };
  }
  if (cursor && isValidObjectId(cursor)) {
    filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  }

  const users = await User.find(filter)
    .select(SLIM_SELECT)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();

  const page = users.slice(0, limit);
  const nextCursor = users.length > limit ? String(page[page.length - 1]._id) : null;
  return ok(res, page.map(slimUser), nextCursor);
});

const SYNC_PAGE = 500;

const syncUsers = handle(async (req, res) => {
  const { since, cursor } = req.query;
  const filter = {};

  if (cursor) {
    const [ts, id] = String(cursor).split('|');
    const cursorDate = new Date(ts);
    if (!isNaN(cursorDate) && isValidObjectId(id)) {
      filter.$or = [
        { updatedAt: { $gt: cursorDate } },
        { updatedAt: cursorDate, _id: { $gt: new mongoose.Types.ObjectId(id) } },
      ];
    }
  } else if (since) {
    const sinceDate = new Date(since);
    if (!isNaN(sinceDate)) filter.updatedAt = { $gt: sinceDate };
  }

  const users = await User.find(filter)
    .select(SLIM_SELECT)
    .sort({ updatedAt: 1, _id: 1 })
    .limit(SYNC_PAGE + 1)
    .lean();

  const page = users.slice(0, SYNC_PAGE);
  const last = page[page.length - 1];
  const nextCursor = users.length > SYNC_PAGE && last
    ? `${last.updatedAt.toISOString()}|${last._id}`
    : null;

  return res.json({
    ok: true,
    data: page.map(slimUser),
    nextCursor,
    serverTime: new Date().toISOString(),
  });
});

// ---- 360 / audit ------------------------------------------------------------

const getUser360 = handle(async (req, res) => {
  const user = await findUserByParam(req.params.userId);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found');
  const u = user.toObject ? user.toObject() : user;

  const [friends, posts, ripples, messagesSent, openReports, sessions] = await Promise.all([
    Friend.countDocuments({ userId: u.userId, status: 'accepted', isDeleted: false }),
    FeedPost.countDocuments({ userId: u.userId }),
    Ripple.countDocuments({ hostUserId: u.userId }),
    Message.countDocuments({ senderId: u.userId }),
    RippleReport.countDocuments({ reportedUserId: u.userId, status: { $in: ['open', 'reviewing'] } }),
    DeviceSession.find({ userId: u.userId, status: 'active' })
      .select('sessionId deviceId deviceName platform lastSeenAt')
      .lean(),
  ]);

  return ok(res, user360(u, { friends, posts, ripples, messagesSent, openReports }, sessions));
});

const getUserAudit = handle(async (req, res) => {
  const user = await findUserByParam(req.params.userId);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found');
  const limit = parseLimit(req.query.limit);
  const filter = { targetType: 'user', targetId: user.userId };
  if (req.query.cursor) {
    const seq = parseInt(req.query.cursor, 10);
    if (!isNaN(seq)) filter.seq = { $lt: seq };
  }
  const docs = await AdminAuditLog.find(filter)
    .sort({ seq: -1 })
    .limit(limit + 1)
    .select('-before -after -meta -hash -prevHash')
    .lean();
  const page = docs.slice(0, limit);
  const nextCursor = docs.length > limit ? String(page[page.length - 1].seq) : null;
  return ok(res, page, nextCursor);
});

// ---- mutations ---------------------------------------------------------------

const USER_EDITABLE_FIELDS = ['name', 'bio', 'email', 'phoneNumber', 'profileImage'];

const patchUser = handle(async (req, res) => {
  const user = await findUserByParam(req.params.userId);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found');

  const updates = {};
  for (const field of USER_EDITABLE_FIELDS) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }
  if (Object.keys(updates).length === 0) {
    return fail(res, 400, 'BAD_REQUEST', `Allowed fields: ${USER_EDITABLE_FIELDS.join(', ')}`);
  }

  res.locals.auditBefore = Object.fromEntries(USER_EDITABLE_FIELDS.map(f => [f, user[f]]));
  Object.assign(user, updates);
  await user.save();
  res.locals.auditAfter = updates;

  return ok(res, { userId: user.userId, updated: updates });
});

const changeState = (state, { allowStates } = {}) => handle(async (req, res) => {
  const user = await findUserByParam(req.params.userId);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found');

  if (allowStates && !allowStates.includes(user.accountStatus?.state || 'active')) {
    return fail(res, 409, 'INVALID_STATE', `Cannot reinstate from state '${user.accountStatus?.state || 'active'}'`);
  }

  res.locals.auditBefore = { accountStatus: user.accountStatus };
  const updated = await setAccountState(user.userId, {
    state,
    reason: req.body.reason,
    until: req.body.until ? new Date(req.body.until) : undefined,
    by: String(req.admin._id),
  });
  res.locals.auditAfter = { accountStatus: updated?.accountStatus };

  return ok(res, { userId: user.userId, state });
});

const suspendUser = handle(async (req, res) => {
  const user = await findUserByParam(req.params.userId);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found');

  let until = null;
  if (req.body.until) {
    until = new Date(req.body.until);
    const now = Date.now();
    if (isNaN(until.getTime()) || until.getTime() <= now) {
      return fail(res, 400, 'BAD_REQUEST', 'until must be a future ISO date');
    }
    if (until.getTime() > now + 365 * 24 * 60 * 60 * 1000) {
      return fail(res, 400, 'BAD_REQUEST', 'until must be within 365 days');
    }
  }

  res.locals.auditBefore = { accountStatus: user.accountStatus };
  const updated = await setAccountState(user.userId, {
    state: 'suspended',
    reason: req.body.reason,
    until,
    by: String(req.admin._id),
  });
  res.locals.auditAfter = { accountStatus: updated?.accountStatus };
  return ok(res, { userId: user.userId, state: 'suspended', until });
});

const forceLogout = handle(async (req, res) => {
  const user = await findUserByParam(req.params.userId);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found');
  const tokenVersion = await forceLogoutUser(user.userId, { reason: req.body.reason });
  res.locals.auditAfter = { tokenVersion };
  return ok(res, { userId: user.userId, tokenVersion });
});

const impersonate = handle(async (req, res) => {
  const user = await findUserByParam(req.params.userId);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found');
  if (getAccountBlock(user)) {
    return fail(res, 409, 'ACCOUNT_BLOCKED', 'Cannot impersonate a blocked account');
  }
  const token = signImpersonationToken(user, req.admin._id);
  const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  return ok(res, {
    token,
    expiresAt: new Date(decoded.exp * 1000).toISOString(),
    user: { userId: user.userId, name: user.name },
  });
});

const notifyUser = handle(async (req, res) => {
  const user = await findUserByParam(req.params.userId);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found');

  const { title, body, category } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || title.length > 80) {
    return fail(res, 400, 'BAD_REQUEST', 'title is required (max 80 chars)');
  }
  if (typeof body !== 'string' || !body.trim() || body.length > 240) {
    return fail(res, 400, 'BAD_REQUEST', 'body is required (max 240 chars)');
  }
  if (category !== undefined && !Object.keys(CATEGORY_COLORS).includes(category)) {
    return fail(res, 400, 'BAD_REQUEST', 'Unknown category');
  }

  try {
    await dispatchNotification({
      toUserId: user.userId,
      fromUserId: 'system',
      type: 'admin_notice',
      category,
      title: title.trim(),
      body: body.trim(),
    });
  } catch (error) {
    return fail(res, 502, 'NOTIFY_FAILED', 'Failed to deliver notification');
  }

  return ok(res, { sent: true });
});

// ---- export / content / messages meta ----------------------------------------

const exportUser = handle(async (req, res) => {
  const user = await findUserByParam(req.params.userId);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found');
  const u = user.toObject ? user.toObject() : user;

  const [friends, posts, ripples, notifications, sessions] = await Promise.all([
    Friend.find({ userId: u.userId, isDeleted: false }).select('friendUserId status').lean(),
    FeedPost.find({ userId: u.userId }).sort({ createdAt: -1 }).limit(1000).lean(),
    Ripple.find({ hostUserId: u.userId }).sort({ createdAt: -1 }).limit(1000).lean(),
    Notification.find({ userId: u.userId }).sort({ createdAt: -1 }).limit(1000).lean(),
    DeviceSession.find({ userId: u.userId }).select('sessionId deviceId deviceName platform status lastSeenAt createdAt').lean(),
  ]);

  return ok(res, {
    exportedAt: new Date().toISOString(),
    profile: user360(u, {}, sessions),
    friends: friends.map(f => ({ friendUserId: f.friendUserId, status: f.status })),
    posts,
    ripples,
    notifications,
  });
});

const CONTENT_MODELS = {
  posts: { model: FeedPost, userField: 'userId' },
  ripples: { model: Ripple, userField: 'hostUserId', match: { kind: 'ripple' } },
  shorts: { model: Ripple, userField: 'hostUserId', match: { kind: 'short' } },
  comments: { model: Comment, userField: 'userId' },
  stories: { model: Story, userField: 'userId' },
};

const listUserContent = handle(async (req, res) => {
  const user = await findUserByParam(req.params.userId);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found');

  const def = CONTENT_MODELS[req.query.type];
  if (!def) return fail(res, 400, 'BAD_REQUEST', `type must be one of: ${Object.keys(CONTENT_MODELS).join(', ')}`);
  const limit = parseLimit(req.query.limit);

  const filter = { [def.userField]: user.userId, ...(def.match || {}) };
  if (req.query.cursor && isValidObjectId(req.query.cursor)) {
    filter._id = { $lt: new mongoose.Types.ObjectId(req.query.cursor) };
  }

  const docs = await def.model.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();

  const page = docs.slice(0, limit);
  const nextCursor = docs.length > limit ? String(page[page.length - 1]._id) : null;
  return ok(res, page, nextCursor);
});

const messageMeta = handle(async (req, res) => {
  const user = await findUserByParam(req.params.userId);
  if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found');
  const uid = user.userId;

  // Metadata ONLY — the first $project keeps ids/direction/timestamp; message
  // bodies, file metadata, image urls and encrypted fields never leave mongo.
  const counterparts = await Message.aggregate([
    { $match: { $or: [{ senderId: uid }, { receiverId: uid }] } },
    { $project: { _id: 0, senderId: 1, receiverId: 1, timestamp: 1 } },
    {
      $group: {
        _id: { $cond: [{ $eq: ['$senderId', uid] }, '$receiverId', '$senderId'] },
        sent: { $sum: { $cond: [{ $eq: ['$senderId', uid] }, 1, 0] } },
        received: { $sum: { $cond: [{ $eq: ['$receiverId', uid] }, 1, 0] } },
        firstAt: { $min: '$timestamp' },
        lastAt: { $max: '$timestamp' },
      },
    },
    { $sort: { lastAt: -1 } },
    { $limit: 200 },
  ]);

  const counterpartIds = counterparts.map(c => c._id).filter(Boolean);
  const names = await User.find({ userId: { $in: counterpartIds } }).select('userId name').lean();
  const nameById = new Map(names.map(n => [n.userId, n.name]));

  const memberships = await GroupMember.find({ userId: uid })
    .select('groupId role joinedAt')
    .lean();
  const groupIds = memberships.map(m => m.groupId).filter(Boolean);
  let groups = [];
  if (groupIds.length) {
    const GroupChat = require('../../models/groupChatModel');
    const groupDocs = await GroupChat.find({ _id: { $in: groupIds } }).select('groupName').lean();
    const nameByGroup = new Map(groupDocs.map(g => [String(g._id), g.groupName]));
    groups = memberships.map(m => ({
      groupId: String(m.groupId),
      name: nameByGroup.get(String(m.groupId)) || null,
      joinedAt: m.joinedAt,
      role: m.role,
    }));
  }

  return ok(res, {
    counterparts: counterparts.map(c => ({
      counterpartUserId: c._id,
      counterpartName: nameById.get(c._id) || null,
      sent: c.sent,
      received: c.received,
      firstAt: c.firstAt,
      lastAt: c.lastAt,
    })),
    groups,
  });
});

module.exports = {
  listUsers,
  syncUsers,
  getUser360,
  getUserAudit,
  patchUser,
  suspendUser,
  banUser: changeState('banned'),
  reinstateUser: changeState('active', { allowStates: ['suspended', 'banned', 'deleted'] }),
  deleteUser: changeState('deleted'),
  restoreUser: changeState('active'),
  forceLogout,
  impersonate,
  notifyUser,
  exportUser,
  listUserContent,
  messageMeta,
};
