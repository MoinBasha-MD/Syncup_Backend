const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Ripple = require('../models/Ripple');
const Rippler = require('../models/Rippler');
const Page = require('../models/Page');
const OpenNetworkProfile = require('../models/OpenNetworkProfile');
const {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} = require('../utils/errorClasses');
const { toRippleSummary } = require('../utils/rippleDto');
const { reachToKm, resolvePlace } = require('../services/openNetworkGeo');
const { getViewerContext } = require('../services/openNetworkVisibility');

const TYPES = ['activity', 'question', 'request', 'plan', 'event', 'interest', 'alert', 'project'];
const REACHES = ['neighborhood', 'city', 'region', 'global', 'online'];
const VISIBILITIES = ['public', 'friends', 'invite'];
const JOIN_POLICIES = ['open', 'approval', 'invite'];
const DISCOVERABILITIES = ['listed', 'unlisted'];
const LIVE_LIFECYCLES = ['active', 'scheduled', 'wrapping'];

// Spam guard: a brand-new account shouldn't be able to carpet the globe.
const DAILY_RIPPLE_LIMIT = 10;
const GLOBAL_REACH_MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const enumCheck = (value, allowed, field) => {
  if (value !== undefined && value !== null && !allowed.includes(value)) {
    const err = new BadRequestError(`${field} must be one of: ${allowed.join(', ')}`);
    err.code = 'VALIDATION';
    throw err;
  }
};

const MAX_RIPPLE_MEDIA = 10;
const MEDIA_TYPES = ['image', 'video'];
const MIX_MODES = ['mix', 'replace', 'mute_original'];

/**
 * Sanitize media attached to a Ripple.
 *
 * Only absolute http(s) URLs are accepted: the client uploads through
 * /upload/post-media first and posts the resulting URLs, so anything else is a
 * malformed client and would otherwise be stored as a broken image.
 */
const sanitizeMedia = (input) => {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_RIPPLE_MEDIA)
    .map((m) => ({
      type: MEDIA_TYPES.includes(m?.type) ? m.type : 'image',
      url: typeof m?.url === 'string' ? m.url.trim() : '',
      thumbnailUrl: typeof m?.thumbnailUrl === 'string' ? m.thumbnailUrl : null,
      width: Number.isFinite(Number(m?.width)) ? Number(m.width) : null,
      height: Number.isFinite(Number(m?.height)) ? Number(m.height) : null,
      duration: Number.isFinite(Number(m?.duration)) ? Number(m.duration) : null,
    }))
    .filter((m) => /^https?:\/\//i.test(m.url));
};

/** Normalize the optional background track. undefined when none was picked. */
const sanitizeMusic = (input) => {
  if (!input || typeof input !== 'object' || !input.trackId) return undefined;
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  return {
    trackId: String(input.trackId),
    title: input.title ? String(input.title).slice(0, 160) : null,
    artist: input.artist ? String(input.artist).slice(0, 160) : null,
    filename: input.filename ? String(input.filename) : null,
    startTime: Math.max(0, num(input.startTime, 0)),
    endTime: Math.max(0, num(input.endTime, 30)),
    volume: Math.min(1, Math.max(0, num(input.volume, 0.7))),
    mixMode: MIX_MODES.includes(input.mixMode) ? input.mixMode : 'mix',
    loop: input.loop !== false,
  };
};

const lifecycleForPublish = (startAt) =>
  startAt && new Date(startAt).getTime() > Date.now() ? 'scheduled' : 'active';

/** Full detail = summary DTO + the fields only a detail view needs + viewer block. */
const toRippleDetail = (ripple, viewer) => ({
  ...toRippleSummary(ripple, { viewerUserId: viewer.userId }),
  description: ripple.description,
  reach: ripple.reach,
  reachKm: ripple.reachKm,
  visibility: ripple.visibility,
  discoverability: ripple.discoverability,
  joinPolicy: ripple.joinPolicy,
  place: ripple.place,
  wrapUntil: ripple.wrapUntil ? new Date(ripple.wrapUntil).toISOString() : null,
  media: ripple.media || [],
  music: ripple.music?.trackId ? ripple.music : null,
  settings: ripple.settings,
  rating: ripple.rating,
  createdAt: ripple.createdAt ? new Date(ripple.createdAt).toISOString() : null,
  updatedAt: ripple.updatedAt ? new Date(ripple.updatedAt).toISOString() : null,
  viewer,
});

