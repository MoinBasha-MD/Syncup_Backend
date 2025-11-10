const asyncHandler = require('express-async-handler');
const friendService = require('../services/friendService');

/**
 * FriendController - HTTP handlers for friend management
 * Follows the same pattern as storyController and contactController
 */
class FriendController {
  
  /**
   * GET /api/friends
   * Get all friends for the authenticated user
   */
  getFriends = asyncHandler(async (req, res) => {
    try {
      console.log('👥 [FRIEND CONTROLLER] Get friends request received');
      console.log('User object:', JSON.stringify(req.user, null, 2));
      
      const userId = req.user.userId;
      
      if (!userId) {
        res.status(400);
        throw new Error('User ID is required');
      }
      
      // Parse query options
      const options = {
        status: req.query.status || 'accepted',
        includeDeviceContacts: req.query.includeDeviceContacts !== 'false',
        includeAppConnections: req.query.includeAppConnections !== 'false',
        limit: parseInt(req.query.limit) || 1000,
        skip: parseInt(req.query.skip) || 0,
        sortBy: req.query.sortBy || 'addedAt',
        sortOrder: parseInt(req.query.sortOrder) || -1
      };
      
      const friends = await friendService.getFriends(userId, options);
      
      console.log(`✅ [FRIEND CONTROLLER] Retrieved ${friends.length} friends`);
      
      res.status(200).json({
        success: true,
        data: friends,
        count: friends.length
      });
    } catch (error) {
      console.error('❌ [FRIEND CONTROLLER] Error getting friends:', error);
      res.status(error.statusCode || 500);
      throw new Error(error.message || 'Failed to get friends');
    }
  });
  
  /**
   * GET /api/friends/requests
   * Get friend requests (pending friendships)
   */
  getFriendRequests = asyncHandler(async (req, res) => {
    try {
      console.log('📬 [FRIEND CONTROLLER] Get friend requests received');
      
      const userId = req.user.userId;
      const type = req.query.type || 'received'; // 'received' or 'sent'
      
      if (!userId) {
        res.status(400);
        throw new Error('User ID is required');
      }
      
      const requests = await friendService.getFriendRequests(userId, type);
      
      console.log(`✅ [FRIEND CONTROLLER] Retrieved ${requests.length} ${type} requests`);
      
      res.status(200).json({
        success: true,
        data: requests,
        count: requests.length,
        type
      });
    } catch (error) {
      console.error('❌ [FRIEND CONTROLLER] Error getting friend requests:', error);
      res.status(error.statusCode || 500);
      throw new Error(error.message || 'Failed to get friend requests');
    }
  });
  
  /**
   * POST /api/friends/add
   * Send a friend request
   */
  sendFriendRequest = asyncHandler(async (req, res) => {
    try {
      console.log('📤 [FRIEND CONTROLLER] Send friend request received');
      console.log('Request body:', JSON.stringify(req.body, null, 2));
      
      const userId = req.user.userId;
      const { friendUserId, username, phoneNumber, message, source } = req.body;
      
      if (!userId) {
        res.status(400);
        throw new Error('User ID is required');
      }
      
      // Determine target user ID
      let targetUserId = friendUserId;
      
      if (!targetUserId && username) {
        // Find user by username
        const User = require('../models/userModel');
        const user = await User.findOne({ username }).select('userId');
        if (!user) {
          res.status(404);
          throw new Error('User not found');
        }
        targetUserId = user.userId;
      } else if (!targetUserId && phoneNumber) {
        // Find user by phone number
        const User = require('../models/userModel');
        const user = await User.findOne({ phoneNumber }).select('userId');
        if (!user) {
          res.status(404);
          throw new Error('User not found');
        }
        targetUserId = user.userId;
      }
      
      if (!targetUserId) {
        res.status(400);
        throw new Error('Friend user ID, username, or phone number is required');
      }
      
      if (targetUserId === userId) {
        res.status(400);
        throw new Error('Cannot send friend request to yourself');
      }
      
      const metadata = {
        message: message || '',
        source: source || 'app_search'
      };
      
      const result = await friendService.sendFriendRequest(userId, targetUserId, metadata);
      
      console.log('✅ [FRIEND CONTROLLER] Friend request sent successfully');
      
      res.status(201).json({
        success: true,
        data: result,
        message: 'Friend request sent successfully'
      });
    } catch (error) {
      console.error('❌ [FRIEND CONTROLLER] Error sending friend request:', error);
      res.status(error.statusCode || 500);
      throw new Error(error.message || 'Failed to send friend request');
    }
  });
  
