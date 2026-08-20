/**
 * Notification Feed Routes
 * Exposes the durable `Notification` collection (comments, replies, likes, mentions, etc.)
 * to the app so it isn't only a fire-and-forget WebSocket/FCM event — this lets a device
 * that was fully offline/killed when the notification was generated still see it later.
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const Notification = require('../models/Notification');

/**
 * Get current user's notifications (most recent first)
 * GET /api/notifications?page=1&limit=30&unreadOnly=false
 */
router.get('/', protect, async (req, res) => {
  try {
    const userId = req.user.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const unreadOnly = req.query.unreadOnly === 'true';

    const query = { userId };
    if (unreadOnly) query.isRead = false;

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({
      success: true,
      data: notifications,
      pagination: { page, limit, total: notifications.length }
    });
  } catch (error) {
    console.error('❌ [NOTIFICATIONS] Error fetching notifications:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch notifications', error: error.message });
  }
});

/**
 * Get unread notification count for badge display
 * GET /api/notifications/unread-count
 */
router.get('/unread-count', protect, async (req, res) => {
  try {
    const count = await Notification.countDocuments({ userId: req.user.userId, isRead: false });
    res.json({ success: true, count });
  } catch (error) {
    console.error('❌ [NOTIFICATIONS] Error fetching unread count:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch unread count', error: error.message });
  }
});

/**
 * Mark a single notification as read
 * PATCH /api/notifications/:notificationId/read
 */
router.patch('/:notificationId/read', protect, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.notificationId, userId: req.user.userId },
      { $set: { isRead: true } },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    res.json({ success: true, data: notification });
  } catch (error) {
    console.error('❌ [NOTIFICATIONS] Error marking notification as read:', error);
    res.status(500).json({ success: false, message: 'Failed to mark notification as read', error: error.message });
  }
});

/**
 * Mark all notifications as read
 * PATCH /api/notifications/read-all
 */
router.patch('/read-all', protect, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user.userId, isRead: false }, { $set: { isRead: true } });
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error('❌ [NOTIFICATIONS] Error marking all notifications as read:', error);
    res.status(500).json({ success: false, message: 'Failed to mark all notifications as read', error: error.message });
  }
});

module.exports = router;