/**
 * The viewer block is the single authority on what this user may do —
 * the client must render actions from these flags only.
 */
const buildViewerBlock = (ripple, member, userId) => {
  const isHost = ripple.hostUserId === userId;
  let relationship = 'none';
  if (isHost || member?.role === 'host') relationship = 'host';
  else if (member?.role === 'cohost') relationship = 'cohost';
  else if (member?.status === 'requested') relationship = 'requested';
  else if (member && ['approved'].includes(member.status)) {
    relationship = member.role === 'follower' ? 'follower' : 'rippler';
  }

  const isFull =
    ripple.capacity != null && (ripple.counts?.ripplers ?? 0) >= ripple.capacity;
  const joinable = LIVE_LIFECYCLES.includes(ripple.lifecycle);
  const isParticipant = relationship === 'host' || relationship === 'cohost' || relationship === 'rippler';
  const isManager = relationship === 'host' || relationship === 'cohost';

  return {
    userId,
    relationship,
    canJoin:
      relationship === 'none' &&
      joinable &&
      !isFull &&
      (ripple.joinPolicy === 'open' || ripple.joinPolicy === 'approval'),
    canFollow: joinable && relationship === 'none',
    canPostEvent:
      isParticipant &&
      ripple.lifecycle === 'active' &&
      (isManager || !!ripple.settings?.ripplersCanPostEvents),
    canManage: isManager,
  };
};

const canView = (ripple, member, ctx, userId) => {
  if (ctx.blockedIds.has(ripple.hostUserId)) return false;
  if (ripple.lifecycle === 'removed') return ripple.hostUserId === userId;
  if (ripple.hostUserId === userId || member) return true;
  if (ripple.visibility === 'public') return true; // listed + unlisted: direct-link access
  if (ripple.visibility === 'friends') return ctx.friendIds.has(ripple.hostUserId);
  return false; // 'invite' — members only
};

