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
    
    // Get all connection IDs for both users (phone contacts + app connections)
    const user1Connections = new Set([
      ...user1.contacts.map(id => id.toString()),
      ...user1.appConnections.map(conn => conn.userId)
    ]);
    
    const user2Connections = new Set([
      ...user2.contacts.map(id => id.toString()),
      ...user2.appConnections.map(conn => conn.userId)
    ]);
    
    // Find mutual connections
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

// @desc    Search for public users globally
// @route   POST /api/search/users
// @access  Private
const searchUsers = asyncHandler(async (req, res) => {
  try {
    const { query, limit = 20, offset = 0 } = req.body;
    const currentUserId = req.user.userId;
    
    // Validate input
    if (!query || typeof query !== 'string') {
      res.status(400);
      throw new Error('Search query is required');
    }
    
    if (query.length < 2) {
      res.status(400);
      throw new Error('Search query must be at least 2 characters');
    }
    
    // Check rate limiting using the new service
    const rateLimitResult = checkRateLimit(currentUserId, 'SEARCH');
    if (!rateLimitResult.allowed) {
      res.status(429);
      res.set('Retry-After', rateLimitResult.retryAfter);
      throw new Error(`Too many search requests. Try again in ${rateLimitResult.retryAfter} seconds.`);
    }
    
    console.log(`🔍 Global search: "${query}" by user ${currentUserId}`);
    
    // Get current user's existing connections to exclude from suggestions
    const currentUser = await User.findOne({ userId: currentUserId }, 'contacts appConnections');
    if (!currentUser) {
      res.status(404);
      throw new Error('User not found');
    }
    
    // Get blocked user IDs to exclude from search (only mutual blocking)
    const [blockedByCurrentUser, blockingCurrentUser] = await Promise.all([
      Block.find({ blockerId: currentUserId }).select('blockedUserId').lean(),
      Block.find({ blockedUserId: currentUserId }).select('blockerId').lean()
    ]);
    
    // Get existing contacts (device contacts) - these are MongoDB ObjectIds
    const existingContactIds = currentUser.contacts.map(id => id.toString());
    
    // Get existing app connections - ONLY include currently accepted connections
    // Exclude declined, cancelled, or removed connections so they can be re-discovered
    const existingAppConnectionIds = currentUser.appConnections
      .filter(conn => conn.status === 'accepted')
      .map(conn => conn.userId);
    
    console.log(`🔍 [CONNECTION STATUS] App connections breakdown:`, {
      total: currentUser.appConnections.length,
      accepted: currentUser.appConnections.filter(c => c.status === 'accepted').length,
      pending: currentUser.appConnections.filter(c => c.status === 'pending').length,
      declined: currentUser.appConnections.filter(c => c.status === 'declined').length,
      cancelled: currentUser.appConnections.filter(c => c.status === 'cancelled').length,
      acceptedUserIds: existingAppConnectionIds
    });
    
    console.log(`🔍 [DEBUG] Current user app connections:`, {
      total: currentUser.appConnections.length,
      accepted: existingAppConnectionIds.length,
      acceptedUserIds: existingAppConnectionIds
    });
    
    // Find users by their MongoDB ObjectIds to get their userIds for exclusion
    const contactUsers = await User.find({ 
      _id: { $in: currentUser.contacts } 
    }, 'userId').lean();
    const contactUserIds = contactUsers.map(user => user.userId);
    
    // CRITICAL DEBUG: Let's see what we're actually excluding
    console.log(`🔍 [CRITICAL DEBUG] Raw data:`, {
      currentUserContacts: currentUser.contacts.length,
      currentUserAppConnections: currentUser.appConnections.length,
      contactObjectIds: existingContactIds,
      contactUsers: contactUsers,
      contactUserIds: contactUserIds,
      appConnectionIds: existingAppConnectionIds
    });
    
    const excludedUserIds = [
      currentUserId,
      ...blockedByCurrentUser.map(b => b.blockedUserId),
      ...blockingCurrentUser.map(b => b.blockerId),
      ...contactUserIds, // Exclude existing device contacts
      ...existingAppConnectionIds // Exclude existing app connections
    ];
    
    console.log(`🔍 [DEBUG] Current user details:`, {
      userId: currentUserId,
      mongoId: currentUser._id,
      contactsCount: currentUser.contacts.length,
      appConnectionsCount: currentUser.appConnections.length
    });
    
    console.log(`🔍 [DEBUG] Contacts details:`, {
      contactObjectIds: currentUser.contacts.map(id => id.toString()),
      contactUserIds: contactUserIds,
      appConnectionUserIds: existingAppConnectionIds
    });
    
    console.log(`🔍 [DEBUG] Excluding from suggestions:`, {
      currentUser: currentUserId,
      deviceContacts: contactUserIds.length,
      appConnections: existingAppConnectionIds.length,
      blocked: blockedByCurrentUser.length + blockingCurrentUser.length,
      totalExcluded: excludedUserIds.length
    });
    
    console.log(`🔍 [DEBUG] Full exclusion list:`, excludedUserIds);
    
    // Create search regex for partial matching
    const searchRegex = new RegExp(query.split('').join('.*'), 'i');
    
    // Build the MongoDB query
    const mongoQuery = {
      $and: [
        { userId: { $nin: excludedUserIds } }, // Exclude current user and blocked users
        { isPublic: true }, // Only public profiles
        {
          $or: [
            { name: { $regex: searchRegex } },
            { username: { $regex: searchRegex } },
            { searchableName: { $regex: searchRegex } }
          ]
        }
      ]
    };
    
    console.log(`🔍 [MONGODB DEBUG] Query:`, JSON.stringify(mongoQuery, null, 2));
    console.log(`🔍 [MONGODB DEBUG] Excluded userIds:`, excludedUserIds);
    console.log(`🔍 [MONGODB DEBUG] Excluded userIds types:`, excludedUserIds.map(id => typeof id));
    console.log(`🔍 [MONGODB DEBUG] Sample excluded userIds:`, excludedUserIds.slice(0, 3));
    
    // CRITICAL DEBUG: Check public users count
    const totalPublicUsers = await User.countDocuments({ isPublic: true });
    console.log(`🔍 [CRITICAL DEBUG] Total public users in database: ${totalPublicUsers}`);
    if (totalPublicUsers === 0) {
      console.log(`🚨 [CRITICAL ISSUE] NO USERS HAVE isPublic: true! Global search will return empty results.`);
    }
    
    // Search public users by name or username, excluding blocked users
    const searchResults = await User.find(mongoQuery)
    .select('userId name username profileImage isPublic') // Safe projection - no sensitive data
    .limit(parseInt(limit))
    .skip(parseInt(offset))
    .lean();
    
    console.log(`🔍 [DEBUG] Found ${searchResults.length} public users matching "${query}"`);
    console.log(`🔍 [DEBUG] Search results userIds:`, searchResults.map(u => u.userId));
    console.log(`🔍 [DEBUG] Search results userIds types:`, searchResults.map(u => typeof u.userId));
    
    // CRITICAL: Check if our exclusion logic is working
    const violatingUsers = searchResults.filter(u => excludedUserIds.includes(u.userId));
    console.log(`🔍 [CRITICAL] Users that should be excluded but appear in results:`, 
      violatingUsers.map(u => ({
        userId: u.userId,
        name: u.name,
        shouldBeExcluded: true,
        isInContactUserIds: contactUserIds.includes(u.userId),
        isInAppConnectionIds: existingAppConnectionIds.includes(u.userId)
      }))
    );
    
    if (violatingUsers.length > 0) {
      console.log(`❌ [CRITICAL ERROR] Exclusion logic failed! ${violatingUsers.length} users should have been excluded`);
      console.log(`❌ [CRITICAL ERROR] MongoDB query did not exclude these users properly`);
    } else {
      console.log(`✅ [SUCCESS] Exclusion logic working correctly`);
    }
    
    // EMERGENCY FIX: Filter out excluded users manually as a safety net
    const manuallyFilteredResults = searchResults.filter(user => {
      const shouldExclude = excludedUserIds.includes(user.userId);
      if (shouldExclude) {
        console.log(`🚨 [MANUAL FILTER] Removing ${user.name} (${user.userId}) - should have been excluded by MongoDB`);
      }
      return !shouldExclude;
    });
    
    console.log(`🔧 [MANUAL FILTER] Results after manual filtering: ${manuallyFilteredResults.length} (was ${searchResults.length})`);
    
    // Use manually filtered results instead of original search results
    const finalResults = manuallyFilteredResults;
    
    // Get existing connection requests for these users (including all statuses)
    const userIds = finalResults.map(user => user.userId);
    const existingRequests = await ConnectionRequest.find({
      $or: [
        { fromUserId: currentUserId, toUserId: { $in: userIds } },
        { fromUserId: { $in: userIds }, toUserId: currentUserId }
      ]
    }).lean();
    
    // Create lookup map for request status with detailed info
    const requestStatusMap = new Map();
    existingRequests.forEach(req => {
      if (req.fromUserId === currentUserId) {
        // Current user sent the request
        requestStatusMap.set(req.toUserId, {
          status: req.status,
          direction: 'outgoing',
          requestId: req._id,
          createdAt: req.createdAt
        });
      } else {
        // Current user received the request
        requestStatusMap.set(req.fromUserId, {
          status: req.status,
          direction: 'incoming',
          requestId: req._id,
          createdAt: req.createdAt
        });
      }
    });
    
    // Optimize mutual connections calculation - batch process instead of individual queries
    // userIds already declared above for connection requests
    
    // Get all users' connections in one query for efficiency
    const allUsersConnections = await User.find(
      { userId: { $in: [currentUserId, ...userIds] } },
      'userId contacts appConnections'
    ).lean();
    
    // Create a map for quick lookup
    const connectionsMap = new Map();
    allUsersConnections.forEach(user => {
      const allConnections = [
        ...user.contacts.map(id => id.toString()),
        ...user.appConnections.map(conn => conn.userId)
      ];
      connectionsMap.set(user.userId, new Set(allConnections));
    });
    
    const currentUserConnections = connectionsMap.get(currentUserId) || new Set();
    
    // Enhance results with mutual connections and request status
    const enhancedResults = finalResults.map((user) => {
      // Calculate mutual connections efficiently
      const userConnections = connectionsMap.get(user.userId) || new Set();
      let mutualConnectionsCount = 0;
      
      for (const connection of currentUserConnections) {
        if (userConnections.has(connection)) {
          mutualConnectionsCount++;
        }
      }
      
      const requestStatus = requestStatusMap.get(user.userId) || null;
      
      // Determine the display status and action availability
      let displayStatus = 'none'; // none, sent, received, connected, declined
      let canSendRequest = true;
      let actionText = 'Add Friend';
      
      if (requestStatus) {
        if (requestStatus.status === 'pending') {
          if (requestStatus.direction === 'outgoing') {
            displayStatus = 'sent';
              canSendRequest = false;
              actionText = 'Sent';
            } else {
              displayStatus = 'received';
              canSendRequest = false;
              actionText = 'Respond';
            }
          } else if (requestStatus.status === 'accepted') {
            displayStatus = 'connected';
            canSendRequest = false;
            actionText = 'Connected';
          } else if (requestStatus.status === 'declined') {
            displayStatus = 'declined';
            canSendRequest = true; // Allow sending new request after decline
            actionText = 'Add Friend';
          }
        }
        
        return {
          userId: user.userId,
          name: user.name,
          username: user.username || '',
          profileImage: user.profileImage || '',
          mutualConnectionsCount,
          connectionStatus: requestStatus?.status || null,
          connectionDirection: requestStatus?.direction || null,
          requestId: requestStatus?.requestId || null,
          displayStatus,
          canSendRequest,
          actionText,
          requestSentAt: requestStatus?.createdAt || null
        };
    });
    
    res.status(200).json({
      success: true,
      data: {
        results: enhancedResults,
        query,
        totalResults: enhancedResults.length,
        hasMore: enhancedResults.length === parseInt(limit),
        debug: {
          originalResultsCount: searchResults.length,
          filteredResultsCount: finalResults.length,
          excludedUsersCount: excludedUserIds.length,
          manualFilterApplied: searchResults.length !== finalResults.length,
          timestamp: new Date().toISOString()
        }
      }
    });
  } catch (error) {
    console.error('Error in global search:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error searching users');
  }
});

