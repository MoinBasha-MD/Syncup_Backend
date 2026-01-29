const User = require('../models/userModel');
const StatusHistory = require('../models/statusHistoryModel');
const StatusPrivacy = require('../models/statusPrivacyModel');
const socketManager = require('../socketManager');
const contactService = require('../services/contactService');

/**
 * @desc    Update user status
 * @route   PUT /api/status
 * @access  Private
 */
const updateUserStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    const { 
      status, customStatus, duration, location,
      // NEW: Hierarchical status fields
      mainStatus, mainDuration, mainDurationLabel,
      subStatus, subDuration, subDurationLabel
    } = req.body;
    
    console.log('📥 [BACKEND] Received status update request');
    console.log('📥 [BACKEND] Location data:', JSON.stringify(location));
    console.log('📥 [BACKEND] shareWithContacts:', location?.shareWithContacts);
    
    // Check if status is provided
    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required',
        details: 'Please provide a valid status value'
      });
    }
    
    // Log the status being used
    console.log(`[STATUS UPDATE] Received status update request with status: '${status}', customStatus: '${customStatus || ""}', duration: ${duration || "null"}, location: ${location ? JSON.stringify(location) : "null"}`);
    
    // No status mapping or normalization - use the status value as provided
    
    // Store previous status for history tracking
    const previousStatus = user.status;
    const previousCustomStatus = user.customStatus || '';
    const statusChangeTime = new Date();
    
    // ✅ NEW: Save current status as previous status when changing to a new status
    // Only save if current status is not "Available" or empty
    if (user.status && user.status.toLowerCase() !== 'available' && user.status !== '') {
      user.previousStatus = user.customStatus || user.status;
      user.previousStatusEndTime = user.statusUntil || new Date();
      console.log(`💾 [PREVIOUS STATUS] Saved: "${user.previousStatus}" ended at ${user.previousStatusEndTime}`);
    }
    
    // ✅ NEW: Clear previous status when setting a new non-Available status
    if (status && status.toLowerCase() !== 'available') {
      // Previous status will be saved above, now we're starting a new status
      console.log(`🔄 [STATUS CHANGE] Changing from "${user.status}" to "${status}"`);
    }
    
    // NEW: Update hierarchical status if provided
    if (mainStatus) {
      user.mainStatus = mainStatus;
      user.mainDuration = mainDuration || 0;
      user.mainDurationLabel = mainDurationLabel || '';
      user.mainStartTime = new Date();
      
      if (mainDuration) {
        user.mainEndTime = new Date(Date.now() + mainDuration * 60000);
      }
      
      // Update sub-status if provided
      if (subStatus) {
        user.subStatus = subStatus;
        user.subDuration = subDuration || 0;
        user.subDurationLabel = subDurationLabel || '';
        user.subStartTime = new Date();
        
        if (subDuration) {
          user.subEndTime = new Date(Date.now() + subDuration * 60000);
        }
      } else {
        // Clear sub-status
        user.subStatus = null;
        user.subDuration = 0;
        user.subDurationLabel = '';
        user.subStartTime = null;
        user.subEndTime = null;
      }
      
      // BACKWARD COMPATIBILITY: Map to old fields
      user.status = mainStatus;
      user.customStatus = mainStatus;
      if (mainDuration) {
        user.statusUntil = user.mainEndTime;
      }
    } else {
      // OLD FORMAT: Update status fields with the original status
      user.status = status;
      
      // Update custom status if provided
      if (customStatus) {
        user.customStatus = customStatus;
      } else {
        user.customStatus = '';
      }
      
      // Map old to new for consistency
      user.mainStatus = customStatus || status;
      if (duration) {
        user.mainDuration = duration;
        user.mainStartTime = new Date();
        user.mainEndTime = new Date(Date.now() + duration * 60000);
      }
    }
    
    // Update location data if provided - CHECK if location has actual data
    if (location && location.placeName && location.placeName.trim() !== '') {
      console.log(`[LOCATION UPDATE] Processing location data:`, JSON.stringify(location));
      
      // Initialize statusLocation if it doesn't exist
      if (!user.statusLocation) {
        user.statusLocation = {};
      }
      
      // Update location fields
      user.statusLocation.placeName = location.placeName;
      
      if (location.coordinates) {
        user.statusLocation.coordinates = {
          latitude: location.coordinates.latitude,
          longitude: location.coordinates.longitude
        };
      }
      
      if (location.address) {
        user.statusLocation.address = location.address;
      }
      
      // Always set to TRUE - no restrictions
      user.statusLocation.shareWithContacts = true;
      
      // Update timestamp
      user.statusLocation.timestamp = new Date();
      
      console.log(`[LOCATION SAVED] Location data saved to user:`, JSON.stringify(user.statusLocation));
    } else {
      // Clear location data if no valid location provided
      console.log(`[LOCATION CLEAR] No valid location data provided (location: ${JSON.stringify(location)}), clearing existing location`);
      if (user.statusLocation) {
        user.statusLocation = {
          placeName: '',
          coordinates: {},
          address: '',
          shareWithContacts: false,
          timestamp: new Date()
        };
      }
    }
    
    // Set status expiration if duration provided (in minutes)
    let expirationTime = null;
    if (duration && duration > 0) {
      expirationTime = new Date();
      expirationTime.setMinutes(expirationTime.getMinutes() + duration);
      user.statusUntil = expirationTime;
    } else {
      user.statusUntil = null; // No expiration
    }
    
    // Log the status data before saving to the database
    console.log(`[STATUS DB SAVE] Saving to database - User: ${user.userId}, Status: '${user.status}', CustomStatus: '${user.customStatus || ""}', StatusUntil: ${user.statusUntil ? user.statusUntil.toISOString() : "null"}`);
    
    const updatedUser = await user.save();
    
    // Log the status data after saving to the database
    console.log(`[STATUS DB SAVED] Successfully saved to database - User: ${updatedUser.userId}, Status: '${updatedUser.status}', CustomStatus: '${updatedUser.customStatus || ""}', StatusUntil: ${updatedUser.statusUntil ? updatedUser.statusUntil.toISOString() : "null"}`);
    
    // Create status history entry if status has changed
    if (previousStatus !== status || 
        previousCustomStatus !== user.customStatus) {
      
      // Create a new status history entry
      await StatusHistory.create({
        user: user._id,
        userId: user.userId,
        status: status,
        customStatus: user.customStatus || '',
        startTime: statusChangeTime,
        endTime: expirationTime || new Date(statusChangeTime.getTime() + 24 * 60 * 60 * 1000), // Default to 24 hours if no expiration
        duration: duration || 1440, // Default to 24 hours (1440 minutes) if no duration specified
      });
    }
    
    // Broadcast status update to all users who have this user in their contacts
    const statusData = {
      // OLD FORMAT (backward compatibility)
      status: updatedUser.status,
      customStatus: updatedUser.customStatus,
      statusUntil: updatedUser.statusUntil,
      statusLocation: updatedUser.statusLocation,
      
      // NEW: Hierarchical status
      mainStatus: updatedUser.mainStatus,
      mainDuration: updatedUser.mainDuration,
      mainDurationLabel: updatedUser.mainDurationLabel,
      mainStartTime: updatedUser.mainStartTime,
      mainEndTime: updatedUser.mainEndTime,
      
      subStatus: updatedUser.subStatus,
      subDuration: updatedUser.subDuration,
      subDurationLabel: updatedUser.subDurationLabel,
      subStartTime: updatedUser.subStartTime,
      subEndTime: updatedUser.subEndTime
    };
    
    console.log('📡 [SOCKET BROADCAST] Broadcasting hierarchical status:', JSON.stringify(statusData));
    
    // Use the enhanced socketManager to broadcast the status update
    socketManager.broadcastStatusUpdate(updatedUser, statusData);
    
    res.json({
      success: true,
      data: {
        userId: updatedUser.userId,
        // OLD FORMAT
        status: updatedUser.status,
        customStatus: updatedUser.customStatus,
        statusUntil: updatedUser.statusUntil,
        statusLocation: updatedUser.statusLocation,
        // NEW: Hierarchical status
        mainStatus: updatedUser.mainStatus,
        mainDuration: updatedUser.mainDuration,
        mainDurationLabel: updatedUser.mainDurationLabel,
        mainStartTime: updatedUser.mainStartTime,
        mainEndTime: updatedUser.mainEndTime,
        subStatus: updatedUser.subStatus,
        subDuration: updatedUser.subDuration,
        subDurationLabel: updatedUser.subDurationLabel,
        subStartTime: updatedUser.subStartTime,
        subEndTime: updatedUser.subEndTime
      }
    });
  } catch (error) {
    console.error('Status update error:', error);
    
    // Check if it's a rate limit error
    if (error.message && error.message.includes('Rate limit')) {
      return res.status(429).json({ 
        success: false,
        message: 'Too many status updates. Please wait a moment and try again.', 
        error: error.message,
        retryAfter: 60 // Suggest retry after 60 seconds
      });
    }
    
    res.status(500).json({ 
      success: false,
      message: 'Server error during status update', 
      error: error.message 
    });
  }
};

