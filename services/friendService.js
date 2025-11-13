const Friend = require('../models/Friend');
const User = require('../models/userModel');
const friendWebSocketService = require('./friendWebSocketService');

/**
 * FriendService - Business logic for friendship management
 * Provides persistent, reliable friend list management
 */
class FriendService {
  
  /**
   * Get all friends for a user
   * @param {String} userId - User ID
   * @param {Object} options - Query options
   * @returns {Array} Friends with cached data
   */
  async getFriends(userId, options = {}) {
    try {
      console.log(`👥 [FRIEND SERVICE] Getting friends for user: ${userId}`);
      console.log(`👥 [FRIEND SERVICE] Options:`, JSON.stringify(options, null, 2));
      
      const friends = await Friend.getFriends(userId, options);
      
      console.log(`✅ [FRIEND SERVICE] Found ${friends.length} friends`);
      
      // Log each friend for debugging
      friends.forEach((friend, index) => {
        console.log(`  Friend ${index + 1}: friendUserId=${friend.friendUserId}, name=${friend.cachedData?.name || 'NO NAME'}, status=${friend.status}, source=${friend.source}, isDeviceContact=${friend.isDeviceContact}`);
      });
      
      // Return formatted friend list with cached data
      return friends.map(friend => ({
        friendUserId: friend.friendUserId,
        name: friend.cachedData.name,
        profileImage: friend.cachedData.profileImage,
        username: friend.cachedData.username,
        isOnline: friend.cachedData.isOnline,
        lastSeen: friend.cachedData.lastSeen,
        source: friend.source,
        status: friend.status,
        addedAt: friend.addedAt,
        isDeviceContact: friend.isDeviceContact,
        phoneNumber: friend.phoneNumber,
        settings: friend.settings,
        interactions: friend.interactions
      }));
    } catch (error) {
      console.error('❌ [FRIEND SERVICE] Error getting friends:', error);
      throw new Error(`Failed to get friends: ${error.message}`);
    }
  }
  
  /**
   * Get friend requests (pending friendships)
   * @param {String} userId - User ID
   * @param {String} type - 'received' or 'sent'
   * @returns {Array} Friend requests
   */
  async getFriendRequests(userId, type = 'received') {
    try {
      console.log(`📬 [FRIEND SERVICE] Getting ${type} friend requests for user: ${userId}`);
      
      const requests = await Friend.getFriendRequests(userId, type);
      
      // Populate cached data if missing
      const populatedRequests = await Promise.all(
        requests.map(async (request) => {
          const targetUserId = type === 'received' ? request.userId : request.friendUserId;
          
          // If cache is stale or missing, refresh it
          if (!request.cachedData.name || this.isCacheStale(request.cachedData.lastCacheUpdate)) {
            const user = await User.findOne({ userId: targetUserId }).select('name profileImage username').lean();
            if (user) {
              request.cachedData = {
                name: user.name,
                profileImage: user.profileImage || '',
                username: user.username || '',
                lastCacheUpdate: new Date()
              };
              
              // Update in database
              await Friend.updateOne(
                { _id: request._id },
                { $set: { cachedData: request.cachedData } }
              );
            }
          }
          
          return {
            requestId: request._id.toString(),
            userId: request.userId,
            friendUserId: request.friendUserId,
            name: request.cachedData.name,
            profileImage: request.cachedData.profileImage,
            username: request.cachedData.username,
            requestMessage: request.requestMetadata?.requestMessage || '',
            mutualFriends: request.requestMetadata?.mutualFriends || [],
            addedAt: request.addedAt,
            source: request.source
          };
        })
      );
      
      console.log(`✅ [FRIEND SERVICE] Found ${populatedRequests.length} ${type} requests`);
      
      return populatedRequests;
    } catch (error) {
      console.error('❌ [FRIEND SERVICE] Error getting friend requests:', error);
      throw new Error(`Failed to get friend requests: ${error.message}`);
    }
  }
  
