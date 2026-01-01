/**
 * FCM Diagnostics Routes
 * Test and validate FCM tokens
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const User = require('../models/userModel');
const { protect } = require('../middleware/authMiddleware');

/**
 * Test FCM token validity
 * POST /api/fcm-diagnostics/test-token
 */
router.post('/test-token', protect, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    
    if (!fcmToken) {
      return res.status(400).json({
        success: false,
        message: 'FCM token is required'
      });
    }

    console.log('🔍 [FCM DIAGNOSTICS] Testing token...');
    console.log('📱 [FCM DIAGNOSTICS] Token length:', fcmToken.length);
    console.log('📱 [FCM DIAGNOSTICS] Token preview:', fcmToken.substring(0, 50) + '...');
    console.log('📱 [FCM DIAGNOSTICS] Token suffix:', '...' + fcmToken.substring(fcmToken.length - 20));

    // Test 1: Token format validation
    const formatValid = fcmToken.length >= 140 && fcmToken.length <= 200;
    console.log('✅ [FCM DIAGNOSTICS] Format check:', formatValid ? 'PASS' : 'FAIL');

    // Test 2: Try to send a test message
    try {
      const testMessage = {
        data: {
          type: 'test',
          message: 'FCM Diagnostic Test'
        },
        token: fcmToken,
        android: {
          priority: 'high'
        }
      };

      const response = await admin.messaging().send(testMessage);
      
      console.log('✅ [FCM DIAGNOSTICS] Send test: SUCCESS');
      console.log('📱 [FCM DIAGNOSTICS] Response:', response);

      return res.json({
        success: true,
        message: 'Token is VALID',
        details: {
          tokenLength: fcmToken.length,
          formatValid: formatValid,
          sendTest: 'SUCCESS',
          messageId: response
        }
      });

    } catch (sendError) {
      console.error('❌ [FCM DIAGNOSTICS] Send test: FAILED');
      console.error('❌ [FCM DIAGNOSTICS] Error code:', sendError.code);
      console.error('❌ [FCM DIAGNOSTICS] Error message:', sendError.message);

      return res.json({
        success: false,
        message: 'Token is INVALID',
        details: {
          tokenLength: fcmToken.length,
          formatValid: formatValid,
          sendTest: 'FAILED',
          errorCode: sendError.code,
          errorMessage: sendError.message,
          reason: getErrorReason(sendError.code)
        }
      });
    }

  } catch (error) {
    console.error('❌ [FCM DIAGNOSTICS] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Diagnostic test failed',
      error: error.message
    });
  }
});

/**
 * Get any user's FCM tokens by userId (Admin)
 * GET /api/fcm-diagnostics/user-tokens/:userId
 */
router.get('/user-tokens/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findOne({ userId }).select('fcmTokens deviceTokens name phoneNumber');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        userId: user.userId,
        name: user.name,
        phoneNumber: user.phoneNumber,
        fcmTokens: user.fcmTokens || [],
        deviceTokens: user.deviceTokens || [],
        fcmTokenCount: user.fcmTokens?.length || 0,
        deviceTokenCount: user.deviceTokens?.length || 0
      }
    });

  } catch (error) {
    console.error('❌ [FCM DIAGNOSTICS] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user tokens',
      error: error.message
    });
  }
});

/**
 * Get user's current FCM tokens
 * GET /api/fcm-diagnostics/my-tokens
 */
router.get('/my-tokens', protect, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const user = await User.findOne({ userId }).select('fcmTokens deviceTokens');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        fcmTokens: user.fcmTokens || [],
        deviceTokens: user.deviceTokens || [],
        fcmTokenCount: user.fcmTokens?.length || 0,
        deviceTokenCount: user.deviceTokens?.length || 0
      }
    });

  } catch (error) {
    console.error('❌ [FCM DIAGNOSTICS] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tokens',
      error: error.message
    });
  }
});

/**
 * Test sending notification to self
 * POST /api/fcm-diagnostics/test-notification
 */
router.post('/test-notification', protect, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const user = await User.findOne({ userId }).select('fcmTokens name');
    
    if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No FCM tokens found for your account'
      });
    }

    const tokens = user.fcmTokens.map(t => t.token);
    
    console.log(`🔍 [FCM DIAGNOSTICS] Testing notification to ${tokens.length} token(s)`);

    const message = {
      notification: {
        title: 'FCM Test',
        body: 'This is a test notification from diagnostics'
      },
      data: {
        type: 'test',
        timestamp: new Date().toISOString()
      },
      tokens: tokens,
      android: {
        priority: 'high',
        notification: {
          channelId: 'chat_messages',
          sound: 'default'
        }
      }
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    console.log(`✅ [FCM DIAGNOSTICS] Results: Success=${response.successCount}, Failed=${response.failureCount}`);

    const results = response.responses.map((resp, idx) => ({
      token: tokens[idx].substring(0, 20) + '...',
      success: resp.success,
      error: resp.error ? {
        code: resp.error.code,
        message: resp.error.message
      } : null
    }));

    res.json({
      success: response.successCount > 0,
      message: `Sent to ${response.successCount}/${tokens.length} devices`,
      details: {
        successCount: response.successCount,
        failureCount: response.failureCount,
        results: results
      }
    });

  } catch (error) {
    console.error('❌ [FCM DIAGNOSTICS] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test notification',
      error: error.message
    });
  }
});

/**
 * Get error reason from Firebase error code
 */
function getErrorReason(errorCode) {
  const reasons = {
    'messaging/invalid-registration-token': 'Token is malformed or expired',
    'messaging/registration-token-not-registered': 'Token is not registered with this Firebase project',
    'messaging/invalid-argument': 'Token format is invalid',
    'messaging/authentication-error': 'Firebase credentials mismatch',
    'messaging/server-unavailable': 'Firebase service temporarily unavailable'
  };
  
  return reasons[errorCode] || 'Unknown error';
}

module.exports = router;