// @route POST /api/ripples
const createRipple = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const body = req.body || {};

  // Idempotency-Key: mobile clients retry; a replay returns the original.
  const idempotencyKey = req.get('Idempotency-Key') || req.get('idempotency-key') || null;
  if (idempotencyKey) {
    const existing = await Ripple.findOne({ hostUserId: userId, idempotencyKey });
    if (existing) {
      const member = await Rippler.findOne({ rippleId: existing._id, userId }).lean();
      return res.status(200).json({
        success: true,
        idempotent: true,
        ripple: toRippleDetail(existing, buildViewerBlock(existing, member, userId)),
      });
    }
  }

  const title = String(body.title || '').trim();
  if (title.length < 3 || title.length > 120) {
    const err = new BadRequestError('title must be 3-120 characters');
    err.code = 'VALIDATION';
    throw err;
  }
  enumCheck(body.type, TYPES, 'type');
  if (!body.type) {
    const err = new BadRequestError('type is required');
    err.code = 'VALIDATION';
    throw err;
  }
  enumCheck(body.reach, REACHES, 'reach');
  enumCheck(body.visibility, VISIBILITIES, 'visibility');
  enumCheck(body.joinPolicy, JOIN_POLICIES, 'joinPolicy');
  enumCheck(body.discoverability, DISCOVERABILITIES, 'discoverability');

  const reach = body.reach || 'city';
  const isOnline = reach === 'online';
  const lng = body.lng != null ? Number(body.lng) : null;
  const lat = body.lat != null ? Number(body.lat) : null;
  if (!isOnline && (!Number.isFinite(lng) || !Number.isFinite(lat))) {
    const err = new BadRequestError('lng and lat are required unless reach is online');
    err.code = 'VALIDATION';
    throw err;
  }
  if (!isOnline && (Math.abs(lng) > 180 || Math.abs(lat) > 90)) {
    const err = new BadRequestError('lng must be [-180,180], lat [-90,90]');
    err.code = 'VALIDATION';
    throw err;
  }

  let capacity = null;
  if (body.capacity != null) {
    capacity = Number(body.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      const err = new BadRequestError('capacity must be a positive integer');
      err.code = 'VALIDATION';
      throw err;
    }
  }

  let hostPageId = null;
  let hostName = req.user.name || '';
  let hostIsPage = false;
  if (body.hostPageId) {
    if (!mongoose.Types.ObjectId.isValid(body.hostPageId)) {
      const err = new BadRequestError('hostPageId is not a valid id');
      err.code = 'VALIDATION';
      throw err;
    }
    const page = await Page.findOne({ _id: body.hostPageId, owner: req.user._id }).lean();
    if (!page) {
      const err = new ForbiddenError('You do not own this Page');
      err.code = 'PAGE_NOT_OWNED';
      throw err;
    }
    hostPageId = page._id;
    hostName = page.name || hostName;
    hostIsPage = true;
  }

  // --- Abuse guards ---
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const createdRecently = await Ripple.countDocuments({
    hostUserId: userId,
    createdAt: { $gte: since },
  });
  if (createdRecently >= DAILY_RIPPLE_LIMIT) {
    const err = new BadRequestError(
      `You can create at most ${DAILY_RIPPLE_LIMIT} Ripples per day`,
    );
    err.code = 'RIPPLE_RATE_LIMITED';
    err.statusCode = 429;
    throw err;
  }

  // Global reach is the highest-blast-radius setting, so it needs an account
  // with some history behind it.
  if (reach === 'global' && req.user.createdAt) {
    const age = Date.now() - new Date(req.user.createdAt).getTime();
    if (age < GLOBAL_REACH_MIN_ACCOUNT_AGE_MS) {
      const err = new BadRequestError(
        'Global reach is available once your account is a week old. Use city reach for now.',
      );
      err.code = 'GLOBAL_REACH_TOO_NEW';
      throw err;
    }
  }

  const place = isOnline
    ? { label: 'Online', neighborhood: '', city: '', state: '', country: '', countryCode: '', cityKey: '' }
    : await resolvePlace(lng, lat);

  const startAt = body.startAt ? new Date(body.startAt) : null;
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  const lifecycle = body.publish === true ? lifecycleForPublish(startAt) : 'draft';

  const ripple = await Ripple.create({
    hostUserId: userId,
    hostPageId,
    hostName,
    hostIsPage,
    title,
    description: String(body.description || ''),
    type: body.type,
    media: sanitizeMedia(body.media),
    music: sanitizeMusic(body.music),
    reach,
    reachKm: reachToKm(reach),
    visibility: body.visibility || 'public',
    discoverability: body.discoverability || 'listed',
    joinPolicy: body.joinPolicy || 'approval',
    lifecycle,
    location: isOnline ? undefined : { type: 'Point', coordinates: [lng, lat] },
    place,
    // Mapbox geocoding has no timezone; accept the client's IANA zone.
    timezone: typeof body.timezone === 'string' ? body.timezone : null,
    startAt,
    expiresAt,
    wrapUntil: body.wrapUntil ? new Date(body.wrapUntil) : null,
    capacity,
    counts: { ripplers: 1, followers: 0, events: 0, pendingRequests: 0 },
    settings: {
      ripplersCanPostEvents: body.settings?.ripplersCanPostEvents !== false,
      verifiedOnly: body.settings?.verifiedOnly === true,
    },
    idempotencyKey,
  });

  await Rippler.create({
    rippleId: ripple._id,
    userId,
    role: 'host',
    status: 'approved',
    joinedAt: new Date(),
    approvedBy: userId,
  });

  // Track host-side creation rate (cap enforcement is a later milestone).
  await OpenNetworkProfile.updateOne(
    { userId },
    { $inc: { 'limits.ripplesCreatedToday': 1 }, $set: { 'limits.lastCreateAt': new Date() } },
    { upsert: true },
  );

  const member = await Rippler.findOne({ rippleId: ripple._id, userId }).lean();
  res.status(201).json({
    success: true,
    ripple: toRippleDetail(ripple, buildViewerBlock(ripple, member, userId)),
  });
});

// @route GET /api/ripples/:id
const getRipple = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    const err = new NotFoundError('Ripple not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const ripple = await Ripple.findById(req.params.id);
  if (!ripple) {
    const err = new NotFoundError('Ripple not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const [ctx, member] = await Promise.all([
    getViewerContext(userId),
    Rippler.findOne({ rippleId: ripple._id, userId }).lean(),
  ]);

  if (!canView(ripple, member, ctx, userId)) {
    // Deliberately 404, not 403 — existence isn't leaked to non-viewers.
    const err = new NotFoundError('Ripple not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  res.status(200).json({
    success: true,
    ripple: toRippleDetail(ripple, buildViewerBlock(ripple, member, userId)),
  });
});

