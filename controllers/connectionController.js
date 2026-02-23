const asyncHandler = require('express-async-handler');
const User = require('../models/userModel');
const ConnectionRequest = require('../models/connectionRequestModel');
const Block = require('../models/blockModel');
const { checkRateLimit } = require('../services/rateLimitService');

/**
 * Calculate mutual connections between two users
 */
const calculateMutualConnections = async (userId1, userId2) => {
  try {
    const user1 = await User.findOne({ userId: userId1 }, 'contacts appConnections');
    const user2 = await User.findOne({ userId: userId2 }, 'contacts appConnections');
    
    if (!user1 || !user2) return 0;
    
    const user1Connections = new Set([
      ...user1.contacts.map(id => id.toString()),
      ...user1.appConnections.map(conn => conn.userId)
    ]);
    
    const user2Connections = new Set([
      ...user2.contacts.map(id => id.toString()),
      ...user2.appConnections.map(conn => conn.userId)
    ]);
    
    let mutualCount = 0;
    for (const connection of user1Connections) {
      if (user2Connections.has(connection)) {
        mutualCount++;
      }
    }
    
    return mutualCount;
  } catch (error) {
    console.error('Error calculating mutual connections:', error);
    return 0;
  }
};

// @desc    Send connection request
// @route   POST /api/connections/request
// @access  Private
const sendConnectionRequest = asyncHandler(async (req, res) => {
  try {
    const { toUserId, message = '' } = req.body;
    const fromUserId = req.user.userId;
    
    // Validate input
    if (!toUserId) {
      res.status(400);
      throw new Error('Target user ID is required');
    }
    
    if (toUserId === fromUserId) {
      res.status(400);
      throw new Error('Cannot send connection request to yourself');
    }
    
    // Check rate limiting using the new service
    const rateLimitResult = checkRateLimit(fromUserId, 'CONNECTION_REQUEST');
    if (!rateLimitResult.allowed) {
      res.status(429);
      res.set('Retry-After', rateLimitResult.retryAfter);
      throw new Error(`Daily connection request limit reached. Try again in ${rateLimitResult.retryAfter} seconds.`);
    }
    
    console.log(`📤 Connection request: ${fromUserId} -> ${toUserId}`);
    
    // ⚡ PERFORMANCE OPTIMIZATION: Check if users are already connected via app connections with lean()
    const [fromUserData, toUserData] = await Promise.all([
      User.findOne({ userId: fromUserId }, 'appConnections').lean(),
      User.findOne({ userId: toUserId }, 'appConnections').lean()
    ]);
    
    if (!fromUserData || !toUserData) {
      res.status(404);
      throw new Error('One or both users not found');
    }
    
    // Check if already connected
    const isAlreadyConnected = fromUserData.appConnections.some(
      conn => conn.userId === toUserId && conn.status === 'accepted'
    );
    
    if (isAlreadyConnected) {
      res.status(400);
      throw new Error('Users are already connected');
    }
    
    // Check for existing pending requests (bidirectional)
    const existingPendingRequest = await ConnectionRequest.findOne({
      $or: [
        { fromUserId, toUserId, status: 'pending' },
        { fromUserId: toUserId, toUserId: fromUserId, status: 'pending' }
      ]
    });
    
    if (existingPendingRequest) {
      res.status(400);
      throw new Error('Connection request already pending between these users');
    }
    
    // Delete any old cancelled/declined requests to prevent duplicates
    await ConnectionRequest.deleteMany({
      $or: [
        { fromUserId, toUserId, status: { $in: ['cancelled', 'declined'] } },
        { fromUserId: toUserId, toUserId: fromUserId, status: { $in: ['cancelled', 'declined'] } }
      ]
    });
    
    console.log(`🧹 Cleaned up old requests between ${fromUserId} and ${toUserId}`);
    
    // Check if either user has blocked the other
    const blockStatus = await Block.isMutuallyBlocked(fromUserId, toUserId);
    if (blockStatus.anyBlocked) {
      res.status(403);
      throw new Error('Cannot send connection request to this user');
    }
    
    // ⚡ PERFORMANCE OPTIMIZATION: Use already fetched user data and get additional details with lean()
    const [fromUser, toUser] = await Promise.all([
      User.findOne({ userId: fromUserId }, 'name username profileImage').lean(),
      User.findOne({ userId: toUserId }, 'name username profileImage isPublic').lean()
    ]);
    
    if (!fromUser) {
      res.status(404);
      throw new Error('Your user account not found');
    }
    
    if (!toUser) {
      res.status(404);
      throw new Error('Target user not found');
    }
    
    if (!toUser.isPublic) {
      res.status(403);
      throw new Error('Cannot send connection request to private user');
    }
    
    // Calculate mutual connections
    const mutualConnectionsCount = await calculateMutualConnections(fromUserId, toUserId);
    
    // CRITICAL FIX: Create BOTH ConnectionRequest AND Friend record to keep systems in sync
    const Friend = require('../models/Friend');
    
    // Create connection request (OLD system)
    const connectionRequest = new ConnectionRequest({
      fromUserId,
      toUserId,
      fromUserName: fromUser.name,
      fromUserUsername: fromUser.username || '',
      fromUserProfileImage: fromUser.profileImage || '',
      toUserName: toUser.name,
      toUserUsername: toUser.username || '',
      toUserProfileImage: toUser.profileImage || '',
      message: message.substring(0, 200), // Limit message length
      mutualConnectionsCount
    });
    
    await connectionRequest.save();
    
    console.log(`✅ Connection request sent: ${connectionRequest._id}`);
    
    // CRITICAL: Also create Friend record (NEW system) to keep both systems synchronized
    try {
      // Check if Friend record already exists
      const existingFriend = await Friend.findOne({
        userId: fromUserId,
        friendUserId: toUserId,
        isDeleted: false
      });
      
      if (!existingFriend) {
        const friendRequest = new Friend({
          userId: fromUserId,
          friendUserId: toUserId,
          source: 'app_search',
          status: 'pending',
          cachedData: {
            name: toUser.name,
            profileImage: toUser.profileImage || '',
            username: toUser.username || '',
            lastCacheUpdate: new Date()
          }
        });
        
        await friendRequest.save();
        console.log(`✅ Friend record created for synchronization: ${friendRequest._id}`);
      } else {
        console.log(`ℹ️ Friend record already exists, skipping creation`);
      }
    } catch (friendError) {
      console.error('❌ Error creating Friend record:', friendError);
      // Don't fail the request if Friend creation fails
      console.warn('⚠️ ConnectionRequest created but Friend record failed - systems may be out of sync');
    }
    
    // Send push notification to target user
    try {
      // TODO: Implement server-side push notification service
      // For now, we'll rely on the frontend to handle notifications
      console.log(`📱 Push notification should be sent to ${toUser.name} (${toUserId})`);
    } catch (notificationError) {
      console.error('❌ Error sending push notification:', notificationError);
      // Don't fail the request if notification fails
    }
    
    res.status(201).json({
      success: true,
      data: {
        requestId: connectionRequest._id,
        toUser: {
          userId: toUser.userId,
          name: toUser.name,
          username: toUser.username || ''
        },
        mutualConnectionsCount,
        message: 'Connection request sent successfully'
      }
    });
  } catch (error) {
    console.error('Error sending connection request:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error sending connection request');
  }
});

