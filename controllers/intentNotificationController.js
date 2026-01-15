const IntentNotification = require('../models/IntentNotification');
const User = require('../models/userModel');
const { broadcastToUser } = require('../socketManager');

/**
 * Send an intent notification to a contact
 * POST /api/intent-notifications/send
 */
exports.sendIntentNotification = async (req, res) => {
  try {
    const fromUserId = req.user.userId;
    const { toUserId, intentType } = req.body;

    // Validate intent type
    if (!['call', 'text', 'emergency'].includes(intentType)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid intent type. Must be: call, text, or emergency' 
      });
    }

    // Check if target user exists and get their status
    const toUser = await User.findOne({ userId: toUserId });
    if (!toUser) {
      return res.status(404).json({ 
        success: false, 
        message: 'Target user not found' 
      });
    }

    // Calculate expiry based on user's status end time
    let expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // Default 24 hours
    
    // Check if user has an active status with end time
    if (toUser.statusEndTime && new Date(toUser.statusEndTime) > new Date()) {
      expiresAt = new Date(toUser.statusEndTime);
      console.log(`⏰ Intent will expire with status at: ${expiresAt}`);
    } else if (toUser.subEndTime && new Date(toUser.subEndTime) > new Date()) {
      expiresAt = new Date(toUser.subEndTime);
      console.log(`⏰ Intent will expire with sub-status at: ${expiresAt}`);
    }

    // Check if there's already an active intent from this user to target
    const existingIntent = await IntentNotification.getActiveIntent(fromUserId, toUserId);
    
    if (existingIntent) {
      // Update existing intent
      existingIntent.intentType = intentType;
      existingIntent.createdAt = new Date();
      existingIntent.expiresAt = expiresAt;
      await existingIntent.save();

      console.log(`🔔 Updated intent notification: ${fromUserId} -> ${toUserId} (${intentType})`);
    } else {
      // Create new intent notification
      const intent = new IntentNotification({
        fromUserId,
        toUserId,
        intentType,
        status: 'pending',
        expiresAt
      });

      await intent.save();
      console.log(`🔔 Created intent notification: ${fromUserId} -> ${toUserId} (${intentType})`);
    }

    // Get sender info for WebSocket broadcast
    const fromUser = await User.findOne({ userId: fromUserId }).select('name phoneNumber profileImage');

    // Broadcast to target user via WebSocket (no push notification)
    const broadcastData = {
      type: 'intent_notification',
      fromUserId: fromUserId,
      fromUserName: fromUser.name,
      fromUserPhone: fromUser.phoneNumber,
      fromUserImage: fromUser.profileImage,
      intentType,
      timestamp: new Date().toISOString()
    };

    broadcastToUser(toUserId, 'intent:new', broadcastData);
    console.log(`📡 Broadcasted intent notification to user ${toUserId}`);

    res.json({
      success: true,
      message: 'Intent notification sent successfully',
      data: {
        intentType,
        toUserId: toUserId
      }
    });

  } catch (error) {
    console.error('❌ Error sending intent notification:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send intent notification',
      error: error.message 
    });
  }
};

/**
 * Get all pending intent notifications for current user
 * GET /api/intent-notifications/pending
 */
exports.getPendingIntents = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Cleanup expired intents first
    await IntentNotification.cleanupExpired();

    // Get all pending intents for this user
    const intents = await IntentNotification.getPendingIntents(userId);

    // Format response
    const formattedIntents = intents.map(intent => ({
      id: intent._id,
      fromUserId: intent.fromUserId.userId || intent.fromUserId._id,
      fromUserName: intent.fromUserId.name,
      fromUserPhone: intent.fromUserId.phoneNumber,
      fromUserImage: intent.fromUserId.profileImage,
      intentType: intent.intentType,
      createdAt: intent.createdAt,
      expiresAt: intent.expiresAt
    }));

    res.json({
      success: true,
      data: formattedIntents
    });

  } catch (error) {
    console.error('❌ Error fetching pending intents:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch pending intents',
      error: error.message 
    });
  }
};