  /**
   * Send friend request
   * @param {String} userId - Requesting user ID
   * @param {String} friendUserId - Target user ID
   * @param {Object} metadata - Request metadata
   * @returns {Object} Created friend request
   */
  async sendFriendRequest(userId, friendUserId, metadata = {}) {
    try {
      console.log(`📤 [FRIEND SERVICE] Sending friend request from ${userId} to ${friendUserId}`);
      
      // Validate users exist
      const [user, friendUser] = await Promise.all([
        User.findOne({ userId }).select('name profileImage username'),
        User.findOne({ userId: friendUserId }).select('name profileImage username')
      ]);
      
      if (!user) {
        throw new Error('User not found');
      }
      
      if (!friendUser) {
        throw new Error('Friend user not found');
      }
      
      // Check if friendship already exists
      const existingFriendship = await Friend.findOne({
        userId,
        friendUserId,
        isDeleted: false
      });
      
      if (existingFriendship) {
        if (existingFriendship.status === 'accepted') {
          throw new Error('Already friends');
        } else if (existingFriendship.status === 'pending') {
          throw new Error('Friend request already sent');
        } else if (existingFriendship.status === 'blocked') {
          throw new Error('Cannot send friend request to blocked user');
        }
      }
      
      // Check for mutual friends
      const mutualFriends = await Friend.getMutualFriends(userId, friendUserId);
      
      // Create friend request
      const friendRequest = new Friend({
        userId,
        friendUserId,
        source: metadata.source || 'app_search',
        status: 'pending',
        isDeviceContact: false,
        cachedData: {
          name: friendUser.name,
          profileImage: friendUser.profileImage || '',
          username: friendUser.username || '',
          lastCacheUpdate: new Date()
        },
        requestMetadata: {
          requestedBy: userId,
          requestMessage: metadata.message || '',
          mutualFriends
        }
      });
      
      await friendRequest.save();
      
      console.log(`✅ [FRIEND SERVICE] Friend request created: ${friendRequest._id}`);
      
      // Broadcast to recipient via WebSocket
      friendWebSocketService.broadcastFriendRequest(friendUserId, friendRequest);
      
      return {
        requestId: friendRequest._id.toString(),
        userId,
        friendUserId,
        status: 'pending',
        addedAt: friendRequest.addedAt,
        mutualFriends
      };
    } catch (error) {
      console.error('❌ [FRIEND SERVICE] Error sending friend request:', error);
      throw new Error(`Failed to send friend request: ${error.message}`);
    }
  }
  
