const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const OpenNetworkProfile = require('../models/OpenNetworkProfile');
const OpenConnection = require('../models/OpenConnection');
const OpenChat = require('../models/OpenChat');
const OpenMessage = require('../models/OpenMessage');
const Ripple = require('../models/Ripple');
const Rippler = require('../models/Rippler');
const User = require('../models/userModel');
const Block = require('../models/blockModel');
const {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} = require('../utils/errorClasses');
const {
  getViewerContext,
  buildVisibilityFilter,
} = require('../services/openNetworkVisibility');
const {
  coarsenPoint,
  normalizeBbox,
  resolvePlace,
} = require('../services/openNetworkGeo');
const { canView } = require('../utils/rippleAccess');
const { toRippleSummary } = require('../utils/rippleDto');
// hydrateSummaryExtras is the same batch avatar/support lookup the feed uses —
// reuse it so a person's recent Ripples render identically to feed cards.
const { profileView, hydrateSummaryExtras } = require('./openNetworkController');
const { notifyUser } = require('../services/openNetworkNotify');
const {
  pairKey,
  toPersonMini,
  toPersonSummary,
  toConnectionDto,
  toMessageDto,
  toChatSummary,
} = require('../utils/openNetworkPeopleDto');
const getSocketManager = () => require('../socketManager');

const OPEN_TO = OpenNetworkProfile.OPEN_TO;
const DISCOVERABLE_LIFECYCLES = ['active', 'wrapping', 'scheduled'];
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_WINDOW_MS = 30 * DAY_MS;
const PRESENCE_REFRESH_MS = 15 * 60 * 1000;
const CONNECT_RATE_LIMIT = 25;
const CONNECT_COOLDOWN_MS = 7 * DAY_MS;
const CHAT_RATE_LIMIT = 30;
const CHAT_RATE_WINDOW_MS = 60 * 1000;
const MESSAGE_DELETE_WINDOW_MS = 15 * 60 * 1000;
const HEAT_MIN_COUNT = 3;

const err = (ErrorClass, message, code, statusCode) => {
  const e = new ErrorClass(message);
  e.code = code;
  if (statusCode) e.statusCode = statusCode;
  return e;
};

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const sanitizeInterests = (input) =>
  [
    ...new Set(
      (Array.isArray(input) ? input : [])
        .map((i) => String(i).trim().toLowerCase())
        .filter((i) => i.length > 0 && i.length <= 24),
    ),
  ].slice(0, 10);

/* ------------------------------------------------------------------ *
 *  Profile + presence                                                *
 * ------------------------------------------------------------------ */

// @route PATCH /api/open-network/profile — persona fields only
const updatePersona = asyncHandler(async (req, res) => {
  const profile = req.openNetworkProfile;
  const body = req.body || {};
  profile.persona = profile.persona || {};

  if (body.headline !== undefined) {
    profile.persona.headline = String(body.headline).trim().slice(0, 60);
  }
  if (body.bio !== undefined) {
    profile.persona.bio = String(body.bio).trim().slice(0, 280);
  }
  if (body.interests !== undefined) {
    if (!Array.isArray(body.interests)) {
      throw err(BadRequestError, 'interests must be an array', 'VALIDATION');
    }
    profile.persona.interests = sanitizeInterests(body.interests);
  }
  if (body.openTo !== undefined) {
    if (!Array.isArray(body.openTo)) {
      throw err(BadRequestError, 'openTo must be an array', 'BAD_OPEN_TO');
    }
    const values = body.openTo.map((v) => String(v));
    const invalid = values.find((v) => !OPEN_TO.includes(v));
    if (invalid) {
      throw err(
        BadRequestError,
        `openTo must be one of: ${OPEN_TO.join(', ')}`,
        'BAD_OPEN_TO',
      );
    }
    profile.persona.openTo = [...new Set(values)];
  }

  await profile.save();
  res.status(200).json({ success: true, profile: profileView(profile) });
});

// @route POST /api/open-network/presence — coarse home anchor + activity tick
const updatePresence = asyncHandler(async (req, res) => {
  const lng = num(req.body?.lng);
  const lat = num(req.body?.lat);
  if (lng === null || lat === null) {
    throw err(BadRequestError, 'lng and lat are required numbers', 'BAD_LOCATION');
  }

  const profile = req.openNetworkProfile;
  const [clng, clat] = coarsenPoint(lng, lat);
  const existing = profile.home?.point?.coordinates;
  const coarseUnchanged =
    Array.isArray(existing) &&
    existing.length === 2 &&
    Math.abs(existing[0] - clng) < 1e-9 &&
    Math.abs(existing[1] - clat) < 1e-9;
  const recentlyResolved =
    profile.home?.updatedAt &&
    Date.now() - new Date(profile.home.updatedAt).getTime() < PRESENCE_REFRESH_MS;

  profile.lastActiveAt = new Date();
  if (recentlyResolved && coarseUnchanged) {
    // Same ~5km cell seen recently — skip the reverse geocode.
    await profile.save();
  } else {
    const place = await resolvePlace(lng, lat); // never throws
    profile.home = {
      city: place.city || '',
      state: place.state || '',
      country: place.country || '',
      countryCode: place.countryCode || '',
      cityKey: place.cityKey || '',
      label: place.label || place.city || '',
      point: { type: 'Point', coordinates: [clng, clat] },
      // Flat copies for bbox queries — the pre-save hook re-derives them on
      // save; writing both keeps updateMany paths consistent too.
      lng: clng,
      lat: clat,
      updatedAt: new Date(),
    };
    await profile.save();
  }

  const home = profile.home || {};
  res.status(200).json({
    success: true,
    home: { city: home.city || '', country: home.country || '', label: home.label || '' },
  });
});