const EDITABLE_FIELDS = [
  'title',
  'description',
  'capacity',
  'joinPolicy',
  'visibility',
  'discoverability',
  'startAt',
  'expiresAt',
  'wrapUntil',
  'timezone',
  'media',
  'music',
];

// @route PATCH /api/ripples/:id — host/cohost only
const updateRipple = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const body = req.body || {};

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    const err = new NotFoundError('Ripple not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const ripple = await Ripple.findById(req.params.id);
  if (!ripple) {
    const err = new NotFoundError('Ripple not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const member = await Rippler.findOne({ rippleId: ripple._id, userId }).lean();
  const isManager =
    ripple.hostUserId === userId || (member && ['host', 'cohost'].includes(member.role));
  if (!isManager) {
    const err = new ForbiddenError('Only the host or a cohost can edit this Ripple');
    err.code = 'FORBIDDEN';
    throw err;
  }

  if ('lifecycle' in body) {
    const err = new BadRequestError('lifecycle is server-driven and cannot be edited');
    err.code = 'LIFECYCLE_READONLY';
    throw err;
  }
  if (ripple.lifecycle !== 'draft' && ('reach' in body || 'location' in body || 'lng' in body || 'lat' in body)) {
    const err = new BadRequestError('reach/location can only change while the Ripple is a draft');
    err.code = 'GEO_LOCKED';
    throw err;
  }

  enumCheck(body.joinPolicy, JOIN_POLICIES, 'joinPolicy');
  enumCheck(body.visibility, VISIBILITIES, 'visibility');
  enumCheck(body.discoverability, DISCOVERABILITIES, 'discoverability');

  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue;
    if (['startAt', 'expiresAt', 'wrapUntil'].includes(field)) {
      ripple[field] = body[field] ? new Date(body[field]) : null;
    } else if (field === 'capacity') {
      if (body.capacity != null && (!Number.isInteger(Number(body.capacity)) || Number(body.capacity) < 1)) {
        const err = new BadRequestError('capacity must be a positive integer or null');
        err.code = 'VALIDATION';
        throw err;
      }
      ripple.capacity = body.capacity == null ? null : Number(body.capacity);
    } else if (field === 'media') {
      ripple.media = sanitizeMedia(body.media);
    } else if (field === 'music') {
      ripple.music = sanitizeMusic(body.music);
    } else {
      ripple[field] = body[field];
    }
  }
  if (body.settings && typeof body.settings === 'object') {
    if ('ripplersCanPostEvents' in body.settings) {
      ripple.settings.ripplersCanPostEvents = !!body.settings.ripplersCanPostEvents;
    }
    if ('verifiedOnly' in body.settings) {
      ripple.settings.verifiedOnly = !!body.settings.verifiedOnly;
    }
  }

  await ripple.save();
  res.status(200).json({
    success: true,
    ripple: toRippleDetail(ripple, buildViewerBlock(ripple, member, userId)),
  });
});

// @route POST /api/ripples/:id/publish — draft -> active/scheduled
const publishRipple = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    const err = new NotFoundError('Ripple not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const ripple = await Ripple.findById(req.params.id);
  if (!ripple) {
    const err = new NotFoundError('Ripple not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const member = await Rippler.findOne({ rippleId: ripple._id, userId }).lean();
  const isManager =
    ripple.hostUserId === userId || (member && ['host', 'cohost'].includes(member.role));
  if (!isManager) {
    const err = new ForbiddenError('Only the host or a cohost can publish this Ripple');
    err.code = 'FORBIDDEN';
    throw err;
  }
  if (ripple.lifecycle !== 'draft') {
    const err = new BadRequestError('Only a draft can be published');
    err.code = 'NOT_DRAFT';
    throw err;
  }
  ripple.lifecycle = lifecycleForPublish(ripple.startAt);
  await ripple.save();
  res.status(200).json({
    success: true,
    ripple: toRippleDetail(ripple, buildViewerBlock(ripple, member, userId)),
  });
});

/**
 * Shared host/cohost guard for lifecycle endpoints. 404 (not 403) when the
 * Ripple doesn't exist or is removed; 403 when it exists but the caller can't
 * manage it.
 */
const loadForLifecycle = async (req) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    const e = new NotFoundError('Ripple not found');
    e.code = 'NOT_FOUND';
    throw e;
  }
  const ripple = await Ripple.findById(req.params.id);
  if (!ripple || ripple.lifecycle === 'removed') {
    const e = new NotFoundError('Ripple not found');
    e.code = 'NOT_FOUND';
    throw e;
  }
  const member = await Rippler.findOne({ rippleId: ripple._id, userId: req.user.userId }).lean();
  const isManager =
    ripple.hostUserId === req.user.userId ||
    (member && ['host', 'cohost'].includes(member.role));
  if (!isManager) {
    const e = new ForbiddenError('Only the host or a cohost can do this');
    e.code = 'FORBIDDEN';
    throw e;
  }
  return { ripple, member };
};