  /**
   * Accept friend request
   * @param {String} requestId - Friend request ID
   * @param {String} userId - User accepting the request
   * @returns {Object} Updated friendship
   */
  async acceptFriendRequest(requestId, userId) {
    try {
      console.log(`✅ [FRIEND SERVICE] Accepting friend request: ${requestId} by user: ${userId}`);
      
      // Find the friend request
      const friendRequest = await Friend.findById(requestId);
      
      if (!friendRequest) {
        throw new Error('Friend request not found');
      }
      
      // Verify this user is the recipient
      if (friendRequest.friendUserId !== userId) {
        throw new Error('Unauthorized to accept this request');
      }
      
      if (friendRequest.status !== 'pending') {
        throw new Error('Friend request is not pending');
      }
      
      // Get accepter's data to update cache in original request
      const accepter = await User.findOne({ userId: friendRequest.friendUserId })
        .select('name profileImage username');
      
      if (!accepter) {
        throw new Error('Accepter user not found');
      }
      
      // Update cached data in the original request with fresh accepter info
      friendRequest.cachedData = {
        name: accepter.name,
        profileImage: accepter.profileImage || '',
        username: accepter.username || '',
        lastCacheUpdate: new Date()
      };
      
      // Accept the request
      await friendRequest.accept();
      
      console.log(`✅ [FRIEND SERVICE] Original request updated: userId=${friendRequest.userId}, friendUserId=${friendRequest.friendUserId}, status=${friendRequest.status}`);
      
      // Create reciprocal friendship (both users are now friends)
      const reciprocalFriendship = await Friend.findOne({
        userId: friendRequest.friendUserId,
        friendUserId: friendRequest.userId,
        isDeleted: false
      });
      
      if (!reciprocalFriendship) {
        // Get requester data for cache
        const requester = await User.findOne({ userId: friendRequest.userId })
          .select('name profileImage username');
        
        if (!requester) {
          throw new Error('Requester user not found');
        }
        
        const newReciprocal = new Friend({
          userId: friendRequest.friendUserId,
          friendUserId: friendRequest.userId,
          source: friendRequest.source,
          status: 'accepted',
          acceptedAt: new Date(),
          isDeviceContact: false,
          cachedData: {
            name: requester.name,
            profileImage: requester.profileImage || '',
            username: requester.username || '',
            lastCacheUpdate: new Date()
          }
        });
        
        await newReciprocal.save();
        console.log(`✅ [FRIEND SERVICE] Created reciprocal friendship for user: ${friendRequest.friendUserId}`);
      } else {
        reciprocalFriendship.status = 'accepted';
        reciprocalFriendship.acceptedAt = new Date();
        await reciprocalFriendship.save();
        console.log(`✅ [FRIEND SERVICE] Updated existing reciprocal friendship`);
      }
      
      console.log(`✅ [FRIEND SERVICE] Friend request accepted successfully`);
      
      // Broadcast to requester via WebSocket
      friendWebSocketService.broadcastFriendAccepted(friendRequest.userId, friendRequest);
      
      // Broadcast friend list updated to both users
      friendWebSocketService.broadcastFriendListUpdated(friendRequest.userId, {
        action: 'added',
        count: 1
      });
      friendWebSocketService.broadcastFriendListUpdated(friendRequest.friendUserId, {
        action: 'added',
        count: 1
      });
      
      return {
        requestId: friendRequest._id.toString(),
        userId: friendRequest.userId,
        friendUserId: friendRequest.friendUserId,
        status: 'accepted',
        acceptedAt: friendRequest.acceptedAt
      };
    } catch (error) {
      console.error('❌ [FRIEND SERVICE] Error accepting friend request:', error);
      throw new Error(`Failed to accept friend request: ${error.message}`);
    }
  }
  
  /**
   * Reject friend request
   * @param {String} requestId - Friend request ID
   * @param {String} userId - User rejecting the request
   * @returns {Object} Result
   */
  async rejectFriendRequest(requestId, userId) {
    try {
      console.log(`❌ [FRIEND SERVICE] Rejecting friend request: ${requestId} by user: ${userId}`);
      
      const friendRequest = await Friend.findById(requestId);
      
      if (!friendRequest) {
        throw new Error('Friend request not found');
      }
      
      // Verify this user is the recipient
      if (friendRequest.friendUserId !== userId) {
        throw new Error('Unauthorized to reject this request');
      }
      
      if (friendRequest.status !== 'pending') {
        throw new Error('Friend request is not pending');
      }
      
      // Soft delete the request
      await friendRequest.remove();
      
      console.log(`✅ [FRIEND SERVICE] Friend request rejected successfully`);
      
      return {
        requestId: friendRequest._id.toString(),
        status: 'rejected'
      };
    } catch (error) {
      console.error('❌ [FRIEND SERVICE] Error rejecting friend request:', error);
      throw new Error(`Failed to reject friend request: ${error.message}`);
    }
  }
  
  /**
   * Remove friend
   * @param {String} userId - User ID
   * @param {String} friendUserId - Friend to remove
   * @returns {Object} Result
   */
  async removeFriend(userId, friendUserId) {
    try {
      console.log(`🗑️ [FRIEND SERVICE] Removing friend ${friendUserId} for user ${userId}`);
      
      // Find and remove both directions of friendship
      const friendships = await Friend.find({
        $or: [
          { userId, friendUserId },
          { userId: friendUserId, friendUserId: userId }
        ],
        isDeleted: false
      });
      
      if (friendships.length === 0) {
        throw new Error('Friendship not found');
      }
      
      // Soft delete all friendship records
      await Promise.all(friendships.map(f => f.remove()));
      
      console.log(`✅ [FRIEND SERVICE] Friend removed successfully`);
      
      return {
        userId,
        friendUserId,
        status: 'removed',
        removedAt: new Date()
      };
    } catch (error) {
      console.error('❌ [FRIEND SERVICE] Error removing friend:', error);
      throw new Error(`Failed to remove friend: ${error.message}`);
    }
  }
  
