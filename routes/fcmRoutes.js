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

    // Check if token already exists
    const tokenExists = user.fcmTokens.some(t => t.token === fcmToken);
    
    if (!tokenExists) {
      // Add new token
      user.fcmTokens.push({
        token: fcmToken,
        platform: platform || 'android',
        addedAt: new Date()
      });

      await user.save();
      console.log('✅ [FCM] Token registered successfully');
    } else {
      console.log('ℹ️ [FCM] Token already registered');
    }

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

    // Remove token from array
    if (user.fcmTokens) {
      user.fcmTokens = user.fcmTokens.filter(t => t.token !== fcmToken);
      await user.save();
      console.log('✅ [FCM] Token removed successfully');
    }

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

module.exports = router;