/**
 * @desc    Get current user status
 * @route   GET /api/status
 * @access  Private
 */
const getUserStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // Check if status timer has expired
    if (user.statusUntil && new Date() > new Date(user.statusUntil)) {
      user.status = 'available';
      user.customStatus = '';
      user.statusUntil = null;
      await user.save();
    }

    res.json({
      success: true,
      data: {
        userId: user.userId,
        status: user.status,
        customStatus: user.customStatus,
        statusUntil: user.statusUntil,
        // NEW: Hierarchical status fields for sub-activity persistence
        mainStatus: user.mainStatus,
        mainDuration: user.mainDuration,
        mainDurationLabel: user.mainDurationLabel,
        mainStartTime: user.mainStartTime,
        mainEndTime: user.mainEndTime,
        subStatus: user.subStatus,
        subDuration: user.subDuration,
        subDurationLabel: user.subDurationLabel,
        subStartTime: user.subStartTime,
        subEndTime: user.subEndTime
      }
    });
  } catch (error) {
    console.error('Get status error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error while getting status', 
      error: error.message 
    });
  }
};

/**
 * @desc    Get specific user status
 * @route   GET /api/status/:userId
 * @access  Private
 */
const getSpecificUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const viewerUserId = req.user._id;
    console.log(`🔍 Getting status for user: ${userId}, viewer: ${viewerUserId}`);
    
    const user = await User.findOne({ userId: userId });
    if (!user) {
      console.log(`❌ User not found: ${userId}`);
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    console.log(`✅ Found user: ${user.name} (${user.phoneNumber})`);
    
    // Check privacy permissions - can the viewer see this user's status?
    const canSeeStatus = await StatusPrivacy.canUserSeeStatus(userId, viewerUserId);
    console.log(`🔒 Privacy check - Can viewer see status: ${canSeeStatus}`);
    
    if (!canSeeStatus) {
      console.log(`🚫 Privacy denied - viewer ${viewerUserId} cannot see status of user ${userId}`);
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this user\'s status',
        data: {
          userId: user._id,
          name: user.name,
          phoneNumber: user.phoneNumber,
          status: 'private', // Show as private when access is denied
          customStatus: '',
          lastSeen: null,
          isOnline: false,
          location: null,
          statusHistory: null
        }
      });
    }

    console.log(`📊 User status: ${user.status}, Custom: ${user.customStatus}`);
    
    // Get the latest status history entry for this user
    const latestStatusHistory = await StatusHistory.findOne({ userId })
      .sort({ createdAt: -1 })
      .limit(1);

    console.log(`📈 Latest status history:`, latestStatusHistory);

    const statusData = {
      userId: user._id,
      name: user.name,
      phoneNumber: user.phoneNumber,
      status: user.status,
      customStatus: user.customStatus || '',
      lastSeen: user.lastSeen,
      isOnline: user.isOnline,
      location: user.location || null,
      statusHistory: latestStatusHistory || null
    };

    console.log(`📤 Sending status data:`, statusData);
    
    // Return response with full status data
    res.json({
      success: true,
      status: {
        userId: user._id,
        name: user.name,
        phoneNumber: user.phoneNumber,
        status: user.status,
        customStatus: user.customStatus,
        lastSeen: user.lastSeen,
        isOnline: user.isOnline,
        location: user.location,
        statusHistory: user.statusHistory,
        statusUntil: user.statusUntil
      }
    });
  } catch (error) {
    console.error('❌ Error getting user status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error getting user status',
      error: error.message 
    });
  }
};