const WRAP_WINDOW_MS = 48 * 60 * 60 * 1000; // 48h grace before a Ripple freezes

// @route POST /api/ripples/:id/end — active -> wrapping (grace) -> memory (cron)
const endRipple = asyncHandler(async (req, res) => {
  const { ripple, member } = await loadForLifecycle(req);
  if (ripple.lifecycle !== 'active' && ripple.lifecycle !== 'scheduled') {
    const e = new BadRequestError('Only an active or scheduled Ripple can be ended');
    e.code = 'NOT_ENDABLE';
    throw e;
  }
  ripple.lifecycle = 'wrapping';
  ripple.wrapUntil = new Date(Date.now() + WRAP_WINDOW_MS);
  await ripple.save();
  res.status(200).json({
    success: true,
    ripple: toRippleDetail(ripple, buildViewerBlock(ripple, member, req.user.userId)),
  });
});

/**
 * Tell everyone who joined that the Ripple changed state.
 * Cancelling previously left participants with no signal at all — they'd only
 * discover it by reopening the Ripple. Best-effort: never fails the request.
 */
const notifyParticipants = async (ripple, event, body) => {
  try {
    const rows = await Rippler.find({
      rippleId: ripple._id,
      status: 'approved',
      userId: { $ne: ripple.hostUserId },
    }).select('userId').lean();
    if (!rows.length) return;
    const { broadcastToUser } = require('../socketManager');
    rows.forEach((r) => {
      try {
        broadcastToUser(r.userId, event, {
          rippleId: String(ripple._id),
          title: ripple.title,
          body,
        });
      } catch (e) { /* best-effort per user */ }
    });
  } catch (e) {
    console.error('❌ [RIPPLE] participant notify failed:', e.message);
  }
};

// @route POST /api/ripples/:id/cancel — draft/scheduled/active -> cancelled
const cancelRipple = asyncHandler(async (req, res) => {
  const { ripple, member } = await loadForLifecycle(req);
  if (!['draft', 'scheduled', 'active'].includes(ripple.lifecycle)) {
    const e = new BadRequestError('This Ripple can no longer be cancelled');
    e.code = 'NOT_CANCELLABLE';
    throw e;
  }
  ripple.lifecycle = 'cancelled';
  await ripple.save();
  await notifyParticipants(ripple, 'ripple:cancelled', `"${ripple.title}" was cancelled`);
  res.status(200).json({
    success: true,
    ripple: toRippleDetail(ripple, buildViewerBlock(ripple, member, req.user.userId)),
  });
});

// @route DELETE /api/ripples/:id — hard-delete drafts only; live ones use cancel
/**
 * Remove every record that belongs to a Ripple.
 *
 * A draft delete used to remove only the Rippler rows and the Ripple itself,
 * orphaning its events, ratings, reports and — worst — leaving a live GroupChat
 * behind with no parent. Every child collection must be cleaned up together.
 * Lazy-required so this module stays loadable without the event/trust models.
 */
