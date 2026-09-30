/**
 * Server-driven notification dispatcher — the backend sends a
 * self-describing envelope and the app renders/routes it generically, so a
 * new notification kind needs backend changes only.
 *
 * Envelope (FCM data is string-only — flattened via toPushData, JSON fields
 * like `action` arrive stringified):
 *   { v:'2', id, type, category, title, body, avatar?, image?, groupKey?,
 *     action?: {screen,params?}|{kind:'live_join',sessionId}|{kind:'url',url},
 *     cta?, inApp?, ts }
 *
 * Channels (all best-effort — a failed push/socket never throws):
 *   1. socket  `notification:push` → foreground in-app banner
 *   2. persist Notification row (feeds the notifications list + pending sync)
 *   3. FCM     tray notification for background/quit devices
 */
const crypto = require('crypto');
const Notification = require('../models/Notification');
const fcmNotificationService = require('./fcmNotificationService');
// Lazy require to break any circular dependency with socketManager.
const getSocketManager = () => require('../socketManager');

/** Accent colour per category — Android tray tint, mirrored by the banner. */
const CATEGORY_COLORS = {
  message: '#06B6D4',
  social: '#8B5CF6',
  ripple: '#8B5CF6',
  live: '#EF4444',
  system: '#F59E0B',
};

/**
 * Build a v2 envelope. `action` stays an object here — it is JSON-stringified
 * only when the envelope is flattened for FCM (toPushData) or persisted.
 */
const buildEnvelope = ({
  type,
  category,
  title,
  body,
  avatar,
  image,
  groupKey,
  action,
  cta,
  inApp,
}) => ({
  v: '2',
  id: crypto.randomUUID(),
  type,
  category: CATEGORY_COLORS[category] ? category : 'system',
  title,
  body,
  ...(avatar ? { avatar } : {}),
  ...(image ? { image } : {}),
  ...(groupKey ? { groupKey } : {}),
  ...(action ? { action } : {}),
  ...(cta ? { cta } : {}),
  inApp: inApp === 'none' ? 'none' : 'banner',
  ts: new Date().toISOString(),
});

/**
 * Map an existing Open Network notifyUser type to envelope
 * category/action/groupKey/cta — the client routes taps straight off these.
 */
const openNetworkEnvelopeSpec = ({ type, fromUserId, data }) => {
  const d = data || {};
  switch (type) {
    case 'on_message':
      return {
        category: 'message',
        groupKey: d.chatId ? `onchat:${d.chatId}` : undefined,
        action: d.chatId
          ? { screen: 'OpenChat', params: { chatId: d.chatId } }
          : undefined,
      };
    case 'on_connect_request':
      return {
        category: 'social',
        action: { screen: 'OpenNetworkInbox', params: { tab: 'requests' } },
      };
    case 'on_connect_accepted':
      return {
        category: 'social',
        action: { screen: 'OpenNetworkProfile', params: { userId: fromUserId } },
      };
    case 'ripple_nearby':
    case 'ripple_invited':
    case 'ripple_join_request':
    case 'ripple_approved':
    case 'ripple_reply':
    case 'ripple_support':
      return {
        category: 'ripple',
        groupKey: d.rippleId ? `ripple:${d.rippleId}` : undefined,
        action: d.rippleId
          ? { screen: 'RippleDetail', params: { rippleId: d.rippleId } }
          : undefined,
      };
    case 'ripple_removed':
      return {
        category: 'ripple',
        groupKey: d.rippleId ? `ripple:${d.rippleId}` : undefined,
      };
    case 'live_started':
      return {
        category: 'live',
        groupKey: d.sessionId ? `live:${d.sessionId}` : undefined,
        action: d.sessionId
          ? { kind: 'live_join', sessionId: String(d.sessionId) }
          : undefined,
        cta: 'Watch',
      };
    default:
      return { category: 'system' };
  }
};

/**
 * @param {object} args
 * @param {string}  args.toUserId     recipient userId
 * @param {string}  args.fromUserId   actor userId
 * @param {string}  args.type         Notification.type + envelope type
 * @param {string}  args.category     message|social|live|ripple|system
 * @param {string}  args.title
 * @param {string}  args.body
 * @param {string}  [args.avatar]     actor/avatar image URL
 * @param {string}  [args.image]      big-picture thumbnail URL
 * @param {string}  [args.groupKey]   collapse/thread key (e.g. onchat:<id>)
 * @param {object}  [args.action]     tap action (see header comment)
 * @param {string}  [args.cta]        banner button label (e.g. 'Watch')
 * @param {string}  [args.inApp]      'banner' (default) | 'none'
 * @param {boolean} [args.persist]    default true
 * @param {boolean} [args.push]       default true
 * @param {boolean} [args.socket]     default true — notification:push relay
 * @param {object}  [args.data]       extra fields persisted on Notification.data
 * @returns the envelope that was dispatched
 */
const dispatchNotification = async ({
  toUserId,
  fromUserId,
  type,
  category,
  title,
  body,
  avatar,
  image,
  groupKey,
  action,
  cta,
  inApp,
  persist = true,
  push = true,
  socket = true,
  data = {},
}) => {
  const envelope = buildEnvelope({
    type, category, title, body, avatar, image, groupKey, action, cta, inApp,
  });

  if (socket) {
    try {
      getSocketManager().broadcastToUser(toUserId, 'notification:push', envelope);
    } catch (e) {
      console.error(`❌ [NOTIFY] socket ${type} → ${toUserId}:`, e.message);
    }
  }
  if (persist) {
    try {
      await Notification.create({
        userId: toUserId,
        type,
        fromUserId,
        message: body,
        data: { ...data, envelope },
      });
    } catch (e) {
      console.error(`❌ [NOTIFY] persist ${type} → ${toUserId}:`, e.message);
    }
  }
  if (push) {
    try {
      if (fcmNotificationService.isEnabled && fcmNotificationService.isEnabled()) {
        await fcmNotificationService.sendEnvelopeNotification(
          toUserId,
          envelope,
          CATEGORY_COLORS[envelope.category],
        );
      }
    } catch (e) {
      console.error(`❌ [NOTIFY] fcm ${type} → ${toUserId}:`, e.message);
    }
  }
  return envelope;
};

module.exports = {
  dispatchNotification,
  buildEnvelope,
  openNetworkEnvelopeSpec,
  CATEGORY_COLORS,
};