// @desc    Get incoming connection requests
// @route   GET /api/connections/requests/incoming
// @access  Private
const getIncomingRequests = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;
    
    console.log(`📥 Getting incoming requests for user ${userId}`);
    
    const requests = await ConnectionRequest.find({
      toUserId: userId,
      status: 'pending'
    })
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .lean();
    
    console.log(`Found ${requests.length} incoming requests`);
    
    const formattedRequests = requests.map(request => ({
      requestId: request._id,
      fromUser: {
        userId: request.fromUserId,
        name: request.fromUserName,
        username: request.fromUserUsername,
        profileImage: request.fromUserProfileImage
      },
      message: request.message,
      mutualConnectionsCount: request.mutualConnectionsCount,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt
    }));
    
    res.status(200).json({
      success: true,
      data: {
        requests: formattedRequests,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: formattedRequests.length
        }
      }
    });
  } catch (error) {
    console.error('Error getting incoming requests:', error);
    res.status(500);
    throw new Error('Error getting incoming requests');
  }
});

// @desc    Get outgoing connection requests
// @route   GET /api/connections/requests/outgoing
// @access  Private
const getOutgoingRequests = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;
    
    console.log(`📤 Getting outgoing requests for user ${userId}`);
    
    const requests = await ConnectionRequest.find({
      fromUserId: userId,
      status: { $in: ['pending', 'declined'] }
    })
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    .lean();
    
    console.log(`Found ${requests.length} outgoing requests`);
    
    const formattedRequests = requests.map(request => ({
      requestId: request._id,
      toUser: {
        userId: request.toUserId,
        name: request.toUserName,
        username: request.toUserUsername,
        profileImage: request.toUserProfileImage
      },
      message: request.message,
      mutualConnectionsCount: request.mutualConnectionsCount,
      status: request.status,
      createdAt: request.createdAt,
      respondedAt: request.respondedAt,
      expiresAt: request.expiresAt
    }));
    
    res.status(200).json({
      success: true,
      data: {
        requests: formattedRequests,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: formattedRequests.length
        }
      }
    });
  } catch (error) {
    console.error('Error getting outgoing requests:', error);
    res.status(500);
    throw new Error('Error getting outgoing requests');
  }
});

