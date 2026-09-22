const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Ripple = require('../models/Ripple');
const Rippler = require('../models/Rippler');
const RippleEvent = require('../models/RippleEvent');
const {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} = require('../utils/errorClasses');
const { getViewerContext } = require('../services/openNetworkVisibility');
const getSocketManager = () => require('../socketManager');

const MANAGER_ROLES = ['host', 'cohost'];
const EVENT_TYPES = ['text', 'image', 'video', 'voice', 'location'];
const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥'];
const MAX_MEDIA = 10;

const err = (ErrorClass, message, code, statusCode) => {
  const e = new ErrorClass(message);
  e.code = code;
  if (statusCode) e.statusCode = statusCode;
  return e;
};

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

const isManager = (ripple, member, userId) =>
  ripple.hostUserId === userId || (member && MANAGER_ROLES.includes(member.role));

const isParticipant = (ripple, member, userId) =>
  isManager(ripple, member, userId) ||
  (member && member.status === 'approved' && member.role !== 'follower');

/**
 * Shorts have no membership — anyone who may VIEW the Short may read and
 * write its comments. Mirrors canView()'s visibility ladder, minus the
 * 'invite' branch (invite-only Shorts: members only, and there are none).
 */
const canViewShort = (ripple, ctx, userId) =>
  ripple.kind === 'short' &&
  (ripple.hostUserId === userId ||
    ripple.visibility === 'public' ||
    (ripple.visibility === 'friends' && ctx.friendIds.has(ripple.hostUserId)));

const toEventDto = (e) => ({
  id: String(e._id),
  rippleId: String(e.rippleId),
  authorId: e.authorId,
  authorName: e.authorName,
  authorIsPage: !!e.authorIsPage,
  origin: e.origin,
  type: e.type,
  body: e.body,
  media: e.media || [],
  location: e.location?.label ? e.location : null,
  pinned: !!e.pinned,
  reactionCount: e.reactionCount || 0,
  reactions: (e.reactions || []).map((r) => ({ emoji: r.emoji, userId: r.userId, userName: r.userName })),
  createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : null,
});

/** Recompute the denormalized ripple event counter. */
const syncEventCount = async (rippleId) => {
  const n = await RippleEvent.countDocuments({ rippleId, status: 'active' });
  await Ripple.updateOne({ _id: rippleId }, { $set: { 'counts.events': n } });
};

/** Best-effort system timeline entry. Never allowed to break the request. */
const recordSystemEvent = async (ripple, body, actorId) => {
  try {
    await RippleEvent.create({
      rippleId: ripple._id,
      authorId: actorId || ripple.hostUserId,
      authorName: '',
      origin: 'system',
      type: 'system',
      body,
    });
    await syncEventCount(ripple._id);
  } catch (e) {
    console.error('❌ [RIPPLE EVENT] system entry failed:', e.message);
  }
};

