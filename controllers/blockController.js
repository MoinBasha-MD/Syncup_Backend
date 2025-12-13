const asyncHandler = require('express-async-handler');
const Block = require('../models/blockModel');
const User = require('../models/userModel');
const ConnectionRequest = require('../models/connectionRequestModel');

// @desc    Block a user
// @route   POST /api/blocks
// @access  Private
const blockUser = asyncHandler(async (req, res) => {
  try {
    const blockerId = req.user.userId;
    // Accept both 'blockedUserId' and 'userId' for compatibility
    const { blockedUserId, userId, reason = '' } = req.body;
    const targetUserId = blockedUserId || userId;
    
    console.log(`🚫 Blocking user: ${blockerId} -> ${targetUserId}`);
    
    if (!targetUserId) {
      res.status(400);
      throw new Error('User ID to block is required');
    }
    
    if (blockerId === targetUserId) {
      res.status(400);
      throw new Error('Cannot block yourself');
    }
    
    // Check if already blocked
    const existingBlock = await Block.findOne({ blockerId, blockedUserId: targetUserId });
    if (existingBlock) {
      res.status(400);
      throw new Error('User is already blocked');
    }
    
    // Find both users
    const [blocker, blockedUser] = await Promise.all([
      User.findOne({ userId: blockerId }),
      User.findOne({ userId: targetUserId })
    ]);
    
    if (!blocker || !blockedUser) {
      res.status(404);
      throw new Error('One or both users not found');
    }
    
    // Create block record
    const block = new Block({
      blockerId,
      blockedUserId: targetUserId,
      blockerName: blocker.name,
      blockerUsername: blocker.username || '',
      blockerProfileImage: blocker.profileImage || '',
      blockedUserName: blockedUser.name,
      blockedUserUsername: blockedUser.username || '',
      blockedUserProfileImage: blockedUser.profileImage || '',
      reason: reason.substring(0, 200)
    });
    
    await block.save();
    
    // Cancel any pending connection requests between them (but keep existing connections)
    await ConnectionRequest.deleteMany({
      $or: [
        { fromUserId: blockerId, toUserId: targetUserId },
        { fromUserId: targetUserId, toUserId: blockerId }
      ]
    });
    
    // Note: We keep existing connections and chat history intact
    // Blocking only prevents new interactions, not historical data
    
    console.log(`✅ User blocked successfully: ${blockerId} -> ${targetUserId}`);
    
    res.status(201).json({
      success: true,
      data: {
        blockId: block._id,
        blockedUser: {
          userId: blockedUser.userId,
          name: blockedUser.name,
          username: blockedUser.username || '',
          profileImage: blockedUser.profileImage || ''
        },
        blockedAt: block.blockedAt,
        message: 'User blocked successfully'
      }
    });
  } catch (error) {
    console.error('Error blocking user:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error blocking user');
  }
});

// @desc    Unblock a user
// @route   DELETE /api/blocks/:userId
// @access  Private
const unblockUser = asyncHandler(async (req, res) => {
  try {
    const blockerId = req.user.userId;
    const { userId: blockedUserId } = req.params;
    
    console.log(`🔓 Unblocking user: ${blockerId} -> ${blockedUserId}`);
    
    if (blockerId === blockedUserId) {
      res.status(400);
      throw new Error('Invalid operation');
    }
    
    // Find and remove block record
    const block = await Block.findOneAndDelete({ blockerId, blockedUserId });
    
    if (!block) {
      res.status(404);
      throw new Error('Block record not found');
    }
    
    console.log(`✅ User unblocked successfully: ${blockerId} -> ${blockedUserId}`);
    
    res.status(200).json({
      success: true,
      data: {
        unblockedUser: {
          userId: block.blockedUserId,
          name: block.blockedUserName,
          username: block.blockedUserUsername,
          profileImage: block.blockedUserProfileImage
        },
        message: 'User unblocked successfully'
      }
    });
  } catch (error) {
    console.error('Error unblocking user:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error unblocking user');
  }
});