// @desc    Accept connection request
// @route   PUT /api/connections/request/:requestId/accept
// @access  Private
const acceptConnectionRequest = asyncHandler(async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.userId;
    
    console.log(`✅ Accepting connection request ${requestId} by user ${userId}`);
    
    // Validate ObjectId format
    if (!requestId || !requestId.match(/^[0-9a-fA-F]{24}$/)) {
      res.status(400);
      throw new Error('Invalid request ID format');
    }
    
    // Find and validate request
    const request = await ConnectionRequest.findOne({
      _id: requestId,
      toUserId: userId,
      status: 'pending'
    });
    
    if (!request) {
      res.status(404);
      throw new Error('Connection request not found or already processed');
    }
    
    // Update request status
    request.status = 'accepted';
    request.respondedAt = new Date();
    await request.save();
    
    // Add each user to the other's app connections
    const [fromUser, toUser] = await Promise.all([
      User.findOne({ userId: request.fromUserId }),
      User.findOne({ userId: request.toUserId })
    ]);
    
    if (!fromUser || !toUser) {
      res.status(404);
      throw new Error('One or both users not found');
    }
    
    // Add to app connections (bidirectional)
    const connectionDate = new Date();
    
    // Add toUser to fromUser's connections
    fromUser.appConnections.push({
      userId: toUser.userId,
      name: toUser.name,
      username: toUser.username || '',
      profileImage: toUser.profileImage || '',
      connectionDate,
      status: 'accepted'
    });
    
    // Add fromUser to toUser's connections
    toUser.appConnections.push({
      userId: fromUser.userId,
      name: fromUser.name,
      username: fromUser.username || '',
      profileImage: fromUser.profileImage || '',
      connectionDate,
      status: 'accepted'
    });
    
    await Promise.all([fromUser.save(), toUser.save()]);
    
    console.log(`✅ Connection established between ${request.fromUserId} and ${request.toUserId}`);
    
    // CRITICAL: Also update Friend records to 'accepted' status to keep systems synchronized
    try {
      const Friend = require('../models/Friend');
      
      // Update the original Friend request to accepted
      const originalFriend = await Friend.findOne({
        userId: request.fromUserId,
        friendUserId: request.toUserId,
        isDeleted: false
      });
      
      if (originalFriend) {
        originalFriend.status = 'accepted';
        originalFriend.acceptedAt = new Date();
        await originalFriend.save();
        console.log(`✅ Updated original Friend record to accepted`);
      } else {
        console.warn(`⚠️ Original Friend record not found, creating new one`);
        const newFriend = new Friend({
          userId: request.fromUserId,
          friendUserId: request.toUserId,
          source: 'app_connection',
          status: 'accepted',
          acceptedAt: new Date(),
          cachedData: {
            name: toUser.name,
            profileImage: toUser.profileImage || '',
            username: toUser.username || '',
            lastCacheUpdate: new Date()
          }
        });
        await newFriend.save();
      }
      
      // Create reciprocal Friend record
      const reciprocalFriend = await Friend.findOne({
        userId: request.toUserId,
        friendUserId: request.fromUserId,
        isDeleted: false
      });
      
      if (!reciprocalFriend) {
        const newReciprocal = new Friend({
          userId: request.toUserId,
          friendUserId: request.fromUserId,
          source: 'app_connection',
          status: 'accepted',
          acceptedAt: new Date(),
          cachedData: {
            name: fromUser.name,
            profileImage: fromUser.profileImage || '',
            username: fromUser.username || '',
            lastCacheUpdate: new Date()
          }
        });
        await newReciprocal.save();
        console.log(`✅ Created reciprocal Friend record`);
      } else {
        reciprocalFriend.status = 'accepted';
        reciprocalFriend.acceptedAt = new Date();
        await reciprocalFriend.save();
        console.log(`✅ Updated reciprocal Friend record to accepted`);
      }
    } catch (friendError) {
      console.error('❌ Error updating Friend records:', friendError);
      // Don't fail the request if Friend update fails
      console.warn('⚠️ Connection accepted but Friend records may be out of sync');
    }
    
    // Send push notification to sender about acceptance
    try {
      // TODO: Implement server-side push notification service
      // For now, we'll rely on the frontend to handle notifications
      console.log(`📱 Push notification should be sent to ${fromUser.name} (${request.fromUserId}) about acceptance`);
    } catch (notificationError) {
      console.error('❌ Error sending acceptance notification:', notificationError);
      // Don't fail the request if notification fails
    }
    
    res.status(200).json({
      success: true,
      data: {
        message: 'Connection request accepted successfully',
        newConnection: {
          userId: fromUser.userId,
          name: fromUser.name,
          username: fromUser.username || '',
          profileImage: fromUser.profileImage || '',
          connectionDate
        }
      }
    });
  } catch (error) {
    console.error('Error accepting connection request:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error accepting connection request');
  }
});

