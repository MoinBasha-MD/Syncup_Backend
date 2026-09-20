/**
 * LiveKit integration — token issuance for Open Network's Live broadcasts.
 *
 * The actual SFU (media routing) is a self-hosted LiveKit server; this
 * service only mints signed JWTs the RN client uses to connect to it, and
 * exposes a couple of admin-API helpers (kicking everyone out of a room when
 * a host ends the broadcast, so viewers get disconnected immediately rather
 * than waiting for LiveKit's own empty-room timeout).
 *
 * Required env vars — see docs/LIVEKIT_SETUP.md for how to stand the server
 * up (self-hosted, Docker):
 *   LIVEKIT_URL          wss://live.yourdomain.com  (what clients connect to)
 *   LIVEKIT_API_KEY
 *   LIVEKIT_API_SECRET
 */
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const { TrackSource } = require('@livekit/protocol');

const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;

const isConfigured = () => !!(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);

/** HTTP(S) form of LIVEKIT_URL — the admin/room-service API needs http(s), not ws(s). */
const httpUrl = () => (LIVEKIT_URL || '').replace(/^ws/, 'http');

let roomServiceClient = null;
const getRoomService = () => {
  if (!isConfigured()) return null;
  if (!roomServiceClient) {
    roomServiceClient = new RoomServiceClient(httpUrl(), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  }
  return roomServiceClient;
};

/**
 * @param {object} opts
 * @param {string} opts.identity  Opaque participant id (userId) — never a real name/email.
 * @param {string} opts.name      Display name shown to other participants.
 * @param {string} opts.room      LiveKit room name (LiveSession.roomName).
 * @param {boolean} opts.canPublish  true for the host, false for viewers.
 */
const createToken = async ({ identity, name, room, canPublish }) => {
  if (!isConfigured()) {
    const err = new Error('Live broadcasts are not configured on this server');
    err.code = 'LIVE_NOT_CONFIGURED';
    throw err;
  }
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name,
    ttl: '4h',
  });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: !!canPublish,
    canPublishData: true,
    // Viewers can always subscribe; a host publishing camera/mic doesn't need
    // to subscribe to itself but there's no harm allowing it (e.g. so a host
    // can see chat/data from viewers).
    canSubscribe: true,
    // livekit-server-sdk >=2.19 wants the proto enum values here, not the
    // string names — passing 'camera' throws "Cannot convert TrackSource".
    canPublishSources: canPublish
      ? [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE]
      : undefined,
  });
  return at.toJwt();
};

/** Force-disconnects every participant — used when a host ends a broadcast. */
const deleteRoom = async (room) => {
  const svc = getRoomService();
  if (!svc) return; // not configured — nothing to clean up server-side
  try {
    await svc.deleteRoom(room);
  } catch (e) {
    // Room may already be gone (LiveKit auto-closes empty rooms) — not fatal.
    console.warn('⚠️ [LiveKit] deleteRoom failed:', e.message);
  }
};

module.exports = { isConfigured, createToken, deleteRoom };
