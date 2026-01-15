const Friend = require('../models/Friend');
const User = require('../models/userModel');
const Block = require('../models/blockModel');
const friendWebSocketService = require('./friendWebSocketService');
const { createPhoneNumberQuery } = require('../utils/phoneNormalization');

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
      
      console.log(`✅ [FRIEND SERVICE] Found ${friends.length} friends (before block filter)`);
      
      // Get list of blocked users to exclude them from friends list
      const blockedUsers = await Block.find({ blockerId: userId }).select('blockedUserId').lean();
      const blockedUserIds = new Set(blockedUsers.map(b => b.blockedUserId));
      
      // Filter out blocked users
      const filteredFriends = friends.filter(friend => {
        const isBlocked = blockedUserIds.has(friend.friendUserId);
        if (isBlocked) {
          console.log(`🚫 [FRIEND SERVICE] Excluding blocked user: ${friend.friendUserId}`);
        }
        return !isBlocked;
      });
      
      console.log(`✅ [FRIEND SERVICE] Returning ${filteredFriends.length} friends (after excluding ${blockedUserIds.size} blocked users)`);
      
      // Log each friend for debugging
      filteredFriends.forEach((friend, index) => {
        console.log(`  Friend ${index + 1}: friendUserId=${friend.friendUserId}, name=${friend.cachedData?.name || 'NO NAME'}, status=${friend.status}, source=${friend.source}, isDeviceContact=${friend.isDeviceContact}`);
      });
      
      // Return formatted friend list with cached data
      // CRITICAL FIX: Only expose phone number for device contacts (privacy protection)
      return filteredFriends.map(friend => ({
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
        // PRIVACY FIX: Only return phone number for device contacts
        // App connections (friend requests) should NOT see phone numbers
        phoneNumber: friend.isDeviceContact ? friend.phoneNumber : undefined,
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
      
      // CRITICAL FIX: For received requests, show SENDER's data
      // For sent requests, show RECIPIENT's data
      const populatedRequests = await Promise.all(
        requests.map(async (request) => {
          // IMPORTANT: targetUserId is the person whose info we want to display
          // - For RECEIVED requests: show the SENDER (request.userId)
          // - For SENT requests: show the RECIPIENT (request.friendUserId)
          const targetUserId = type === 'received' ? request.userId : request.friendUserId;
          
          console.log(`🔍 [FRIEND SERVICE] Processing ${type} request:`);
          console.log(`  - Request ID: ${request._id}`);
          console.log(`  - request.userId (sender): ${request.userId}`);
          console.log(`  - request.friendUserId (recipient): ${request.friendUserId}`);
          console.log(`  - targetUserId (person to display): ${targetUserId}`);
          console.log(`  - Current cachedData.name: ${request.cachedData?.name}`);
          console.log(`  - Current cachedData.username: ${request.cachedData?.username}`);
          
          // ALWAYS fetch fresh data for the target user to ensure correct display
          const user = await User.findOne({ userId: targetUserId }).select('name profileImage username').lean();
          
          if (!user) {
            console.error(`❌ [FRIEND SERVICE] Target user not found: ${targetUserId}`);
            return null;
          }
          
          // Use fresh user data (not cached data which might be for wrong user)
          const result = {
            requestId: request._id.toString(),
            userId: request.userId,
            friendUserId: request.friendUserId,
            name: user.name,  // Fresh data from target user
            profileImage: user.profileImage || '',
            username: user.username || '',
            requestMessage: request.requestMetadata?.requestMessage || '',
            mutualFriends: request.requestMetadata?.mutualFriends || [],
            addedAt: request.addedAt,
            source: request.source
          };
          
          console.log(`✅ [FRIEND SERVICE] Returning ${type} request data:`);
          console.log(`  - Displaying user: ${result.name} (@${result.username})`);
          console.log(`  - Sender: ${result.userId}`);
          console.log(`  - Recipient: ${result.friendUserId}`);
          
          return result;
        })
      );
      
      // Filter out any null results
      const validRequests = populatedRequests.filter(r => r !== null);
      
      console.log(`✅ [FRIEND SERVICE] Found ${validRequests.length} ${type} requests`);
      
      return validRequests;
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
      
      // CRITICAL FIX: Check BOTH directions in a single query to prevent race conditions
      // Also check for removed friendships to allow re-adding
      const [existingFriendship, reverseRequest, removedFriendship] = await Promise.all([
        Friend.findOne({
          userId,
          friendUserId,
          isDeleted: false
        }),
        Friend.findOne({
          userId: friendUserId,
          friendUserId: userId,
          status: 'pending',
          isDeleted: false
        }),
        Friend.findOne({
          userId,
          friendUserId,
          status: 'removed',
          isDeleted: true
        })
      ]);
      
      // Check existing friendship (sender → recipient)
      if (existingFriendship) {
        if (existingFriendship.status === 'accepted') {
          throw new Error('Already friends');
        } else if (existingFriendship.status === 'pending') {
          throw new Error('Friend request already sent');
        } else if (existingFriendship.status === 'blocked') {
          throw new Error('Cannot send friend request to blocked user');
        }
      }
      
      // Handle removed friendship - reactivate it as pending
      if (removedFriendship) {
        console.log(`🔄 [FRIEND SERVICE] Found removed friendship - reactivating as pending request`);
        
        // Reactivate the removed friendship as a new pending request
        removedFriendship.status = 'pending';
        removedFriendship.isDeleted = false;
        removedFriendship.addedAt = new Date();
        removedFriendship.acceptedAt = null;
        removedFriendship.removedAt = null;
        removedFriendship.requestMetadata = {
          requestedBy: userId,
          requestMessage: metadata.message || '',
          mutualFriends: await Friend.getMutualFriends(userId, friendUserId)
        };
        
        // Update cached data with fresh user info
        removedFriendship.cachedData = {
          name: friendUser.name,
          profileImage: friendUser.profileImage || '',
          username: friendUser.username || '',
          lastCacheUpdate: new Date()
        };
        
        await removedFriendship.save();
        
        console.log(`✅ [FRIEND SERVICE] Reactivated removed friendship as pending request`);
        
        return {
          requestId: removedFriendship._id.toString(),
          userId,
          friendUserId,
          status: 'pending',
          message: 'Friend request sent successfully',
          reactivated: true
        };
      }
      
      // Check reverse request (recipient → sender)
      
      if (reverseRequest) {
        console.log(`🔄 [FRIEND SERVICE] Found reverse pending request - auto-accepting!`);
        
        // Auto-accept the reverse request instead of creating a new one
        const result = await this.acceptFriendRequest(reverseRequest._id.toString(), userId);
        
        return {
          requestId: reverseRequest._id.toString(),
          userId,
          friendUserId,
          status: 'accepted',
          autoAccepted: true,
          message: 'You both sent requests! You are now friends.',
          ...result
        };
      }
      
      // Check for mutual friends
      const mutualFriends = await Friend.getMutualFriends(userId, friendUserId);
      
      // CRITICAL FIX: Cache the TARGET user's data (the recipient)
      // This is what will be shown when the SENDER views their "sent requests"
      // For received requests, the backend will fetch the SENDER's data separately
      const friendRequest = new Friend({
        userId,
        friendUserId,
        source: metadata.source || 'app_search',
        status: 'pending',
        isDeviceContact: false,
        cachedData: {
          name: friendUser.name,  // Target user (recipient)
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
      
      console.log(`📊 [FRIEND SERVICE] Friend request created with cached data:`, {
        cachedName: friendUser.name,
        cachedUsername: friendUser.username,
        sender: userId,
        recipient: friendUserId
      });
      
      await friendRequest.save();
      
      console.log(`✅ [FRIEND SERVICE] Friend request created: ${friendRequest._id}`);
      
      // Broadcast to recipient via WebSocket
      await friendWebSocketService.broadcastFriendRequest(friendUserId, friendRequest);
      
      // Also send push notification to recipient
      try {
        const notificationService = require('./enhancedNotificationService');
        await notificationService.sendNotification(friendUserId, {
          type: 'friend_request',
          title: '👋 New Friend Request',
          message: `${user.name} wants to connect with you`,
          data: {
            requestId: friendRequest._id.toString(),
            fromUserId: userId,
            fromName: user.name,
            fromProfileImage: user.profileImage || '',
            action: 'friend_request'
          }
        });
        console.log(`📱 [FRIEND SERVICE] Push notification sent to ${friendUserId}`);
      } catch (notifError) {
        console.error('⚠️ [FRIEND SERVICE] Failed to send push notification:', notifError.message);
        // Don't fail the request if notification fails
      }
      
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
      
      // CRITICAL: DO NOT overwrite cached data in original request
      // The original request (sender → recipient) should keep the RECIPIENT's data in cache
      // This is what the SENDER sees when viewing their sent requests
      
      // ✅ FIX: Add error handling for original request acceptance
      try {
        await friendRequest.accept();
        console.log(`✅ [FRIEND SERVICE] Original request updated: userId=${friendRequest.userId}, friendUserId=${friendRequest.friendUserId}, status=${friendRequest.status}`);
        console.log(`📊 [FRIEND SERVICE] This means: ${friendRequest.userId} → ${friendRequest.friendUserId} is now ACCEPTED`);
      } catch (acceptError) {
        console.error(`❌ [FRIEND SERVICE] Failed to accept original request:`, acceptError);
        throw new Error(`Failed to accept friend request: ${acceptError.message}`);
      }
      
      // Verify original request was saved
      const verifyOriginalAccept = await Friend.findById(requestId);
      if (!verifyOriginalAccept || verifyOriginalAccept.status !== 'accepted') {
        console.error(`❌ [FRIEND SERVICE] Original request not properly saved!`);
        throw new Error('Original friend request acceptance failed to save');
      }
      console.log(`✅ [FRIEND SERVICE] Original request verified in database`);
      
      // Create reciprocal friendship (both users are now friends)
      // ✅ FIX: Don't filter by isDeleted - we need to find deleted records too!
      const reciprocalFriendship = await Friend.findOne({
        userId: friendRequest.friendUserId,
        friendUserId: friendRequest.userId
      });
      
      if (!reciprocalFriendship) {
        console.log(`🔄 [FRIEND SERVICE] No reciprocal friendship found, creating new one...`);
        console.log(`📊 [FRIEND SERVICE] Creating: ${friendRequest.friendUserId} → ${friendRequest.userId}`);
        
        // Get requester data for cache
        const requester = await User.findOne({ userId: friendRequest.userId })
          .select('name profileImage username');
        
        if (!requester) {
          throw new Error('Requester user not found');
        }
        
        // ✅ FIX: Explicitly ensure isDeviceContact is false for app connections
        // This prevents mutual check logic from incorrectly filtering out friend requests
        const newReciprocal = new Friend({
          userId: friendRequest.friendUserId,
          friendUserId: friendRequest.userId,
          source: friendRequest.source || 'app_search', // Ensure source is set
          status: 'accepted',
          acceptedAt: new Date(),
          isDeviceContact: false, // CRITICAL: Must be false for app connections
          cachedData: {
            name: requester.name,
            profileImage: requester.profileImage || '',
            username: requester.username || '',
            lastCacheUpdate: new Date()
          }
        });
        
        console.log(`✅ [FRIEND SERVICE] Reciprocal friendship config:`, {
          isDeviceContact: false,
          source: friendRequest.source || 'app_search',
          status: 'accepted'
        });
        
        // ✅ FIX: Add try-catch for reciprocal save with detailed error logging
        try {
          await newReciprocal.save();
          console.log(`✅ [FRIEND SERVICE] Created reciprocal friendship for user: ${friendRequest.friendUserId}`);
          console.log(`📊 [FRIEND SERVICE] Reciprocal details:`, {
            _id: newReciprocal._id,
            userId: newReciprocal.userId,
            friendUserId: newReciprocal.friendUserId,
            status: newReciprocal.status,
            source: newReciprocal.source,
            isDeviceContact: newReciprocal.isDeviceContact
          });
        } catch (saveError) {
          console.error(`❌ [FRIEND SERVICE] CRITICAL: Failed to save reciprocal friendship!`);
          console.error(`❌ [FRIEND SERVICE] Error:`, saveError);
          throw new Error(`Failed to create reciprocal friendship: ${saveError.message}`);
        }
      } else {
        console.log(`🔄 [FRIEND SERVICE] Found existing reciprocal friendship (may be deleted), restoring...`);
        console.log(`📊 [FRIEND SERVICE] Current state:`, {
          _id: reciprocalFriendship._id,
          status: reciprocalFriendship.status,
          isDeleted: reciprocalFriendship.isDeleted
        });
        
        // ✅ FIX: Restore deleted friendship by updating all fields
        reciprocalFriendship.status = 'accepted';
        reciprocalFriendship.acceptedAt = new Date();
        reciprocalFriendship.isDeleted = false; // CRITICAL: Restore deleted record
        reciprocalFriendship.isDeviceContact = false; // Ensure correct for app connections
        reciprocalFriendship.source = friendRequest.source || 'app_search'; // Update source
        
        // Update cached data
        const requester = await User.findOne({ userId: friendRequest.userId })
          .select('name profileImage username');
        
        if (requester) {
          reciprocalFriendship.cachedData = {
            name: requester.name,
            profileImage: requester.profileImage || '',
            username: requester.username || '',
            lastCacheUpdate: new Date()
          };
        }
        
        await reciprocalFriendship.save();
        console.log(`✅ [FRIEND SERVICE] Restored and updated existing reciprocal friendship`);
        console.log(`📊 [FRIEND SERVICE] Reciprocal details:`, {
          _id: reciprocalFriendship._id,
          userId: reciprocalFriendship.userId,
          friendUserId: reciprocalFriendship.friendUserId,
          status: reciprocalFriendship.status,
          isDeleted: reciprocalFriendship.isDeleted,
          isDeviceContact: reciprocalFriendship.isDeviceContact
        });
      }
      
      console.log(`✅ [FRIEND SERVICE] Friend request accepted successfully`);
      console.log(`📊 [FRIEND SERVICE] FINAL STATE: Both friendships created`);
      console.log(`   - ${friendRequest.userId} → ${friendRequest.friendUserId} (original request)`);
      console.log(`   - ${friendRequest.friendUserId} → ${friendRequest.userId} (reciprocal)`);
      
      // ✅ FIX: Add 150ms delay to ensure database writes are fully committed
      // This prevents race condition where frontend queries before data is available
      console.log(`⏳ [FRIEND SERVICE] Waiting 150ms for database write completion...`);
      await new Promise(resolve => setTimeout(resolve, 150));
      console.log(`✅ [FRIEND SERVICE] Database writes confirmed, broadcasting events...`);
      
      // Broadcast to requester via WebSocket
      console.log(`📡 [FRIEND SERVICE] Broadcasting acceptance to requester: ${friendRequest.userId}`);
      friendWebSocketService.broadcastFriendAccepted(friendRequest.userId, friendRequest);
      
      // Broadcast friend list updated to both users
      console.log(`📡 [FRIEND SERVICE] Broadcasting friend list update to requester: ${friendRequest.userId}`);
      friendWebSocketService.broadcastFriendListUpdated(friendRequest.userId, {
        action: 'added',
        count: 1
      });
      console.log(`📡 [FRIEND SERVICE] Broadcasting friend list update to accepter: ${friendRequest.friendUserId}`);
      friendWebSocketService.broadcastFriendListUpdated(friendRequest.friendUserId, {
        action: 'added',
        count: 1
      });
      
      // Verify both friendships exist in database
      const verifyOriginal = await Friend.findById(friendRequest._id);
      const verifyReciprocal = await Friend.findOne({
        userId: friendRequest.friendUserId,
        friendUserId: friendRequest.userId,
        status: 'accepted',
        isDeleted: false
      });
      
      console.log(`🔍 [FRIEND SERVICE] VERIFICATION:`);
      console.log(`   - Original friendship exists: ${!!verifyOriginal}, status: ${verifyOriginal?.status}`);
      console.log(`   - Reciprocal friendship exists: ${!!verifyReciprocal}, status: ${verifyReciprocal?.status}`);
      
      if (!verifyReciprocal) {
        console.error(`❌ [FRIEND SERVICE] CRITICAL: Reciprocal friendship not found in database!`);
        console.error(`❌ [FRIEND SERVICE] This means the save operation failed silently!`);
        console.error(`❌ [FRIEND SERVICE] Attempting to create reciprocal again...`);
        
        // ✅ FIX: Retry reciprocal creation if verification fails
        try {
          const requester = await User.findOne({ userId: friendRequest.userId })
            .select('name profileImage username');
          
          if (!requester) {
            throw new Error('Requester user not found for retry');
          }
          
          const retryReciprocal = new Friend({
            userId: friendRequest.friendUserId,
            friendUserId: friendRequest.userId,
            source: friendRequest.source || 'app_search',
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
          
          await retryReciprocal.save();
          console.log(`✅ [FRIEND SERVICE] RETRY: Reciprocal friendship created successfully`);
          
          // Update verification
          verifyReciprocal = await Friend.findById(retryReciprocal._id);
        } catch (retryError) {
          console.error(`❌ [FRIEND SERVICE] RETRY FAILED:`, retryError);
          throw new Error(`Failed to create reciprocal friendship after retry: ${retryError.message}`);
        }
      }
      
      return {
        requestId: friendRequest._id.toString(),
        userId: friendRequest.userId,
        friendUserId: friendRequest.friendUserId,
        status: 'accepted',
        acceptedAt: friendRequest.acceptedAt,
        reciprocalCreated: !!verifyReciprocal
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
   * Cancel outgoing friend request (by the sender)
   * @param {String} requestId - Friend request ID
   * @param {String} userId - User cancelling the request (must be the sender)
   * @returns {Object} Result
   */
  async cancelFriendRequest(requestId, userId) {
    try {
      console.log(`🚫 [FRIEND SERVICE] Cancelling friend request: ${requestId} by user: ${userId}`);
      
      const friendRequest = await Friend.findById(requestId);
      
      if (!friendRequest) {
        throw new Error('Friend request not found');
      }
      
      // Verify this user is the SENDER (not recipient)
      if (friendRequest.userId !== userId) {
        throw new Error('Unauthorized to cancel this request - you are not the sender');
      }
      
      if (friendRequest.status !== 'pending') {
        throw new Error('Friend request is not pending - cannot cancel');
      }
      
      // Soft delete the request
      await friendRequest.remove();
      
      console.log(`✅ [FRIEND SERVICE] Friend request cancelled successfully`);
      
      return {
        requestId: friendRequest._id.toString(),
        status: 'cancelled'
      };
    } catch (error) {
      console.error('❌ [FRIEND SERVICE] Error cancelling friend request:', error);
      throw new Error(`Failed to cancel friend request: ${error.message}`);
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
      
      // Log sample phone numbers for debugging
      console.log(`📱 [SAMPLE NUMBERS] First 5: ${phoneNumbers.slice(0, 5).join(', ')}`);
      
      // Create phone number query with normalization
      const phoneQuery = createPhoneNumberQuery(phoneNumbers);
      
      // Find registered users from phone numbers (with normalized matching)
      const registeredUsers = await User.find({
        ...phoneQuery,
        userId: { $ne: userId } // Exclude self
      }).select('userId name phoneNumber profileImage username').lean();
      
      console.log(`📱 [FRIEND SERVICE] Found ${registeredUsers.length} registered users from ${phoneNumbers.length} device contacts`);
      
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
          // ✅ CRITICAL FIX: Don't overwrite app connections (friend requests) with device contact data
          // This was causing the reciprocal deletion bug where User A disappears from User B's list
          
          console.log(`🔍 [FRIEND SERVICE] Found existing friendship with ${registeredUser.userId}:`);
          console.log(`   - Current source: ${existingFriendship.source}`);
          console.log(`   - Current status: ${existingFriendship.status}`);
          console.log(`   - Current isDeviceContact: ${existingFriendship.isDeviceContact}`);
          
          // Skip pending or removed friendships - don't convert them to device contacts
          if (existingFriendship.status === 'pending' || existingFriendship.status === 'removed') {
            console.log(`⚠️ [FRIEND SERVICE] Skipping ${existingFriendship.status} friendship - not converting to device contact`);
            continue;
          }
          
          // Only mark as device contact if it was originally a device contact
          // Don't overwrite app connections (app_search, qr_code, etc.)
          if (existingFriendship.source === 'device_contact') {
            existingFriendship.isDeviceContact = true;
            existingFriendship.lastDeviceSync = now;
            existingFriendship.phoneNumber = registeredUser.phoneNumber;
            
            await existingFriendship.updateCache({
              name: registeredUser.name,
              profileImage: registeredUser.profileImage,
              username: registeredUser.username
            });
            
            console.log(`🔄 [FRIEND SERVICE] Updated existing device contact with ${registeredUser.userId}`);
          } else {
            // For app connections, just update cache but DON'T change isDeviceContact or source
            await existingFriendship.updateCache({
              name: registeredUser.name,
              profileImage: registeredUser.profileImage,
              username: registeredUser.username
            });
            
            console.log(`🔄 [FRIEND SERVICE] Updated cache for app connection with ${registeredUser.userId}`);
            console.log(`   - Keeping source: ${existingFriendship.source}`);
            console.log(`   - Keeping isDeviceContact: ${existingFriendship.isDeviceContact}`);
          }
        } else {
          // Create new friendship (auto-accepted for device contacts)
          // ✅ FIX: Use upsert to avoid duplicate key error
          await Friend.findOneAndUpdate(
            {
              userId,
              friendUserId: registeredUser.userId
            },
            {
              $set: {
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
              }
            },
            { upsert: true, new: true }
          );
          
          // ✅ FIX: DO NOT create reciprocal friendship automatically
          // This was causing Bug #1: Users appearing as friends without consent
          // Only User A should have User B in their list if A has B's number
          // User B should NOT automatically have User A unless:
          // 1. B also has A's number in their contacts, OR
          // 2. A sends a friend request and B accepts it
          
          // REMOVED: Automatic reciprocal friendship creation
          // The old code was creating B → A friendship with status 'accepted'
          // This violated user privacy and consent
          
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