// @desc    Decline connection request
// @route   PUT /api/connections/request/:requestId/decline
// @access  Private
const declineConnectionRequest = asyncHandler(async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.userId;
    
    console.log(`❌ Declining connection request ${requestId} by user ${userId}`);
    
    // Validate ObjectId format
    if (!requestId || !requestId.match(/^[0-9a-fA-F]{24}$/)) {
      res.status(400);
      throw new Error('Invalid request ID format');
    }
    
    // Find and validate request
    const request = await ConnectionRequest.findOne({
      _id: requestId,
      toUserId: userId,
      status: 'pending'
    });
    
    if (!request) {
      res.status(404);
      throw new Error('Connection request not found or already processed');
    }
    
    // Update request status
    request.status = 'declined';
    request.respondedAt = new Date();
    await request.save();
    
    console.log(`❌ Connection request declined: ${requestId}`);
    
    res.status(200).json({
      success: true,
      data: {
        message: 'Connection request declined'
      }
    });
  } catch (error) {
    console.error('Error declining connection request:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error declining connection request');
  }
});

// @desc    Cancel outgoing connection request
// @route   DELETE /api/connections/request/:requestId
// @access  Private
const cancelConnectionRequest = asyncHandler(async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.userId;
    
    console.log(`🚫 Cancelling connection request ${requestId} by user ${userId}`);
    
    // Validate ObjectId format - more lenient validation
    if (!requestId || requestId.trim() === '') {
      res.status(400);
      throw new Error('Request ID is required');
    }
    
    // Try to validate as ObjectId but be more flexible
    if (requestId.length !== 24 || !/^[0-9a-fA-F]{24}$/i.test(requestId)) {
      console.log(`⚠️ Invalid ObjectId format: ${requestId}, length: ${requestId.length}`);
      res.status(400);
      throw new Error('Invalid request ID format');
    }
    
    // Find and validate request
    const request = await ConnectionRequest.findOne({
      _id: requestId,
      fromUserId: userId,
      status: 'pending'
    });
    
    if (!request) {
      res.status(404);
      throw new Error('Connection request not found or cannot be cancelled');
    }
    
    // Delete the request instead of updating status to prevent duplicates
    await ConnectionRequest.deleteOne({ _id: requestId });
    
    console.log(`🚫 Connection request cancelled: ${requestId}`);
    
    res.status(200).json({
      success: true,
      data: {
        message: 'Connection request cancelled'
      }
    });
  } catch (error) {
    console.error('Error cancelling connection request:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error cancelling connection request');
  }
});

