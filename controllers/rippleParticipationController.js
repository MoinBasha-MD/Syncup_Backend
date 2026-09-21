const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Ripple = require('../models/Ripple');
const Rippler = require('../models/Rippler');
const RippleSupport = require('../models/RippleSupport');
const GroupChat = require('../models/groupChatModel');
const GroupMember = require('../models/groupMemberModel');
const Notification = require('../models/Notification');
const User = require('../models/userModel');
const {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} = require('../utils/errorClasses');
const { getViewerContext } = require('../services/openNetworkVisibility');
// Lazy require to break any circular dependency with socketManager.
const getSocketManager = () => require('../socketManager');
const fcmNotificationService = require('../services/fcmNotificationService');

const JOINABLE = ['active', 'scheduled'];
const MANAGER_ROLES = ['host', 'cohost'];

const err = (ErrorClass, message, code) => {
  const e = new ErrorClass(message);
  e.code = code;
  return e;
};

/** Load a Ripple or 404. Centralised so every endpoint hides non-viewers. */
const loadRipple = async (req) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw err(NotFoundError, 'Ripple not found', 'RIPPLE_NOT_FOUND');
  }
  const ripple = await Ripple.findById(req.params.id);
  if (!ripple || ripple.lifecycle === 'removed') {
    throw err(NotFoundError, 'Ripple not found', 'RIPPLE_NOT_FOUND');
  }
  return ripple;
};

/**
 * Blocks are deliberately invisible: if host blocked viewer or vice-versa we
 * 404 so existence is never leaked, matching the privacy rule in canView().
 */
const assertNotBlocked = async (userId, ripple) => {
  if (userId === ripple.hostUserId) return;
  const ctx = await getViewerContext(userId);
  if (ctx.blockedIds.has(ripple.hostUserId)) {
    throw err(NotFoundError, 'Ripple not found', 'RIPPLE_NOT_FOUND');
  }
  return ctx;
};

const isManager = (ripple, member, userId) =>
  ripple.hostUserId === userId || (member && MANAGER_ROLES.includes(member.role));

const getMember = (rippleId, userId) =>
  Rippler.findOne({ rippleId, userId }).lean();

const isFull = (ripple) =>
  ripple.capacity != null && (ripple.counts?.ripplers ?? 0) >= ripple.capacity;

/* ------------------------------------------------------------------ *
 *  Notifications — socket for in-app, FCM for offline, Notification   *
 *  record for the feed. Lock-screen text carries only the Ripple      *
 *  title — never a description or a member's name.                    *
 * ------------------------------------------------------------------ */

const notifyRipple = async ({ toUserId, fromUserId, ripple, kind, title, message }) => {
  const data = {
    type: `ripple_${kind}`,
    rippleId: String(ripple._id),
    rippleTitle: ripple.title,
    fromUserId,
    timestamp: new Date().toISOString(),
  };
  try {
    getSocketManager().broadcastToUser(toUserId, `notification:ripple:${kind}`, {
      type: `ripple_${kind}`,
      title,
      body: message,
      data,
    });
  } catch (e) {
    console.error(`❌ [RIPPLE NOTIFY] socket ${kind} → ${toUserId}:`, e.message);
  }
  try {
    await Notification.create({
      userId: toUserId,
      type: `ripple_${kind}`,
      fromUserId,
      message,
      data,
    });
  } catch (e) {
    console.error(`❌ [RIPPLE NOTIFY] persist ${kind} → ${toUserId}:`, e.message);
  }
  try {
    if (fcmNotificationService.isEnabled && fcmNotificationService.isEnabled()) {
      // NOTE: the service exposes sendVisibleNotification(userId, notification)
      // — there is no sendToUserDevices. A wrong method name here would be
      // swallowed by optional chaining and silently send no push at all.
      await fcmNotificationService.sendVisibleNotification(toUserId, {
        title,
        body: message,
        data,
      });
    }
  } catch (e) {
    console.error(`❌ [RIPPLE NOTIFY] fcm ${kind} → ${toUserId}:`, e.message);
  }
};

