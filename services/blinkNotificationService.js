const User = require('../models/userModel');
const Notification = require('../models/Notification');
const Message = require('../models/Message');

// Lazy require to avoid circular dependency with socketManager
const getSocketManager = () => require('../socketManager');

/**
 * Build a blinkData object to embed in chat messages.
 * Looks up the Blink owner's profile so the frontend has it.
 */
async function buildBlinkData(blink, action) {
  let ownerUser = null;
  try {
    ownerUser = await User.findOne({ userId: blink.userId })
      .select('name profileImage')
      .lean();
  } catch (err) {
    console.warn('[BlinkNotificationService] Could not look up blink owner:', err);
  }

  return {
    blinkId: blink._id.toString(),
    mediaUrl: blink.mediaUrl || null,
    mediaType: blink.mediaType || 'image',
    caption: blink.caption || null,
    blinkOwner: {
      userId: blink.userId,
      userName: ownerUser?.name || null,
      userProfileImage: ownerUser?.profileImage || null,
    },
    action,
  };
}

/**
 * Create a chat message and broadcast it via WebSocket.
 */
async function sendBlinkChatMessage({ senderId, receiverId, messageText, messageType, blinkData, senderName, senderProfileImage }) {
  try {
    const msg = new Message({
      senderId,
      receiverId,
      message: messageText,
      messageType,
      blinkData,
      timestamp: new Date(),
      status: 'sent',
    });
    const saved = await msg.save();

    const payload = {
      _id: saved._id,
      senderId: saved.senderId,
      receiverId: saved.receiverId,
      senderName: senderName || 'Someone',
      senderProfileImage: senderProfileImage || null,
      message: saved.message,
      messageType: saved.messageType,
      blinkData: saved.blinkData,
      timestamp: saved.timestamp,
      status: 'sent',
    };

    const delivered = getSocketManager().broadcastToUser(receiverId, 'message:new', payload);
    if (delivered) {
      saved.status = 'delivered';
      await saved.save();
    }
    // Also notify sender's other devices
    getSocketManager().broadcastToUser(senderId, 'message:new', payload);

    return saved;
  } catch (err) {
    console.error('[BlinkNotificationService] sendBlinkChatMessage failed:', err);
  }
}

/**
 * BlinkNotificationService
 * Sends persistent notifications + real-time events to Blink owners when
 * someone likes their Blink or captures it (screenshot / screen recording).
 * Also drops a message into the 1-on-1 chat so interactions live in the conversation.
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

      // Persistent notification
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

      // Real-time notification event
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

      // Chat message: "Liked your Blink" — deduplicate to avoid spam on like/unlike/like
      const blinkIdStr = blink._id.toString();
      const recentLikeMsg = await Message.findOne({
        senderId: fromUserId,
        receiverId: blink.userId,
        messageType: 'blink_like',
        'blinkData.blinkId': blinkIdStr,
        timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // within last 24h
      }).lean();

      if (!recentLikeMsg) {
        const blinkData = await buildBlinkData(blink, 'like');
        await sendBlinkChatMessage({
          senderId: fromUserId,
          receiverId: blink.userId,
          messageText: `❤️ Liked your Blink`,
          messageType: 'blink_like',
          blinkData,
          senderName: fromUser?.name,
          senderProfileImage: fromUser?.profileImage,
        });
      }
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

      // Persistent notification
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

      // Real-time notification event
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

      // Chat message: "took a screenshot of your Blink" — deduplicate
      const action = captureType === 'screen_recording' ? 'screen_recording' : 'screenshot';
      const blinkIdStr = blink._id.toString();
      const recentCaptureMsg = await Message.findOne({
        senderId: fromUserId,
        receiverId: blink.userId,
        messageType: 'blink_capture',
        'blinkData.blinkId': blinkIdStr,
        'blinkData.action': action,
        timestamp: { $gte: new Date(Date.now() - 60 * 60 * 1000) } // within last 1h
      }).lean();

      if (!recentCaptureMsg) {
        const blinkData = await buildBlinkData(blink, action);
        const emoji = captureType === 'screen_recording' ? '🎥' : '📸';
        await sendBlinkChatMessage({
          senderId: fromUserId,
          receiverId: blink.userId,
          messageText: `${emoji} Took a ${captureLabel} of your Blink`,
          messageType: 'blink_capture',
          blinkData,
          senderName: fromUser?.name,
          senderProfileImage: fromUser?.profileImage,
        });
      }
    } catch (error) {
      console.error('Failed to send Blink capture notification:', error);
    }
  }

  /**
   * Send a reply-to-Blink as a chat message.
   */
  async sendBlinkReply(blink, fromUserId, replyText) {
    try {
      if (!blink || !fromUserId || !replyText?.trim()) return null;

      const fromUser = await User.findOne({ userId: fromUserId })
        .select('name profileImage')
        .lean();

      const blinkData = await buildBlinkData(blink, 'reply');

      const saved = await sendBlinkChatMessage({
        senderId: fromUserId,
        receiverId: blink.userId,
        messageText: replyText.trim(),
        messageType: 'blink_reply',
        blinkData,
        senderName: fromUser?.name,
        senderProfileImage: fromUser?.profileImage,
      });

      return saved;
    } catch (error) {
      console.error('Failed to send Blink reply:', error);
      return null;
    }
  }
}

module.exports = new BlinkNotificationService();