/**
 * @desc    Force sync status from app to database
 * @route   POST /api/status/sync
 * @access  Private
 */
const forceSyncStatus = async (req, res) => {
  try {
    const { status, customStatus, statusUntil } = req.body;
    
    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }
    
    console.log(`Force syncing status: ${status}, custom: ${customStatus}, until: ${statusUntil}`);
    
    // Get the user
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Update the status directly
    user.status = status;
    user.customStatus = customStatus || '';
    
    // Parse statusUntil if provided
    if (statusUntil) {
      user.statusUntil = new Date(statusUntil);
    } else {
      user.statusUntil = null;
    }
    
    // Save to database
    // Log the status data before saving to the database
    console.log(`[STATUS DB SAVE] Saving to database - User: ${user.userId}, Status: '${user.status}', CustomStatus: '${user.customStatus || ""}', StatusUntil: ${user.statusUntil ? user.statusUntil.toISOString() : "null"}`);
    
    const updatedUser = await user.save();
    
    // Log the status data after saving to the database
    console.log(`[STATUS DB SAVED] Successfully saved to database - User: ${updatedUser.userId}, Status: '${updatedUser.status}', CustomStatus: '${updatedUser.customStatus || ""}', StatusUntil: ${updatedUser.statusUntil ? updatedUser.statusUntil.toISOString() : "null"}`);
    
    // Clear any Redis cache for this user's status
    if (redisClient && redisClient.isReady) {
      try {
        await redisClient.del(`user:${user._id}:status`);
        await redisClient.del(`user:${user.userId}:status`);
        console.log('Cleared Redis cache for user status');
      } catch (redisError) {
        console.error('Redis cache clear error:', redisError);
      }
    }
    
    // Broadcast the status update
    const statusData = {
      status: updatedUser.status,
      customStatus: updatedUser.customStatus,
      statusUntil: updatedUser.statusUntil
    };
    
    socketManager.broadcastStatusUpdate(updatedUser, statusData);
    
    res.status(200).json({
      success: true,
      message: 'Status synced successfully',
      data: {
        userId: updatedUser.userId,
        status: updatedUser.status,
        customStatus: updatedUser.customStatus,
        statusUntil: updatedUser.statusUntil
      }
    });
  } catch (error) {
    console.error('Force sync status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during status sync',
      error: error.message
    });
  }
};