// @desc    Get mutual connections count
// @route   GET /api/connections/mutual/:userId
// @access  Private
const getMutualConnections = asyncHandler(async (req, res) => {
  try {
    const { userId: targetUserId } = req.params;
    const currentUserId = req.user.userId;
    
    if (targetUserId === currentUserId) {
      res.status(400);
      throw new Error('Cannot get mutual connections with yourself');
    }
    
    const mutualCount = await calculateMutualConnections(currentUserId, targetUserId);
    
    res.status(200).json({
      success: true,
      data: {
        mutualConnectionsCount: mutualCount
      }
    });
  } catch (error) {
    console.error('Error getting mutual connections:', error);
    res.status(500);
    throw new Error('Error getting mutual connections');
  }
});

// @desc    Get user's accepted connections
// @route   GET /api/connections
// @access  Private
const getConnections = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 50 } = req.query;
    
    console.log(`🔍 [PRIVACY DEBUG] Getting connections for user ${userId}`);
    console.log(`🔍 [PRIVACY DEBUG] Request user object:`, {
      id: req.user.id,
      userId: req.user.userId,
      name: req.user.name,
      phoneNumber: req.user.phoneNumber
    });
    
    // Find user and populate app connections
    const user = await User.findOne({ userId }, 'appConnections userId name phoneNumber');
    
    if (!user) {
      console.error(`❌ [PRIVACY DEBUG] User not found for userId: ${userId}`);
      res.status(404);
      throw new Error('User not found');
    }
    
    console.log(`🔍 [PRIVACY DEBUG] Found user:`, {
      _id: user._id,
      userId: user.userId,
      name: user.name,
      phoneNumber: user.phoneNumber,
      totalAppConnections: user.appConnections.length
    });
    
    // Log all app connections for debugging
    console.log(`🔍 [PRIVACY DEBUG] All app connections for user ${userId}:`, 
      user.appConnections.map(conn => ({
        userId: conn.userId,
        name: conn.name,
        status: conn.status,
        connectionDate: conn.connectionDate
      }))
    );
    
    // Get accepted connections
    const connections = user.appConnections
      .filter(conn => conn.status === 'accepted')
      .sort((a, b) => new Date(b.connectionDate) - new Date(a.connectionDate))
      .slice((parseInt(page) - 1) * parseInt(limit), parseInt(page) * parseInt(limit));
    
    console.log(`🔍 [PRIVACY DEBUG] Filtered accepted connections:`, 
      connections.map(conn => ({
        userId: conn.userId,
        name: conn.name,
        status: conn.status
      }))
    );
    
    // Format connections for response
    const formattedConnections = connections.map(conn => ({
      userId: conn.userId,
      name: conn.name,
      username: conn.username || '',
      profileImage: conn.profileImage || '',
      phoneNumber: '', // App connections may not have phone numbers
      connectedAt: conn.connectionDate,
      isActive: true,
      lastSeen: conn.lastSeen || conn.connectionDate,
      status: 'Available' // Default status
    }));
    
    console.log(`🔍 [PRIVACY DEBUG] Final response connections:`, {
      count: formattedConnections.length,
      userIds: formattedConnections.map(c => c.userId),
      requestingUser: userId
    });
    
    // CRITICAL PRIVACY CHECK: Ensure we're only returning connections for the authenticated user
    if (formattedConnections.length > 0) {
      console.log(`🔍 [PRIVACY DEBUG] FINAL PRIVACY VALIDATION - User ${userId} is seeing connections to:`, 
        formattedConnections.map(c => `${c.name} (${c.userId})`).join(', ')
      );
    }
    
    res.status(200).json({
      success: true,
      data: {
        connections: formattedConnections,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: user.appConnections.filter(conn => conn.status === 'accepted').length
        }
      }
    });
  } catch (error) {
    console.error('Error getting connections:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error getting connections');
  }
});