  /**
   * POST /api/friends/accept/:requestId
   * Accept a friend request
   */
  acceptFriendRequest = asyncHandler(async (req, res) => {
    try {
      console.log('✅ [FRIEND CONTROLLER] Accept friend request received');
      
      const userId = req.user.userId;
      const { requestId } = req.params;
      
      if (!userId) {
        res.status(400);
        throw new Error('User ID is required');
      }
      
      if (!requestId) {
        res.status(400);
        throw new Error('Request ID is required');
      }
      
      const result = await friendService.acceptFriendRequest(requestId, userId);
      
      console.log('✅ [FRIEND CONTROLLER] Friend request accepted successfully');
      
      res.status(200).json({
        success: true,
        data: result,
        message: 'Friend request accepted successfully'
      });
    } catch (error) {
      console.error('❌ [FRIEND CONTROLLER] Error accepting friend request:', error);
      res.status(error.statusCode || 500);
      throw new Error(error.message || 'Failed to accept friend request');
    }
  });
  
  /**
   * POST /api/friends/reject/:requestId
   * Reject a friend request
   */
  rejectFriendRequest = asyncHandler(async (req, res) => {
    try {
      console.log('❌ [FRIEND CONTROLLER] Reject friend request received');
      
      const userId = req.user.userId;
      const { requestId } = req.params;
      
      if (!userId) {
        res.status(400);
        throw new Error('User ID is required');
      }
      
      if (!requestId) {
        res.status(400);
        throw new Error('Request ID is required');
      }
      
      const result = await friendService.rejectFriendRequest(requestId, userId);
      
      console.log('✅ [FRIEND CONTROLLER] Friend request rejected successfully');
      
      res.status(200).json({
        success: true,
        data: result,
        message: 'Friend request rejected successfully'
      });
    } catch (error) {
      console.error('❌ [FRIEND CONTROLLER] Error rejecting friend request:', error);
      res.status(error.statusCode || 500);
      throw new Error(error.message || 'Failed to reject friend request');
    }
  });
  
  /**
   * DELETE /api/friends/:friendUserId
   * Remove a friend
   */
  removeFriend = asyncHandler(async (req, res) => {
    try {
      console.log('🗑️ [FRIEND CONTROLLER] Remove friend request received');
      
      const userId = req.user.userId;
      const { friendUserId } = req.params;
      
      if (!userId) {
        res.status(400);
        throw new Error('User ID is required');
      }
      
      if (!friendUserId) {
        res.status(400);
        throw new Error('Friend user ID is required');
      }
      
      const result = await friendService.removeFriend(userId, friendUserId);
      
      console.log('✅ [FRIEND CONTROLLER] Friend removed successfully');
      
      res.status(200).json({
        success: true,
        data: result,
        message: 'Friend removed successfully'
      });
    } catch (error) {
      console.error('❌ [FRIEND CONTROLLER] Error removing friend:', error);
      res.status(error.statusCode || 500);
      throw new Error(error.message || 'Failed to remove friend');
    }
  });
  
  /**
   * POST /api/friends/block/:userId
   * Block a user
   */
  blockUser = asyncHandler(async (req, res) => {
    try {
      console.log('🚫 [FRIEND CONTROLLER] Block user request received');
      
      const userId = req.user.userId;
      const { userId: blockedUserId } = req.params;
      
      if (!userId) {
        res.status(400);
        throw new Error('User ID is required');
      }
      
      if (!blockedUserId) {
        res.status(400);
        throw new Error('Blocked user ID is required');
      }
      
      if (userId === blockedUserId) {
        res.status(400);
        throw new Error('Cannot block yourself');
      }
      
      const result = await friendService.blockUser(userId, blockedUserId);
      
      console.log('✅ [FRIEND CONTROLLER] User blocked successfully');
      
      res.status(200).json({
        success: true,
        data: result,
        message: 'User blocked successfully'
      });
    } catch (error) {
      console.error('❌ [FRIEND CONTROLLER] Error blocking user:', error);
      res.status(error.statusCode || 500);
      throw new Error(error.message || 'Failed to block user');
    }
  });
  
  /**
   * POST /api/friends/unblock/:userId
   * Unblock a user
   */
  unblockUser = asyncHandler(async (req, res) => {
    try {
      console.log('✅ [FRIEND CONTROLLER] Unblock user request received');
      
      const userId = req.user.userId;
      const { userId: blockedUserId } = req.params;
      
      if (!userId) {
        res.status(400);
        throw new Error('User ID is required');
      }
      
      if (!blockedUserId) {
        res.status(400);
        throw new Error('Blocked user ID is required');
      }
      
      const result = await friendService.unblockUser(userId, blockedUserId);
      
      console.log('✅ [FRIEND CONTROLLER] User unblocked successfully');
      
      res.status(200).json({
        success: true,
        data: result,
        message: 'User unblocked successfully'
      });
    } catch (error) {
      console.error('❌ [FRIEND CONTROLLER] Error unblocking user:', error);
      res.status(error.statusCode || 500);
      throw new Error(error.message || 'Failed to unblock user');
    }
  });
  
