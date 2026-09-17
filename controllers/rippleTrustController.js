const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Ripple = require('../models/Ripple');
const Rippler = require('../models/Rippler');
const RippleRating = require('../models/RippleRating');
const RippleReport = require('../models/RippleReport');
const OpenNetworkProfile = require('../models/OpenNetworkProfile');
const {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} = require('../utils/errorClasses');

const MANAGER_ROLES = ['host', 'cohost'];
const RATEABLE_LIFECYCLES = ['wrapping', 'memory'];
const RATING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RATING_TAGS = [
  'as_described',
  'well_organised',
  'friendly',
  'safe',
  'good_value',
  'would_join_again',
];

// Public numeric scores need this many samples before they mean anything.
const MIN_RATINGS_FOR_SCORE = 3;
// Bayesian prior: stops one bad review destroying a new host. Smoothed score
// = (sum + PRIOR_WEIGHT*PRIOR_MEAN) / (count + PRIOR_WEIGHT).
const PRIOR_MEAN = 4.0;
const PRIOR_WEIGHT = 5;

const err = (ErrorClass, message, code, statusCode) => {
  const e = new ErrorClass(message);
  e.code = code;
  if (statusCode) e.statusCode = statusCode;
  return e;
};

const smoothed = (sum, count) =>
  count === 0 ? null : (sum + PRIOR_WEIGHT * PRIOR_MEAN) / (count + PRIOR_WEIGHT);

/** Reliability is shown as a band, never a number — a public score on an
 *  ordinary person is a harassment vector. */
const reliabilityBand = (attended, noShow) => {
  const total = attended + noShow;
  if (total < 3) return 'new';
  const ratio = attended / total;
  if (ratio >= 0.8) return 'reliable';
  if (ratio >= 0.5) return 'mixed';
  return 'low';
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

/* --------------------------------- Ratings -------------------------------- */

// @route POST /api/ripples/:id/rating
const rateRipple = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const ripple = await loadRipple(req);

  if (ripple.hostUserId === userId) {
    throw err(ForbiddenError, 'A host cannot rate their own Ripple', 'HOST_CANNOT_RATE');
  }
  const member = await Rippler.findOne({ rippleId: ripple._id, userId }).lean();
  if (!member || member.status !== 'approved' || member.role === 'follower') {
    throw err(ForbiddenError, 'Only Ripplers can rate this Ripple', 'NOT_A_RIPPLER');
  }
  if (!RATEABLE_LIFECYCLES.includes(ripple.lifecycle)) {
    throw err(BadRequestError, 'You can rate a Ripple once it has ended', 'RIPPLE_NOT_ENDED');
  }

  // Window is anchored to wrapUntil when present, else to the last update.
  const anchor = ripple.wrapUntil ? new Date(ripple.wrapUntil).getTime() : new Date(ripple.updatedAt).getTime();
  if (Date.now() - anchor > RATING_WINDOW_MS) {
    throw err(BadRequestError, 'The rating window for this Ripple has closed', 'RATING_WINDOW_CLOSED');
  }

  const existing = await RippleRating.findOne({ rippleId: ripple._id, raterId: userId }).lean();
  if (existing) {
    // Immutable — return the caller's own rating rather than erroring, so a
    // retried request is harmless.
    return res.status(200).json({
      success: true,
      idempotent: true,
      myRating: { score: existing.score, tags: existing.tags, comment: existing.comment },
    });
  }

  const score = Number(req.body.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw err(BadRequestError, 'score must be an integer from 1 to 5', 'VALIDATION');
  }
  const tags = Array.isArray(req.body.tags)
    ? req.body.tags.filter((t) => RATING_TAGS.includes(t))
    : [];
  const comment = String(req.body.comment || '').slice(0, 500);

  await RippleRating.create({
    rippleId: ripple._id,
    raterId: userId,
    hostUserId: ripple.hostUserId,
    score,
    tags,
    comment,
  });

  // Recompute both aggregates from source so they can't drift.
  const [agg] = await RippleRating.aggregate([
    { $match: { rippleId: ripple._id } },
    { $group: { _id: null, sum: { $sum: '$score' }, count: { $sum: 1 } } },
  ]);
  const sum = agg?.sum || 0;
  const count = agg?.count || 0;
  await Ripple.updateOne(
    { _id: ripple._id },
    {
      $set: {
        'rating.sum': sum,
        'rating.count': count,
        'rating.average': count ? Number((sum / count).toFixed(2)) : null,
      },
    },
  );

  const [hostAgg] = await RippleRating.aggregate([
    { $match: { hostUserId: ripple.hostUserId } },
    { $group: { _id: null, sum: { $sum: '$score' }, count: { $sum: 1 } } },
  ]);
  const hSum = hostAgg?.sum || 0;
  const hCount = hostAgg?.count || 0;
  await OpenNetworkProfile.updateOne(
    { userId: ripple.hostUserId },
    {
      $set: {
        'reputation.hostSum': hSum,
        'reputation.hostCount': hCount,
        // Suppressed below the minimum sample — null means "no score yet".
        'reputation.hostScore':
          hCount >= MIN_RATINGS_FOR_SCORE ? Number(smoothed(hSum, hCount).toFixed(2)) : null,
      },
    },
    { upsert: true },
  );

  res.status(201).json({ success: true, score });
});

// @route GET /api/ripples/:id/rating — aggregate only, never individual rows
const getRippleRating = asyncHandler(async (req, res) => {
  const ripple = await loadRipple(req);
  const count = ripple.rating?.count || 0;
  res.status(200).json({
    success: true,
    // Below the minimum sample we deliberately report no number.
    average: count >= MIN_RATINGS_FOR_SCORE ? ripple.rating?.average ?? null : null,
    count,
    minimumForScore: MIN_RATINGS_FOR_SCORE,
  });
});