/**
 * @desc    Get status of a user by phone number
 * @route   GET /api/status/phone/:phoneNumber
 * @access  Private
 */
const getUserStatusByPhone = async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const viewerUserId = req.user._id;
    console.log(`Getting status for phone number: ${phoneNumber}, viewer: ${viewerUserId}`);
    
    // Simple security check - ensure the phone number is properly formatted
    if (!phoneNumber || phoneNumber.length < 5) {
      console.log('Invalid phone number format');
      return res.status(400).json({ 
        success: false,
        message: 'Invalid phone number format' 
      });
    }

    console.log(`Looking for user with normalized phone number: ${phoneNumber}`);
    const user = await User.findOne({ phoneNumber });

    if (!user) {
      console.log(`No user found with phone number: ${phoneNumber}`);
      return res.status(404).json({ 
        success: false,
        message: 'User not found with this phone number' 
      });
    }

    console.log(`Found user: ${user.name}, current status: ${user.status}, statusUntil: ${user.statusUntil}`);
    
    // Check privacy permissions - can the viewer see this user's status?
    const canSeeStatus = await StatusPrivacy.canUserSeeStatus(user._id, viewerUserId);
    console.log(`🔒 Privacy check - Can viewer see status: ${canSeeStatus}`);
    
    if (!canSeeStatus) {
      console.log(`🚫 Privacy denied - viewer ${viewerUserId} cannot see status of user ${user._id}`);
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this user\'s status',
        data: {
          status: 'private',
          customStatus: '',
          statusUntil: null
        }
      });
    }

    // Check if status timer has expired
    const currentTime = new Date();
    console.log(`Current time: ${currentTime.toISOString()}`);
    
    if (user.statusUntil && currentTime > new Date(user.statusUntil)) {
      console.log(`Status expired at ${user.statusUntil}, resetting to Available`);
      user.status = 'Available';  // ✅ FIXED: Capitalized to match app convention
      user.customStatus = '';
      user.statusUntil = null;
      await user.save();
      console.log('Status reset to Available');
    } else if (user.statusUntil) {
      console.log(`Status until: ${user.statusUntil}`);
    } else {
      console.log('Status until: No expiration');
    }

    // Prepare response data
    const responseData = {
      status: user.status,
      customStatus: user.customStatus,
      statusUntil: user.statusUntil
    };
    
    console.log('[STATUS BY PHONE] Returning status data:', JSON.stringify(responseData, null, 2));
    console.log(`[STATUS BY PHONE] Status value type: ${typeof user.status}, Raw value: '${user.status}'`);
    console.log(`[STATUS BY PHONE] Status comparison: user.status === 'available': ${user.status === 'available'}, user.status === 'At mail': ${user.status === 'At mail'}`);

    // Return response
    res.json({
      success: true,
      status: responseData  // Change 'data' to 'status' to match frontend expectations
    });
  } catch (error) {
    console.error('Get user status by phone error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error while getting user status by phone', 
      error: error.message 
    });
  }
};

