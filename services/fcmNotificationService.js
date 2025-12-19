const admin = require('firebase-admin');
const path = require('path');
const User = require('../models/userModel');

class FCMNotificationService {
  constructor() {
    this.initialized = false;
    this.fcmEnabled = false;
  }

  /**
   * Initialize Firebase Admin SDK with service account
   */
  initialize() {
    try {
      console.log('🔔 [FCM] Initializing Firebase Admin SDK...');

      // Check if already initialized
      if (admin.apps.length > 0) {
        console.log('✅ [FCM] Firebase Admin already initialized');
        this.fcmEnabled = true;
        this.initialized = true;
        return;
      }

      // Load service account from config folder
      const serviceAccountPath = path.join(__dirname, '../config/firebase-service-account.json');
      const serviceAccount = require(serviceAccountPath);

      // Initialize Firebase Admin
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });

      this.fcmEnabled = true;
      this.initialized = true;
      console.log('✅ [FCM] Firebase Admin SDK initialized successfully');
      console.log(`✅ [FCM] Project: ${serviceAccount.project_id}`);
    } catch (error) {
      console.error('❌ [FCM] Failed to initialize Firebase Admin SDK:', error.message);
      console.log('⚠️ [FCM] FCM notifications will be disabled');
      this.fcmEnabled = false;
      this.initialized = false;
    }
  }

  /**
   * Send wakeup notification to user's device(s)
   * This is a silent notification that wakes the app to reconnect WebSocket
   */
  async sendWakeupNotification(userId, messageData) {
    if (!this.fcmEnabled) {
      console.log('⚠️ [FCM] FCM is disabled - skipping notification');
      return { success: false, reason: 'FCM disabled' };
    }

    try {
      // Get user's FCM tokens
      const user = await User.findOne({ userId }).select('fcmTokens');
      
      if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
        console.log(`⚠️ [FCM] No FCM tokens found for user: ${userId}`);
        return { success: false, reason: 'No FCM tokens' };
      }

      const tokens = user.fcmTokens.map(t => t.token);
      console.log(`📱 [FCM] Sending wakeup notification to ${tokens.length} device(s)`);

      // Create silent notification payload
      const message = {
        data: {
          type: 'wakeup',
          action: 'reconnect_websocket',
          senderId: messageData.senderId || '',
          senderName: messageData.senderName || '',
          messageId: messageData.messageId || '',
          timestamp: new Date().toISOString()
        },
        tokens: tokens,
        android: {
          priority: 'high',
          ttl: 60000 // 1 minute
        }
      };

      // Send notification
      const response = await admin.messaging().sendEachForMulticast(message);

      console.log(`✅ [FCM] Wakeup notification sent - Success: ${response.successCount}, Failed: ${response.failureCount}`);

      // Remove invalid tokens
      if (response.failureCount > 0) {
        const invalidTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            invalidTokens.push(tokens[idx]);
            console.log(`⚠️ [FCM] Invalid token removed: ${tokens[idx].substring(0, 20)}...`);
          }
        });

        // Remove invalid tokens from database
        if (invalidTokens.length > 0) {
          await User.updateOne(
            { userId },
            { $pull: { fcmTokens: { token: { $in: invalidTokens } } } }
          );
        }
      }

      return {
        success: response.successCount > 0,
        successCount: response.successCount,
        failureCount: response.failureCount
      };

    } catch (error) {
      console.error('❌ [FCM] Error sending wakeup notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send notification with visible message (for important alerts)
   */
  async sendVisibleNotification(userId, notification) {
    if (!this.fcmEnabled) {
      console.log('⚠️ [FCM] FCM is disabled - skipping notification');
      return { success: false, reason: 'FCM disabled' };
    }

    try {
      const user = await User.findOne({ userId }).select('fcmTokens');
      
      if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
        console.log(`⚠️ [FCM] No FCM tokens found for user: ${userId}`);
        return { success: false, reason: 'No FCM tokens' };
      }

      const tokens = user.fcmTokens.map(t => t.token);

      const message = {
        notification: {
          title: notification.title,
          body: notification.body
        },
        data: notification.data || {},
        tokens: tokens,
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'chat_messages'
          }
        }
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      console.log(`✅ [FCM] Visible notification sent - Success: ${response.successCount}, Failed: ${response.failureCount}`);

      return {
        success: response.successCount > 0,
        successCount: response.successCount,
        failureCount: response.failureCount
      };

    } catch (error) {
      console.error('❌ [FCM] Error sending visible notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if FCM is enabled and ready
   */
  isEnabled() {
    return this.fcmEnabled && this.initialized;
  }
}

// Export singleton instance
module.exports = new FCMNotificationService();