// @route POST /api/ripples/:id/events
const createEvent = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const ripple = await loadRipple(req);

  const ctx = await getViewerContext(userId);
  if (ctx.blockedIds.has(ripple.hostUserId)) {
    throw err(NotFoundError, 'Ripple not found', 'RIPPLE_NOT_FOUND');
  }

  const member = await Rippler.findOne({ rippleId: ripple._id, userId }).lean();
  const manager = isManager(ripple, member, userId);
  const participant =
    isParticipant(ripple, member, userId) || canViewShort(ripple, ctx, userId);

  if (!participant) {
    throw err(ForbiddenError, 'Only Ripplers can post in this Ripple', 'NOT_A_RIPPLER');
  }
  if (ripple.kind !== 'short' && !manager && !ripple.settings?.ripplersCanPostEvents) {
    throw err(ForbiddenError, 'Only hosts can post in this Ripple', 'POSTING_RESTRICTED');
  }
  // Contributors may post while active; managers may also post during the
  // 48h wrapping grace window so wrap-up photos land before the freeze.
  const canPost = manager
    ? ['active', 'wrapping'].includes(ripple.lifecycle)
    : ripple.lifecycle === 'active';
  if (!canPost) {
    throw err(BadRequestError, 'This Ripple is closed to new posts', 'RIPPLE_CLOSED');
  }

  const idempotencyKey = req.get('Idempotency-Key') || req.get('idempotency-key') || null;
  if (idempotencyKey) {
    const existing = await RippleEvent.findOne({ authorId: userId, idempotencyKey });
    if (existing) {
      return res.status(200).json({ success: true, idempotent: true, event: toEventDto(existing) });
    }
  }

  const body = String(req.body.body || '').trim();
  const type = req.body.type || 'text';
  if (!EVENT_TYPES.includes(type)) {
    throw err(BadRequestError, `type must be one of: ${EVENT_TYPES.join(', ')}`, 'VALIDATION');
  }
  const media = Array.isArray(req.body.media) ? req.body.media.slice(0, MAX_MEDIA) : [];

  if (type === 'text' && !body) {
    throw err(BadRequestError, 'A text post needs a body', 'VALIDATION');
  }
  if (['image', 'video', 'voice'].includes(type) && media.length === 0) {
    throw err(BadRequestError, `A ${type} post needs at least one media item`, 'VALIDATION');
  }
  if (body.length > 2000) {
    throw err(BadRequestError, 'body must be 2000 characters or fewer', 'VALIDATION');
  }

  const event = await RippleEvent.create({
    rippleId: ripple._id,
    authorId: userId,
    authorName: req.user.name || '',
    authorIsPage: false,
    origin: 'user',
    type,
    body,
    media,
    location: req.body.location?.label
      ? {
          label: String(req.body.location.label).slice(0, 160),
          lng: Number.isFinite(Number(req.body.location.lng)) ? Number(req.body.location.lng) : null,
          lat: Number.isFinite(Number(req.body.location.lat)) ? Number(req.body.location.lat) : null,
        }
      : undefined,
    idempotencyKey,
  });

  await syncEventCount(ripple._id);
  await Ripple.updateOne({ _id: ripple._id }, { $set: { lastActivityAt: new Date() } }).catch(() => {});

  // Live update to everyone else in the Ripple.
  try {
    const others = await Rippler.find({
      rippleId: ripple._id,
      status: 'approved',
      userId: { $ne: userId },
    }).select('userId').lean();
    others.forEach((r) => {
      getSocketManager().broadcastToUser(r.userId, 'ripple:event:new', {
        rippleId: String(ripple._id),
        event: toEventDto(event),
      });
    });
  } catch (e) {
    console.error('❌ [RIPPLE EVENT] broadcast failed:', e.message);
  }

  res.status(201).json({ success: true, event: toEventDto(event) });
});

// @route GET /api/ripples/:id/events — newest first, cursor-paginated
const listEvents = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const ripple = await loadRipple(req);

  const ctx = await getViewerContext(userId);
  if (ctx.blockedIds.has(ripple.hostUserId)) {
    throw err(NotFoundError, 'Ripple not found', 'RIPPLE_NOT_FOUND');
  }
  const member = await Rippler.findOne({ rippleId: ripple._id, userId }).lean();
  const canSee =
    isParticipant(ripple, member, userId) ||
    ripple.visibility === 'public' ||
    canViewShort(ripple, ctx, userId);
  if (!canSee) {
    throw err(ForbiddenError, 'You cannot view this Ripple', 'FORBIDDEN');
  }

  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const q = { rippleId: ripple._id, status: 'active' };
  if (req.query.cursor && mongoose.Types.ObjectId.isValid(req.query.cursor)) {
    q._id = { $lt: req.query.cursor };
  }

  const events = await RippleEvent.find(q).sort({ _id: -1 }).limit(limit + 1).lean();
  const hasMore = events.length > limit;
  const page = hasMore ? events.slice(0, limit) : events;

  // The first page also carries the pinned set separately — pinned replies
  // must surface above the fold regardless of age, which the _id cursor
  // can't express inside the main list. Dedupe client-side (a pinned reply
  // that's also recent still appears chronologically in `events`).
  let pinnedEvents = [];
  if (!req.query.cursor) {
    pinnedEvents = await RippleEvent.find({
      rippleId: ripple._id,
      status: 'active',
      pinned: true,
    })
      .sort({ _id: -1 })
      .limit(5)
      .lean();
  }

  res.status(200).json({
    success: true,
    events: page.map(toEventDto),
    pinnedEvents: pinnedEvents.map(toEventDto),
    nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
  });
});

