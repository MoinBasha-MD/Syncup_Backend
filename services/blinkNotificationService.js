const User = require('../models/userModel');
const Notification = require('../models/Notification');

// Lazy require to avoid circular dependency with socketManager
const getSocketManager = () => require('../socketManager');

/**
 * BlinkNotificationService
 * Sends persistent notifications + real-time events to Blink owners when
 * someone likes their Blink or captures it (screenshot / screen recording).
 */
class BlinkNotificationService {
  /**
   * Notify the Blink owner that someone liked their Blink.
   */
  async notifyBlinkLiked(blink, fromUserId) {
    try {
      if (!blink || !fromUserId || blink.userId === fromUserId) return;

      const fromUser = await User.findOne({ userId: fromUserId })
        .select('name profileImage')
        .lean();

      const title = 'New Blink like';
      const body = `${fromUser?.name || 'Someone'} liked your Blink`;

      await Notification.create({
        userId: blink.userId,
        type: 'like',
        fromUserId,
        message: body,
        data: {
          blinkId: blink._id.toString(),
          type: 'blink_like'
        }
      });

      getSocketManager().broadcastToUser(blink.userId, 'notification:blink', {
        type: 'blink_like',
        title,
        body,
        data: {
          blinkId: blink._id.toString(),
          fromUserId,
          fromUserName: fromUser?.name || 'Someone',
          fromUserProfileImage: fromUser?.profileImage || null,
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to send Blink like notification:', error);
    }
  }

  /**
   * Notify the Blink owner that someone captured their Blink.
   * captureType: 'screenshot' | 'screen_recording'
   */
  async notifyBlinkCaptured(blink, fromUserId, captureType) {
    try {
      if (!blink || !fromUserId || blink.userId === fromUserId) return;

      const fromUser = await User.findOne({ userId: fromUserId })
        .select('name profileImage')
        .lean();

      const captureLabel = captureType === 'screen_recording' ? 'screen recording' : 'screenshot';
      const title = 'Blink captured';
      const body = `${fromUser?.name || 'Someone'} took a ${captureLabel} of your Blink`;
      const notificationType = captureType === 'screen_recording'
        ? 'blink_screen_recording'
        : 'blink_screenshot';

      await Notification.create({
        userId: blink.userId,
        type: notificationType,
        fromUserId,
        message: body,
        data: {
          blinkId: blink._id.toString(),
          captureType,
          type: notificationType
        }
      });

      getSocketManager().broadcastToUser(blink.userId, 'notification:blink', {
        type: notificationType,
        title,
        body,
        data: {
          blinkId: blink._id.toString(),
          captureType,
          fromUserId,
          fromUserName: fromUser?.name || 'Someone',
          fromUserProfileImage: fromUser?.profileImage || null,
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to send Blink capture notification:', error);
    }
  }
}

module.exports = new BlinkNotificationService();