/* ------------------------------------------------------------------ *
 *  People                                                            *
 * ------------------------------------------------------------------ */

/** Shared batch hydration for a page of profiles → PersonSummary[]. */
const hydratePeople = async (rows, viewerId, viewerProfile, ctx) => {
  const ids = rows.map((p) => p.userId);
  const [users, connections, rippleCounts] = await Promise.all([
    ids.length
      ? User.find({ userId: { $in: ids } }).select('userId name profileImage').lean()
      : [],
    ids.length
      ? OpenConnection.find({ pairKey: { $in: ids.map((id) => pairKey(viewerId, id)) } }).lean()
      : [],
    ids.length
      ? Ripple.aggregate([
          {
            $match: {
              $and: [
                buildVisibilityFilter(viewerId, ctx),
                { hostUserId: { $in: ids } },
                { lifecycle: { $in: DISCOVERABLE_LIFECYCLES } },
              ],
            },
          },
          { $group: { _id: '$hostUserId', n: { $sum: 1 } } },
        ])
      : [],
  ]);
  const userById = {};
  users.forEach((u) => {
    userById[u.userId] = u;
  });
  const connByPair = {};
  connections.forEach((c) => {
    connByPair[c.pairKey] = c;
  });
  const rippleCountById = {};
  rippleCounts.forEach((r) => {
    rippleCountById[r._id] = r.n;
  });

  return rows.map((p) => {
    const conn = connByPair[pairKey(viewerId, p.userId)];
    const connection =
      conn?.status === 'accepted'
        ? 'connected'
        : conn?.status === 'pending'
          ? conn.requesterId === viewerId
            ? 'outgoing'
            : 'incoming'
          : 'none';
    return toPersonSummary(p, userById[p.userId], {
      viewerInterests: viewerProfile?.persona?.interests,
      distanceKm:
        Number.isFinite(p.distMeters) ? p.distMeters / 1000 : null,
      connection,
      connectionId: conn ? String(conn._id) : null,
      isFriend: ctx.friendIds.has(p.userId),
      activeRippleCount: rippleCountById[p.userId] || 0,
    });
  });
};

// @route GET /api/open-network/people
const listPeople = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const myProfile = req.openNetworkProfile;
  const ctx = await getViewerContext(userId, req.user._id);

  // Origin: a coarsened query point, else the viewer's coarse home anchor.
  let origin = null;
  const qlng = num(req.query.lng);
  const qlat = num(req.query.lat);
  if (qlng !== null && qlat !== null) {
    origin = coarsenPoint(qlng, qlat);
  } else if (myProfile.home?.point?.coordinates?.length === 2) {
    origin = myProfile.home.point.coordinates;
  }
  if (!origin) {
    throw err(
      BadRequestError,
      'A location is required — pass lng+lat or set presence first',
      'LOCATION_REQUIRED',
    );
  }

  const radiusKm = Math.min(Math.max(num(req.query.radiusKm) ?? 50, 1), 300);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const sort = req.query.sort === 'shared' ? 'shared' : 'distance';

  const openTo = String(req.query.openTo || '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => OPEN_TO.includes(v));
  const interest = String(req.query.interest || '').trim().toLowerCase();

  const query = {
    joined: true,
    'settings.discoverable': true,
    // blockedIds covers both directions (I blocked them / they blocked me).
    userId: { $ne: userId, $nin: [...ctx.blockedIds] },
    lastActiveAt: { $gte: new Date(Date.now() - ACTIVE_WINDOW_MS) },
    'home.point': { $exists: true },
  };
  if (openTo.length) query['persona.openTo'] = { $in: openTo };
  if (interest) query['persona.interests'] = interest;

  // 'shared' ranks the nearest 200 by shared-interests-then-distance;
  // 'distance' is the geo order as returned.
  const windowSize = sort === 'shared' ? 200 : offset + limit + 1;
  const rows = await OpenNetworkProfile.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: origin },
        distanceField: 'distMeters',
        maxDistance: radiusKm * 1000,
        spherical: true,
        query,
      },
    },
    { $limit: windowSize },
  ]);

  let pageRows;
  let nextOffset = null;
  if (sort === 'shared') {
    const mine = new Set(myProfile.persona?.interests || []);
    rows.forEach((r) => {
      r._sharedCount = (r.persona?.interests || []).filter((i) => mine.has(i)).length;
    });
    rows.sort((a, b) => b._sharedCount - a._sharedCount || a.distMeters - b.distMeters);
    pageRows = rows.slice(offset, offset + limit);
    if (rows.length > offset + limit) nextOffset = offset + limit;
  } else {
    pageRows = rows.slice(offset, offset + limit);
    if (rows.length > offset + limit) nextOffset = offset + limit;
  }

  const people = await hydratePeople(pageRows, userId, myProfile, ctx);
  res.status(200).json({ success: true, people, nextOffset });
});