/* ------------------------------------------------------------------ *
 *  Group chat linking — replicates groupChatController.createGroupChat *
 *  exactly: GroupChat doc + a GroupMember row per member, with the     *
 *  'group:created' broadcast. Both stores must be written.            *
 * ------------------------------------------------------------------ */

const ensureGroupChat = async (ripple) => {
  if (ripple.groupChatId) return ripple.groupChatId;

  const approved = await Rippler.find({
    rippleId: ripple._id,
    status: 'approved',
    role: { $ne: 'follower' },
  }).select('userId role').lean();

  const memberIds = [...new Set(approved.map((m) => m.userId))];
  const adminIds = approved
    .filter((m) => MANAGER_ROLES.includes(m.role))
    .map((m) => m.userId);

  const groupChat = await GroupChat.create({
    groupName: (ripple.title || 'Ripple').slice(0, 100),
    description: ripple.description ? ripple.description.slice(0, 500) : '',
    groupImage: '',
    createdBy: ripple.hostUserId,
    admins: adminIds.length ? adminIds : [ripple.hostUserId],
    members: memberIds,
    memberCount: memberIds.length,
  });

  await GroupMember.insertMany(
    memberIds.map((memberId) => ({
      groupId: groupChat._id,
      userId: memberId,
      role: adminIds.includes(memberId) ? 'admin' : 'member',
      addedBy: ripple.hostUserId,
      joinedAt: new Date(),
    })),
  );

  ripple.groupChatId = groupChat._id;
  await ripple.save();

  const notificationData = {
    type: 'group_created',
    groupId: groupChat._id,
    groupName: groupChat.groupName,
    createdBy: ripple.hostUserId,
    memberCount: memberIds.length,
    timestamp: new Date().toISOString(),
  };
  memberIds.forEach((memberId) => {
    if (memberId !== ripple.hostUserId) {
      try {
        getSocketManager().broadcastToUser(memberId, 'group:created', notificationData);
      } catch (e) {
        console.error(`❌ [RIPPLE CHAT] notify ${memberId}:`, e.message);
      }
    }
  });

  return groupChat._id;
};

/** Keep GroupChat.members + GroupMember rows in sync with Rippler state. */
const addToGroupChat = async (ripple, userId) => {
  if (!ripple.groupChatId) return;
  await GroupChat.findByIdAndUpdate(ripple.groupChatId, {
    $addToSet: { members: userId },
    $set: { lastActivity: new Date() },
  });
  await GroupMember.findOneAndUpdate(
    { groupId: ripple.groupChatId, userId },
    {
      $set: { isActive: true, joinedAt: new Date() },
      $setOnInsert: { role: 'member', addedBy: ripple.hostUserId },
    },
    { upsert: true },
  );
};

const removeFromGroupChat = async (ripple, userId) => {
  if (!ripple.groupChatId) return;
  await GroupChat.findByIdAndUpdate(ripple.groupChatId, {
    $pull: { members: userId, admins: userId },
    $set: { lastActivity: new Date() },
  });
  await GroupMember.findOneAndUpdate(
    { groupId: ripple.groupChatId, userId },
    { $set: { isActive: false, leftAt: new Date() } },
  );
};

/* ------------------------------------------------------------------ *
 *  Endpoints                                                         *
 * ------------------------------------------------------------------ */

