/**
 * Ripple summary DTO mapper — the exact shape the RN screen renders.
 * Shared by every list/detail read path so the client never rewrites.
 */
const { projectState } = require('../services/openNetworkGeo');

const toIso = (d) => (d ? new Date(d).toISOString() : null);

/**
 * @param {object} ripple  Mongoose doc or lean object
 * @param {object} [opts]
 * @param {Set<string>} [opts.friendIds]   viewer's confirmed friends (for future friendsCount)
 * @param {number|null} [opts.distanceKm]  precomputed distance (nearby endpoint)
 * @param {number|null} [opts.friendsCount]
 * @param {string|null} [opts.reason]
 * @param {string} [opts.viewerUserId]     for the 'Yours' badge
 * @param {string|null} [opts.ownerAvatar] host's profile image URL
 * @param {boolean} [opts.supportedByMe]   viewer already supports this
 */
const toRippleSummary = (ripple, opts = {}) => {
  const {
    distanceKm = null,
    friendsCount = null,
    reason = null,
    viewerUserId = null,
    ownerAvatar = null,
    supportedByMe = false,
  } = opts;

  const state = projectState(ripple);
  const isFull =
    ripple.capacity != null && (ripple.counts?.ripplers ?? 0) >= ripple.capacity;

  const badges = [];
  if (state === 'live') badges.push('Live');
  if (distanceKm != null && distanceKm <= 50) badges.push('Nearby');
  if (viewerUserId && ripple.hostUserId === viewerUserId) badges.push('Yours');

  return {
    id: String(ripple._id),
    title: ripple.title,
    type: ripple.type,
    kind: ripple.kind || 'ripple',
    state,
    lifecycle: ripple.lifecycle,
    ownerId: ripple.hostIsPage ? String(ripple.hostPageId) : ripple.hostUserId,
    ownerName: ripple.hostName,
    ownerIsPage: !!ripple.hostIsPage,
    ownerAvatar,
    placeLabel: ripple.reach === 'online' ? 'Online' : ripple.place?.label || '',
    distanceKm,
    startAt: toIso(ripple.startAt),
    expiresAt: toIso(ripple.expiresAt),
    timezone: ripple.timezone || null,
    // Denormalized counter = approved Ripplers (maintained on approval).
    participantCount: ripple.counts?.ripplers ?? 0,
    contributionCount: ripple.counts?.events ?? 0,
    /** The Short's like counter (0 on regular Ripples). */
    supportCount: ripple.counts?.supports ?? 0,
    supportedByMe,
    capacity: ripple.capacity ?? null,
    isFull,
    friendsCount,
    reason,
    coordinates:
      ripple.lat != null && ripple.lng != null
        ? { lat: ripple.lat, lng: ripple.lng }
        : null,
    /**
     * First attached photo/video, for the card thumbnail. Deliberately a single
     * URL rather than the whole array: summaries ride in every viewport/feed
     * response, and the full media list only matters on the detail screen.
     */
    coverMediaUrl: ripple.media?.length ? ripple.media[0].url : null,
    coverMediaType: ripple.media?.length ? ripple.media[0].type || 'image' : null,
    coverThumbnailUrl: ripple.media?.length ? ripple.media[0].thumbnailUrl ?? null : null,
    mediaCount: ripple.media?.length ?? 0,
    badges,
  };
};

module.exports = { toRippleSummary };