// @route GET /api/open-network/people/heat — city-level aggregates only
const peopleHeat = asyncHandler(async (req, res) => {
  const swLng = num(req.query.swLng);
  const swLat = num(req.query.swLat);
  const neLng = num(req.query.neLng);
  const neLat = num(req.query.neLat);
  if ([swLng, swLat, neLng, neLat].some((v) => v === null)) {
    throw err(
      BadRequestError,
      'swLng, swLat, neLng and neLat are required numbers',
      'BAD_VIEWPORT',
    );
  }

  const boxes = normalizeBbox({ swLng, swLat, neLng, neLat });
  // Flat numeric ranges on home.lng/home.lat — $geoWithin $box is a
  // legacy-coordinate operator and does not reliably match GeoJSON
  // (mirrors the viewport path's bboxOr on Ripple.lng/lat).
  const cells = await OpenNetworkProfile.aggregate([
    {
      $match: {
        joined: true,
        'settings.discoverable': true,
        lastActiveAt: { $gte: new Date(Date.now() - ACTIVE_WINDOW_MS) },
        'home.cityKey': { $ne: '' },
        $or: boxes.map((b) => ({
          'home.lng': { $gte: b.swLng, $lte: b.neLng },
          'home.lat': { $gte: b.swLat, $lte: b.neLat },
        })),
      },
    },
    {
      $group: {
        _id: '$home.cityKey',
        count: { $sum: 1 },
        lng: { $avg: '$home.lng' },
        lat: { $avg: '$home.lat' },
        city: { $first: '$home.city' },
        country: { $first: '$home.country' },
      },
    },
    // Privacy floor — same rule as the globe's ripple clusters.
    { $match: { count: { $gte: HEAT_MIN_COUNT } } },
    { $sort: { count: -1 } },
    { $limit: 500 },
  ]);

  res.status(200).json({
    success: true,
    cells: cells.map((c) => ({
      cityKey: c._id,
      label: [c.city, c.country].filter(Boolean).join(', '),
      coordinates: { lng: c.lng, lat: c.lat },
      count: c.count,
    })),
  });
});

