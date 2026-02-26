const LocationSettings = require('../models/LocationSettings');
const User = require('../models/userModel');

let cleanupInterval = null;

/**
 * Cleanup expired location sharing sessions and notify friends
 */
const cleanupExpiredSessions = async () => {
  try {
    console.log('🧹 [LOCATION SHARING CLEANUP] Starting cleanup of expired sessions...');
    
    const now = new Date();
    
    // Find all users with expired sessions
    const usersWithExpiredSessions = await LocationSettings.find({
      'activeSessions.expiresAt': { $lt: now },
      'activeSessions.isActive': true
    }).populate('userId', 'userId name')
      .populate('activeSessions.friendId', 'userId name');
    
    if (usersWithExpiredSessions.length === 0) {
      console.log('✅ [LOCATION SHARING CLEANUP] No expired sessions found');
      return;
    }
    
    console.log(`🔍 [LOCATION SHARING CLEANUP] Found ${usersWithExpiredSessions.length} users with expired sessions`);
    
    let totalExpiredSessions = 0;
    let notificationsSent = 0;
    
    for (const settings of usersWithExpiredSessions) {
      const expiredSessions = settings.activeSessions.filter(
        s => s.isActive && new Date(s.expiresAt) < now
      );
      
      if (expiredSessions.length === 0) continue;
      
      totalExpiredSessions += expiredSessions.length;
      
      // Get socket.io instance and userSockets map
      const io = global.io;
      const userSockets = global.userSockets;
      
      // Notify each friend that the session expired
      for (const session of expiredSessions) {
        const friendId = session.friendId.userId; // UUID
        const userId = settings.userId.userId; // UUID
        const userName = settings.userId.name;
        
        console.log(`⏰ [LOCATION SHARING CLEANUP] Session expired: ${userName} → ${session.friendId.name}`);
        
        // Mark session as inactive
        session.isActive = false;
        
        // Notify friend via WebSocket
        if (io && userSockets) {
          const friendSocket = userSockets.get(friendId);
          if (friendSocket) {
            friendSocket.emit('location_sharing_stopped', {
              userId: userId,
              userName: userName,
              timestamp: new Date().toISOString(),
              reason: 'expired'
            });
            notificationsSent++;
            console.log(`✅ [LOCATION SHARING CLEANUP] Notified ${session.friendId.name} that sharing expired`);
          } else {
            console.log(`⚠️ [LOCATION SHARING CLEANUP] Friend ${session.friendId.name} not connected`);
          }
        }
      }
      
      // Save updated settings
      await settings.save();
    }
    
    console.log(`✅ [LOCATION SHARING CLEANUP] Cleaned up ${totalExpiredSessions} expired sessions`);
    console.log(`📡 [LOCATION SHARING CLEANUP] Sent ${notificationsSent} notifications`);
    
  } catch (error) {
    console.error('❌ [LOCATION SHARING CLEANUP] Error during cleanup:', error);
  }
};

/**
 * Start the cleanup scheduler
 * Runs every 1 minute to check for expired sessions
 */
const start = () => {
  if (cleanupInterval) {
    console.log('⚠️ [LOCATION SHARING CLEANUP] Scheduler already running');
    return;
  }
  
  // Run immediately on start
  cleanupExpiredSessions();
  
  // Run every 1 minute (60 seconds)
  cleanupInterval = setInterval(cleanupExpiredSessions, 60 * 1000);
  
  console.log('✅ [LOCATION SHARING CLEANUP] Scheduler started (runs every 1 minute)');
};

/**
 * Stop the cleanup scheduler
 */
const stop = () => {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log('✅ [LOCATION SHARING CLEANUP] Scheduler stopped');
  }
};

module.exports = {
  start,
  stop,
  cleanupExpiredSessions,
  cleanup: cleanupExpiredSessions // Alias for masterScheduler compatibility
};