// @route POST /api/ripples/:id/join
const joinRipple = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const ripple = await loadRipple(req);
  await assertNotBlocked(userId, ripple);

  // Shorts have no membership — Support + Comments only.
  if (ripple.kind === 'short') {
    throw err(BadRequestError, 'Shorts cannot be joined', 'RIPPLE_NOT_JOINABLE');
  }

  if (!JOINABLE.includes(ripple.lifecycle)) {
    throw err(BadRequestError, 'This Ripple is no longer open to join', 'RIPPLE_NOT_JOINABLE');
  }

  const existing = await getMember(ripple._id, userId);
  if (existing && existing.status === 'approved') {
    return res.status(200).json({ success: true, idempotent: true, member: existing });
  }
  if (existing && existing.status === 'requested') {
    return res.status(200).json({ success: true, idempotent: true, member: existing });
  }

  // invite-only: only an invited (pre-created requested) row may proceed.
  if (ripple.joinPolicy === 'invite' && !existing) {
    throw err(ForbiddenError, 'This Ripple is invite-only', 'RIPPLE_INVITE_ONLY');
  }

  if (isFull(ripple)) {
    const e = err(BadRequestError, 'This Ripple is full', 'RIPPLE_CAPACITY_FULL');
    e.statusCode = 409;
    return res.status(409).json({
      success: false,
      code: 'RIPPLE_CAPACITY_FULL',
      message: e.message,
      canFollow: true,
    });
  }

  const approveNow = ripple.joinPolicy === 'open';
  const requestMessage = String(req.body.requestMessage || '').slice(0, 200);

  // Coarse origin only — city key + city centroid, never the user's real point.
  const originCityKey = typeof req.body.cityKey === 'string' ? req.body.cityKey : null;
  const cc = req.body.cityCentroid;
  const originCentroid =
    Array.isArray(cc) && cc.length === 2 && cc.every(Number.isFinite) ? cc : undefined;

  const member = await Rippler.findOneAndUpdate(
    { rippleId: ripple._id, userId },
    {
      $set: {
        role: 'rippler',
        status: approveNow ? 'approved' : 'requested',
        requestMessage,
        joinedAt: approveNow ? new Date() : null,
        ...(originCityKey ? { originCityKey } : {}),
        ...(originCentroid ? { originCentroid } : {}),
      },
      $setOnInsert: { rippleId: ripple._id, userId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (approveNow) {
    await Ripple.updateOne({ _id: ripple._id }, { $inc: { 'counts.ripplers': 1 } });
    await addToGroupChat(ripple, userId);
  } else {
    await Ripple.updateOne({ _id: ripple._id }, { $inc: { 'counts.pendingRequests': 1 } });
    await notifyRipple({
      toUserId: ripple.hostUserId,
      fromUserId: userId,
      ripple,
      kind: 'join_request',
      title: 'New join request',
      message: `Someone asked to join "${ripple.title}"`,
    });
  }

  res.status(approveNow ? 200 : 202).json({ success: true, member });
});

// @route POST /api/ripples/:id/leave
const leaveRipple = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const ripple = await loadRipple(req);

  const member = await getMember(ripple._id, userId);
  if (!member) {
    throw err(NotFoundError, 'You are not part of this Ripple', 'NOT_A_MEMBER');
  }
  if (ripple.hostUserId === userId || member.role === 'host') {
    throw err(BadRequestError, 'The host cannot leave — cancel or transfer the Ripple instead', 'RIPPLE_HOST_CANNOT_LEAVE');
  }

  const wasApproved = member.status === 'approved';
  const wasFollower = member.role === 'follower';
  const wasRequested = member.status === 'requested';

  await Rippler.updateOne(
    { _id: member._id },
    { $set: { status: 'left' } },
  );

  const inc = {};
  if (wasApproved && !wasFollower) inc['counts.ripplers'] = -1;
  if (wasApproved && wasFollower) inc['counts.followers'] = -1;
  if (wasRequested) inc['counts.pendingRequests'] = -1;
  if (Object.keys(inc).length) {
    await Ripple.updateOne({ _id: ripple._id }, { $inc: inc });
  }
  if (wasApproved && !wasFollower) await removeFromGroupChat(ripple, userId);

  res.status(200).json({ success: true });
});

// @route POST /api/ripples/:id/follow — allowed even when capacity-full
const followRipple = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const ripple = await loadRipple(req);
  await assertNotBlocked(userId, ripple);

  if (!JOINABLE.includes(ripple.lifecycle) && ripple.lifecycle !== 'wrapping') {
    throw err(BadRequestError, 'This Ripple can no longer be followed', 'RIPPLE_NOT_JOINABLE');
  }

  const existing = await getMember(ripple._id, userId);
  if (existing) {
    // Already a participant or follower — idempotent no-op.
    return res.status(200).json({ success: true, idempotent: true, member: existing });
  }

  const member = await Rippler.create({
    rippleId: ripple._id,
    userId,
    role: 'follower',
    status: 'approved',
    joinedAt: new Date(),
  });
  await Ripple.updateOne({ _id: ripple._id }, { $inc: { 'counts.followers': 1 } });

  res.status(200).json({ success: true, member });
});

