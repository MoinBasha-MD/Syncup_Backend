/**
 * FCM Routes - Handle FCM token registration
 */

const express = require('express');
const router = express.Router();
const User = require('../models/userModel');
const { protect } = require('../middleware/authMiddleware');

/**
 * Register FCM token for a user
 * POST /api/notifications/register-fcm-token
 */
router.post('/register-fcm-token', protect, async (req, res) => {
  try {
    const { fcmToken, platform } = req.body;
    const userId = req.user.userId;

    console.log('📱 [FCM] Registering token for user:', userId);

    if (!fcmToken) {
      return res.status(400).json({
        success: false,
        message: 'FCM token is required'
      });
    }

    // Update user's FCM token
    const user = await User.findOne({ userId });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Initialize fcmTokens array if it doesn't exist
    if (!user.fcmTokens) {
      user.fcmTokens = [];
    }

    const currentPlatform = platform || 'android';

    // Atomic update: Remove existing tokens for this platform or token string
    await User.updateOne(
      { userId },
      { $pull: { fcmTokens: { $or: [{ token: fcmToken }, { platform: currentPlatform }] } } }
    );

    // Atomic push: Add new token and keep only the latest 10 tokens to prevent unbounded array growth
    await User.updateOne(
      { userId },
      {
        $push: {
          fcmTokens: {
            $each: [{
              token: fcmToken,
              platform: currentPlatform,
              addedAt: new Date(),
              lastUsed: new Date()
            }],
            $slice: -10
          }
        }
      }
    );

    console.log('✅ [FCM] Token registered atomically');

    res.json({
      success: true,
      message: 'FCM token registered successfully'
    });

  } catch (error) {
    console.error('❌ [FCM] Error registering token:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to register FCM token',
      error: error.message
    });
  }
});

/**
 * Remove FCM token (when user logs out)
 * POST /api/notifications/remove-fcm-token
 */
router.post('/remove-fcm-token', protect, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    const userId = req.user.userId;

    console.log('🗑️ [FCM] Removing token for user:', userId);

    const user = await User.findOne({ userId });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Remove token from array atomically
    await User.updateOne(
      { userId },
      { $pull: { fcmTokens: { token: fcmToken } } }
    );
    console.log('✅ [FCM] Token removed successfully');

    res.json({
      success: true,
      message: 'FCM token removed successfully'
    });

  } catch (error) {
    console.error('❌ [FCM] Error removing token:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove FCM token',
      error: error.message
    });
  }
});

/**
 * Test FCM notification - Send test notification to yourself
 * POST /api/notifications/test-fcm
 */
router.post('/test-fcm', protect, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { title, body, testType } = req.body;

    console.log('🧪 [FCM TEST] Sending test notification to user:', userId);

    const fcmNotificationService = require('../services/fcmNotificationService');

    // Get user's FCM tokens
    const user = await User.findOne({ userId }).select('fcmTokens name');
    
    if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No FCM tokens registered for this user. Please register a token first.'
      });
    }

    // Send test notification based on type
    let result;
    if (testType === 'wakeup') {
      // Test wakeup notification (what happens when app is closed)
      result = await fcmNotificationService.sendWakeupNotification(userId, {
        senderId: 'test-sender',
        senderName: 'Test User',
        messageId: 'test-message-123'
      });
    } else {
      // Send custom test notification
      result = await fcmNotificationService.sendTestNotification(userId, {
        title: title || '🧪 FCM Test Notification',
        body: body || 'This is a test notification from Syncup Backend!',
        data: {
          type: 'test',
          timestamp: new Date().toISOString()
        }
      });
    }

    if (result.success) {
      res.json({
        success: true,
        message: 'Test notification sent successfully',
        details: {
          userId,
          userName: user.name,
          tokensCount: user.fcmTokens.length,
          sentCount: result.sentCount || 1,
          testType: testType || 'custom'
        }
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send test notification',
        error: result.error
      });
    }

  } catch (error) {
    console.error('❌ [FCM TEST] Error sending test notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test notification',
      error: error.message
    });
  }
});

/**
 * Cleanup old/unused FCM tokens
 * POST /api/notifications/cleanup-tokens
 * Removes tokens older than 30 days that haven't been used
 */
router.post('/cleanup-tokens', protect, async (req, res) => {
  try {
    const userId = req.user.userId;

    console.log('🧹 [FCM] Cleaning up old tokens for user:', userId);

    const user = await User.findOne({ userId });
    
    if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
      return res.json({
        success: true,
        message: 'No tokens to cleanup',
        removedCount: 0
      });
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const initialCount = user.fcmTokens.length;

    // Remove tokens older than 30 days that haven't been used recently
    user.fcmTokens = user.fcmTokens.filter(token => {
      const lastUsed = token.lastUsed || token.addedAt;
      return lastUsed > thirtyDaysAgo;
    });

    const removedCount = initialCount - user.fcmTokens.length;

    if (removedCount > 0) {
      await user.save();
      console.log(`✅ [FCM] Removed ${removedCount} old token(s)`);
    }

    res.json({
      success: true,
      message: 'Token cleanup completed',
      removedCount,
      remainingCount: user.fcmTokens.length
    });

  } catch (error) {
    console.error('❌ [FCM] Error cleaning up tokens:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup tokens',
      error: error.message
    });
  }
});

module.exports = router;