  /**
   * Block user
   * @param {String} userId - User ID
   * @param {String} blockedUserId - User to block
   * @returns {Object} Result
   */
  async blockUser(userId, blockedUserId) {
    try {
      console.log(`🚫 [FRIEND SERVICE] Blocking user ${blockedUserId} for user ${userId}`);
      
      // Find existing friendship
      let friendship = await Friend.findOne({
        userId,
        friendUserId: blockedUserId,
        isDeleted: false
      });
      
      if (friendship) {
        await friendship.block();
      } else {
        // Create new blocked relationship
        const blockedUser = await User.findOne({ userId: blockedUserId })
          .select('name profileImage username');
        
        friendship = new Friend({
          userId,
          friendUserId: blockedUserId,
          source: 'app_search',
          status: 'blocked',
          blockedAt: new Date(),
          isDeviceContact: false,
          cachedData: {
            name: blockedUser?.name || '',
            profileImage: blockedUser?.profileImage || '',
            username: blockedUser?.username || '',
            lastCacheUpdate: new Date()
          }
        });
        
        await friendship.save();
      }
      
      console.log(`✅ [FRIEND SERVICE] User blocked successfully`);
      
      return {
        userId,
        blockedUserId,
        status: 'blocked',
        blockedAt: friendship.blockedAt
      };
    } catch (error) {
      console.error('❌ [FRIEND SERVICE] Error blocking user:', error);
      throw new Error(`Failed to block user: ${error.message}`);
    }
  }
  
  /**
   * Unblock user
   * @param {String} userId - User ID
   * @param {String} blockedUserId - User to unblock
   * @returns {Object} Result
   */
  async unblockUser(userId, blockedUserId) {
    try {
      console.log(`✅ [FRIEND SERVICE] Unblocking user ${blockedUserId} for user ${userId}`);
      
      const friendship = await Friend.findOne({
        userId,
        friendUserId: blockedUserId,
        status: 'blocked',
        isDeleted: false
      });
      
      if (!friendship) {
        throw new Error('Blocked relationship not found');
      }
      
      // Remove the blocked relationship
      await friendship.remove();
      
      console.log(`✅ [FRIEND SERVICE] User unblocked successfully`);
      
      return {
        userId,
        blockedUserId,
        status: 'unblocked'
      };
    } catch (error) {
      console.error('❌ [FRIEND SERVICE] Error unblocking user:', error);
      throw new Error(`Failed to unblock user: ${error.message}`);
    }
  }
  