// @route POST /api/ripples/:id/unfollow
const unfollowRipple = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const ripple = await loadRipple(req);

  const member = await getMember(ripple._id, userId);
  if (!member || member.role !== 'follower' || member.status !== 'approved') {
    return res.status(200).json({ success: true, idempotent: true });
  }

  await Rippler.deleteOne({ _id: member._id });
  await Ripple.updateOne({ _id: ripple._id }, { $inc: { 'counts.followers': -1 } });

  res.status(200).json({ success: true });
});

// @route GET /api/ripples/:id/members
const getMembers = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const ripple = await loadRipple(req);
  const member = await getMember(ripple._id, userId);
  const viewerIsManager = isManager(ripple, member, userId);

  const { status, role, cursor, limit = 50 } = req.query;
  const cap = Math.min(Number(limit) || 50, 100);

  const q = { rippleId: ripple._id };
  // Only managers may see pending requests; everyone else sees approved only.
  if (viewerIsManager && status) {
    q.status = status;
  } else {
    q.status = 'approved';
  }
  if (role) q.role = role;
  if (cursor) q._id = { $lt: cursor };

  const rows = await Rippler.find(q).sort({ _id: -1 }).limit(cap + 1).lean();
  const hasMore = rows.length > cap;
  const members = hasMore ? rows.slice(0, cap) : rows;

  // Hydrate names/avatars — denormalized onto the member payload.
  const userIds = members.map((m) => m.userId);
  const users = await User.find({ userId: { $in: userIds } })
    .select('userId name profileImage')
    .lean();
  const byUser = {};
  users.forEach((u) => { byUser[u.userId] = u; });

  res.status(200).json({
    success: true,
    members: members.map((m) => ({
      userId: m.userId,
      name: byUser[m.userId]?.name || 'User',
      profileImage: byUser[m.userId]?.profileImage || '',
      role: m.role,
      status: m.status,
      joinedAt: m.joinedAt,
    })),
    nextCursor: hasMore ? String(members[members.length - 1]._id) : null,
  });
});

// @route GET /api/ripples/:id/requests — host/cohost only
const getRequests = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const ripple = await loadRipple(req);
  const member = await getMember(ripple._id, userId);
  if (!isManager(ripple, member, userId)) {
    throw err(ForbiddenError, 'Only the host or a cohost can view requests', 'FORBIDDEN');
  }

  const rows = await Rippler.find({ rippleId: ripple._id, status: 'requested' })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const users = await User.find({ userId: { $in: rows.map((r) => r.userId) } })
    .select('userId name profileImage')
    .lean();
  const byUser = {};
  users.forEach((u) => { byUser[u.userId] = u; });

  res.status(200).json({
    success: true,
    requests: rows.map((r) => ({
      userId: r.userId,
      name: byUser[r.userId]?.name || 'User',
      profileImage: byUser[r.userId]?.profileImage || '',
      requestMessage: r.requestMessage,
      requestedAt: r.createdAt,
    })),
  });
});

// @route POST /api/ripples/:id/requests/:userId/approve
const approveRequest = asyncHandler(async (req, res) => {
  const actorId = req.user.userId;
  const targetUserId = req.params.userId;
  const ripple = await loadRipple(req);

  const actor = await getMember(ripple._id, actorId);
  if (!isManager(ripple, actor, actorId)) {
    throw err(ForbiddenError, 'Only the host or a cohost can approve requests', 'FORBIDDEN');
  }

  const target = await getMember(ripple._id, targetUserId);
  if (!target || target.status !== 'requested') {
    // Already approved or no pending request — idempotent no-op.
    return res.status(200).json({ success: true, idempotent: true });
  }

  if (isFull(ripple)) {
    return res.status(409).json({
      success: false,
      code: 'RIPPLE_CAPACITY_FULL',
      message: 'This Ripple is full',
    });
  }

  await Rippler.updateOne(
    { _id: target._id },
    { $set: { status: 'approved', joinedAt: new Date(), approvedBy: actorId } },
  );
  await Ripple.updateOne(
    { _id: ripple._id },
    { $inc: { 'counts.ripplers': 1, 'counts.pendingRequests': -1 } },
  );
  await addToGroupChat(ripple, targetUserId);
  await notifyRipple({
    toUserId: targetUserId,
    fromUserId: actorId,
    ripple,
    kind: 'approved',
    title: "You're in",
    message: `Your request to join "${ripple.title}" was approved`,
  });

  res.status(200).json({ success: true });
});