// @route GET /api/ripples/:id/rating/me
const getMyRating = asyncHandler(async (req, res) => {
  const ripple = await loadRipple(req);
  const mine = await RippleRating.findOne({
    rippleId: ripple._id,
    raterId: req.user.userId,
  }).lean();
  res.status(200).json({
    success: true,
    myRating: mine ? { score: mine.score, tags: mine.tags, comment: mine.comment } : null,
  });
});

/* -------------------------------- Attendance ------------------------------- */

// @route POST /api/ripples/:id/attendance — host/cohost marks who showed up
const markAttendance = asyncHandler(async (req, res) => {
  const actorId = req.user.userId;
  const ripple = await loadRipple(req);

  const actor = await Rippler.findOne({ rippleId: ripple._id, userId: actorId }).lean();
  if (!isManager(ripple, actor, actorId)) {
    throw err(ForbiddenError, 'Only the host or a cohost can mark attendance', 'FORBIDDEN');
  }
  if (!RATEABLE_LIFECYCLES.includes(ripple.lifecycle)) {
    throw err(BadRequestError, 'Attendance is marked after a Ripple ends', 'RIPPLE_NOT_ENDED');
  }

  const targetUserId = String(req.body.userId || '');
  if (!targetUserId) throw err(BadRequestError, 'userId is required', 'VALIDATION');
  if (typeof req.body.attended !== 'boolean') {
    throw err(BadRequestError, 'attended must be a boolean', 'VALIDATION');
  }
  if (targetUserId === ripple.hostUserId) {
    throw err(BadRequestError, 'The host is not marked for attendance', 'VALIDATION');
  }

  const target = await Rippler.findOne({
    rippleId: ripple._id,
    userId: targetUserId,
    status: 'approved',
  });
  if (!target || target.role === 'follower') {
    throw err(NotFoundError, 'No such Rippler', 'NOT_A_MEMBER');
  }

  // Only a first-time marking moves the counters — re-marking must not
  // double-count, which is the classic way these stats get corrupted.
  const had = target.attended;
  target.attended = req.body.attended;
  await target.save();

  if (had === null || had === undefined) {
    await OpenNetworkProfile.updateOne(
      { userId: targetUserId },
      {
        $inc: req.body.attended
          ? { 'reputation.attendedCount': 1 }
          : { 'reputation.noShowCount': 1 },
      },
      { upsert: true },
    );
  } else if (had !== req.body.attended) {
    // A correction swaps the two counters.
    await OpenNetworkProfile.updateOne(
      { userId: targetUserId },
      req.body.attended
        ? { $inc: { 'reputation.attendedCount': 1, 'reputation.noShowCount': -1 } }
        : { $inc: { 'reputation.attendedCount': -1, 'reputation.noShowCount': 1 } },
    );
  }

  res.status(200).json({ success: true });
});

/* -------------------------------- Reputation ------------------------------- */

// @route GET /api/open-network/users/:userId/reputation
const getReputation = asyncHandler(async (req, res) => {
  const targetUserId = req.params.userId;
  const viewerId = req.user.userId;
  const profile = await OpenNetworkProfile.findOne({ userId: targetUserId }).lean();

  const hostCount = profile?.reputation?.hostCount || 0;
  const attended = profile?.reputation?.attendedCount || 0;
  const noShow = profile?.reputation?.noShowCount || 0;

  const isSelf = viewerId === targetUserId;
  // Reliability is private to the person and to hosts deciding whether to
  // approve them — never part of a public profile.
  const viewerIsHostOfSomething = await Ripple.exists({
    hostUserId: viewerId,
    lifecycle: { $in: ['active', 'scheduled', 'wrapping', 'memory'] },
  });

  res.status(200).json({
    success: true,
    reputation: {
      hostScore: hostCount >= MIN_RATINGS_FOR_SCORE ? profile.reputation.hostScore : null,
      hostCount,
      minimumForScore: MIN_RATINGS_FOR_SCORE,
      reliability:
        isSelf || viewerIsHostOfSomething ? reliabilityBand(attended, noShow) : null,
    },
  });
});

/* --------------------------------- Reports -------------------------------- */

// @route POST /api/ripples/:id/report
const reportRipple = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const ripple = await loadRipple(req);

  const reason = String(req.body.reason || '');
  const allowed = ['spam', 'harassment', 'safety', 'misleading', 'inappropriate', 'no_show', 'other'];
  if (!allowed.includes(reason)) {
    throw err(BadRequestError, `reason must be one of: ${allowed.join(', ')}`, 'VALIDATION');
  }
  if (ripple.hostUserId === userId) {
    throw err(BadRequestError, 'You cannot report your own Ripple', 'VALIDATION');
  }

  const eventId =
    req.body.eventId && mongoose.Types.ObjectId.isValid(req.body.eventId)
      ? req.body.eventId
      : null;

  const existing = await RippleReport.findOne({ rippleId: ripple._id, reporterId: userId }).lean();
  if (existing) {
    return res.status(200).json({ success: true, idempotent: true });
  }

  await RippleReport.create({
    rippleId: ripple._id,
    eventId,
    reporterId: userId,
    reportedUserId: ripple.hostUserId,
    reason,
    details: String(req.body.details || '').slice(0, 1000),
  });
  await Ripple.updateOne({ _id: ripple._id }, { $inc: { 'moderation.reportCount': 1 } });

  // Reporting is deliberately quiet — the reported party learns nothing.
  res.status(201).json({ success: true });
});

module.exports = {
  rateRipple,
  getRippleRating,
  getMyRating,
  markAttendance,
  getReputation,
  reportRipple,
  reliabilityBand,
  MIN_RATINGS_FOR_SCORE,
};
