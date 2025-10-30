const LocationSettings = require('../models/LocationSettings');
const User = require('../models/userModel');
const Message = require('../models/Message');

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
    const userId = req.user.userId; // Use userId field, NOT _id (MongoDB ObjectId)
    const userObjectId = req.user._id; // MongoDB ObjectId for database queries
    const { friendId, duration } = req.body; // duration in minutes: 15, 60, 480
    
    console.log('🔍 [LOCATION SHARING] User IDs:', {
      userId: userId,
      userObjectId: userObjectId.toString(),
      friendId: friendId
    });
    
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
    const user = await User.findById(userObjectId).select('contacts appConnections userId name profileImage currentLocation');
    if (!user) {
      console.log('❌ [LOCATION SHARING] User not found:', userObjectId);
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
    
    // Use userObjectId for database queries (LocationSettings expects ObjectId)
    let settings = await LocationSettings.findOne({ userId: userObjectId });
    
    if (!settings) {
      settings = await LocationSettings.create({ userId: userObjectId });
    }
    
    console.log('📋 [LOCATION SHARING] Location settings:', {
      settingsId: settings._id,
      userId: userObjectId.toString(),
      activeSessions: settings.activeSessions.length
    });
    
    await settings.startSession(friendId, parseInt(duration));
    
    // Populate friend details
    await settings.populate('activeSessions.friendId', 'name profileImage');
    
    console.log(`✅ [LOCATION SHARING] Started ${duration}min session: ${userId} → ${friendId}`);
    
    // Send location message to chat
    let createdLocationMessage = null;
    try {
      // Use the user object we already fetched earlier
      const senderUser = user;
      
      if (senderUser && senderUser.currentLocation) {
        const expiresAt = new Date(Date.now() + parseInt(duration) * 60 * 1000);
        
        // Create location message
        createdLocationMessage = await Message.create({
          senderId: userId,
          receiverId: friendId,
          message: `📍 Sharing live location for ${duration === 15 ? '15 minutes' : duration === 60 ? '1 hour' : '8 hours'}`,
          messageType: 'location',
          locationData: {
            latitude: senderUser.currentLocation.latitude,
            longitude: senderUser.currentLocation.longitude,
            isLiveLocation: true,
            duration: parseInt(duration),
            expiresAt: expiresAt,
            address: null
          },
          timestamp: new Date(),
          status: 'sent'
        });
        
        console.log('✅ [LOCATION SHARING] Location message created:', {
          messageId: createdLocationMessage._id,
          messageType: createdLocationMessage.messageType,
          hasLocationData: !!createdLocationMessage.locationData,
          senderId: userId,
          receiverId: friendId
        });
        
        // Use the SAME notification system as regular chat messages
        const { broadcastToUser } = require('../socketManager');
        const enhancedNotificationService = require('../services/enhancedNotificationService');
        
        const messageData = {
          _id: createdLocationMessage._id,
          senderId: userId, // Use userId string for socket broadcast
          receiverId: friendId,
          senderName: senderUser.name,
          senderProfileImage: senderUser.profileImage || null,
          message: createdLocationMessage.message,
          messageType: createdLocationMessage.messageType,
          locationData: createdLocationMessage.locationData,
          timestamp: createdLocationMessage.timestamp,
          status: 'delivered'
        };
        
        console.log('📤 [LOCATION SHARING] Prepared message data for broadcast:', {
          senderUserId: userId,
          receiverUserId: friendId,
          messageType: messageData.messageType
        });
        
        // Broadcast to RECEIVER using the same system as chat
        const broadcastSuccess = broadcastToUser(friendId, 'message:new', messageData);
        console.log('📤 [LOCATION SHARING] Broadcast to receiver:', broadcastSuccess ? 'SUCCESS' : 'FAILED');
        
        // Broadcast to SENDER (so they see it in their chat too)
        broadcastToUser(userId, 'message:new', messageData);
        console.log('📤 [LOCATION SHARING] Broadcast to sender: SUCCESS');
        
        // Send push notification using the same service as chat
        try {
          console.log('🔔 [LOCATION SHARING] Sending notification via enhancedNotificationService...');
          await enhancedNotificationService.sendChatMessageNotification(
            userId,
            friendId,
            createdLocationMessage
          );
          console.log('✅ [LOCATION SHARING] Notification sent successfully');
        } catch (notifError) {
          console.error('❌ [LOCATION SHARING] Notification error:', notifError);
          // Don't fail if notification fails
        }
        
        console.log('✅ [LOCATION SHARING] All events sent using chat notification system');
      }
    } catch (msgError) {
      console.error('⚠️ [LOCATION SHARING] Error sending chat message:', msgError);
      // Don't fail the whole request if message fails
    }
    
    res.json({
      success: true,
      message: `Sharing location for ${duration} minutes`,
      settings,
      locationMessage: createdLocationMessage // Include the message so frontend can display it immediately
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
 * Get live locations shared with the current user
 */
exports.getReceivedShares = async (req, res) => {
  try {
    const userId = req.user.userId; // userId string used in Message collection

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User identifier missing'
      });
    }

    const now = new Date();

    const messages = await Message.find({
      receiverId: userId,
      messageType: 'location',
      'locationData.isLiveLocation': true,
      'locationData.expiresAt': { $gt: now }
    })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    const senderIds = [...new Set(messages.map(msg => msg.senderId).filter(Boolean))];

    const senders = await User.find({ userId: { $in: senderIds } })
      .select('userId name profileImage')
      .lean();

    const senderMap = new Map();
    senders.forEach(sender => {
      senderMap.set(sender.userId, {
        name: sender.name,
        profileImage: sender.profileImage || null
      });
    });

    const shares = messages.map(msg => {
      const senderInfo = senderMap.get(msg.senderId) || {};
      return {
        messageId: msg._id,
        senderId: msg.senderId,
        senderName: senderInfo.name || 'Unknown User',
        senderProfileImage: senderInfo.profileImage || null,
        locationData: msg.locationData,
        message: msg.message,
        startedAt: msg.timestamp,
        expiresAt: msg.locationData?.expiresAt || null
      };
    });

    res.json({
      success: true,
      count: shares.length,
      shares
    });

  } catch (error) {
    console.error('❌ [LOCATION SHARING] Error getting received shares:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting received location shares',
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
