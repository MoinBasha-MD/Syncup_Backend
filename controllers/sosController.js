const User = require('../models/userModel');
const Block = require('../models/blockModel');
const { broadcastToUser } = require('../socketManager');

// Shared recipient validation for every SOS action: 1-20 real users, none of
// whom has a mutual block with the sender.
const getValidEmergencyContacts = async (userId, emergencyContacts) => {
  if (!Array.isArray(emergencyContacts) || emergencyContacts.length === 0 || emergencyContacts.length > 20) {
    return null;
  }
  const valid = [];
  for (const contact of emergencyContacts) {
    if (!contact || typeof contact.userId !== 'string') continue;
    if (!(await User.exists({ userId: contact.userId }))) continue;
    const blockStatus = await Block.isMutuallyBlocked(userId, contact.userId);
    if (blockStatus.anyBlocked) continue;
    valid.push(contact);
  }
  return valid.length ? valid : null;
};

/**
 * Send SOS alert to emergency contacts
 */
exports.sendSOSAlert = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { emergencyContacts, location, message, duration } = req.body;

    console.log('🆘 [SOS CONTROLLER] SOS alert received from user:', userId);

    // Get user info
    const user = await User.findOne({ userId }).select('name phoneNumber');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const validContacts = await getValidEmergencyContacts(userId, emergencyContacts);
    if (!validContacts) {
      return res.status(400).json({ success: false, message: 'emergencyContacts must be 1-20 valid, unblocked users' });
    }

    // Send alert to each emergency contact
    for (const contact of validContacts) {
      const notification = {
        type: 'SOS_ALERT',
        senderId: userId,
        senderName: user.name,
        senderPhone: user.phoneNumber,
        message: message,
        location: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
        },
        duration: duration,
        timestamp: new Date().toISOString(),
      };

      // Broadcast to specific user
      broadcastToUser(contact.userId, 'sos_alert', notification);

      console.log(`📲 [SOS CONTROLLER] SOS alert sent to ${contact.name} (${contact.userId})`);
    }

    // Save SOS event to database (optional - for history)
    await User.findOneAndUpdate(
      { userId },
      {
        $push: {
          sosHistory: {
            timestamp: new Date(),
            location: location,
            emergencyContacts: validContacts.map(c => c.userId),
            message: message,
          }
        }
      }
    );

    res.json({
      success: true,
      message: 'SOS alert sent successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ [SOS CONTROLLER] Error sending SOS alert:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send SOS alert',
      error: error.message
    });
  }
};

/**
 * Send location update during active SOS
 */
exports.sendLocationUpdate = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { emergencyContacts, location } = req.body;

    console.log('📍 [SOS CONTROLLER] Location update from user:', userId);

    if (!location || typeof location !== 'object') {
      return res.status(400).json({ success: false, message: 'location is required' });
    }
    const validContacts = await getValidEmergencyContacts(userId, emergencyContacts);
    if (!validContacts) {
      return res.status(400).json({ success: false, message: 'emergencyContacts must be 1-20 valid, unblocked users' });
    }

    // Send location update to each emergency contact
    for (const contact of validContacts) {
      const update = {
        type: 'SOS_LOCATION_UPDATE',
        senderId: userId,
        location: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          timestamp: location.timestamp,
        },
        timestamp: new Date().toISOString(),
      };

      broadcastToUser(contact.userId, 'sos_location_update', update);
    }

    res.json({
      success: true,
      message: 'Location update sent',
    });

  } catch (error) {
    console.error('❌ [SOS CONTROLLER] Error sending location update:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send location update',
      error: error.message
    });
  }
};

/**
 * Stop active SOS
 */
exports.stopSOS = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { emergencyContacts } = req.body;

    console.log('🛑 [SOS CONTROLLER] SOS stopped by user:', userId);

    const validContacts = await getValidEmergencyContacts(userId, emergencyContacts);
    if (!validContacts) {
      return res.status(400).json({ success: false, message: 'emergencyContacts must be 1-20 valid, unblocked users' });
    }

    // Notify emergency contacts that SOS has been stopped
    for (const contact of validContacts) {
      const notification = {
        type: 'SOS_STOPPED',
        senderId: userId,
        timestamp: new Date().toISOString(),
      };

      broadcastToUser(contact.userId, 'sos_stopped', notification);
    }

    res.json({
      success: true,
      message: 'SOS stopped',
    });

  } catch (error) {
    console.error('❌ [SOS CONTROLLER] Error stopping SOS:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stop SOS',
      error: error.message
    });
  }
};

/**
 * Get SOS history
 */
exports.getSOSHistory = async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await User.findOne({ userId })
      .select('sosHistory')
      .populate('sosHistory.emergencyContacts', 'name phoneNumber');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      history: user.sosHistory || [],
    });

  } catch (error) {
    console.error('❌ [SOS CONTROLLER] Error getting SOS history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get SOS history',
      error: error.message
    });
  }
};
