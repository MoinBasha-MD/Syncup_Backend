const LocationSettings = require('../models/LocationSettings');
const User = require('../models/userModel');

/**
 * Get user's location sharing settings
 */
exports.getSettings = async (req, res) => {
  try {
    const userId = req.user._id;
    
    let settings = await LocationSettings.findOne({ userId })
      .populate('selectedFriends', 'name profileImage')
      .populate('activeSessions.friendId', 'name profileImage');
    
    // Create default settings if none exist
    if (!settings) {
      settings = await LocationSettings.create({ userId });
    }
    
    // Cleanup expired sessions
    await settings.cleanupExpiredSessions();
    
    res.json({
      success: true,
      settings
    });
    
  } catch (error) {
    console.error('❌ [LOCATION SHARING] Error getting settings:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting location sharing settings',
      error: error.message
    });
  }
};

/**
 * Update sharing mode
 */
exports.updateSharingMode = async (req, res) => {
  try {
    const userId = req.user._id;
    const { mode, selectedFriends } = req.body;
    
    if (!['all_friends', 'selected_friends', 'off'].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid sharing mode'
      });
    }
    
    let settings = await LocationSettings.findOne({ userId });
    
    if (!settings) {
      settings = await LocationSettings.create({ userId });
    }
    
    settings.sharingMode = mode;
    
    if (mode === 'selected_friends' && selectedFriends) {
      settings.selectedFriends = selectedFriends;
    }
    
    await settings.save();
    
    console.log(`✅ [LOCATION SHARING] Updated mode to ${mode} for user ${userId}`);
    
    res.json({
      success: true,
      settings
    });
    
  } catch (error) {
    console.error('❌ [LOCATION SHARING] Error updating mode:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating sharing mode',
      error: error.message
    });
  }
};

/**
 * Start sharing session with a friend (WhatsApp-style)
 */
exports.startSession = async (req, res) => {
  try {
    const userId = req.user._id;
    const { friendId, duration } = req.body; // duration in minutes: 15, 60, 480
    
    if (!friendId || !duration) {
      return res.status(400).json({
        success: false,
        message: 'Friend ID and duration are required'
      });
    }
    
    // Validate duration (15 min, 1 hour, 8 hours)
    if (![15, 60, 480].includes(parseInt(duration))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid duration. Must be 15, 60, or 480 minutes'
      });
    }
    
    // Verify contact/connection (using 'contacts' field, not 'friends')
    const user = await User.findById(userId).select('contacts appConnections');
    if (!user) {
      console.log('❌ [LOCATION SHARING] User not found:', userId);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Convert friendId to string for comparison
    const friendIdStr = friendId.toString();
    
    // Check if friend is in contacts (device contacts)
    const isContact = user.contacts && user.contacts.some(
      c => c.toString() === friendIdStr
    );
    
    // Check if friend is in app connections
    const isAppConnection = user.appConnections && user.appConnections.some(
      conn => conn.userId === friendIdStr
    );
    
    const hasConnection = isContact || isAppConnection;
    
    if (!hasConnection) {
      console.log('⚠️ [LOCATION SHARING] Not connected:', { 
        userId, 
        friendId, 
        hasContacts: user.contacts?.length > 0,
        hasAppConnections: user.appConnections?.length > 0 
      });
      return res.status(403).json({
        success: false,
        message: 'Not connected with this user'
      });
    }
    
    console.log('✅ [LOCATION SHARING] Connection verified:', { userId, friendId, isContact, isAppConnection });
    
    let settings = await LocationSettings.findOne({ userId });
    
    if (!settings) {
      settings = await LocationSettings.create({ userId });
    }
    
    await settings.startSession(friendId, parseInt(duration));
    
    // Populate friend details
    await settings.populate('activeSessions.friendId', 'name profileImage');
    
    console.log(`✅ [LOCATION SHARING] Started ${duration}min session: ${userId} → ${friendId}`);
    
    res.json({
      success: true,
      message: `Sharing location for ${duration} minutes`,
      settings
    });
    
  } catch (error) {
    console.error('❌ [LOCATION SHARING] Error starting session:', error);
    res.status(500).json({
      success: false,
      message: 'Error starting sharing session',
      error: error.message
    });
  }
};

/**
 * Stop sharing session with a friend
 */
exports.stopSession = async (req, res) => {
  try {
    const userId = req.user._id;
    const { friendId } = req.body;
    
    if (!friendId) {
      return res.status(400).json({
        success: false,
        message: 'Friend ID is required'
      });
    }
    
    const settings = await LocationSettings.findOne({ userId });
    
    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'No location settings found'
      });
    }
    
    await settings.stopSession(friendId);
    
    console.log(`✅ [LOCATION SHARING] Stopped session: ${userId} → ${friendId}`);
    
    res.json({
      success: true,
      message: 'Stopped sharing location',
      settings
    });
    
  } catch (error) {
    console.error('❌ [LOCATION SHARING] Error stopping session:', error);
    res.status(500).json({
      success: false,
      message: 'Error stopping sharing session',
      error: error.message
    });
  }
};

/**
 * Get all active sharing sessions
 */
exports.getActiveSessions = async (req, res) => {
  try {
    const userId = req.user._id;
    
    const settings = await LocationSettings.findOne({ userId })
      .populate('activeSessions.friendId', 'name profileImage');
    
    if (!settings) {
      return res.json({
        success: true,
        sessions: []
      });
    }
    
    // Cleanup expired and return active
    await settings.cleanupExpiredSessions();
    
    const activeSessions = settings.activeSessions.filter(s => s.isActive);
    
    res.json({
      success: true,
      count: activeSessions.length,
      sessions: activeSessions
    });
    
  } catch (error) {
    console.error('❌ [LOCATION SHARING] Error getting sessions:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting active sessions',
      error: error.message
    });
  }
};

/**
 * Check if user is sharing location with a specific friend
 */
exports.checkSharingStatus = async (req, res) => {
  try {
    const userId = req.user._id;
    const { friendId } = req.params;
    
    const settings = await LocationSettings.findOne({ userId });
    
    if (!settings) {
      return res.json({
        success: true,
        isSharing: false
      });
    }
    
    const isSharing = settings.isSharingWith(friendId);
    
    // Get session details if sharing
    const session = settings.activeSessions.find(
      s => s.friendId.toString() === friendId && s.isActive
    );
    
    res.json({
      success: true,
      isSharing,
      session: session || null
    });
    
  } catch (error) {
    console.error('❌ [LOCATION SHARING] Error checking status:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking sharing status',
      error: error.message
    });
  }
};

/**
 * Update preferences
 */
exports.updatePreferences = async (req, res) => {
  try {
    const userId = req.user._id;
    const { showAccuracy, showBattery, notifyOnShare } = req.body;
    
    let settings = await LocationSettings.findOne({ userId });
    
    if (!settings) {
      settings = await LocationSettings.create({ userId });
    }
    
    if (showAccuracy !== undefined) settings.preferences.showAccuracy = showAccuracy;
    if (showBattery !== undefined) settings.preferences.showBattery = showBattery;
    if (notifyOnShare !== undefined) settings.preferences.notifyOnShare = notifyOnShare;
    
    await settings.save();
    
    res.json({
      success: true,
      preferences: settings.preferences
    });
    
  } catch (error) {
    console.error('❌ [LOCATION SHARING] Error updating preferences:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating preferences',
      error: error.message
    });
  }
};