// @route POST /api/ripples/:id/requests/:userId/reject
const rejectRequest = asyncHandler(async (req, res) => {
  const actorId = req.user.userId;
  const targetUserId = req.params.userId;
  const ripple = await loadRipple(req);

  const actor = await getMember(ripple._id, actorId);
  if (!isManager(ripple, actor, actorId)) {
    throw err(ForbiddenError, 'Only the host or a cohost can reject requests', 'FORBIDDEN');
  }

  const target = await getMember(ripple._id, targetUserId);
  if (!target || target.status !== 'requested') {
    return res.status(200).json({ success: true, idempotent: true });
  }

  await Rippler.updateOne({ _id: target._id }, { $set: { status: 'rejected' } });
  await Ripple.updateOne({ _id: ripple._id }, { $inc: { 'counts.pendingRequests': -1 } });

  res.status(200).json({ success: true });
});

// @route POST /api/ripples/:id/members/:userId/remove
const removeMember = asyncHandler(async (req, res) => {
  const actorId = req.user.userId;
  const targetUserId = req.params.userId;
  const ripple = await loadRipple(req);

  const actor = await getMember(ripple._id, actorId);
  if (!isManager(ripple, actor, actorId)) {
    throw err(ForbiddenError, 'Only the host or a cohost can remove members', 'FORBIDDEN');
  }
  if (targetUserId === ripple.hostUserId) {
    throw err(BadRequestError, 'The host cannot be removed', 'RIPPLE_HOST_PROTECTED');
  }

  const target = await getMember(ripple._id, targetUserId);
  if (!target || target.status !== 'approved') {
    return res.status(200).json({ success: true, idempotent: true });
  }

  await Rippler.updateOne({ _id: target._id }, { $set: { status: 'removed' } });
  const inc = target.role === 'follower'
    ? { 'counts.followers': -1 }
    : { 'counts.ripplers': -1 };
  await Ripple.updateOne({ _id: ripple._id }, { $inc: inc });
  if (target.role !== 'follower') await removeFromGroupChat(ripple, targetUserId);
  // Quiet — socket only, no push, per spec.
  try {
    getSocketManager().broadcastToUser(targetUserId, 'notification:ripple:removed', {
      type: 'ripple_removed',
      rippleId: String(ripple._id),
      timestamp: new Date().toISOString(),
    });
  } catch (e) { /* best-effort */ }

  res.status(200).json({ success: true });
});

// @route POST /api/ripples/:id/members/:userId/promote — -> cohost
const promoteMember = asyncHandler(async (req, res) => {
  const actorId = req.user.userId;
  const targetUserId = req.params.userId;
  const ripple = await loadRipple(req);

  const actor = await getMember(ripple._id, actorId);
  if (!isManager(ripple, actor, actorId)) {
    throw err(ForbiddenError, 'Only the host or a cohost can promote', 'FORBIDDEN');
  }

  const target = await getMember(ripple._id, targetUserId);
  if (!target || target.status !== 'approved' || target.role === 'follower') {
    throw err(NotFoundError, 'No such approved member', 'NOT_A_MEMBER');
  }
  if (target.role === 'host') {
    return res.status(200).json({ success: true, idempotent: true });
  }

  await Rippler.updateOne({ _id: target._id }, { $set: { role: 'cohost' } });
  // Promote inside the linked chat too.
  if (ripple.groupChatId) {
    await GroupChat.findByIdAndUpdate(ripple.groupChatId, {
      $addToSet: { admins: targetUserId },
    });
    await GroupMember.findOneAndUpdate(
      { groupId: ripple.groupChatId, userId: targetUserId },
      { $set: { role: 'admin' } },
    );
  }

  res.status(200).json({ success: true });
});