  /**
   * Sync device contacts
   * Creates friendships for registered contacts
   * @param {String} userId - User ID
   * @param {Array} phoneNumbers - Array of phone numbers from device
   * @returns {Object} Sync results
   */
  async syncDeviceContacts(userId, phoneNumbers) {
    try {
      console.log(`📱 [FRIEND SERVICE] Syncing ${phoneNumbers.length} device contacts for user: ${userId}`);
      
      if (!phoneNumbers || phoneNumbers.length === 0) {
        return { newFriends: [], removedContacts: [], totalFriends: 0 };
      }
      
      // Find registered users from phone numbers
      const registeredUsers = await User.find({
        phoneNumber: { $in: phoneNumbers },
        userId: { $ne: userId } // Exclude self
      }).select('userId name phoneNumber profileImage username').lean();
      
      console.log(`📱 [FRIEND SERVICE] Found ${registeredUsers.length} registered users`);
      
      const newFriends = [];
      const now = new Date();
      
      // Create or update friendships for registered contacts
      for (const registeredUser of registeredUsers) {
        const existingFriendship = await Friend.findOne({
          userId,
          friendUserId: registeredUser.userId,
          isDeleted: false
        });
        
        if (existingFriendship) {
          // Update existing friendship
          existingFriendship.isDeviceContact = true;
          existingFriendship.lastDeviceSync = now;
          existingFriendship.phoneNumber = registeredUser.phoneNumber;
          
          // Update cache
          await existingFriendship.updateCache({
            name: registeredUser.name,
            profileImage: registeredUser.profileImage,
            username: registeredUser.username
          });
          
          console.log(`🔄 [FRIEND SERVICE] Updated existing friendship with ${registeredUser.userId}`);
        } else {
          // Create new friendship (auto-accepted for device contacts)
          const newFriendship = new Friend({
            userId,
            friendUserId: registeredUser.userId,
            source: 'device_contact',
            status: 'accepted',
            acceptedAt: now,
            isDeviceContact: true,
            phoneNumber: registeredUser.phoneNumber,
            lastDeviceSync: now,
            cachedData: {
              name: registeredUser.name,
              profileImage: registeredUser.profileImage || '',
              username: registeredUser.username || '',
              lastCacheUpdate: now
            }
          });
          
          await newFriendship.save();
          
          // Create reciprocal friendship
          const reciprocalFriendship = new Friend({
            userId: registeredUser.userId,
            friendUserId: userId,
            source: 'device_contact',
            status: 'accepted',
            acceptedAt: now,
            isDeviceContact: true,
            phoneNumber: registeredUser.phoneNumber,
            lastDeviceSync: now,
            cachedData: {
              name: registeredUser.name,
              profileImage: registeredUser.profileImage || '',
              username: registeredUser.username || '',
              lastCacheUpdate: now
            }
          });
          
          await reciprocalFriendship.save();
          
          newFriends.push({
            friendUserId: registeredUser.userId,
            name: registeredUser.name,
            phoneNumber: registeredUser.phoneNumber,
            profileImage: registeredUser.profileImage,
            username: registeredUser.username
          });
          
          console.log(`✅ [FRIEND SERVICE] Created new friendship with ${registeredUser.userId}`);
        }
      }
      
      // Mark contacts that are no longer in device contacts
      const registeredUserIds = registeredUsers.map(u => u.userId);
      const removedContacts = await Friend.updateMany(
        {
          userId,
          isDeviceContact: true,
          friendUserId: { $nin: registeredUserIds },
          isDeleted: false
        },
        {
          $set: {
            isDeviceContact: false,
            lastDeviceSync: now
          }
        }
      );
      
      // Get total friend count
      const totalFriends = await Friend.countDocuments({
        userId,
        status: 'accepted',
        isDeleted: false
      });
      
      console.log(`✅ [FRIEND SERVICE] Sync complete: ${newFriends.length} new, ${removedContacts.modifiedCount} removed, ${totalFriends} total`);
      
      // Broadcast new friends via WebSocket
      for (const newFriend of newFriends) {
        friendWebSocketService.broadcastNewFriendFromSync(userId, newFriend);
      }
      
      // Broadcast friend list updated
      if (newFriends.length > 0 || removedContacts.modifiedCount > 0) {
        friendWebSocketService.broadcastFriendListUpdated(userId, {
          action: 'synced',
          count: totalFriends
        });
      }
      
      return {
        newFriends,
        removedContacts: removedContacts.modifiedCount,
        totalFriends
      };
    } catch (error) {
      console.error('❌ [FRIEND SERVICE] Error syncing device contacts:', error);
      throw new Error(`Failed to sync device contacts: ${error.message}`);
    }
  }
  
  /**
   * Search for users to add as friends
   * @param {String} userId - Searching user ID
   * @param {String} query - Search query (username, name, or phone)
   * @param {Number} limit - Result limit
   * @returns {Array} Search results
   */
  async searchUsers(userId, query, limit = 20) {
    try {
      console.log(`🔍 [FRIEND SERVICE] Searching users: "${query}" for user: ${userId}`);
      
      // Get current friends to exclude from results
      const currentFriends = await Friend.find({
        userId,
        status: { $in: ['accepted', 'pending'] },
        isDeleted: false
      }).distinct('friendUserId');
      
      // Search users by username, name, or phone
      const users = await User.find({
        $and: [
          { userId: { $ne: userId, $nin: currentFriends } }, // Exclude self and current friends
          {
            $or: [
              { username: new RegExp(query, 'i') },
              { name: new RegExp(query, 'i') },
              { phoneNumber: query }
            ]
          }
        ]
      })
      .select('userId name username profileImage phoneNumber')
      .limit(limit)
      .lean();
      
      // Get mutual friends for each result
      const results = await Promise.all(
        users.map(async (user) => {
          const mutualFriends = await Friend.getMutualFriends(userId, user.userId);
          
          return {
            userId: user.userId,
            name: user.name,
            username: user.username,
            profileImage: user.profileImage || '',
            phoneNumber: user.phoneNumber,
            mutualFriendsCount: mutualFriends.length
          };
        })
      );
      
      console.log(`✅ [FRIEND SERVICE] Found ${results.length} users`);
      
      return results;
    } catch (error) {
      console.error('❌ [FRIEND SERVICE] Error searching users:', error);
      throw new Error(`Failed to search users: ${error.message}`);
    }
  }
  
