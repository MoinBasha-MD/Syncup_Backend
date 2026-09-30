/**
 * Shared Open Network notification fan-out — socket broadcast for live
 * surfaces, a persisted Notification record for the feed, and an FCM push
 * for offline devices. Every channel is best-effort: a failed push must
 * never fail the request that produced it.
 */
const { dispatchNotification, openNetworkEnvelopeSpec } = require('./notificationDispatcher');
// Lazy require to break any circular dependency with socketManager.
const getSocketManager = () => require('../socketManager');

/**
 * FCM data payloads are string-only — the service String()s each value, so a
 * nested object would arrive on the device as "[object Object]". Flatten it
 * here instead: drop null/undefined, JSON-stringify objects/arrays, and
 * String() everything else.
 */
const toPushData = (payload) => {
  const out = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (value === null || value === undefined) continue;
    out[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return out;
};

/**
 * @param {object} args
 * @param {string} args.toUserId     recipient userId
 * @param {string} args.fromUserId   actor userId
 * @param {string} args.type         Notification.type + data.type
 * @param {string|null} args.socketEvent  socket event name broadcast to the
 *   recipient — falsy skips the socket channel (e.g. when the caller already
 *   broadcast the richer payload itself)
 * @param {string} args.title        push title
 * @param {string} args.message      notification body (persisted + push body)
 * @param {object} [args.data]       extra payload (socket data + Notification.data)
 * @param {boolean} [args.persist]   default true — chat messages skip the record
 * @param {boolean} [args.push]      default true — quiet paths (e.g. removal) skip FCM
 * @param {string}  [args.avatar]    actor avatar URL for the v2 envelope/banner
 * @param {string}  [args.image]     big-picture thumbnail for the v2 envelope
 */
const notifyUser = async ({
  toUserId,
  fromUserId,
  type,
  socketEvent,
  title,
  message,
  data = {},
  persist = true,
  push = true,
  avatar,
  image,
}) => {
  const payload = {
    type,
    fromUserId,
    ...data,
    timestamp: new Date().toISOString(),
  };
  // Legacy per-feature socket event — screens subscribe to these directly.
  if (socketEvent) {
    try {
      getSocketManager().broadcastToUser(toUserId, socketEvent, {
        type,
        title,
        body: message,
        data: payload,
      });
    } catch (e) {
      console.error(`❌ [ON NOTIFY] socket ${type} → ${toUserId}:`, e.message);
    }
  }
  // v2 envelope: notification:push socket + Notification row + FCM.
  const spec = openNetworkEnvelopeSpec({ type, fromUserId, data });
  await dispatchNotification({
    toUserId,
    fromUserId,
    type,
    category: spec.category,
    title,
    body: message,
    avatar,
    image,
    groupKey: spec.groupKey,
    action: spec.action,
    cta: spec.cta,
    persist,
    push,
    data: payload,
  });
};

/**
 * "New Ripple near you" — fire-and-forget fan-out after a Ripple publishes.
 * Only public/listed non-online Ripples ping nearby members; recipients are
 * throttled to one push per 6h and must not be in a block relationship with
 * the host (either direction). Never throws — wraps everything so a lookup
 * failure can't fail the create/publish request that triggered it.
 */
const NEARBY_THROTTLE_MS = 6 * 60 * 60 * 1000;
const NEARBY_MAX_RADIUS_KM = 50;
const NEARBY_DEFAULT_RADIUS_KM = 25;
const NEARBY_LIMIT = 200;
const EARTH_RADIUS_KM = 6378.1;

const notifyRippleNearby = (ripple) => {
  setImmediate(async () => {
    try {
      if (
        ripple.visibility !== 'public' ||
        ripple.discoverability !== 'listed' ||
        ripple.reach === 'online'
      ) {
        return;
      }
      const coords = ripple.location?.coordinates;
      if (!Array.isArray(coords) || coords.length !== 2) return;
      const radiusKm = Math.min(ripple.reachKm || NEARBY_DEFAULT_RADIUS_KM, NEARBY_MAX_RADIUS_KM);

      const OpenNetworkProfile = require('../models/OpenNetworkProfile');
      const Block = require('../models/blockModel');

      const profiles = await OpenNetworkProfile.find({
        joined: true,
        'settings.notifyNearby': true,
        userId: { $ne: ripple.hostUserId },
        'home.point': {
          $geoWithin: {
            $centerSphere: [[coords[0], coords[1]], radiusKm / EARTH_RADIUS_KM],
          },
        },
        $or: [
          { lastNearbyNotifiedAt: null },
          { lastNearbyNotifiedAt: { $lt: new Date(Date.now() - NEARBY_THROTTLE_MS) } },
        ],
      })
        .select('userId')
        .limit(NEARBY_LIMIT)
        .lean();
      if (!profiles.length) return;

      const ids = profiles.map((p) => p.userId);
      const blocks = await Block.find({
        $or: [
          { blockerId: ripple.hostUserId, blockedUserId: { $in: ids } },
          { blockerId: { $in: ids }, blockedUserId: ripple.hostUserId },
        ],
      })
        .select('blockerId blockedUserId')
        .lean();
      const blockedWithHost = new Set(
        blocks.flatMap((b) => [b.blockerId, b.blockedUserId]),
      );
      blockedWithHost.delete(ripple.hostUserId);
      const targets = ids.filter((id) => !blockedWithHost.has(id));
      if (!targets.length) return;

      // Stamp first so a fan-out failure doesn't re-notify on the next Ripple.
      await OpenNetworkProfile.updateMany(
        { userId: { $in: targets } },
        { $set: { lastNearbyNotifiedAt: new Date() } },
      );
      await Promise.allSettled(
        targets.map((toUserId) =>
          notifyUser({
            toUserId,
            fromUserId: ripple.hostUserId,
            type: 'ripple_nearby',
            socketEvent: 'open-network:nearby',
            title: 'New Ripple near you',
            message: ripple.title,
            data: { rippleId: String(ripple._id) },
          }),
        ),
      );
    } catch (e) {
      console.error('❌ [ON NEARBY] fan-out failed:', e.message);
    }
  });
};

const LIVE_STARTED_THROTTLE_MS = 10 * 60 * 1000;
const LIVE_STARTED_LIMIT = 500;

/**
 * "<host> is live" — fire-and-forget fan-out to the host's Syncup friends
 * (minus blocks) when a broadcast starts. Throttled to one fan-out per host
 * per 10 minutes so a quick restart doesn't re-ping everyone. Never throws —
 * a lookup failure must not fail the startLive request that triggered it.
 */
const notifyLiveStarted = (session) => {
  setImmediate(async () => {
    try {
      if (!session?._id || !session.hostUserId) return;
      // Lazy requires — same circular-dep pattern as getSocketManager.
      const { getViewerContext } = require('./openNetworkVisibility');
      const LiveSession = require('../models/LiveSession');

      const startedAt = session.startedAt ? new Date(session.startedAt) : new Date();
      const recent = await LiveSession.countDocuments({
        hostUserId: session.hostUserId,
        _id: { $ne: session._id },
        startedAt: { $gte: new Date(startedAt.getTime() - LIVE_STARTED_THROTTLE_MS) },
      });
      if (recent > 0) return;

      const ctx = await getViewerContext(session.hostUserId);
      const targets = [...ctx.friendIds]
        .filter((id) => !ctx.blockedIds.has(id))
        .slice(0, LIVE_STARTED_LIMIT);
      if (!targets.length) return;

      const hostName = session.hostName || 'Someone';
      await Promise.allSettled(
        targets.map((toUserId) =>
          notifyUser({
            toUserId,
            fromUserId: session.hostUserId,
            type: 'live_started',
            socketEvent: 'open-network:live',
            title: `${hostName} is live`,
            message: session.title || 'Tap to watch now',
            avatar: session.hostAvatar || undefined,
            data: {
              sessionId: String(session._id),
              hostName,
              hostUserId: session.hostUserId,
              actorName: hostName,
            },
          }),
        ),
      );
    } catch (e) {
      console.error('❌ [ON LIVE] fan-out failed:', e.message);
    }
  });
};

module.exports = { notifyUser, notifyRippleNearby, notifyLiveStarted, toPushData };
