/**
 * Friend WebSocket Service
 * Handles real-time friend updates via WebSocket
 */

const socketManager = require('../socketManager');

class FriendWebSocketService {
  
  /**
   * Broadcast friend request to recipient
   * @param {String} recipientUserId - User receiving the request
   * @param {Object} requestData - Friend request data
   */
  broadcastFriendRequest(recipientUserId, requestData) {
    try {
      console.log(`📤 [FRIEND WS] Broadcasting friend request to ${recipientUserId}`);
      
      socketManager.broadcastToUser(recipientUserId, 'friend:request_received', {
        requestId: requestData.requestId,
        fromUserId: requestData.userId,
        fromName: requestData.cachedData?.name || 'Unknown',
        fromProfileImage: requestData.cachedData?.profileImage || '',
        fromUsername: requestData.cachedData?.username || '',
        message: requestData.requestMetadata?.requestMessage || '',
        mutualFriends: requestData.requestMetadata?.mutualFriends || [],
        timestamp: new Date().toISOString()
      });
      
      console.log(`✅ [FRIEND WS] Friend request broadcast sent`);
    } catch (error) {
      console.error(`❌ [FRIEND WS] Error broadcasting friend request:`, error);
    }
  }
  
  /**
   * Broadcast friend request accepted
   * @param {String} requesterUserId - User who sent the original request
   * @param {Object} acceptData - Acceptance data
   */
  broadcastFriendAccepted(requesterUserId, acceptData) {
    try {
      console.log(`✅ [FRIEND WS] Broadcasting friend accepted to ${requesterUserId}`);
      
      socketManager.broadcastToUser(requesterUserId, 'friend:request_accepted', {
        friendUserId: acceptData.friendUserId,
        friendName: acceptData.cachedData?.name || 'Unknown',
        friendProfileImage: acceptData.cachedData?.profileImage || '',
        friendUsername: acceptData.cachedData?.username || '',
        acceptedAt: acceptData.acceptedAt,
        timestamp: new Date().toISOString()
      });
      
      console.log(`✅ [FRIEND WS] Friend accepted broadcast sent`);
    } catch (error) {
      console.error(`❌ [FRIEND WS] Error broadcasting friend accepted:`, error);
    }
  }
  
  /**
   * Broadcast friend request rejected
   * @param {String} requesterUserId - User who sent the original request
   * @param {String} rejectedByUserId - User who rejected
   */
  broadcastFriendRejected(requesterUserId, rejectedByUserId) {
    try {
      console.log(`❌ [FRIEND WS] Broadcasting friend rejected to ${requesterUserId}`);
      
      socketManager.broadcastToUser(requesterUserId, 'friend:request_rejected', {
        rejectedByUserId,
        timestamp: new Date().toISOString()
      });
      
      console.log(`✅ [FRIEND WS] Friend rejected broadcast sent`);
    } catch (error) {
      console.error(`❌ [FRIEND WS] Error broadcasting friend rejected:`, error);
    }
  }
  
  /**
   * Broadcast friend removed
   * @param {String} friendUserId - User who was removed
   * @param {String} removedByUserId - User who removed the friend
   */
  broadcastFriendRemoved(friendUserId, removedByUserId) {
    try {
      console.log(`🗑️ [FRIEND WS] Broadcasting friend removed to ${friendUserId}`);
      
      socketManager.broadcastToUser(friendUserId, 'friend:removed', {
        removedByUserId,
        timestamp: new Date().toISOString()
      });
      
      console.log(`✅ [FRIEND WS] Friend removed broadcast sent`);
    } catch (error) {
      console.error(`❌ [FRIEND WS] Error broadcasting friend removed:`, error);
    }
  }
  
  /**
   * Broadcast user blocked
   * @param {String} blockedUserId - User who was blocked
   * @param {String} blockedByUserId - User who blocked
   */
  broadcastUserBlocked(blockedUserId, blockedByUserId) {
    try {
      console.log(`🚫 [FRIEND WS] Broadcasting user blocked to ${blockedUserId}`);
      
      socketManager.broadcastToUser(blockedUserId, 'friend:blocked', {
        blockedByUserId,
        timestamp: new Date().toISOString()
      });
      
      console.log(`✅ [FRIEND WS] User blocked broadcast sent`);
    } catch (error) {
      console.error(`❌ [FRIEND WS] Error broadcasting user blocked:`, error);
    }
  }
  
  /**
   * Broadcast new friend from device sync
   * @param {String} userId - User who got a new friend
   * @param {Object} friendData - New friend data
   */
  broadcastNewFriendFromSync(userId, friendData) {
    try {
      console.log(`📱 [FRIEND WS] Broadcasting new friend from sync to ${userId}`);
      
      socketManager.broadcastToUser(userId, 'friend:new_from_sync', {
        friendUserId: friendData.friendUserId,
        friendName: friendData.name,
        friendProfileImage: friendData.profileImage || '',
        friendUsername: friendData.username || '',
        phoneNumber: friendData.phoneNumber,
        timestamp: new Date().toISOString()
      });
      
      console.log(`✅ [FRIEND WS] New friend from sync broadcast sent`);
    } catch (error) {
      console.error(`❌ [FRIEND WS] Error broadcasting new friend from sync:`, error);
    }
  }
  
  /**
   * Broadcast friend cache updated
   * @param {String} userId - User whose friend cache was updated
   * @param {Object} friendData - Updated friend data
   */
  broadcastFriendCacheUpdated(userId, friendData) {
    try {
      console.log(`🔄 [FRIEND WS] Broadcasting friend cache updated to ${userId}`);
      
      socketManager.broadcastToUser(userId, 'friend:cache_updated', {
        friendUserId: friendData.friendUserId,
        friendName: friendData.name,
        friendProfileImage: friendData.profileImage || '',
        friendUsername: friendData.username || '',
        isOnline: friendData.isOnline,
        lastSeen: friendData.lastSeen,
        timestamp: new Date().toISOString()
      });
      
      console.log(`✅ [FRIEND WS] Friend cache updated broadcast sent`);
    } catch (error) {
      console.error(`❌ [FRIEND WS] Error broadcasting friend cache updated:`, error);
    }
  }
  
  /**
   * Broadcast friend list updated (general update)
   * @param {String} userId - User whose friend list was updated
   * @param {Object} updateData - Update metadata
   */
  broadcastFriendListUpdated(userId, updateData) {
    try {
      console.log(`🔄 [FRIEND WS] Broadcasting friend list updated to ${userId}`);
      
      socketManager.broadcastToUser(userId, 'friend:list_updated', {
        action: updateData.action, // 'added', 'removed', 'synced'
        count: updateData.count,
        timestamp: new Date().toISOString()
      });
      
      console.log(`✅ [FRIEND WS] Friend list updated broadcast sent`);
    } catch (error) {
      console.error(`❌ [FRIEND WS] Error broadcasting friend list updated:`, error);
    }
  }
}

module.exports = new FriendWebSocketService();
