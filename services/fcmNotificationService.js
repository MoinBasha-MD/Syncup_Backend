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
            sound: notification.sound || 'default',
            channelId: notification.channelId || 'syncup-general-channel'
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
   * Send incoming call notification (for offline users)
   * This triggers a full-screen call notification like WhatsApp/Instagram
   */
  async sendCallNotification(userId, callData) {
    if (!this.fcmEnabled) {
      console.log('⚠️ [FCM] FCM is disabled - skipping call notification');
      return { success: false, reason: 'FCM disabled' };
    }

    try {
      const user = await User.findOne({ userId }).select('fcmTokens');
      
      if (!user || !user.fcmTokens || user.fcmTokens.length === 0) {
        console.log(`⚠️ [FCM] No FCM tokens found for user: ${userId}`);
        return { success: false, reason: 'No FCM tokens' };
      }

      const tokens = user.fcmTokens.map(t => t.token);
      console.log(`📞 [FCM CALL] Sending call notification to ${tokens.length} device(s)`);

      // Create high-priority call notification
      // CRITICAL: Use data-only message for call notifications to trigger custom UI
      const message = {
        data: {
          type: 'incoming_call',
          callId: String(callData.callId),
          callerId: String(callData.callerId),
          callerName: String(callData.callerName || 'Unknown'),
          callerAvatar: String(callData.callerAvatar || ''),
          callType: String(callData.callType), // 'voice' or 'video'
          timestamp: new Date().toISOString(),
          // Include offer SDP for immediate call setup
          offer: JSON.stringify(callData.offer || {})
        },
        tokens: tokens,
        android: {
          priority: 'high',
          ttl: 30000, // 30 seconds - call expires quickly
          notification: {
            channelId: 'incoming_calls',
            sound: 'ring_tone', // Custom ringtone
            priority: 'max',
            defaultSound: false,
            defaultVibrateTimings: false,
            color: '#00C853', // Green for calls
            icon: 'ic_call',
            tag: String(callData.callId),
            visibility: 'public',
            // Full-screen intent for call UI
            clickAction: 'INCOMING_CALL'
          }
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: `${callData.callerName || 'Unknown'}`,
                body: `Incoming ${callData.callType} call`
              },
              sound: 'default',
              badge: 1,
              contentAvailable: true,
              category: 'CALL_INVITATION'
            }
          }
        }
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      console.log(`✅ [FCM CALL] Call notification sent - Success: ${response.successCount}, Failed: ${response.failureCount}`);

      // Cleanup invalid tokens
      if (response.failureCount > 0) {
        const invalidTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            invalidTokens.push(tokens[idx]);
            console.log(`❌ [FCM CALL] Token failed: ${resp.error?.code} - ${resp.error?.message}`);
          }
        });

        if (invalidTokens.length > 0) {
          await User.updateOne(
            { userId },
            { $pull: { fcmTokens: { token: { $in: invalidTokens } } } }
          );
          console.log(`🧹 [FCM CALL] Cleaned up ${invalidTokens.length} invalid token(s)`);
        }
      }

      return {
        success: response.successCount > 0,
        successCount: response.successCount,
        failureCount: response.failureCount
      };

    } catch (error) {
      console.error('❌ [FCM CALL] Error sending call notification:', error);
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
