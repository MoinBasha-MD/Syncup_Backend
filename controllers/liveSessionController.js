const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const mongoose = require('mongoose');
const LiveSession = require('../models/LiveSession');
const { BadRequestError, ForbiddenError, NotFoundError } = require('../utils/errorClasses');
const { getViewerContext } = require('../services/openNetworkVisibility');
const liveKitService = require('../services/liveKitService');

const toIso = (d) => (d ? new Date(d).toISOString() : null);

const toLiveSummary = (session) => ({
  id: String(session._id),
  hostUserId: session.hostUserId,
  hostName: session.hostName,
  hostAvatar: session.hostAvatar || null,
  title: session.title || '',
  thumbnailUrl: session.thumbnailUrl || null,
  visibility: session.visibility,
  status: session.status,
  startedAt: toIso(session.startedAt),
  endedAt: toIso(session.endedAt),
  viewerCount: session.viewerCount || 0,
});

const MAX_LIVE_TITLE = 120;

// @route POST /api/open-network/live — start broadcasting
const startLive = asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  if (!liveKitService.isConfigured()) {
    const err = new BadRequestError('Live broadcasts are not set up yet on this server');
    err.code = 'LIVE_NOT_CONFIGURED';
    throw err;
  }

  // One broadcast at a time per host — starting a new one implicitly closes
  // any stale session (e.g. the app was killed mid-broadcast).
  const stale = await LiveSession.findOne({ hostUserId: userId, status: 'live' });
  if (stale) {
    stale.status = 'ended';
    stale.endedAt = new Date();
    await stale.save();
    await liveKitService.deleteRoom(stale.roomName);
  }

  const visibility = req.body?.visibility === 'friends' ? 'friends' : 'public';
  const title = String(req.body?.title || '').slice(0, MAX_LIVE_TITLE);
  const roomName = `live-${userId}-${crypto.randomBytes(4).toString('hex')}`;

  const session = await LiveSession.create({
    hostUserId: userId,
    hostName: req.user.name || 'Someone',
    hostAvatar: req.user.profileImage || null,
    title,
    roomName,
    visibility,
  });

  const token = await liveKitService.createToken({
    identity: userId,
    name: req.user.name || 'Host',
    room: roomName,
    canPublish: true,
  });

  res.status(201).json({
    success: true,
    session: toLiveSummary(session),
    livekit: { url: process.env.LIVEKIT_URL, token, room: roomName },
  });
});

// @route GET /api/open-network/live — sessions this viewer may see, live now
const listLive = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const ctx = await getViewerContext(userId);

  const match = {
    status: 'live',
    hostUserId: { $nin: [...ctx.blockedIds] },
    $or: [
      { visibility: 'public' },
      { visibility: 'friends', hostUserId: { $in: [...ctx.friendIds] } },
      { hostUserId: userId },
    ],
  };

  const sessions = await LiveSession.find(match)
    .sort({ viewerCount: -1, startedAt: -1 })
    .limit(50)
    .lean();

  res.status(200).json({ success: true, sessions: sessions.map(toLiveSummary) });
});

const loadActive = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const err = new NotFoundError('Live session not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const session = await LiveSession.findById(id);
  if (!session || session.status !== 'live') {
    const err = new NotFoundError('Live session not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return session;
};

// @route POST /api/open-network/live/:id/join — viewer token (subscribe-only)
const joinLive = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const session = await loadActive(req.params.id);

  if (session.visibility === 'friends' && session.hostUserId !== userId) {
    const ctx = await getViewerContext(userId);
    if (!ctx.friendIds.has(session.hostUserId)) {
      const err = new ForbiddenError('This live broadcast is friends-only');
      err.code = 'FORBIDDEN';
      throw err;
    }
  }

  const token = await liveKitService.createToken({
    identity: userId,
    name: req.user.name || 'Viewer',
    room: session.roomName,
    canPublish: false,
  });

  if (session.hostUserId !== userId) {
    session.viewerCount += 1;
    session.peakViewerCount = Math.max(session.peakViewerCount, session.viewerCount);
    await session.save();
  }

  res.status(200).json({
    success: true,
    session: toLiveSummary(session),
    livekit: { url: process.env.LIVEKIT_URL, token, room: session.roomName },
  });
});

// @route POST /api/open-network/live/:id/leave — viewer left the room
const leaveLive = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(200).json({ success: true }); // already gone — no-op
  }
  const session = await LiveSession.findById(req.params.id);
  if (session && session.status === 'live' && session.hostUserId !== userId && session.viewerCount > 0) {
    session.viewerCount -= 1;
    await session.save();
  }
  res.status(200).json({ success: true });
});

// @route POST /api/open-network/live/:id/end — host ends the broadcast
const endLive = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const session = await loadActive(req.params.id);
  if (session.hostUserId !== userId) {
    const err = new ForbiddenError('Only the host can end this broadcast');
    err.code = 'FORBIDDEN';
    throw err;
  }
  session.status = 'ended';
  session.endedAt = new Date();
  await session.save();
  await liveKitService.deleteRoom(session.roomName);
  res.status(200).json({ success: true, session: toLiveSummary(session) });
});

module.exports = { startLive, listLive, joinLive, leaveLive, endLive };
