const Message = require('../models/Message');

let cleanupInterval = null;

/**
 * Message Cleanup Scheduler
 * Automatically deletes expired timer mode messages and notifies users via socket
 */
const messageCleanupScheduler = {
  /**
   * Start the cleanup scheduler
   */
  start() {
    console.log('⏳ [MESSAGE CLEANUP] Starting message cleanup scheduler...');
    
    // Run cleanup every 60 seconds
    cleanupInterval = setInterval(async () => {
      try {
        await this.cleanupExpiredMessages();
      } catch (error) {
        console.error('❌ [MESSAGE CLEANUP] Error in cleanup scheduler:', error);
      }
    }, 60000); // Run every 60 seconds
    
    // Run initial cleanup immediately
    this.cleanupExpiredMessages();
    
    console.log('✅ [MESSAGE CLEANUP] Scheduler started (runs every 60 seconds)');
  },

  /**
   * Stop the cleanup scheduler
   */
  stop() {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
      console.log('⏳ [MESSAGE CLEANUP] Scheduler stopped');
    }
  },

  /**
   * Clean up expired timer mode messages
   */
  async cleanupExpiredMessages() {
    try {
      const now = new Date();
      
      // Find all expired timer mode messages
      const expiredMessages = await Message.find({
        privacyMode: 'timer',
        expiresAt: { $lte: now }
      }).select('_id senderId receiverId message expiresAt');
      
      if (expiredMessages.length === 0) {
        // No expired messages
        return;
      }
      
      console.log(`⏳ [MESSAGE CLEANUP] Found ${expiredMessages.length} expired messages`);
      
      // Announcements go to the two people in the chat only (see below); no socket gate needed.
      const { broadcastToUser } = require('../socketManager');

      // Delete messages and notify users
      for (const message of expiredMessages) {
        try {
          // Delete from database
          await Message.deleteOne({ _id: message._id });
          
          console.log(`🗑️ [MESSAGE CLEANUP] Deleted expired message ${message._id}`);
          console.log(`   - Sender: ${message.senderId}`);
          console.log(`   - Receiver: ${message.receiverId}`);
          console.log(`   - Expired at: ${message.expiresAt}`);
          
          // Notify both sender and receiver via socket
          const notificationData = {
            messageId: message._id.toString(),
            senderId: message.senderId,
            receiverId: message.receiverId,
            reason: 'timer_expired',
            timestamp: new Date().toISOString()
          };
          
          console.log(`📡 [MESSAGE CLEANUP] Notifying users about expired message:`);
          console.log(`   - Sender: ${message.senderId}`);
          console.log(`   - Receiver: ${message.receiverId}`);
          console.log(`   - Message ID: ${message._id}`);
          
          // Only the two people in the chat hear about it. io.emit would reach every connected user.
          broadcastToUser(message.senderId, 'message:expired', notificationData);
          broadcastToUser(message.receiverId, 'message:expired', notificationData);
          
          console.log('Told both participants (message:expired)');
          
        } catch (deleteError) {
          console.error(`❌ [MESSAGE CLEANUP] Error deleting message ${message._id}:`, deleteError);
        }
      }
      
      console.log(`✅ [MESSAGE CLEANUP] Cleanup complete. Deleted ${expiredMessages.length} messages`);
      
    } catch (error) {
      console.error('❌ [MESSAGE CLEANUP] Error in cleanupExpiredMessages:', error);
    }
  },

  /**
   * Manually trigger cleanup (for testing)
   */
  async triggerCleanup() {
    console.log('🔧 [MESSAGE CLEANUP] Manual cleanup triggered');
    await this.cleanupExpiredMessages();
  }
};

module.exports = messageCleanupScheduler;