/**
 * @desc    Get nearby users with active status and location
 * @route   GET /api/status/nearby
 * @access  Private
 */
const getNearbyUsers = async (req, res) => {
  try {
    const { latitude, longitude, radius = 5 } = req.query; // radius in km, default 5km
    const currentUserId = req.user._id;

    // Validate coordinates
    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates'
      });
    }

    // Convert radius to meters for MongoDB
    const radiusInMeters = parseFloat(radius) * 1000;

    // Find users with active status and location within radius
    const nearbyUsers = await User.find({
      _id: { $ne: currentUserId }, // Exclude current user
      'statusLocation.coordinates.latitude': { $exists: true },
      'statusLocation.coordinates.longitude': { $exists: true },
      'statusLocation.shareWithContacts': true, // Only users who share location
      statusUntil: { $gt: new Date() } // Status not expired
    }).select('name profileImage status customStatus statusLocation statusUntil');

    // Filter by distance and calculate distance for each user
    const locationService = require('../services/locationService');
    const usersWithDistance = nearbyUsers
      .map(user => {
        if (!user.statusLocation || !user.statusLocation.coordinates) {
          return null;
        }

        const distance = locationService.calculateDistance(
          lat,
          lon,
          user.statusLocation.coordinates.latitude,
          user.statusLocation.coordinates.longitude
        );

        if (distance <= parseFloat(radius)) {
          return {
            userId: user._id,
            name: user.name,
            profileImage: user.profileImage,
            status: user.status,
            customStatus: user.customStatus,
            location: {
              placeName: user.statusLocation.placeName,
              address: user.statusLocation.address,
              coordinates: user.statusLocation.coordinates
            },
            distance: distance,
            statusUntil: user.statusUntil
          };
        }
        return null;
      })
      .filter(user => user !== null)
      .sort((a, b) => a.distance - b.distance); // Sort by distance

    console.log(`[NEARBY USERS] Found ${usersWithDistance.length} users within ${radius}km`);

    res.json({
      success: true,
      count: usersWithDistance.length,
      radius: parseFloat(radius),
      users: usersWithDistance
    });
  } catch (error) {
    console.error('Get nearby users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while getting nearby users',
      error: error.message
    });
  }
};

module.exports = {
  updateUserStatus,
  getUserStatus,
  getSpecificUserStatus,
  getUserStatusByPhone,
  forceSyncStatus,
  getNearbyUsers
};