// @route GET /api/open-network/people/:userId — person detail
const getPerson = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const targetId = String(req.params.userId);
  const isSelf = targetId === userId;
  const ctx = await getViewerContext(userId, req.user._id);

  const [profile, user, connection] = await Promise.all([
    OpenNetworkProfile.findOne({ userId: targetId }).lean(),
    User.findOne({ userId: targetId }).select('userId name profileImage').lean(),
    isSelf
      ? null
      : OpenConnection.findOne({ pairKey: pairKey(userId, targetId) }).lean(),
  ]);

  const connected = connection?.status === 'accepted';
  if (
    !profile ||
    !profile.joined ||
    (!isSelf &&
      (ctx.blockedIds.has(targetId) ||
        (!profile.settings?.discoverable && !connected)))
  ) {
    throw err(NotFoundError, 'Person not found', 'PERSON_NOT_FOUND');
  }

  // Ripples where BOTH users are host or an approved non-follower member.
  const [myRippleIds, theirRippleIds] = await Promise.all([
    Promise.all([
      Ripple.distinct('_id', { hostUserId: userId }),
      Rippler.distinct('rippleId', { userId, status: 'approved', role: { $ne: 'follower' } }),
    ]).then(([a, b]) => new Set([...a.map(String), ...b.map(String)])),
    Promise.all([
      Ripple.distinct('_id', { hostUserId: targetId }),
      Rippler.distinct('rippleId', { userId: targetId, status: 'approved', role: { $ne: 'follower' } }),
    ]).then(([a, b]) => new Set([...a.map(String), ...b.map(String)])),
  ]);
  const sharedRipplesCount = [...myRippleIds].filter((id) => theirRippleIds.has(id)).length;

  const recent = await Ripple.find({
    $and: [
      buildVisibilityFilter(userId, ctx),
      { hostUserId: targetId },
      { lifecycle: { $in: [...DISCOVERABLE_LIFECYCLES, 'memory'] } },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(6)
    .lean();
  const extras = await hydrateSummaryExtras(recent, userId);

  const person = toPersonSummary(profile, user, {
    viewerInterests: req.openNetworkProfile?.persona?.interests,
    connection: connected
      ? 'connected'
      : connection?.status === 'pending'
        ? connection.requesterId === userId
          ? 'outgoing'
          : 'incoming'
        : 'none',
    connectionId: connection ? String(connection._id) : null,
    isFriend: ctx.friendIds.has(targetId),
  });

  res.status(200).json({
    success: true,
    person: {
      ...person,
      bio: profile.persona?.bio || '',
      reputation: {
        hostScore: profile.reputation?.hostScore ?? null,
        hostCount: profile.reputation?.hostCount ?? 0,
      },
      recentRipples: recent.map((r) => toRippleSummary(r, extras(r))),
      sharedRipplesCount,
      connectedAt: connection?.acceptedAt
        ? new Date(connection.acceptedAt).toISOString()
        : null,
      isSelf,
    },
  });
});

/* ------------------------------------------------------------------ *
 *  Connections                                                       *
 * ------------------------------------------------------------------ */

/** Does this pair share a Ripple (either is host / approved member on one)? */
const sharesRipple = async (aId, bId) => {
  const [aIds, bIds] = await Promise.all([
    Promise.all([
      Ripple.distinct('_id', { hostUserId: aId }),
      Rippler.distinct('rippleId', { userId: aId, status: 'approved' }),
    ]).then(([x, y]) => new Set([...x.map(String), ...y.map(String)])),
    Promise.all([
      Ripple.distinct('_id', { hostUserId: bId }),
      Rippler.distinct('rippleId', { userId: bId, status: 'approved' }),
    ]).then(([x, y]) => new Set([...x.map(String), ...y.map(String)])),
  ]);
  return [...aIds].some((id) => bIds.has(id));
};

/** Accept a pending connection + open the chat + notify the requester. */
const acceptConnection = async (conn) => {
  conn.status = 'accepted';
  conn.acceptedAt = new Date();
  await conn.save();
  const chat = await OpenChat.findOrCreate(conn.requesterId, conn.recipientId, conn._id);
  // An archived chat re-opens for both sides on (re)connection.
  if (chat.archivedBy?.length) {
    await OpenChat.updateOne({ _id: chat._id }, { $set: { archivedBy: [] } });
  }

  const [requesterProfile, requesterUser, accepterProfile, accepterUser] =
    await Promise.all([
      OpenNetworkProfile.findOne({ userId: conn.requesterId }).lean(),
      User.findOne({ userId: conn.requesterId }).select('userId name profileImage').lean(),
      OpenNetworkProfile.findOne({ userId: conn.recipientId }).lean(),
      User.findOne({ userId: conn.recipientId }).select('userId name profileImage').lean(),
    ]);
  await notifyUser({
    toUserId: conn.requesterId,
    fromUserId: conn.recipientId,
    type: 'on_connect_accepted',
    socketEvent: 'open-network:connection',
    title: 'Connection accepted',
    message: `${accepterUser?.name || 'Someone'} accepted your connection`,
    data: {
      kind: 'accepted',
      actorName: accepterUser?.name || 'Someone',
      connectionId: String(conn._id),
      connection: toConnectionDto(
        conn,
        toPersonMini(accepterProfile, accepterUser),
      ),
    },
  });
  return { conn, chat, requesterProfile, requesterUser };
};

// @route POST /api/open-network/connections — send a connect request
const createConnection = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const toUserId = String(req.body.toUserId || '');
  const note = String(req.body.note || '').trim().slice(0, 150);
  const rippleId = mongoose.Types.ObjectId.isValid(req.body.rippleId)
    ? req.body.rippleId
    : null;

  if (!toUserId) {
    throw err(BadRequestError, 'toUserId is required', 'VALIDATION');
  }
  if (toUserId === userId) {
    throw err(BadRequestError, 'You cannot connect with yourself', 'VALIDATION');
  }

  const [targetProfile, ctx] = await Promise.all([
    OpenNetworkProfile.findOne({ userId: toUserId }).lean(),
    getViewerContext(userId, req.user._id),
  ]);
  if (!targetProfile?.joined || ctx.blockedIds.has(toUserId)) {
    throw err(NotFoundError, 'Person not found', 'PERSON_NOT_FOUND');
  }
  // Non-discoverable members are only reachable through a shared Ripple.
  if (!targetProfile.settings?.discoverable && !(await sharesRipple(userId, toUserId))) {
    throw err(NotFoundError, 'Person not found', 'PERSON_NOT_FOUND');
  }

  const pk = pairKey(userId, toUserId);
  let conn = await OpenConnection.findOne({ pairKey: pk });

  if (conn?.status === 'accepted') {
    return res.status(200).json({ success: true, idempotent: true, connection: conn });
  }
  if (conn?.status === 'pending' && conn.requesterId === userId) {
    return res.status(200).json({ success: true, idempotent: true, connection: conn });
  }
  if (conn?.status === 'pending' && conn.requesterId === toUserId) {
    // They already asked — my "request" is really an acceptance.
    const accepted = await acceptConnection(conn);
    return res.status(200).json({
      success: true,
      accepted: true,
      connection: accepted.conn,
      chatId: String(accepted.chat._id),
    });
  }
  if (
    conn?.status === 'declined' &&
    conn.respondedAt &&
    Date.now() - new Date(conn.respondedAt).getTime() < CONNECT_COOLDOWN_MS
  ) {
    throw err(
      BadRequestError,
      'This connection was declined recently — try again later',
      'CONNECT_COOLDOWN',
      429,
    );
  }

  // ≤25 new/reset requests per requester per rolling 24h.
  const recentRequests = await OpenConnection.countDocuments({
    requesterId: userId,
    requestedAt: { $gte: new Date(Date.now() - DAY_MS) },
  });
  if (recentRequests >= CONNECT_RATE_LIMIT) {
    throw err(
      BadRequestError,
      'Too many connection requests — try again later',
      'CONNECT_RATE_LIMITED',
      429,
    );
  }

  if (conn) {
    // declined-past-cooldown / withdrawn / removed — reset to a fresh request.
    conn.requesterId = userId;
    conn.recipientId = toUserId;
    conn.status = 'pending';
    conn.note = note;
    conn.contextRippleId = rippleId;
    conn.requestedAt = new Date();
    conn.respondedAt = null;
    conn.acceptedAt = null;
    await conn.save();
  } else {
    try {
      conn = await OpenConnection.create({
        requesterId: userId,
        recipientId: toUserId,
        pairKey: pk,
        status: 'pending',
        note,
        contextRippleId: rippleId,
        requestedAt: new Date(),
      });
    } catch (e) {
      // Concurrent double-send raced the unique pairKey — the other write
      // already created the row, so this request is satisfied idempotently.
      if (e?.code === 11000) {
        const existing = await OpenConnection.findOne({ pairKey: pk }).lean();
        return res.status(200).json({ success: true, idempotent: true, connection: existing });
      }
      throw e;
    }
  }

  const [myProfile, me, contextRipple] = await Promise.all([
    OpenNetworkProfile.findOne({ userId }).lean(),
    User.findOne({ userId }).select('userId name profileImage').lean(),
    rippleId ? Ripple.findById(rippleId).select('title').lean() : null,
  ]);
  const dto = toConnectionDto(conn, toPersonMini(myProfile, me), contextRipple?.title || null);
  await notifyUser({
    toUserId,
    fromUserId: userId,
    type: 'on_connect_request',
    socketEvent: 'open-network:connection',
    title: 'New connection request',
    message: `${me?.name || 'Someone'} wants to connect on Open Network`,
    data: { kind: 'request', actorName: me?.name || 'Someone', connection: dto },
  });

  res.status(201).json({ success: true, connection: dto });
});

