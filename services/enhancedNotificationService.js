const User = require('../models/userModel');
const { broadcastToUser } = require('../socketManager');

/**
 * Enhanced Backend Notification Service (NO FIREBASE)
 * Handles WebSocket events and notification analytics only
 */
class EnhancedNotificationService {
  constructor() {
    this.notificationStats = {
      totalSent: 0,
      totalDelivered: 0,
      totalClicked: 0,
      totalFailed: 0
    };
    
    console.log('🔔 Enhanced Notification Service initialized (Local notifications only - NO FIREBASE)');
  }

  /**
   * Send enhanced chat message notification
   */
  async sendChatMessageNotification(senderId, receiverId, message) {
    try {
      console.log('🔔 [ENHANCED BACKEND NOTIFICATIONS] Sending chat message notification');
      
      // Get sender and receiver details
      const [sender, receiver] = await Promise.all([
        User.findOne({ userId: senderId }).select('name profileImage'),
        User.findOne({ userId: receiverId }).select('deviceTokens notificationSettings')
      ]);

      if (!sender || !receiver) {
        console.log('❌ Sender or receiver not found');
        return false;
      }

      // Check notification preferences
      if (!this.shouldSendNotification(receiver, 'chat_messages')) {
        console.log('🔕 User has disabled chat message notifications');
        return false;
      }

      // Prepare notification data
      const notificationData = {
        title: sender.name || 'New Message',
        body: this.formatMessagePreview(message),
        data: {
          type: 'chat_message',
          senderId,
          receiverId,
          messageId: message._id,
          chatId: senderId,
          senderName: sender.name,
          timestamp: new Date().toISOString()
        },
        android: {
          channelId: 'chat_messages',
          priority: 'high',
          notification: {
            icon: 'ic_notification',
            color: '#007AFF',
            sound: 'message_sound',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'message_sound.caf',
              badge: 1,
              category: 'MESSAGE_CATEGORY'
            }
          }
        }
      };

      // Send real-time WebSocket notification only (NO PUSH NOTIFICATIONS)
      const socketSuccess = broadcastToUser(receiverId, 'notification:new', {
        type: 'chat_message',
        title: sender.name || 'New Message',
        body: this.formatMessagePreview(message),
        data: {
          type: 'chat_message',
          senderId,
          receiverId,
          messageId: message._id,
          chatId: senderId,
          senderName: sender.name,
          senderProfileImage: sender.profileImage, // Add profile image
          timestamp: new Date().toISOString()
        },
        senderProfileImage: sender.profileImage, // Add at root level too
        timestamp: new Date().toISOString()
      });

      // Update statistics
      this.notificationStats.totalSent++;
      if (socketSuccess) {
        this.notificationStats.totalDelivered++;
      } else {
        this.notificationStats.totalFailed++;
      }

      console.log('✅ Chat message notification sent via WebSocket:', {
        webSocket: socketSuccess,
        receiverOnline: socketSuccess
      });

      return socketSuccess;

    } catch (error) {
      console.error('❌ Error sending chat message notification:', error);
      this.notificationStats.totalFailed++;
      return false;
    }
  }

  /**
   * Send status update notification
   */
  async sendStatusUpdateNotification(userId, statusData, contactIds) {
    try {
      console.log('🔔 [ENHANCED BACKEND NOTIFICATIONS] Sending status update notifications');
      
      const user = await User.findOne({ userId }).select('name profileImage');
      if (!user) {
        console.log('❌ User not found for status update');
        return false;
      }

      // Get contacts who should receive the notification
      const contacts = await User.find({
        userId: { $in: contactIds }
      }).select('userId deviceTokens notificationSettings');

      const notificationPromises = contacts.map(async (contact) => {
        // Check if contact wants status notifications
        if (!this.shouldSendNotification(contact, 'status_updates')) {
          return { success: false, reason: 'notifications_disabled' };
        }

        const notificationData = {
          title: 'Status Update',
          body: `${user.name} is now ${statusData.status}${statusData.customStatus ? `: ${statusData.customStatus}` : ''}`,
          data: {
            type: 'status_update',
            userId,
            userName: user.name,
            status: statusData.status,
            customStatus: statusData.customStatus,
            statusUntil: statusData.statusUntil,
            timestamp: new Date().toISOString()
          },
          android: {
            channelId: 'status_updates',
            priority: 'default'
          }
        };

        // Send WebSocket notification only (NO PUSH NOTIFICATIONS)
        const socketSuccess = broadcastToUser(contact.userId, 'notification:status_update', notificationData.data);

        return {
          success: socketSuccess,
          contactId: contact.userId,
          webSocket: socketSuccess
        };
      });

      const results = await Promise.all(notificationPromises);
      const successCount = results.filter(r => r.success).length;

      console.log('✅ Status update notifications sent:', {
        totalContacts: contacts.length,
        successful: successCount,
        failed: contacts.length - successCount
      });

      return successCount > 0;

    } catch (error) {
      console.error('❌ Error sending status update notifications:', error);
      return false;
    }
  }

  /**
   * Send system notification
   */
  async sendSystemNotification(userId, title, message, data = {}) {
    try {
      console.log('🔔 [ENHANCED BACKEND NOTIFICATIONS] Sending system notification');
      
      const user = await User.findOne({ userId }).select('deviceTokens notificationSettings');
      if (!user) {
        console.log('❌ User not found for system notification');
        return false;
      }

      const notificationData = {
        title,
        body: message,
        data: {
          type: 'system',
          ...data,
          timestamp: new Date().toISOString()
        },
        android: {
          channelId: 'system_notifications',
          priority: 'default'
        }
      };

      const socketSuccess = broadcastToUser(userId, 'notification:system', notificationData.data);

      return socketSuccess;

    } catch (error) {
      console.error('❌ Error sending system notification:', error);
      return false;
    }
  }

  /**
   * Note: Push notifications removed - using WebSocket notifications only
   * This method is kept for backward compatibility but does nothing
   */
  async sendToUserDevices(user, notificationData) {
    console.log('📱 Push notifications disabled - using WebSocket notifications only');
    
    return {
      successCount: 0,
      failureCount: 0,
      responses: []
    };
  }

  /**
   * Check if user should receive notification based on preferences
   */
  shouldSendNotification(user, notificationType) {
    if (!user.notificationSettings) {
      return true; // Default to enabled if no settings
    }

    const settings = user.notificationSettings;
    
    switch (notificationType) {
      case 'chat_messages':
        return settings.chatMessages !== false;
      case 'status_updates':
        return settings.statusUpdates !== false;
      case 'system':
        return settings.systemNotifications !== false;
      default:
        return true;
    }
  }

  /**
   * Format message preview for notifications
   */
  formatMessagePreview(message) {
    switch (message.messageType) {
      case 'image':
        return '📷 Photo';
      case 'voice':
        return '🎤 Voice message';
      case 'file':
        return '📎 File';
      case 'gif':
        return '🎬 GIF';
      default:
        return message.message && message.message.length > 50 
          ? message.message.substring(0, 47) + '...'
          : message.message || 'New message';
    }
  }

  /**
   * Clean up invalid device tokens
   */
  async cleanupInvalidTokens(userId, responses) {
    try {
      const invalidTokens = responses
        .filter(response => !response.success)
        .map(response => response.token);

      if (invalidTokens.length > 0) {
        await User.updateOne(
          { _id: userId },
          { $pull: { deviceTokens: { $in: invalidTokens } } }
        );
        
        console.log('🧹 Cleaned up', invalidTokens.length, 'invalid device tokens');
      }
    } catch (error) {
      console.error('❌ Error cleaning up invalid tokens:', error);
    }
  }

  /**
   * Device token registration disabled (NO FIREBASE)
   */
  async registerDeviceToken(userId, token, platform = 'unknown') {
    console.log('📱 Device token registration disabled - using local notifications only');
    return true; // Return true for compatibility
  }

  /**
   * Update notification preferences
   */
  async updateNotificationSettings(userId, settings) {
    try {
      console.log('⚙️ Updating notification settings for user:', userId);
      
      await User.updateOne(
        { userId },
        { 
          $set: { 
            notificationSettings: {
              chatMessages: settings.chatMessages !== false,
              statusUpdates: settings.statusUpdates !== false,
              systemNotifications: settings.systemNotifications !== false,
              ...settings
            }
          }
        }
      );
      
      console.log('✅ Notification settings updated successfully');
      return true;

    } catch (error) {
      console.error('❌ Error updating notification settings:', error);
      return false;
    }
  }

  /**
   * Get notification statistics
   */
  getNotificationStats() {
    return {
      ...this.notificationStats,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Send document access notification (when someone accesses your document)
   */
  async sendDocumentAccessNotification(ownerId, accessorId, accessorName, documentType) {
    try {
      console.log(`📄 [NOTIFICATION] Document accessed: ${documentType} by ${accessorName}`);
      
      const notificationData = {
        type: 'document_access',
        title: 'Document Accessed',
        body: `${accessorName} accessed your ${documentType}`,
        data: {
          accessorId,
          accessorName,
          documentType,
          timestamp: new Date().toISOString()
        }
      };

      // Send WebSocket notification
      const socketSuccess = broadcastToUser(ownerId, 'notification:document:access', notificationData);
      
      if (socketSuccess) {
        this.notificationStats.totalSent++;
        this.notificationStats.totalDelivered++;
      }
      
      return socketSuccess;
    } catch (error) {
      console.error('❌ Error sending document access notification:', error);
      this.notificationStats.totalFailed++;
      return false;
    }
  }

  /**
   * Send document request notification (when someone requests your document)
   */
  async sendDocumentRequestNotification(ownerId, requesterId, requesterName, documentType) {
    try {
      console.log(`📄 [NOTIFICATION] Document requested: ${documentType} by ${requesterName}`);
      
      const notificationData = {
        type: 'document_request',
        title: 'Document Request',
        body: `${requesterName} is requesting your ${documentType}`,
        data: {
          requesterId,
          requesterName,
          documentType,
          timestamp: new Date().toISOString()
        }
      };

      // Send WebSocket notification
      const socketSuccess = broadcastToUser(ownerId, 'notification:document:request', notificationData);
      
      if (socketSuccess) {
        this.notificationStats.totalSent++;
        this.notificationStats.totalDelivered++;
      }
      
      return socketSuccess;
    } catch (error) {
      console.error('❌ Error sending document request notification:', error);
      this.notificationStats.totalFailed++;
      return false;
    }
  }

  /**
   * Send document shared notification (when someone shares a document with you)
   */
  async sendDocumentSharedNotification(receiverId, senderId, senderName, documentType) {
    try {
      console.log(`📄 [NOTIFICATION] Document shared: ${documentType} by ${senderName}`);
      
      const notificationData = {
        type: 'document_shared',
        title: 'Document Shared',
        body: `${senderName} shared their ${documentType} with you`,
        data: {
          senderId,
          senderName,
          documentType,
          timestamp: new Date().toISOString()
        }
      };

      // Send WebSocket notification
      const socketSuccess = broadcastToUser(receiverId, 'notification:document:shared', notificationData);
      
      if (socketSuccess) {
        this.notificationStats.totalSent++;
        this.notificationStats.totalDelivered++;
      }
      
      return socketSuccess;
    } catch (error) {
      console.error('❌ Error sending document shared notification:', error);
      this.notificationStats.totalFailed++;
      return false;
    }
  }

  /**
   * Test notification system
   */
  async testNotificationSystem(userId) {
    try {
      console.log('🧪 Testing notification system for user:', userId);
      
      const testMessage = {
        _id: 'test_' + Date.now(),
        message: 'This is a test notification from the enhanced notification system!',
        messageType: 'text',
        timestamp: new Date().toISOString()
      };

      // Send test WebSocket notification
      const socketSuccess = broadcastToUser(userId, 'notification:test', {
        type: 'test',
        title: 'Test Notification',
        body: 'This is a test notification from the enhanced notification system (WebSocket only)!',
        timestamp: new Date().toISOString()
      });
      
      console.log('🧪 Test notification result:', socketSuccess ? 'SUCCESS' : 'FAILED');
      return socketSuccess;

    } catch (error) {
      console.error('❌ Error testing notification system:', error);
      return false;
    }
  }
}

module.exports = new EnhancedNotificationService();