// @route POST /api/ripples/:id/members/:userId/demote — cohost -> rippler
const demoteMember = asyncHandler(async (req, res) => {
  const actorId = req.user.userId;
  const targetUserId = req.params.userId;
  const ripple = await loadRipple(req);

  const actor = await getMember(ripple._id, actorId);
  if (!isManager(ripple, actor, actorId)) {
    throw err(ForbiddenError, 'Only the host or a cohost can demote', 'FORBIDDEN');
  }
  if (targetUserId === ripple.hostUserId) {
    throw err(BadRequestError, 'The host cannot be demoted', 'RIPPLE_HOST_PROTECTED');
  }

  const target = await getMember(ripple._id, targetUserId);
  if (!target || target.role !== 'cohost') {
    return res.status(200).json({ success: true, idempotent: true });
  }

  await Rippler.updateOne({ _id: target._id }, { $set: { role: 'rippler' } });
  if (ripple.groupChatId) {
    await GroupChat.findByIdAndUpdate(ripple.groupChatId, {
      $pull: { admins: targetUserId },
    });
    await GroupMember.findOneAndUpdate(
      { groupId: ripple.groupChatId, userId: targetUserId },
      { $set: { role: 'member' } },
    );
  }

  res.status(200).json({ success: true });
});

// @route POST /api/ripples/:id/chat — create-or-return the linked group chat
const getOrCreateRippleChat = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const ripple = await loadRipple(req);

  const member = await getMember(ripple._id, userId);
  const allowed =
    isManager(ripple, member, userId) ||
    (member && member.status === 'approved' && member.role !== 'follower');
  if (!allowed) {
    throw err(ForbiddenError, 'Only Ripplers can open this chat', 'FORBIDDEN');
  }

  const groupId = await ensureGroupChat(ripple);
  res.status(200).json({ success: true, groupId: String(groupId) });
});

// @route POST /api/ripples/:id/support — toggle the Short's support counter
const toggleSupport = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const ripple = await loadRipple(req);
  const ctx = await assertNotBlocked(userId, ripple);

  // Supporting implies viewing — same visibility rule as canView().
  const member = await getMember(ripple._id, userId);
  const viewable =
    ripple.hostUserId === userId ||
    !!member ||
    ripple.visibility === 'public' ||
    (ripple.visibility === 'friends' && !!ctx?.friendIds.has(ripple.hostUserId));
  if (!viewable) {
    throw err(NotFoundError, 'Ripple not found', 'RIPPLE_NOT_FOUND');
  }
  if (!JOINABLE.includes(ripple.lifecycle) && ripple.lifecycle !== 'wrapping') {
    throw err(BadRequestError, 'This Ripple is closed to new support', 'RIPPLE_CLOSED');
  }

  const existing = await RippleSupport.findOne({
    rippleId: ripple._id,
    userId,
  }).lean();

  const delta = existing ? -1 : 1;
  if (existing) {
    await RippleSupport.deleteOne({ _id: existing._id });
  } else {
    await RippleSupport.create({ rippleId: ripple._id, userId });
  }
  const updated = await Ripple.findOneAndUpdate(
    { _id: ripple._id },
    { $inc: { 'counts.supports': delta } },
    { new: true, projection: { counts: 1 } },
  ).lean();

  res.status(200).json({
    success: true,
    supported: !existing,
    supportCount: Math.max(0, updated?.counts?.supports ?? 0),
  });
});

module.exports = {
  joinRipple,
  leaveRipple,
  followRipple,
  unfollowRipple,
  getMembers,
  getRequests,
  approveRequest,
  rejectRequest,
  removeMember,
  promoteMember,
  demoteMember,
  getOrCreateRippleChat,
  toggleSupport,
};