// @route GET /api/open-network/connections?status=incoming|outgoing|accepted
const listConnections = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const status = String(req.query.status || 'incoming');
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

  const query =
    status === 'incoming'
      ? { recipientId: userId, status: 'pending' }
      : status === 'outgoing'
        ? { requesterId: userId, status: 'pending' }
        : { $or: [{ requesterId: userId }, { recipientId: userId }], status: 'accepted' };

  const rows = await OpenConnection.find(query)
    .sort({ updatedAt: -1 })
    .skip(offset)
    .limit(limit + 1)
    .lean();
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const otherIds = page.map((c) => (c.requesterId === userId ? c.recipientId : c.requesterId));
  const rippleIds = page.map((c) => c.contextRippleId).filter(Boolean);
  const [profiles, users, ripples] = await Promise.all([
    OpenNetworkProfile.find({ userId: { $in: otherIds } }).lean(),
    User.find({ userId: { $in: otherIds } }).select('userId name profileImage').lean(),
    rippleIds.length ? Ripple.find({ _id: { $in: rippleIds } }).select('title').lean() : [],
  ]);
  const profileById = {};
  profiles.forEach((p) => {
    profileById[p.userId] = p;
  });
  const userById = {};
  users.forEach((u) => {
    userById[u.userId] = u;
  });
  const rippleTitleById = {};
  ripples.forEach((r) => {
    rippleTitleById[String(r._id)] = r.title;
  });

  res.status(200).json({
    success: true,
    connections: page.map((c) => {
      const otherId = c.requesterId === userId ? c.recipientId : c.requesterId;
      return toConnectionDto(
        c,
        toPersonMini(profileById[otherId], userById[otherId]),
        c.contextRippleId ? rippleTitleById[String(c.contextRippleId)] || null : null,
      );
    }),
    nextOffset: hasMore ? offset + limit : null,
  });
});

const loadConnection = async (req) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw err(NotFoundError, 'Connection not found', 'CONNECTION_NOT_FOUND');
  }
  const conn = await OpenConnection.findById(req.params.id);
  if (!conn || (conn.requesterId !== req.user.userId && conn.recipientId !== req.user.userId)) {
    throw err(NotFoundError, 'Connection not found', 'CONNECTION_NOT_FOUND');
  }
  return conn;
};

