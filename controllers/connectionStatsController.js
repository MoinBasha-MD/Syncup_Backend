const asyncHandler = require('express-async-handler');
const User = require('../models/userModel');
const Group = require('../models/groupModel');

/**
 * @desc    Get user connection statistics
 * @route   GET /api/users/connection-stats
 * @access  Private
 */
const getConnectionStats = asyncHandler(async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get user's contacts from their profile
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Calculate total contacts (from user's contacts array)
    const totalContacts = user.contacts ? user.contacts.length : 0;
    
    // Calculate registered contacts (contacts that are also users in the system)
    let registeredContacts = 0;
    if (user.contacts && user.contacts.length > 0) {
      const contactPhones = user.contacts.map(contact => contact.phoneNumber);
      registeredContacts = await User.countDocuments({
        phoneNumber: { $in: contactPhones }
      });
    }

    // Calculate active contacts (registered users who have been active in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    let activeContacts = 0;
    if (user.contacts && user.contacts.length > 0) {
      const contactPhones = user.contacts.map(contact => contact.phoneNumber);
      activeContacts = await User.countDocuments({
        phoneNumber: { $in: contactPhones },
        lastActive: { $gte: thirtyDaysAgo }
      });
    }

    // Get total groups created by user
    const totalGroups = await Group.countDocuments({ userId });

    // Calculate recent connections (contacts added in last 30 days)
    let recentConnections = 0;
    if (user.contacts && user.contacts.length > 0) {
      recentConnections = user.contacts.filter(contact => {
        if (!contact.addedAt) return false;
        const addedDate = new Date(contact.addedAt);
        return addedDate >= thirtyDaysAgo;
      }).length;
    }

    // Calculate mutual connections (simplified - contacts who also have this user in their contacts)
    let mutualConnections = 0;
    if (user.contacts && user.contacts.length > 0) {
      const contactPhones = user.contacts.map(contact => contact.phoneNumber);
      const usersWithMutualConnections = await User.find({
        phoneNumber: { $in: contactPhones },
        'contacts.phoneNumber': user.phoneNumber
      });
      mutualConnections = usersWithMutualConnections.length;
    }

    const stats = {
      followers: 0, // Set to 0 for now as requested
      registeredContacts: totalContacts, // Show total contacts as "Connected"
      activeContacts,
      totalGroups,
      recentConnections,
      mutualConnections
    };

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching connection stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch connection statistics'
    });
  }
});

/**
 * @desc    Get recent connections
 * @route   GET /api/users/recent-connections
 * @access  Private
 */
const getRecentConnections = asyncHandler(async (req, res) => {
  try {
    const userId = req.user._id;
    const limit = parseInt(req.query.limit) || 10;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get recent connections (added in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let recentConnections = [];
    if (user.contacts && user.contacts.length > 0) {
      recentConnections = user.contacts
        .filter(contact => {
          if (!contact.addedAt) return false;
          const addedDate = new Date(contact.addedAt);
          return addedDate >= thirtyDaysAgo;
        })
        .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
        .slice(0, limit);

      // Enrich with user data if they are registered
      const phoneNumbers = recentConnections.map(c => c.phoneNumber);
      const registeredUsers = await User.find({
        phoneNumber: { $in: phoneNumbers }
      }).select('phoneNumber name profileImage lastActive');

      recentConnections = recentConnections.map(contact => {
        const registeredUser = registeredUsers.find(u => u.phoneNumber === contact.phoneNumber);
        return {
          phoneNumber: contact.phoneNumber,
          name: contact.name || (registeredUser ? registeredUser.name : 'Unknown'),
          isRegistered: !!registeredUser,
          lastSeen: registeredUser ? registeredUser.lastActive : null,
          profileImage: registeredUser ? registeredUser.profileImage : null
        };
      });
    }

    res.status(200).json({
      success: true,
      data: recentConnections
    });
  } catch (error) {
    console.error('Error fetching recent connections:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recent connections'
    });
  }
});

/**
 * @desc    Get mutual connections with another user
 * @route   GET /api/users/mutual-connections/:phoneNumber
 * @access  Private
 */
const getMutualConnections = asyncHandler(async (req, res) => {
  try {
    const userId = req.user._id;
    const { phoneNumber } = req.params;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find the other user
    const otherUser = await User.findOne({ phoneNumber });
    if (!otherUser) {
      return res.status(404).json({
        success: false,
        message: 'Target user not found'
      });
    }

    // Find mutual connections
    let mutualConnections = [];
    if (user.contacts && otherUser.contacts) {
      const userContactPhones = user.contacts.map(c => c.phoneNumber);
      const otherUserContactPhones = otherUser.contacts.map(c => c.phoneNumber);
      
      // Find common phone numbers
      const mutualPhones = userContactPhones.filter(phone => 
        otherUserContactPhones.includes(phone)
      );

      if (mutualPhones.length > 0) {
        // Get user data for mutual connections
        const mutualUsers = await User.find({
          phoneNumber: { $in: mutualPhones }
        }).select('phoneNumber name profileImage lastActive');

        mutualConnections = mutualPhones.map(phone => {
          const userContact = user.contacts.find(c => c.phoneNumber === phone);
          const registeredUser = mutualUsers.find(u => u.phoneNumber === phone);
          
          return {
            phoneNumber: phone,
            name: userContact ? userContact.name : (registeredUser ? registeredUser.name : 'Unknown'),
            isRegistered: !!registeredUser,
            lastSeen: registeredUser ? registeredUser.lastActive : null,
            profileImage: registeredUser ? registeredUser.profileImage : null
          };
        });
      }
    }

    res.status(200).json({
      success: true,
      data: mutualConnections
    });
  } catch (error) {
    console.error('Error fetching mutual connections:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch mutual connections'
    });
  }
});

module.exports = {
  getConnectionStats,
  getRecentConnections,
  getMutualConnections
};