/**
 * Mark all intent notifications as read (acknowledged)
 * POST /api/intent-notifications/mark-all-read
 */
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Update all pending intents to acknowledged
    const result = await IntentNotification.updateMany(
      {
        toUserId: userId,
        status: 'pending'
      },
      {
        $set: { 
          status: 'acknowledged',
          acknowledgedAt: new Date()
        }
      }
    );

    console.log(`✅ Marked ${result.modifiedCount} intents as read for user ${userId}`);

    res.json({
      success: true,
      message: `Marked ${result.modifiedCount} intent notifications as read`,
      data: {
        clearedCount: result.modifiedCount
      }
    });

  } catch (error) {
    console.error('❌ Error marking intents as read:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to mark intents as read',
      error: error.message 
    });
  }
};

/**
 * Clear a specific intent notification
 * DELETE /api/intent-notifications/:intentId
 */
exports.clearIntent = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { intentId } = req.params;

    const intent = await IntentNotification.findOne({
      _id: intentId,
      toUserId: userId
    });

    if (!intent) {
      return res.status(404).json({ 
        success: false, 
        message: 'Intent notification not found' 
      });
    }

    intent.status = 'acknowledged';
    intent.acknowledgedAt = new Date();
    await intent.save();

    console.log(`✅ Cleared intent ${intentId} for user ${userId}`);

    res.json({
      success: true,
      message: 'Intent notification cleared successfully'
    });

  } catch (error) {
    console.error('❌ Error clearing intent:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to clear intent notification',
      error: error.message 
    });
  }
};

/**
 * Get all intents SENT by current user (to show colors on sender's side)
 * GET /api/intent-notifications/sent
 */
exports.getSentIntents = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Cleanup expired intents first
    await IntentNotification.cleanupExpired();

    // Get all pending intents FROM this user
    const intents = await IntentNotification.find({
      fromUserId: userId,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    }).sort({ createdAt: -1 });

    // Manually populate user data
    const formattedIntents = await Promise.all(
      intents.map(async (intent) => {
        const toUser = await User.findOne({ userId: intent.toUserId }).select('name phoneNumber profileImage userId');
        return {
          id: intent._id,
          toUserId: toUser?.userId || intent.toUserId,
          toUserName: toUser?.name || 'Unknown',
          toUserPhone: toUser?.phoneNumber || '',
          toUserImage: toUser?.profileImage || '',
          intentType: intent.intentType,
          createdAt: intent.createdAt,
          expiresAt: intent.expiresAt
        };
      })
    );

    console.log(`📤 [INTENT CONTROLLER] User ${userId} has ${formattedIntents.length} sent intents`);

    res.json({
      success: true,
      data: formattedIntents
    });

  } catch (error) {
    console.error('❌ Error fetching sent intents:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch sent intents',
      error: error.message 
    });
  }
};

/**
 * Check if contact's status has expired and auto-clear intents
 * This is called periodically or when status updates are received
 * POST /api/intent-notifications/check-expiry
 */
exports.checkStatusExpiry = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { contactUserId, statusEndTime } = req.body;

    if (!statusEndTime) {
      return res.status(400).json({ 
        success: false, 
        message: 'Status end time is required' 
      });
    }

    const endTime = new Date(statusEndTime);
    const now = new Date();

    // If status has expired, clear the intent
    if (now >= endTime) {
      const result = await IntentNotification.updateMany(
        {
          fromUserId: userId,
          toUserId: contactUserId,
          status: 'pending'
        },
        {
          $set: { 
            status: 'expired',
            expiresAt: now
          }
        }
      );

      console.log(`⏰ Auto-expired ${result.modifiedCount} intents due to status expiry`);

      return res.json({
        success: true,
        message: 'Intent auto-expired due to status end',
        data: {
          expired: true,
          clearedCount: result.modifiedCount
        }
      });
    }

    res.json({
      success: true,
      message: 'Status still active',
      data: {
        expired: false
      }
    });

  } catch (error) {
    console.error('❌ Error checking status expiry:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to check status expiry',
      error: error.message 
    });
  }
};