// @route POST /api/open-network/connections/:id/accept
const acceptConnectionEndpoint = asyncHandler(async (req, res) => {
  const conn = await loadConnection(req);
  if (conn.recipientId !== req.user.userId) {
    throw err(ForbiddenError, 'Only the recipient can accept', 'FORBIDDEN');
  }
  if (conn.status === 'accepted') {
    const chat = await OpenChat.findOrCreate(conn.requesterId, conn.recipientId, conn._id);
    return res.status(200).json({ success: true, connection: conn, chatId: String(chat._id) });
  }
  if (conn.status !== 'pending') {
    throw err(BadRequestError, 'This request is no longer pending', 'NOT_PENDING');
  }
  const { conn: saved, chat } = await acceptConnection(conn);
  res.status(200).json({ success: true, connection: saved, chatId: String(chat._id) });
});

// @route POST /api/open-network/connections/:id/decline
const declineConnection = asyncHandler(async (req, res) => {
  const conn = await loadConnection(req);
  if (conn.recipientId !== req.user.userId) {
    throw err(ForbiddenError, 'Only the recipient can decline', 'FORBIDDEN');
  }
  if (conn.status !== 'pending') {
    throw err(BadRequestError, 'This request is no longer pending', 'NOT_PENDING');
  }
  conn.status = 'declined';
  conn.respondedAt = new Date();
  await conn.save();
  res.status(200).json({ success: true, connection: conn });
});

// @route POST /api/open-network/connections/:id/withdraw
const withdrawConnection = asyncHandler(async (req, res) => {
  const conn = await loadConnection(req);
  if (conn.requesterId !== req.user.userId) {
    throw err(ForbiddenError, 'Only the requester can withdraw', 'FORBIDDEN');
  }
  if (conn.status !== 'pending') {
    throw err(BadRequestError, 'This request is no longer pending', 'NOT_PENDING');
  }
  conn.status = 'withdrawn';
  conn.respondedAt = new Date();
  await conn.save();
  res.status(200).json({ success: true, connection: conn });
});

// @route DELETE /api/open-network/connections/:id — remove an accepted link
const removeConnection = asyncHandler(async (req, res) => {
  const conn = await loadConnection(req);
  if (conn.status !== 'accepted') {
    throw err(BadRequestError, 'Only an accepted connection can be removed', 'NOT_CONNECTED');
  }
  conn.status = 'removed';
  conn.respondedAt = new Date();
  await conn.save();
  res.status(200).json({ success: true });
});

/* ------------------------------------------------------------------ *
 *  Chats                                                             *
 * ------------------------------------------------------------------ */

const loadChat = async (req) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw err(NotFoundError, 'Chat not found', 'CHAT_NOT_FOUND');
  }
  const chat = await OpenChat.findById(req.params.id);
  if (!chat || !chat.participants.includes(req.user.userId)) {
    throw err(NotFoundError, 'Chat not found', 'CHAT_NOT_FOUND');
  }
  return chat;
};

/** The other participant's userId in a two-person chat. */
const otherParticipant = (chat, userId) => chat.participants.find((p) => p !== userId);

// @route GET /api/open-network/chats
const listChats = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

  const rows = await OpenChat.find({ participants: userId, archivedBy: { $ne: userId } })
    .sort({ 'lastMessage.at': -1, updatedAt: -1 })
    .skip(offset)
    .limit(limit + 1)
    .lean();
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const otherIds = page.map((c) => otherParticipant(c, userId)).filter(Boolean);
  const [profiles, users, connections] = await Promise.all([
    OpenNetworkProfile.find({ userId: { $in: otherIds } }).lean(),
    User.find({ userId: { $in: otherIds } }).select('userId name profileImage').lean(),
    OpenConnection.find({
      pairKey: { $in: otherIds.map((id) => pairKey(userId, id)) },
      status: 'accepted',
    })
      .select('pairKey')
      .lean(),
  ]);
  const profileById = {};
  profiles.forEach((p) => {
    profileById[p.userId] = p;
  });
  const userById = {};
  users.forEach((u) => {
    userById[u.userId] = u;
  });
  const connectedPairs = new Set(connections.map((c) => c.pairKey));

  res.status(200).json({
    success: true,
    chats: page.map((c) => {
      const otherId = otherParticipant(c, userId);
      return toChatSummary(c, toPersonMini(profileById[otherId], userById[otherId]), {
        userId,
        connected: connectedPairs.has(pairKey(userId, otherId)),
      });
    }),
    nextOffset: hasMore ? offset + limit : null,
  });
});