// @desc    Get list of blocked users
// @route   GET /api/blocks
// @access  Private
const getBlockedUsers = asyncHandler(async (req, res) => {
  try {
    const blockerId = req.user.userId;
    const { limit = 50, offset = 0 } = req.query;
    
    console.log(`📋 Getting blocked users for: ${blockerId}`);
    
    const blockedUsers = await Block.getBlockedUsers(blockerId, { limit, offset });
    
    const formattedUsers = blockedUsers.map(block => ({
      userId: block.blockedUserId,
      name: block.blockedUserName,
      username: block.blockedUserUsername,
      profileImage: block.blockedUserProfileImage,
      reason: block.reason,
      blockedAt: block.blockedAt,
      blockId: block._id
    }));
    
    res.status(200).json({
      success: true,
      data: {
        blockedUsers: formattedUsers,
        total: formattedUsers.length,
        hasMore: formattedUsers.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error getting blocked users:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error getting blocked users');
  }
});

// @desc    Check if a user is blocked
// @route   GET /api/blocks/check/:userId
// @access  Private
const checkBlockStatus = asyncHandler(async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const { userId: targetUserId } = req.params;
    
    if (currentUserId === targetUserId) {
      res.status(400);
      throw new Error('Cannot check block status with yourself');
    }
    
    const blockStatus = await Block.isMutuallyBlocked(currentUserId, targetUserId);
    
    res.status(200).json({
      success: true,
      data: {
        isBlocked: blockStatus.user1BlockedUser2, // Current user blocked target
        isBlockedBy: blockStatus.user2BlockedUser1, // Target user blocked current user
        anyBlocked: blockStatus.anyBlocked
      }
    });
  } catch (error) {
    console.error('Error checking block status:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error checking block status');
  }
});

// @desc    Check multiple users' block status
// @route   POST /api/blocks/check-multiple
// @access  Private
const checkMultipleBlockStatus = asyncHandler(async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const { userIds } = req.body;
    
    if (!Array.isArray(userIds) || userIds.length === 0) {
      res.status(400);
      throw new Error('User IDs array is required');
    }
    
    if (userIds.length > 100) {
      res.status(400);
      throw new Error('Too many user IDs. Maximum 100 allowed');
    }
    
    // Remove current user from the list
    const filteredUserIds = userIds.filter(id => id !== currentUserId);
    
    const blockStatuses = {};
    
    // Check blocks in batches for efficiency
    const [blockedByCurrentUser, blockingCurrentUser] = await Promise.all([
      Block.find({ 
        blockerId: currentUserId, 
        blockedUserId: { $in: filteredUserIds } 
      }).lean(),
      Block.find({ 
        blockerId: { $in: filteredUserIds }, 
        blockedUserId: currentUserId 
      }).lean()
    ]);
    
    // Create lookup maps
    const blockedByCurrentMap = new Set(blockedByCurrentUser.map(b => b.blockedUserId));
    const blockingCurrentMap = new Set(blockingCurrentUser.map(b => b.blockerId));
    
    // Build response
    filteredUserIds.forEach(userId => {
      const isBlocked = blockedByCurrentMap.has(userId);
      const isBlockedBy = blockingCurrentMap.has(userId);
      
      blockStatuses[userId] = {
        isBlocked,
        isBlockedBy,
        anyBlocked: isBlocked || isBlockedBy
      };
    });
    
    res.status(200).json({
      success: true,
      data: { blockStatuses }
    });
  } catch (error) {
    console.error('Error checking multiple block statuses:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error checking multiple block statuses');
  }
});

// @desc    Health check for blocks API
// @route   GET /api/blocks/health
// @access  Private
const getBlocksHealth = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      message: 'Blocks API is operational'
    }
  });
});

module.exports = {
  blockUser,
  unblockUser,
  getBlockedUsers,
  checkBlockStatus,
  checkMultipleBlockStatus,
  getBlocksHealth
};