const purgeRippleChildren = async (ripple) => {
  const RippleEvent = require('../models/RippleEvent');
  const RippleRating = require('../models/RippleRating');
  const RippleReport = require('../models/RippleReport');
  const GroupChat = require('../models/groupChatModel');
  const GroupMember = require('../models/groupMemberModel');
  const GroupMessage = require('../models/groupMessageModel');

  await RippleEvent.deleteMany({ rippleId: ripple._id });
  await RippleRating.deleteMany({ rippleId: ripple._id });
  await RippleReport.deleteMany({ rippleId: ripple._id });
  await Rippler.deleteMany({ rippleId: ripple._id });

  if (ripple.groupChatId) {
    // Messages must go before the chat that owns them.
    await GroupMessage.deleteMany({ groupId: ripple.groupChatId });
    await GroupMember.deleteMany({ groupId: ripple.groupChatId });
    await GroupChat.deleteOne({ _id: ripple.groupChatId });
  }

  await Ripple.deleteOne({ _id: ripple._id });
};

// @route DELETE /api/ripples/:id — hard-delete drafts only; live ones use cancel
const deleteRipple = asyncHandler(async (req, res) => {
  const { ripple } = await loadForLifecycle(req);
  if (ripple.lifecycle !== 'draft') {
    const e = new BadRequestError(
      'Only a draft can be deleted. Cancel an active or scheduled Ripple instead.',
    );
    e.code = 'ONLY_DRAFT_DELETABLE';
    e.statusCode = 409;
    throw e;
  }
  await purgeRippleChildren(ripple);
  res.status(200).json({ success: true, deleted: true });
});

// A source city needs at least this many Ripplers before it gets its own arc.
// Below it, the count folds into `otherCount` — an arc from a city with one
// joiner would pin that individual to a place, which is exactly the inference
// this whole feature must never allow.
const ARC_MIN_COUNT = 3;

// @route GET /api/ripples/:id/arcs — where Ripplers joined from (city-level)
const getRippleArcs = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const ripple = await Ripple.findById(
    mongoose.Types.ObjectId.isValid(req.params.id) ? req.params.id : new mongoose.Types.ObjectId(),
  );
  if (!ripple || ripple.lifecycle === 'removed') {
    const e = new NotFoundError('Ripple not found');
    e.code = 'NOT_FOUND';
    throw e;
  }

  const member = await Rippler.findOne({ rippleId: ripple._id, userId }).lean();
  const ctx = await getViewerContext(userId);
  if (ctx.blockedIds.has(ripple.hostUserId)) {
    const e = new NotFoundError('Ripple not found');
    e.code = 'NOT_FOUND';
    throw e;
  }
  if (!canView(ripple, member, ctx, userId)) {
    const e = new NotFoundError('Ripple not found');
    e.code = 'NOT_FOUND';
    throw e;
  }

  const rows = await Rippler.aggregate([
    {
      $match: {
        rippleId: ripple._id,
        status: 'approved',
        role: { $ne: 'follower' },
        originCityKey: { $type: 'string' },
        originCentroid: { $type: 'array' },
      },
    },
    {
      $group: {
        _id: '$originCityKey',
        count: { $sum: 1 },
        lng: { $avg: { $arrayElemAt: ['$originCentroid', 0] } },
        lat: { $avg: { $arrayElemAt: ['$originCentroid', 1] } },
      },
    },
  ]);

  const hostCityKey = ripple.place?.cityKey || null;
  const arcs = [];
  let otherCount = 0;

  rows.forEach((r) => {
    // No arc from the anchor city to itself.
    if (hostCityKey && r._id === hostCityKey) return;
    if (r.count < ARC_MIN_COUNT) {
      otherCount += r.count;
      return;
    }
    arcs.push({
      cityKey: r._id,
      // cityKey is `${countryCode}:${slug}` — the label is cosmetic.
      label: String(r._id).split(':').slice(1).join(':').replace(/-/g, ' '),
      coordinates: [Number(r.lng.toFixed(4)), Number(r.lat.toFixed(4))],
      count: r.count,
    });
  });

  arcs.sort((a, b) => b.count - a.count);

  res.status(200).json({
    success: true,
    arcs,
    otherCount,
    totalRemote: arcs.reduce((n, a) => n + a.count, 0) + otherCount,
    minimumForArc: ARC_MIN_COUNT,
  });
});

module.exports = {
  createRipple,
  getRipple,
  updateRipple,
  publishRipple,
  endRipple,
  cancelRipple,
  deleteRipple,
  getRippleArcs,
  // Exported so the cascade can be exercised directly in a test.
  purgeRippleChildren,
};