// @route GET /api/open-network/chats/with/:userId — chat for an accepted pair
const chatWith = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const otherId = String(req.params.userId);
  const conn = await OpenConnection.findOne({
    pairKey: pairKey(userId, otherId),
    status: 'accepted',
  }).lean();
  if (!conn) {
    throw err(ForbiddenError, 'You are not connected with this person', 'NOT_CONNECTED');
  }
  const chat = await OpenChat.findOrCreate(userId, otherId, conn._id);
  if (chat.archivedBy?.includes(userId)) {
    await OpenChat.updateOne({ _id: chat._id }, { $pull: { archivedBy: userId } });
  }
  res.status(200).json({ success: true, chatId: String(chat._id) });
});

// @route GET /api/open-network/chats/:id/messages?before&limit — newest first
const listMessages = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const chat = await loadChat(req);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 50);

  const q = { chatId: chat._id };
  if (req.query.before && mongoose.Types.ObjectId.isValid(req.query.before)) {
    q._id = { $lt: req.query.before };
  }
  const rows = await OpenMessage.find(q).sort({ _id: -1 }).limit(limit + 1).lean();
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const otherId = otherParticipant(chat, userId);
  const otherReadAt = chat.readAt?.get?.(otherId) || chat.readAt?.[otherId] || null;

  res.status(200).json({
    success: true,
    messages: page.map(toMessageDto),
    nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
    otherReadAt: otherReadAt ? new Date(otherReadAt).toISOString() : null,
  });
});

// @route POST /api/open-network/chats/:id/messages
const sendMessage = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const chat = await loadChat(req);
  const otherId = otherParticipant(chat, userId);

  const ctx = await getViewerContext(userId, req.user._id);
  const [conn, joinedProfiles, me] = await Promise.all([
    OpenConnection.findOne({ pairKey: chat.pairKey, status: 'accepted' }).lean(),
    OpenNetworkProfile.find({ userId: { $in: chat.participants }, joined: true })
      .select('userId')
      .lean(),
    User.findOne({ userId }).select('userId name').lean(),
  ]);
  if (!conn || ctx.blockedIds.has(otherId)) {
    throw err(ForbiddenError, 'You are not connected with this person', 'NOT_CONNECTED');
  }
  if (joinedProfiles.length !== chat.participants.length) {
    throw err(ForbiddenError, 'This person is no longer on Open Network', 'PERSON_UNAVAILABLE');
  }

  const type = String(req.body.type || 'text');
  if (!['text', 'image', 'ripple'].includes(type)) {
    throw err(BadRequestError, 'type must be one of: text, image, ripple', 'VALIDATION');
  }

  // Send retries replay the same clientId — return the original message.
  const clientId = req.body.clientId ? String(req.body.clientId) : null;
  if (clientId) {
    const existing = await OpenMessage.findOne({ senderId: userId, clientId }).lean();
    if (existing && String(existing.chatId) === String(chat._id)) {
      return res.status(200).json({ success: true, idempotent: true, message: toMessageDto(existing) });
    }
  }

  const recent = await OpenMessage.countDocuments({
    chatId: chat._id,
    senderId: userId,
    createdAt: { $gte: new Date(Date.now() - CHAT_RATE_WINDOW_MS) },
  });
  if (recent >= CHAT_RATE_LIMIT) {
    throw err(BadRequestError, 'Sending too fast — slow down', 'CHAT_RATE_LIMITED', 429);
  }

  let body = String(req.body.body || '').trim();
  let imageUrl = null;
  let rippleId = null;
  let rippleSnapshot = undefined;

  if (type === 'text') {
    if (!body || body.length > 2000) {
      throw err(BadRequestError, 'A text message needs 1-2000 characters', 'VALIDATION');
    }
  } else if (type === 'image') {
    imageUrl = String(req.body.imageUrl || '').trim();
    if (!/^https?:\/\//i.test(imageUrl)) {
      throw err(BadRequestError, 'imageUrl must be an http(s) URL', 'VALIDATION');
    }
    body = body.slice(0, 2000);
  } else {
    // 'ripple' — the sender must be able to see the Ripple they share.
    if (!mongoose.Types.ObjectId.isValid(req.body.rippleId)) {
      throw err(BadRequestError, 'rippleId is required', 'VALIDATION');
    }
    const ripple = await Ripple.findById(req.body.rippleId).lean();
    const member = ripple
      ? await Rippler.findOne({ rippleId: ripple._id, userId }).lean()
      : null;
    if (!ripple || !canView(ripple, member, ctx, userId)) {
      throw err(NotFoundError, 'Ripple not found', 'RIPPLE_NOT_FOUND');
    }
    rippleId = ripple._id;
    rippleSnapshot = {
      title: ripple.title,
      coverUrl: ripple.media?.[0]?.url || null,
      kind: ripple.kind || 'ripple',
      placeLabel: ripple.place?.label || '',
    };
    body = body.slice(0, 2000);
  }

  const message = await OpenMessage.create({
    chatId: chat._id,
    senderId: userId,
    type,
    body,
    imageUrl,
    rippleId,
    ...(rippleSnapshot ? { rippleSnapshot } : {}),
    ...(clientId ? { clientId } : {}),
  });

  const preview = type === 'text' ? body : type === 'image' ? '📷 Photo' : rippleSnapshot.title;
  await OpenChat.updateOne(
    { _id: chat._id },
    {
      $set: {
        lastMessage: {
          body: String(preview || '').slice(0, 120),
          type,
          senderId: userId,
          at: message.createdAt,
        },
      },
      $inc: { [`unread.${otherId}`]: 1 },
      // A new message un-archives the chat for both sides.
      $pull: { archivedBy: { $in: chat.participants } },
    },
  );

  const dto = toMessageDto(message);
  try {
    chat.participants.forEach((p) => {
      getSocketManager().broadcastToUser(p, 'open-network:message', {
        chatId: String(chat._id),
        message: dto,
      });
    });
  } catch (e) {
    console.error('❌ [ON CHAT] broadcast failed:', e.message);
  }

  if (!chat.mutedBy?.includes(otherId)) {
    try {
      await notifyUser({
        toUserId: otherId,
        fromUserId: userId,
        type: 'on_message',
        socketEvent: null,
        title: me?.name || 'New message',
        message: 'New message',
        data: { chatId: String(chat._id), actorName: me?.name || 'Someone' },
      });
    } catch (e) {
      /* best-effort */
    }
  }

  res.status(201).json({ success: true, message: dto });
});

