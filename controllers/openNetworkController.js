const asyncHandler = require('express-async-handler');
const OpenNetworkProfile = require('../models/OpenNetworkProfile');
const Ripple = require('../models/Ripple');
const Rippler = require('../models/Rippler');
const { BadRequestError } = require('../utils/errorClasses');
const { toRippleSummary } = require('../utils/rippleDto');
const {
  cellSizeForZoom,
  normalizeBbox,
  resolvePlace,
} = require('../services/openNetworkGeo');
const {
  getViewerContext,
  buildVisibilityFilter,
} = require('../services/openNetworkVisibility');

const DISCOVERABLE_LIFECYCLES = ['active', 'wrapping', 'scheduled'];
// Privacy floor from the client contract: below this many ripples in a cell
// the count is withheld so a single Ripple can't be pinpointed by its count.
const MIN_CLUSTER_EXACT_COUNT = 3;

const profileView = (p) => ({
  userId: p.userId,
  joined: p.joined,
  joinedAt: p.joinedAt,
  leftAt: p.leftAt,
  settings: p.settings,
  reputation: p.reputation,
});

// @route GET /api/open-network/me — no join requirement (drives the gate UI)
const getMe = asyncHandler(async (req, res) => {
  const profile = await OpenNetworkProfile.getOrCreate(req.user.userId);
  res.status(200).json({ success: true, profile: profileView(profile) });
});

// @route POST /api/open-network/join
const joinOpenNetwork = asyncHandler(async (req, res) => {
  const profile = await OpenNetworkProfile.getOrCreate(req.user.userId);
  if (!profile.joined) {
    profile.joined = true;
    profile.joinedAt = new Date();
    profile.leftAt = null;
    await profile.save();
  }
  res.status(200).json({ success: true, profile: profileView(profile) });
});

// @route POST /api/open-network/leave
const leaveOpenNetwork = asyncHandler(async (req, res) => {
  const profile = await OpenNetworkProfile.getOrCreate(req.user.userId);
  if (profile.joined) {
    profile.joined = false;
    profile.leftAt = new Date();
    await profile.save();
  }
  res.status(200).json({ success: true, profile: profileView(profile) });
});

const SETTINGS_ENUMS = {
  defaultReach: ['neighborhood', 'city', 'region', 'global', 'online'],
  defaultVisibility: ['public', 'friends', 'invite'],
};
const SETTINGS_BOOLS = ['discoverable', 'notifyNearby'];

// @route PATCH /api/open-network/settings
const updateSettings = asyncHandler(async (req, res) => {
  const profile = await OpenNetworkProfile.getOrCreate(req.user.userId);
  const patch = req.body || {};

  for (const key of Object.keys(patch)) {
    if (SETTINGS_BOOLS.includes(key)) {
      if (typeof patch[key] !== 'boolean') {
        throw new BadRequestError(`settings.${key} must be a boolean`);
      }
      profile.settings[key] = patch[key];
    } else if (SETTINGS_ENUMS[key]) {
      if (!SETTINGS_ENUMS[key].includes(patch[key])) {
        throw new BadRequestError(
          `settings.${key} must be one of: ${SETTINGS_ENUMS[key].join(', ')}`,
        );
      }
      profile.settings[key] = patch[key];
    }
    // Unknown keys are ignored deliberately — forward-compatible PATCH.
  }

  await profile.save();
  res.status(200).json({ success: true, profile: profileView(profile) });
});

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// Longitude midpoint that survives an antimeridian-crossing viewport.
const midLng = (swLng, neLng) => {
  let m = swLng <= neLng ? (swLng + neLng) / 2 : (swLng + neLng + 360) / 2;
  if (m > 180) m -= 360;
  return m;
};

/**
 * Apply the optional `section` param as extra match clauses.
 * Returns extra clauses array (possibly empty).
 */
const sectionClauses = async (section, userId) => {
  switch (section) {
    case 'live':
      return [{ lifecycle: { $in: ['active', 'wrapping'] } }];
    case 'memories':
      return [{ lifecycle: 'memory' }];
    case 'yours':
      return [{ hostUserId: userId }];
    case 'invited': {
      const rows = await Rippler.find({ userId, status: 'requested' })
        .select('rippleId')
        .lean();
      return [{ _id: { $in: rows.map((r) => r.rippleId) } }];
    }
    // forYou / trending / anything else: the default discoverable set.
    default:
      return [{ lifecycle: { $in: DISCOVERABLE_LIFECYCLES } }];
  }
};

