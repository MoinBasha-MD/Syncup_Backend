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
      
      console.log(`🔍 [FCM DEBUG] User lookup result:`, {
        userFound: !!user,
        userId: userId,
        hasFcmTokens: user ? !!user.fcmTokens : false,
        tokenCount: user && user.fcmTokens ? user.fcmTokens.length : 0,
        tokens: user && user.fcmTokens ? user.fcmTokens.map(t => ({
          platform: t.platform,
          tokenPreview: t.token.substring(0, 20) + '...',
          addedAt: t.addedAt
        })) : []
      });
      
      if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
        console.log(`⚠️ [FCM] No FCM tokens found for user: ${userId}`);
        return { success: false, reason: 'No FCM tokens' };
      }

      const tokens = user.fcmTokens.map(t => t.token);
      console.log(`📱 [FCM] Sending wakeup notification to ${tokens.length} device(s)`);

      // Create notification payload with both notification and data
      // CRITICAL: notification field required for Android 12+ to wake app when closed
      // CRITICAL: All data fields MUST be strings (Firebase requirement)
      const message = {
        notification: {
          title: messageData.senderName || 'New Message',
          body: 'New message' // Always show "New message" for privacy
        },
        data: {
          type: 'chat_message',
          action: 'reconnect_websocket',
          senderId: String(messageData.senderId || ''),
          senderName: String(messageData.senderName || ''),
          messageId: String(messageData.messageId || ''),
          chatId: String(messageData.senderId || ''),
          timestamp: new Date().toISOString()
        },
        tokens: tokens,
        android: {
          priority: 'high',
          ttl: 60000, // 1 minute
          notification: {
            channelId: 'chat_messages',
            sound: 'mess_tone', // Custom notification sound
            priority: 'high',
            defaultSound: false,
            defaultVibrateTimings: false,
            defaultLightSettings: false,
            color: '#007AFF', // Blue notification color
            icon: 'ic_notification',
            tag: String(messageData.senderId || ''),
            visibility: 'public'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              contentAvailable: true
            }
          }
        }
      };

      // Send notification
      const response = await admin.messaging().sendEachForMulticast(message);

      console.log(`✅ [FCM] Wakeup notification sent - Success: ${response.successCount}, Failed: ${response.failureCount}`);

      // Process results and cleanup invalid tokens
      if (response.failureCount > 0) {
        const invalidTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            invalidTokens.push(tokens[idx]);
            console.log(`❌ [FCM] Token failed: ${tokens[idx].substring(0, 20)}...`);
            console.log(`❌ [FCM] Error code: ${resp.error?.code}`);
            console.log(`❌ [FCM] Error message: ${resp.error?.message}`);
            console.log(`❌ [FCM] Full token: ${tokens[idx]}`);
          }
        });

        // Remove ALL invalid tokens from database
        if (invalidTokens.length > 0) {
          await User.updateOne(
            { userId },
            { $pull: { fcmTokens: { token: { $in: invalidTokens } } } }
          );
          console.log(`🧹 [FCM] Cleaned up ${invalidTokens.length} invalid token(s)`);
        }
      }

      // Update lastUsed timestamp for successful tokens
      if (response.successCount > 0) {
        const successfulTokens = [];
        response.responses.forEach((resp, idx) => {
          if (resp.success) {
            successfulTokens.push(tokens[idx]);
          }
        });

        if (successfulTokens.length > 0) {
          await User.updateOne(
            { userId },
            { 
              $set: { 
                'fcmTokens.$[elem].lastUsed': new Date() 
              } 
            },
            { 
              arrayFilters: [{ 'elem.token': { $in: successfulTokens } }] 
            }
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

      // Convert all data fields to strings (Firebase requirement)
      const dataFields = notification.data || {};
      const stringifiedData = {};
      for (const [key, value] of Object.entries(dataFields)) {
        stringifiedData[key] = String(value);
      }

      const message = {
        notification: {
          title: notification.title,
          body: notification.body
        },
        data: stringifiedData,
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
   * Send test notification (for testing FCM functionality)
   */
  async sendTestNotification(userId, notification) {
    if (!this.fcmEnabled) {
      console.log('⚠️ [FCM] FCM is disabled - skipping test notification');
      return { success: false, reason: 'FCM disabled' };
    }

    try {
      const user = await User.findOne({ userId }).select('fcmTokens name');
      
      if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
        console.log(`⚠️ [FCM] No FCM tokens found for user: ${userId}`);
        return { success: false, reason: 'No FCM tokens' };
      }

      const tokens = user.fcmTokens.map(t => t.token);

      console.log(`🧪 [FCM TEST] Sending test notification to ${user.name} (${tokens.length} tokens)`);

      // Convert all data fields to strings (Firebase requirement)
      const additionalData = notification.data || {};
      const stringifiedAdditionalData = {};
      for (const [key, value] of Object.entries(additionalData)) {
        stringifiedAdditionalData[key] = String(value);
      }

      const message = {
        notification: {
          title: notification.title || '🧪 Test Notification',
          body: notification.body || 'This is a test notification from Syncup!'
        },
        data: {
          type: 'test',
          userId: String(userId),
          timestamp: new Date().toISOString(),
          ...stringifiedAdditionalData
        },
        tokens: tokens,
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'chat_messages',
            color: '#007AFF'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        }
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      console.log(`✅ [FCM TEST] Notification sent - Success: ${response.successCount}, Failed: ${response.failureCount}`);

      // Log individual results
      response.responses.forEach((resp, idx) => {
        if (resp.success) {
          console.log(`  ✅ Token ${idx + 1}: Delivered`);
        } else {
          console.log(`  ❌ Token ${idx + 1}: Failed - ${resp.error?.message}`);
        }
      });

      return {
        success: response.successCount > 0,
        sentCount: response.successCount,
        failedCount: response.failureCount,
        totalTokens: tokens.length
      };

    } catch (error) {
      console.error('❌ [FCM TEST] Error sending test notification:', error);
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