// @route POST /api/open-network/chats/:id/read — mark the thread read
const markChatRead = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const chat = await loadChat(req);
  const otherId = otherParticipant(chat, userId);
  const now = new Date();
  await OpenChat.updateOne(
    { _id: chat._id },
    { $set: { [`unread.${userId}`]: 0, [`readAt.${userId}`]: now } },
  );
  try {
    getSocketManager().broadcastToUser(otherId, 'open-network:read', {
      chatId: String(chat._id),
      userId,
      readAt: now.toISOString(),
    });
  } catch (e) {
    /* best-effort */
  }
  res.status(200).json({ success: true });
});

// @route POST /api/open-network/chats/:id/mute {muted}
const muteChat = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const chat = await loadChat(req);
  const muted = req.body?.muted !== false;
  await OpenChat.updateOne(
    { _id: chat._id },
    muted ? { $addToSet: { mutedBy: userId } } : { $pull: { mutedBy: userId } },
  );
  res.status(200).json({ success: true, muted });
});

// @route POST /api/open-network/chats/:id/archive
const archiveChat = asyncHandler(async (req, res) => {
  const chat = await loadChat(req);
  await OpenChat.updateOne({ _id: chat._id }, { $addToSet: { archivedBy: req.user.userId } });
  res.status(200).json({ success: true });
});

// @route DELETE /api/open-network/chats/:id/messages/:messageId
const deleteMessage = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const chat = await loadChat(req);
  if (!mongoose.Types.ObjectId.isValid(req.params.messageId)) {
    throw err(NotFoundError, 'Message not found', 'MESSAGE_NOT_FOUND');
  }
  const message = await OpenMessage.findOne({ _id: req.params.messageId, chatId: chat._id });
  if (!message || message.deleted) {
    throw err(NotFoundError, 'Message not found', 'MESSAGE_NOT_FOUND');
  }
  if (message.senderId !== userId) {
    throw err(ForbiddenError, 'Only the sender can delete a message', 'FORBIDDEN');
  }
  if (Date.now() - new Date(message.createdAt).getTime() > MESSAGE_DELETE_WINDOW_MS) {
    throw err(ForbiddenError, 'This message can no longer be deleted', 'DELETE_WINDOW_CLOSED');
  }
  message.deleted = true;
  message.body = '';
  message.imageUrl = null;
  await message.save();
  try {
    chat.participants.forEach((p) => {
      getSocketManager().broadcastToUser(p, 'open-network:message:deleted', {
        chatId: String(chat._id),
        messageId: String(message._id),
      });
    });
  } catch (e) {
    /* best-effort */
  }
  res.status(200).json({ success: true, deleted: true });
});

/* ------------------------------------------------------------------ *
 *  Badges                                                            *
 * ------------------------------------------------------------------ */

// @route GET /api/open-network/badges — inbox + request counters
const getBadges = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const [unreadChats, incomingRequests] = await Promise.all([
    OpenChat.countDocuments({
      participants: userId,
      archivedBy: { $ne: userId },
      [`unread.${userId}`]: { $gt: 0 },
    }),
    OpenConnection.countDocuments({ recipientId: userId, status: 'pending' }),
  ]);
  res.status(200).json({ success: true, unreadChats, incomingRequests });
});

module.exports = {
  updatePersona,
  updatePresence,
  listPeople,
  peopleHeat,
  getPerson,
  createConnection,
  listConnections,
  acceptConnectionEndpoint,
  declineConnection,
  withdrawConnection,
  removeConnection,
  listChats,
  chatWith,
  listMessages,
  sendMessage,
  markChatRead,
  muteChat,
  archiveChat,
  deleteMessage,
  getBadges,
};