// @route GET /api/open-network/viewport?swLng&swLat&neLng&neLat&zoom[&types=a,b][&section=...]
const getViewport = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const swLng = num(req.query.swLng);
  const swLat = num(req.query.swLat);
  const neLng = num(req.query.neLng);
  const neLat = num(req.query.neLat);
  const zoom = num(req.query.zoom);

  if ([swLng, swLat, neLng, neLat, zoom].some((v) => v === null)) {
    const err = new BadRequestError(
      'swLng, swLat, neLng, neLat and zoom are required numbers',
    );
    err.code = 'BAD_VIEWPORT';
    throw err;
  }

  const boxes = normalizeBbox({ swLng, swLat, neLng, neLat });
  const bboxOr = boxes.map((b) => ({
    lng: { $gte: b.swLng, $lte: b.neLng },
    lat: { $gte: b.swLat, $lte: b.neLat },
  }));

  const ctx = await getViewerContext(userId);
  const baseMatch = {
    $and: [buildVisibilityFilter(userId, ctx), { $or: bboxOr }],
  };

  const typeList = (req.query.types || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const clauses = await sectionClauses(req.query.section, userId);
  const match = { $and: [...baseMatch.$and, ...clauses] };
  if (typeList.length) match.$and.push({ type: { $in: typeList } });

  // Region + counts describe the viewport itself, not the applied section
  // filter — they power the "viewing X — N ripples here" toast.
  const [activeCount, memoriesCount, place] = await Promise.all([
    Ripple.countDocuments({
      $and: [...baseMatch.$and, { lifecycle: { $in: ['active', 'wrapping'] } }],
    }),
    Ripple.countDocuments({
      $and: [...baseMatch.$and, { lifecycle: 'memory' }],
    }),
    resolvePlace(midLng(swLng, neLng), (swLat + neLat) / 2),
  ]);
  const region = {
    name: place.city || place.country || place.label || '',
    countryCode: place.countryCode || '',
  };
  const counts = { active: activeCount, memories: memoriesCount };

  /**
   * "My Ripples" — the ones I host, plus the ones I've joined.
   *
   * These are ALWAYS returned as individual markers, at every zoom level.
   * Without this, a Ripple you just created collapses into an anonymous
   * cluster at world zoom and appears not to exist — which is exactly the
   * "my own Ripple isn't showing" bug.
   */
  const joinedRows = await Rippler.find({ userId, status: 'approved' })
    .select('rippleId')
    .lean();
  const joinedIds = joinedRows.map((r) => r.rippleId);
  const mineClause = {
    $or: [{ hostUserId: userId }, { _id: { $in: joinedIds } }],
  };

  const cellSize = cellSizeForZoom(zoom);
  if (cellSize === null) {
    const ripples = await Ripple.find(match).limit(300).lean();
    return res.status(200).json({
      success: true,
      mode: 'ripples',
      clusters: [],
      ripples: ripples.map((r) => toRippleSummary(r, { viewerUserId: userId })),
      region,
      counts,
    });
  }

  // Clusters describe *other people's* activity; my own Ripples are pulled out
  // and rendered individually, so the two never double-count the same Ripple.
  const clusterMatch = {
    $and: [...match.$and, { $nor: [mineClause] }],
  };

  const [groups, mine] = await Promise.all([
    Ripple.aggregate([
      { $match: clusterMatch },
      {
        $group: {
          _id: {
            lngCell: { $floor: { $divide: ['$lng', cellSize] } },
            latCell: { $floor: { $divide: ['$lat', cellSize] } },
          },
          centroidLng: { $avg: '$lng' },
          centroidLat: { $avg: '$lat' },
          count: { $sum: 1 },
          hasLive: {
            $max: { $cond: [{ $in: ['$lifecycle', ['active', 'wrapping']] }, 1, 0] },
          },
        },
      },
    ]),
    Ripple.find({ $and: [...match.$and, mineClause] }).limit(100).lean(),
  ]);

  res.status(200).json({
    success: true,
    mode: 'clusters',
    clusters: groups.map((g) => ({
      cellKey: `${g._id.lngCell}:${g._id.latCell}`,
      coordinates: { lat: g.centroidLat, lng: g.centroidLng },
      count: g.count < MIN_CLUSTER_EXACT_COUNT ? null : g.count,
      hasLive: !!g.hasLive,
    })),
    // My own Ripples, always visible as markers regardless of zoom.
    ripples: mine.map((r) => toRippleSummary(r, { viewerUserId: userId })),
    region,
    counts,
  });
});