// @desc    Check if username is available
// @route   GET /api/search/username-available/:username
// @access  Private
const checkUsernameAvailability = asyncHandler(async (req, res) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user.userId;
    
    // Validate username format
    if (!username || username.length < 3 || username.length > 20) {
      res.status(400);
      throw new Error('Username must be 3-20 characters long');
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      res.status(400);
      throw new Error('Username can only contain letters, numbers, and underscores');
    }
    
    console.log(`🔍 Checking username availability: "${username}" for user ${currentUserId}`);
    
    // Check if username exists (excluding current user)
    const existingUser = await User.findOne({
      username: username,
      userId: { $ne: currentUserId }
    }).select('userId username');
    
    const isAvailable = !existingUser;
    
    console.log(`Username "${username}" is ${isAvailable ? 'available' : 'taken'}`);
    
    res.status(200).json({
      success: true,
      data: {
        username,
        available: isAvailable,
        message: isAvailable 
          ? `Username "${username}" is available` 
          : `Username "${username}" is already taken`
      }
    });
  } catch (error) {
    console.error('Error checking username availability:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error checking username availability');
  }
});

// @desc    Get search suggestions based on partial input
// @route   POST /api/search/suggestions
// @access  Private
const getSearchSuggestions = asyncHandler(async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;
    const currentUserId = req.user.userId;
    
    if (!query || query.length < 1) {
      return res.status(200).json({
        success: true,
        data: { suggestions: [] }
      });
    }
    
    // Get popular usernames and names for suggestions
    const suggestions = await User.find({
      $and: [
        { userId: { $ne: currentUserId } },
        { isPublic: true },
        {
          $or: [
            { username: { $regex: `^${query}`, $options: 'i' } },
            { name: { $regex: `^${query}`, $options: 'i' } }
          ]
        }
      ]
    })
    .select('name username')
    .limit(parseInt(limit))
    .lean();
    
    const suggestionList = suggestions.map(user => ({
      text: user.username || user.name,
      type: user.username ? 'username' : 'name'
    }));
    
    res.status(200).json({
      success: true,
      data: { suggestions: suggestionList }
    });
  } catch (error) {
    console.error('Error getting search suggestions:', error);
    res.status(500);
    throw new Error('Error getting search suggestions');
  }
});

