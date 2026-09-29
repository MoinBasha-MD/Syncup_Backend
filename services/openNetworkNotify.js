/**
 * Shared Open Network notification fan-out — socket broadcast for live
 * surfaces, a persisted Notification record for the feed, and an FCM push
 * for offline devices. Every channel is best-effort: a failed push must
 * never fail the request that produced it.
 */
const Notification = require('../models/Notification');
const fcmNotificationService = require('./fcmNotificationService');
// Lazy require to break any circular dependency with socketManager.
const getSocketManager = () => require('../socketManager');

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
}) => {
  const payload = {
    type,
    fromUserId,
    ...data,
    timestamp: new Date().toISOString(),
  };
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
  if (persist) {
    try {
      await Notification.create({
        userId: toUserId,
        type,
        fromUserId,
        message,
        data: payload,
      });
    } catch (e) {
      console.error(`❌ [ON NOTIFY] persist ${type} → ${toUserId}:`, e.message);
    }
  }
  if (push) {
    try {
      if (fcmNotificationService.isEnabled && fcmNotificationService.isEnabled()) {
        // NOTE: the service exposes sendVisibleNotification(userId, notification)
        // — there is no sendToUserDevices. A wrong method name here would be
        // swallowed by optional chaining and silently send no push at all.
        await fcmNotificationService.sendVisibleNotification(toUserId, {
          title,
          body: message,
          data: payload,
        });
      }
    } catch (e) {
      console.error(`❌ [ON NOTIFY] fcm ${type} → ${toUserId}:`, e.message);
    }
  }
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

module.exports = { notifyUser, notifyRippleNearby };