// @route DELETE /api/ripples/:id/events/:eventId — author or manager
const deleteEvent = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const ripple = await loadRipple(req);

  if (!mongoose.Types.ObjectId.isValid(req.params.eventId)) {
    throw err(NotFoundError, 'Post not found', 'EVENT_NOT_FOUND');
  }
  const event = await RippleEvent.findOne({ _id: req.params.eventId, rippleId: ripple._id });
  if (!event || event.status === 'deleted') {
    throw err(NotFoundError, 'Post not found', 'EVENT_NOT_FOUND');
  }

  const member = await Rippler.findOne({ rippleId: ripple._id, userId }).lean();
  const canDelete = event.authorId === userId || isManager(ripple, member, userId);
  if (!canDelete) {
    throw err(ForbiddenError, 'You cannot delete this post', 'FORBIDDEN');
  }

  event.status = 'deleted';
  event.deletedAt = new Date();
  event.deletedBy = userId;
  await event.save();
  await syncEventCount(ripple._id);

  res.status(200).json({ success: true, deleted: true });
});

// @route POST /api/ripples/:id/events/:eventId/react — toggles the caller's reaction
const reactToEvent = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const emoji = String(req.body.emoji || '');
  if (!ALLOWED_REACTIONS.includes(emoji)) {
    throw err(BadRequestError, `emoji must be one of: ${ALLOWED_REACTIONS.join(' ')}`, 'VALIDATION');
  }

  const ripple = await loadRipple(req);
  const member = await Rippler.findOne({ rippleId: ripple._id, userId }).lean();
  if (!isParticipant(ripple, member, userId) && ripple.visibility !== 'public') {
    throw err(ForbiddenError, 'Only Ripplers can react', 'NOT_A_RIPPLER');
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.eventId)) {
    throw err(NotFoundError, 'Post not found', 'EVENT_NOT_FOUND');
  }
  const event = await RippleEvent.findOne({
    _id: req.params.eventId,
    rippleId: ripple._id,
    status: 'active',
  });
  if (!event) throw err(NotFoundError, 'Post not found', 'EVENT_NOT_FOUND');

  // One reaction per user: same emoji toggles off, a different one replaces.
  const existing = event.reactions.find((r) => r.userId === userId);
  if (existing && existing.emoji === emoji) {
    event.reactions = event.reactions.filter((r) => r.userId !== userId);
  } else {
    event.reactions = event.reactions.filter((r) => r.userId !== userId);
    event.reactions.push({ emoji, userId, userName: req.user.name || '', createdAt: new Date() });
  }
  event.reactionCount = event.reactions.length;
  await event.save();

  res.status(200).json({ success: true, event: toEventDto(event) });
});

// @route POST /api/ripples/:id/events/:eventId/pin — manager only
const pinEvent = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const ripple = await loadRipple(req);
  const member = await Rippler.findOne({ rippleId: ripple._id, userId }).lean();
  if (!isManager(ripple, member, userId)) {
    throw err(ForbiddenError, 'Only the host or a cohost can pin', 'FORBIDDEN');
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.eventId)) {
    throw err(NotFoundError, 'Post not found', 'EVENT_NOT_FOUND');
  }
  const event = await RippleEvent.findOne({
    _id: req.params.eventId,
    rippleId: ripple._id,
    status: 'active',
  });
  if (!event) throw err(NotFoundError, 'Post not found', 'EVENT_NOT_FOUND');

  event.pinned = typeof req.body.pinned === 'boolean' ? req.body.pinned : !event.pinned;
  await event.save();

  res.status(200).json({ success: true, event: toEventDto(event) });
});

module.exports = {
  createEvent,
  listEvents,
  deleteEvent,
  reactToEvent,
  pinEvent,
  recordSystemEvent,
  syncEventCount,
  ALLOWED_REACTIONS,
};