// @desc    Clear search cache and get fresh suggestions
// @route   POST /api/search/users/refresh
// @access  Private
const refreshSearchUsers = asyncHandler(async (req, res) => {
  try {
    const { query, limit = 20, offset = 0 } = req.body;
    const currentUserId = req.user.userId;
    
    console.log(`🔄 [REFRESH] Force refreshing search for "${query}" by user ${currentUserId}`);
    
    // Force fresh data by bypassing any potential caching
    // This is the same logic as searchUsers but with explicit fresh data fetching
    
    // Get current user's fresh data
    const currentUser = await User.findOne({ userId: currentUserId }, 'contacts appConnections').lean();
    if (!currentUser) {
      res.status(404);
      throw new Error('User not found');
    }
    
    // Get fresh blocked users data
    const [blockedByCurrentUser, blockingCurrentUser] = await Promise.all([
      Block.find({ blockerId: currentUserId }).select('blockedUserId').lean(),
      Block.find({ blockedUserId: currentUserId }).select('blockerId').lean()
    ]);
    
    // Get fresh contact user IDs
    const contactUsers = await User.find({ 
      _id: { $in: currentUser.contacts } 
    }, 'userId').lean();
    const contactUserIds = contactUsers.map(user => user.userId);
    
    // Get fresh app connection IDs
    const existingAppConnectionIds = currentUser.appConnections
      .filter(conn => conn.status === 'accepted')
      .map(conn => conn.userId);
    
    const excludedUserIds = [
      currentUserId,
      ...blockedByCurrentUser.map(b => b.blockedUserId),
      ...blockingCurrentUser.map(b => b.blockerId),
      ...contactUserIds,
      ...existingAppConnectionIds
    ];
    
    console.log(`🔄 [REFRESH] Fresh exclusion data:`, {
      contacts: contactUserIds.length,
      appConnections: existingAppConnectionIds.length,
      blocked: blockedByCurrentUser.length + blockingCurrentUser.length,
      totalExcluded: excludedUserIds.length
    });
    
    // Perform fresh search
    const searchRegex = new RegExp(query.split('').join('.*'), 'i');
    const searchResults = await User.find({
      $and: [
        { userId: { $nin: excludedUserIds } },
        { isPublic: true },
        {
          $or: [
            { name: { $regex: searchRegex } },
            { username: { $regex: searchRegex } },
            { searchableName: { $regex: searchRegex } }
          ]
        }
      ]
    })
    .select('userId name username profileImage isPublic')
    .limit(parseInt(limit))
    .skip(parseInt(offset))
    .lean();
    
    console.log(`🔄 [REFRESH] Fresh search results: ${searchResults.length} users`);
    
    res.status(200).json({
      success: true,
      data: {
        results: searchResults.map(user => ({
          userId: user.userId,
          name: user.name,
          username: user.username || '',
          profileImage: user.profileImage || '',
          displayStatus: 'none',
          canSendRequest: true,
          actionText: 'Add Friend'
        })),
        query,
        totalResults: searchResults.length,
        refreshed: true,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error in refresh search:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error refreshing search');
  }
});

// @desc    Test exclusion logic specifically
// @route   GET /api/search/debug/exclusion-test
// @access  Private
const testExclusionLogic = asyncHandler(async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    
    console.log(`🧪 [TEST] Testing exclusion logic for user ${currentUserId}`);
    
    // Get current user data
    const currentUser = await User.findOne({ userId: currentUserId }).lean();
    if (!currentUser) {
      res.status(404);
      throw new Error('User not found');
    }
    
    // Get all public users
    const allPublicUsers = await User.find({ isPublic: true }, 'userId name username').lean();
    
    // Build exclusion list step by step
    const contactUsers = await User.find({ 
      _id: { $in: currentUser.contacts } 
    }, 'userId name username').lean();
    const contactUserIds = contactUsers.map(user => user.userId);
    
    const existingAppConnectionIds = currentUser.appConnections
      .filter(conn => conn.status === 'accepted')
      .map(conn => conn.userId);
    
    const excludedUserIds = [
      currentUserId,
      ...contactUserIds,
      ...existingAppConnectionIds
    ];
    
    // Test the exclusion
    const shouldBeExcluded = allPublicUsers.filter(u => excludedUserIds.includes(u.userId));
    const shouldBeIncluded = allPublicUsers.filter(u => !excludedUserIds.includes(u.userId));
    
    res.status(200).json({
      success: true,
      data: {
        currentUser: {
          userId: currentUser.userId,
          name: currentUser.name
        },
        totalPublicUsers: allPublicUsers.length,
        exclusionList: excludedUserIds,
        shouldBeExcluded: shouldBeExcluded.map(u => ({
          userId: u.userId,
          name: u.name,
          reason: u.userId === currentUserId ? 'self' : 
                  contactUserIds.includes(u.userId) ? 'contact' : 
                  existingAppConnectionIds.includes(u.userId) ? 'appConnection' : 'unknown'
        })),
        shouldBeIncluded: shouldBeIncluded.map(u => ({
          userId: u.userId,
          name: u.name
        })),
        expectedSuggestions: shouldBeIncluded.length
      }
    });
  } catch (error) {
    console.error('Error in exclusion test:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error testing exclusion logic');
  }
});

// @desc    Debug user connections data
// @route   GET /api/search/debug/connections
// @access  Private
const debugUserConnections = asyncHandler(async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    
    console.log(`🔍 [DEBUG] Getting connection data for user ${currentUserId}`);
    
    // Get current user's full data
    const currentUser = await User.findOne({ userId: currentUserId }).lean();
    if (!currentUser) {
      res.status(404);
      throw new Error('User not found');
    }
    
    // Get contact users details
    const contactUsers = await User.find({ 
      _id: { $in: currentUser.contacts } 
    }, 'userId name username').lean();
    
    // Get app connections details
    const appConnectionUserIds = currentUser.appConnections
      .filter(conn => conn.status === 'accepted')
      .map(conn => conn.userId);
    
    const appConnectionUsers = await User.find({
      userId: { $in: appConnectionUserIds }
    }, 'userId name username').lean();
    
    res.status(200).json({
      success: true,
      data: {
        currentUser: {
          userId: currentUser.userId,
          name: currentUser.name,
          mongoId: currentUser._id
        },
        deviceContacts: {
          count: currentUser.contacts.length,
          objectIds: currentUser.contacts.map(id => id.toString()),
          users: contactUsers.map(u => ({
            userId: u.userId,
            name: u.name,
            username: u.username
          }))
        },
        appConnections: {
          count: currentUser.appConnections.length,
          acceptedCount: currentUser.appConnections.filter(c => c.status === 'accepted').length,
          connections: currentUser.appConnections.map(conn => ({
            userId: conn.userId,
            name: conn.name,
            status: conn.status
          })),
          acceptedUserIds: appConnectionUserIds,
          users: appConnectionUsers.map(u => ({
            userId: u.userId,
            name: u.name,
            username: u.username
          }))
        }
      }
    });
  } catch (error) {
    console.error('Error in debug connections:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error debugging connections');
  }
});

module.exports = {
  searchUsers,
  checkUsernameAvailability,
  getSearchSuggestions,
  refreshSearchUsers,
  testExclusionLogic,
  debugUserConnections
};