  /**
   * POST /api/friends/sync-contacts
   * Sync device contacts to create friendships
   */
  syncDeviceContacts = asyncHandler(async (req, res) => {
    try {
      console.log('📱 [FRIEND CONTROLLER] Sync device contacts request received');
      console.log('Request body:', JSON.stringify(req.body, null, 2));
      
      const userId = req.user.userId;
      const { phoneNumbers } = req.body;
      
      if (!userId) {
        res.status(400);
        throw new Error('User ID is required');
      }
      
      if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
        res.status(400);
        throw new Error('Phone numbers array is required');
      }
      
      const result = await friendService.syncDeviceContacts(userId, phoneNumbers);
      
      console.log('✅ [FRIEND CONTROLLER] Device contacts synced successfully');
      
      res.status(200).json({
        success: true,
        data: result,
        message: `Synced ${result.newFriends.length} new friends, ${result.totalFriends} total friends`
      });
    } catch (error) {
      console.error('❌ [FRIEND CONTROLLER] Error syncing device contacts:', error);
      res.status(error.statusCode || 500);
      throw new Error(error.message || 'Failed to sync device contacts');
    }
  });
  
  /**
   * GET /api/friends/search
   * Search for users to add as friends
   */
  searchUsers = asyncHandler(async (req, res) => {
    try {
      console.log('🔍 [FRIEND CONTROLLER] Search users request received');
      
      const userId = req.user.userId;
      const { query, limit } = req.query;
      
      if (!userId) {
        res.status(400);
        throw new Error('User ID is required');
      }
      
      if (!query) {
        res.status(400);
        throw new Error('Search query is required');
      }
      
      const results = await friendService.searchUsers(
        userId,
        query,
        parseInt(limit) || 20
      );
      
      console.log(`✅ [FRIEND CONTROLLER] Found ${results.length} users`);
      
      res.status(200).json({
        success: true,
        data: results,
        count: results.length,
        query
      });
    } catch (error) {
      console.error('❌ [FRIEND CONTROLLER] Error searching users:', error);
      res.status(error.statusCode || 500);
      throw new Error(error.message || 'Failed to search users');
    }
  });
  
  /**
   * GET /api/friends/mutual/:userId
   * Get mutual friends with another user
   */
  getMutualFriends = asyncHandler(async (req, res) => {
    try {
      console.log('🤝 [FRIEND CONTROLLER] Get mutual friends request received');
      
      const userId = req.user.userId;
      const { userId: otherUserId } = req.params;
      
      if (!userId) {
        res.status(400);
        throw new Error('User ID is required');
      }
      
      if (!otherUserId) {
        res.status(400);
        throw new Error('Other user ID is required');
      }
      
      const mutualFriends = await friendService.getMutualFriends(userId, otherUserId);
      
      console.log(`✅ [FRIEND CONTROLLER] Found ${mutualFriends.length} mutual friends`);
      
      res.status(200).json({
        success: true,
        data: mutualFriends,
        count: mutualFriends.length
      });
    } catch (error) {
      console.error('❌ [FRIEND CONTROLLER] Error getting mutual friends:', error);
      res.status(error.statusCode || 500);
      throw new Error(error.message || 'Failed to get mutual friends');
    }
  });
  
  /**
   * PUT /api/friends/:friendUserId/settings
   * Update friend-specific settings
   */
  updateFriendSettings = asyncHandler(async (req, res) => {
    try {
      console.log('⚙️ [FRIEND CONTROLLER] Update friend settings request received');
      
      const userId = req.user.userId;
      const { friendUserId } = req.params;
      const settings = req.body;
      
      if (!userId) {
        res.status(400);
        throw new Error('User ID is required');
      }
      
      if (!friendUserId) {
        res.status(400);
        throw new Error('Friend user ID is required');
      }
      
      const result = await friendService.updateFriendSettings(userId, friendUserId, settings);
      
      console.log('✅ [FRIEND CONTROLLER] Friend settings updated successfully');
      
      res.status(200).json({
        success: true,
        data: result,
        message: 'Friend settings updated successfully'
      });
    } catch (error) {
      console.error('❌ [FRIEND CONTROLLER] Error updating friend settings:', error);
      res.status(error.statusCode || 500);
      throw new Error(error.message || 'Failed to update friend settings');
    }
  });
  
  /**
   * POST /api/friends/refresh-cache
   * Refresh cached friend data
   */
  refreshFriendCache = asyncHandler(async (req, res) => {
    try {
      console.log('🔄 [FRIEND CONTROLLER] Refresh friend cache request received');
      
      const userId = req.user.userId;
      
      if (!userId) {
        res.status(400);
        throw new Error('User ID is required');
      }
      
      const result = await friendService.refreshFriendCache(userId);
      
      console.log('✅ [FRIEND CONTROLLER] Friend cache refreshed successfully');
      
      res.status(200).json({
        success: true,
        data: result,
        message: `Refreshed ${result.updated} of ${result.total} friend caches`
      });
    } catch (error) {
      console.error('❌ [FRIEND CONTROLLER] Error refreshing friend cache:', error);
      res.status(error.statusCode || 500);
      throw new Error(error.message || 'Failed to refresh friend cache');
    }
  });
}

module.exports = new FriendController();
