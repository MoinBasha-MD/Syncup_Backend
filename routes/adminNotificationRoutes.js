/**
 * Admin push notifications — POST /api/admin/notifications/push, mounted in
 * server.js behind adminAuthMiddleware. Sends a v2 envelope to a list of
 * userIds through the shared dispatcher (socket + Notification row + FCM).
 */
const express = require('express');
const asyncHandler = require('express-async-handler');
const { BadRequestError } = require('../utils/errorClasses');
const { dispatchNotification, CATEGORY_COLORS } = require('../services/notificationDispatcher');

const router = express.Router();

const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_COLORS));

// POST /api/admin/notifications/push
router.post('/notifications/push', asyncHandler(async (req, res) => {
  const {
    userIds,
    type,
    category,
    title,
    body,
    avatar,
    image,
    action,
    cta,
    groupKey,
  } = req.body || {};

  if (!Array.isArray(userIds) || userIds.length === 0 || userIds.length > 1000) {
    throw new BadRequestError('userIds must be an array of 1..1000 ids');
  }
  if (userIds.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new BadRequestError('userIds must contain only non-empty strings');
  }
  if (typeof title !== 'string' || !title.trim() || title.length > 80) {
    throw new BadRequestError('title is required (max 80 chars)');
  }
  if (typeof body !== 'string' || !body.trim() || body.length > 240) {
    throw new BadRequestError('body is required (max 240 chars)');
  }
  if (typeof type !== 'string' || !/^[a-z][a-z0-9_]{1,63}$/.test(type)) {
    throw new BadRequestError('type must be a snake_case identifier');
  }
  if (category !== undefined && !VALID_CATEGORIES.has(category)) {
    throw new BadRequestError(`category must be one of: ${[...VALID_CATEGORIES].join(', ')}`);
  }
  if (action !== undefined && action !== null) {
    const a = action;
    const ok =
      (typeof a.screen === 'string' && a.screen.length > 0) ||
      (a.kind === 'live_join' && !!a.sessionId) ||
      (a.kind === 'url' && typeof a.url === 'string');
    if (typeof a !== 'object' || !ok) {
      throw new BadRequestError('action must be {screen, params?} | {kind:"live_join", sessionId} | {kind:"url", url}');
    }
  }

  const results = await Promise.allSettled(
    userIds.map((toUserId) =>
      dispatchNotification({
        toUserId: toUserId.trim(),
        fromUserId: 'system',
        type,
        category,
        title: title.trim(),
        body: body.trim(),
        avatar,
        image,
        groupKey,
        action,
        cta,
      }),
    ),
  );

  res.status(200).json({
    success: true,
    sent: results.filter((r) => r.status === 'fulfilled').length,
    failed: results.filter((r) => r.status === 'rejected').length,
  });
}));

module.exports = router;