  /**
   * Get mutual friends between two users
   * @param {String} userId1 - First user ID
   * @param {String} userId2 - Second user ID
   * @returns {Array} Mutual friends
   */
  async getMutualFriends(userId1, userId2) {
    try {
      console.log(`🤝 [FRIEND SERVICE] Getting mutual friends for ${userId1} and ${userId2}`);
      
      const mutualFriendIds = await Friend.getMutualFriends(userId1, userId2);
      
      // Get user details for mutual friends
      const mutualFriends = await User.find({
        userId: { $in: mutualFriendIds }
      }).select('userId name profileImage username').lean();
      
      console.log(`✅ [FRIEND SERVICE] Found ${mutualFriends.length} mutual friends`);
      
      return mutualFriends;
    } catch (error) {
      console.error('❌ [FRIEND SERVICE] Error getting mutual friends:', error);
      throw new Error(`Failed to get mutual friends: ${error.message}`);
    }
  }
  
  /**
   * Update friend settings
   * @param {String} userId - User ID
   * @param {String} friendUserId - Friend user ID
   * @param {Object} settings - Settings to update
   * @returns {Object} Updated friendship
   */
  async updateFriendSettings(userId, friendUserId, settings) {
    try {
      console.log(`⚙️ [FRIEND SERVICE] Updating settings for friend ${friendUserId}`);
      
      const friendship = await Friend.findOne({
        userId,
        friendUserId,
        isDeleted: false
      });
      
      if (!friendship) {
        throw new Error('Friendship not found');
      }
      
      // Update settings
      friendship.settings = {
        ...friendship.settings,
        ...settings
      };
      
      await friendship.save();
      
      console.log(`✅ [FRIEND SERVICE] Settings updated successfully`);
      
      return {
        friendUserId,
        settings: friendship.settings
      };
    } catch (error) {
      console.error('❌ [FRIEND SERVICE] Error updating friend settings:', error);
      throw new Error(`Failed to update friend settings: ${error.message}`);
    }
  }
  
  /**
   * Check if cache is stale (older than 24 hours)
   * @param {Date} lastUpdate - Last cache update time
   * @returns {Boolean} Is stale
   */
  isCacheStale(lastUpdate) {
    if (!lastUpdate) return true;
    const hoursSinceUpdate = (Date.now() - new Date(lastUpdate).getTime()) / (1000 * 60 * 60);
    return hoursSinceUpdate > 24;
  }
  
  /**
   * Refresh cached data for all friends
   * @param {String} userId - User ID
   * @returns {Object} Refresh results
   */
  async refreshFriendCache(userId) {
    try {
      console.log(`🔄 [FRIEND SERVICE] Refreshing friend cache for user: ${userId}`);
      
      const friends = await Friend.find({
        userId,
        status: 'accepted',
        isDeleted: false
      });
      
      let updated = 0;
      
      for (const friend of friends) {
        if (this.isCacheStale(friend.cachedData.lastCacheUpdate)) {
          const user = await User.findOne({ userId: friend.friendUserId })
            .select('name profileImage username').lean();
          
          if (user) {
            await friend.updateCache(user);
            updated++;
          }
        }
      }
      
      console.log(`✅ [FRIEND SERVICE] Refreshed ${updated} friend caches`);
      
      return { updated, total: friends.length };
    } catch (error) {
      console.error('❌ [FRIEND SERVICE] Error refreshing friend cache:', error);
      throw new Error(`Failed to refresh friend cache: ${error.message}`);
    }
  }
}

module.exports = new FriendService();
