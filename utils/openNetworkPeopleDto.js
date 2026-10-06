/**
 * People-layer DTO mappers — pure functions, no DB access (unit-testable).
 *
 * PRIVACY: nothing in this module ever emits coordinates — PersonSummary
 * carries a coarse `distanceLabel` string and city names only. home.point is
 * for matching, never for output.
 */
const { distanceLabel } = require('../services/openNetworkGeo');

/** Sorted pair key — one connection/chat row per unordered user pair. */
const pairKey = (a, b) => [String(a), String(b)].sort().join('|');

const DAY_MS = 24 * 60 * 60 * 1000;

/** 'Active today' (<24h), 'Active this week' (<7d), else hidden. */
const activeLabel = (lastActiveAt, now = Date.now()) => {
  if (!lastActiveAt) return null;
  const age = now - new Date(lastActiveAt).getTime();
  if (!Number.isFinite(age) || age < 0) return null;
  if (age < DAY_MS) return 'Active today';
  if (age < 7 * DAY_MS) return 'Active this week';
  return null;
};

/** Compact identity card embedded in connection rows and chat summaries. */
const toPersonMini = (profile, user) => ({
  userId: profile.userId,
  name: user?.name || 'Someone',
  avatar: user?.profileImage || null,
  headline: profile.persona?.headline || '',
  city: profile.home?.city || '',
});

/**
 * The "People nearby" row.
 * @param {object} profile  OpenNetworkProfile (lean)
 * @param {object} [user]   User row for name/avatar (lean)
 * @param {object} [extras]
 * @param {string[]} [extras.viewerInterests]
 * @param {number|null} [extras.distanceKm]
 * @param {'none'|'outgoing'|'incoming'|'connected'} [extras.connection]
 * @param {string|null} [extras.connectionId]
 * @param {boolean} [extras.isFriend]
 * @param {number} [extras.activeRippleCount]
 */
const toPersonSummary = (profile, user, extras = {}) => {
  const interests = Array.isArray(profile.persona?.interests)
    ? profile.persona.interests
    : [];
  const mine = Array.isArray(extras.viewerInterests) ? extras.viewerInterests : [];
  const mySet = new Set(mine);
  return {
    userId: profile.userId,
    name: user?.name || 'Someone',
    avatar: user?.profileImage || null,
    headline: profile.persona?.headline || '',
    interests,
    openTo: Array.isArray(profile.persona?.openTo) ? profile.persona.openTo : [],
    city: profile.home?.city || '',
    country: profile.home?.country || '',
    distanceLabel:
      extras.distanceKm != null ? distanceLabel(extras.distanceKm) : null,
    sharedInterests: interests.filter((i) => mySet.has(i)),
    connection: extras.connection || 'none',
    connectionId: extras.connectionId || null,
    isFriend: !!extras.isFriend,
    activeRippleCount: extras.activeRippleCount ?? 0,
    activeLabel: activeLabel(profile.lastActiveAt),
  };
};

const toConnectionDto = (conn, otherPerson, contextRippleTitle = null) => ({
  id: String(conn._id),
  status: conn.status,
  person: otherPerson,
  note: conn.note || '',
  contextRippleTitle,
  createdAt: conn.createdAt ? new Date(conn.createdAt).toISOString() : null,
  acceptedAt: conn.acceptedAt ? new Date(conn.acceptedAt).toISOString() : null,
});

const toMessageDto = (m) => ({
  id: String(m._id),
  chatId: String(m.chatId),
  senderId: m.senderId,
  type: m.type,
  body: m.body || '',
  imageUrl: m.imageUrl || null,
  rippleId: m.rippleId ? String(m.rippleId) : null,
  rippleSnapshot: m.rippleSnapshot?.title ? m.rippleSnapshot : null,
  clientId: m.clientId || null,
  deleted: !!m.deleted,
  e2ee: m.e2ee?.v === 2 ? { v: 2, envelope: m.e2ee.envelope } : null,
  createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : null,
});

const toChatSummary = (chat, other, extras = {}) => ({
  chatId: String(chat._id),
  other,
  lastMessage: chat.lastMessage?.at
    ? {
        body: chat.lastMessage.body || '',
        type: chat.lastMessage.type || null,
        senderId: chat.lastMessage.senderId || null,
        at: chat.lastMessage.at ? new Date(chat.lastMessage.at).toISOString() : null,
        lastE2ee: chat.lastMessage.lastE2ee?.v === 2
          ? { v: 2, envelope: chat.lastMessage.lastE2ee.envelope }
          : null,
      }
    : null,
  unread: Number(chat.unread?.get?.(extras.userId) ?? chat.unread?.[extras.userId] ?? 0),
  muted: Array.isArray(chat.mutedBy) && chat.mutedBy.includes(extras.userId),
  connected: !!extras.connected,
  updatedAt: chat.updatedAt ? new Date(chat.updatedAt).toISOString() : null,
});

module.exports = {
  pairKey,
  activeLabel,
  toPersonMini,
  toPersonSummary,
  toConnectionDto,
  toMessageDto,
  toChatSummary,
};
