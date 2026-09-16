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

const enumCheck = (value, allowed, field) => {
  if (value !== undefined && value !== null && !allowed.includes(value)) {
    const err = new BadRequestError(`${field} must be one of: ${allowed.join(', ')}`);
    err.code = 'VALIDATION';
    throw err;
  }
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

module.exports = {
  createRipple,
  getRipple,
  updateRipple,
  publishRipple,
};