// @route GET /api/open-network/nearby?lng&lat&radiusKm
const getNearby = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const lng = num(req.query.lng);
  const lat = num(req.query.lat);
  if (lng === null || lat === null) {
    const err = new BadRequestError('lng and lat are required numbers');
    err.code = 'BAD_COORDS';
    throw err;
  }
  const radiusKm = Math.min(Math.max(num(req.query.radiusKm) || 50, 1), 500);

  const ctx = await getViewerContext(userId);
  const visibility = buildVisibilityFilter(userId, ctx);

  const rows = await Ripple.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distMeters',
        maxDistance: radiusKm * 1000,
        spherical: true,
        query: {
          $and: [visibility, { lifecycle: { $in: DISCOVERABLE_LIFECYCLES } }],
        },
      },
    },
    { $limit: 100 },
  ]);

  res.status(200).json({
    success: true,
    ripples: rows.map((r) => {
      const distanceKm = Math.round((r.distMeters / 1000) * 10) / 10;
      return toRippleSummary(r, { viewerUserId: userId, distanceKm });
    }),
  });
});

const FEED_SECTIONS = ['forYou', 'live', 'trending', 'invited', 'yours', 'memories'];

// @route GET /api/open-network/feed?section&cursor&limit
const getFeed = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const section = req.query.section || 'forYou';
  if (!FEED_SECTIONS.includes(section)) {
    const err = new BadRequestError(
      `section must be one of: ${FEED_SECTIONS.join(', ')}`,
    );
    err.code = 'BAD_SECTION';
    throw err;
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

  const ctx = await getViewerContext(userId);
  const visibility = buildVisibilityFilter(userId, ctx);

  const clauses = [];
  // sortField doubles as the cursor field (ISO date).
  let sortField = 'createdAt';
  let sortDir = -1;

  switch (section) {
    case 'live':
      clauses.push(visibility, { lifecycle: { $in: ['active', 'wrapping'] } });
      break;
    case 'trending':
      clauses.push(visibility, {
        lifecycle: { $in: DISCOVERABLE_LIFECYCLES },
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      });
      break;
    case 'memories':
      clauses.push(visibility, { lifecycle: 'memory' });
      break;
    case 'yours':
      clauses.push({ hostUserId: userId });
      break;
    case 'invited': {
      const rows = await Rippler.find({ userId, status: 'requested' })
        .select('rippleId')
        .lean();
      clauses.push({ _id: { $in: rows.map((r) => r.rippleId) } });
      break;
    }
    case 'forYou':
    default:
      clauses.push(visibility, { lifecycle: { $in: ['active', 'scheduled'] } });
      sortField = 'startAt';
      sortDir = 1;
      break;
  }

  // Cursor = ISO value of the sort field of the last item on the previous page.
  if (req.query.cursor) {
    const cursorDate = new Date(req.query.cursor);
    if (Number.isNaN(cursorDate.getTime())) {
      const err = new BadRequestError('cursor must be an ISO date');
      err.code = 'BAD_CURSOR';
      throw err;
    }
    clauses.push({ [sortField]: sortDir === 1 ? { $gt: cursorDate } : { $lt: cursorDate } });
  }

  const docs = await Ripple.find({ $and: clauses })
    .sort({ [sortField]: sortDir, _id: sortDir })
    .limit(limit + 1)
    .lean();

  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last && last[sortField] ? new Date(last[sortField]).toISOString() : null;

  res.status(200).json({
    success: true,
    section,
    ripples: page.map((r) => toRippleSummary(r, { viewerUserId: userId })),
    nextCursor,
  });
});

module.exports = {
  getMe,
  joinOpenNetwork,
  leaveOpenNetwork,
  updateSettings,
  getViewport,
  getNearby,
  getFeed,
};