// @desc    Check if connected with specific user
// @route   GET /api/connections/check/:userId
// @access  Private
const checkConnection = asyncHandler(async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const { userId: targetUserId } = req.params;
    
    console.log(`🔍 Checking connection: ${currentUserId} -> ${targetUserId}`);
    
    if (currentUserId === targetUserId) {
      return res.status(200).json({
        success: true,
        data: { isConnected: false }
      });
    }
    
    // Find current user and check if target user is in their connections
    const user = await User.findOne({ userId: currentUserId }, 'appConnections');
    
    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }
    
    const isConnected = user.appConnections.some(
      conn => conn.userId === targetUserId && conn.status === 'accepted'
    );
    
    console.log(`🔍 Connection status: ${isConnected}`);
    
    res.status(200).json({
      success: true,
      data: { isConnected }
    });
  } catch (error) {
    console.error('Error checking connection:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error checking connection');
  }
});

// @desc    Check connection status with multiple users
// @route   POST /api/connections/check-multiple
// @access  Private
const checkMultipleConnections = asyncHandler(async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const { userIds } = req.body;
    
    console.log(`🔍 Checking multiple connections for user ${currentUserId}:`, userIds);
    
    if (!Array.isArray(userIds) || userIds.length === 0) {
      res.status(400);
      throw new Error('userIds must be a non-empty array');
    }
    
    // Find current user and get their connections
    const user = await User.findOne({ userId: currentUserId }, 'appConnections');
    
    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }
    
    // Create a map of connection statuses
    const connections = {};
    const connectedUserIds = new Set(
      user.appConnections
        .filter(conn => conn.status === 'accepted')
        .map(conn => conn.userId)
    );
    
    userIds.forEach(userId => {
      connections[userId] = connectedUserIds.has(userId);
    });
    
    console.log(`🔍 Multiple connection results:`, connections);
    
    res.status(200).json({
      success: true,
      data: { connections }
    });
  } catch (error) {
    console.error('Error checking multiple connections:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error checking multiple connections');
  }
});

// @desc    Remove/unfriend a connection
// @route   DELETE /api/connections/:userId
// @access  Private
const removeConnection = asyncHandler(async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const { userId: targetUserId } = req.params;
    
    console.log(`🗑️ Removing connection: ${currentUserId} -> ${targetUserId}`);
    
    if (currentUserId === targetUserId) {
      res.status(400);
      throw new Error('Cannot remove connection with yourself');
    }
    
    // Find both users
    const [currentUser, targetUser] = await Promise.all([
      User.findOne({ userId: currentUserId }),
      User.findOne({ userId: targetUserId })
    ]);
    
    if (!currentUser || !targetUser) {
      res.status(404);
      throw new Error('One or both users not found');
    }
    
    // Remove connection from both users (bidirectional)
    currentUser.appConnections = currentUser.appConnections.filter(
      conn => conn.userId !== targetUserId
    );
    
    targetUser.appConnections = targetUser.appConnections.filter(
      conn => conn.userId !== currentUserId
    );
    
    await Promise.all([currentUser.save(), targetUser.save()]);
    
    console.log(`✅ Connection removed: ${currentUserId} <-> ${targetUserId}`);
    
    res.status(200).json({
      success: true,
      data: { message: 'Connection removed successfully' }
    });
  } catch (error) {
    console.error('Error removing connection:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error removing connection');
  }
});

// @desc    Health check for connections API
// @route   GET /api/connections/health
// @access  Private
const getConnectionsHealth = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      message: 'Connections API is operational'
    }
  });
});

module.exports = {
  sendConnectionRequest,
  getIncomingRequests,
  getOutgoingRequests,
  acceptConnectionRequest,
  declineConnectionRequest,
  cancelConnectionRequest,
  getMutualConnections,
  getConnections,
  checkConnection,
  checkMultipleConnections,
  removeConnection,
  getConnectionsHealth
};
