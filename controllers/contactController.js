const asyncHandler = require('express-async-handler');
const User = require('../models/userModel');
const contactService = require('../services/contactService');

// @desc    Get all contacts for a user
// @route   GET /api/contacts
// @access  Private
const getUserContacts = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    console.log(`Getting contacts for user ${user._id}, contacts count: ${user.contacts.length}`);
    console.log('Contact IDs:', user.contacts);

    // Get contacts with basic info
    const contacts = await User.find(
      { _id: { $in: user.contacts } },
      'name email phoneNumber profileImage'
    );

    console.log(`Found ${contacts.length} contacts`);
    contacts.forEach(contact => {
      console.log(`- ${contact.name} (${contact.phoneNumber})`);
    });

    res.status(200).json(contacts);
  } catch (error) {
    console.error('Error getting contacts:', error);
    res.status(500);
    throw new Error(`Error getting contacts: ${error.message}`);
  }
});

// @desc    Get all contacts with their current status
// @route   GET /api/contacts/with-status
// @access  Private
const getContactsWithStatus = asyncHandler(async (req, res) => {
  try {
    // Get user UUID from authenticated user
    const userId = req.user.userId;
    
    console.log(`Getting contacts with status for user ${userId}`);

    // Use the contact service to get contacts with status
    const contacts = await contactService.getContactsWithStatus(userId);

    console.log(`Found ${contacts.length} contacts with status`);
    
    // Add debug info for each contact
    contacts.forEach(contact => {
      console.log(`Contact: ${contact.name}, Phone: ${contact.phoneNumber}, Status: ${contact.currentStatus.status}`);
    });

    res.status(200).json(contacts);
  } catch (error) {
    console.error('Error getting contacts with status:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error getting contacts with status');
  }
});

// @desc    Add a contact
// @route   POST /api/contacts
// @access  Private
const addContact = asyncHandler(async (req, res) => {
  try {
    const { phone, name } = req.body;

    if (!phone) {
      res.status(400);
      throw new Error('Phone number is required');
    }

    // Find the user to add as contact
    const contactUser = await User.findOne({ phone });

    if (!contactUser) {
      res.status(404);
      throw new Error('User with this phone number not found');
    }

    // Get current user
    const user = await User.findById(req.user.id);

    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    // Check if already a contact
    if (user.contacts.includes(contactUser._id)) {
      res.status(400);
      throw new Error('User is already in your contacts');
    }

    // Add to contacts
    user.contacts.push(contactUser._id);
    await user.save();

    res.status(201).json({
      _id: contactUser._id,
      name: contactUser.name,
      phone: contactUser.phone,
      email: contactUser.email,
      profileImage: contactUser.profileImage,
      currentStatus: contactUser.currentStatus
    });
  } catch (error) {
    res.status(500);
    throw new Error(`Error adding contact: ${error.message}`);
  }
});

// @desc    Remove a contact
// @route   DELETE /api/contacts/:id
// @access  Private
const removeContact = asyncHandler(async (req, res) => {
  try {
    const contactId = req.params.id;
    
    // Get current user
    const user = await User.findById(req.user.id);

    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    // Check if contact exists
    if (!user.contacts.includes(contactId)) {
      res.status(404);
      throw new Error('Contact not found');
    }

    // Remove from contacts
    user.contacts = user.contacts.filter(id => id.toString() !== contactId);
    await user.save();

    res.status(200).json({ message: 'Contact removed' });
  } catch (error) {
    res.status(500);
    throw new Error(`Error removing contact: ${error.message}`);
  }
});

// @desc    Get status of a specific contact
// @route   GET /api/contacts/:id/status
// @access  Private
const getContactStatus = asyncHandler(async (req, res) => {
  try {
    const contactId = req.params.id;
    const userId = req.user.userId;
    
    // Use the contact service to get contact status
    const statusData = await contactService.getContactStatus(userId, contactId);

    res.status(200).json(statusData);
  } catch (error) {
    console.error('Error getting contact status:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error getting contact status');
  }
});

// @desc    Sync device contacts with registered users
// @route   POST /api/contacts/sync
// @access  Private
// NOTE: This endpoint now uses the new Friend system
const syncContacts = asyncHandler(async (req, res) => {
  try {
    const { phoneNumbers } = req.body;

    if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
      res.status(400);
      throw new Error('Phone numbers array is required');
    }

    console.log('\n📞 [CONTACT SYNC - LEGACY ENDPOINT] Redirecting to Friend system');
    console.log('📞 [PHONE SYNC] Received phone numbers for sync:', phoneNumbers);
    console.log(`📞 [PHONE SYNC] Total phone numbers received: ${phoneNumbers.length}`);
    
    // Use the new Friend service for contact sync
    const friendService = require('../services/friendService');
    const Friend = require('../models/Friend');
    
    // Get userId from req.user
    const userId = req.user.userId;
    
    if (!userId) {
      res.status(400);
      throw new Error('User ID is required');
    }
    
    // Call the new friend service sync method
    const syncResult = await friendService.syncDeviceContacts(userId, phoneNumbers);
    
    // Get all friends (device contacts) to return in the old format
    const friends = await Friend.getFriends(userId, {
      status: 'accepted',
      includeDeviceContacts: true,
      includeAppConnections: true
    });
    
    console.log(`\n📊 [FRIEND QUERY] Retrieved ${friends.length} friends from Friend.getFriends()`);
    
    // Log first friend for debugging
    if (friends.length > 0) {
      console.log('📊 [FIRST FRIEND]:', JSON.stringify(friends[0], null, 2));
    }
    
    // Format friends to match old contacts response
    const formattedContacts = friends.map(friend => {
      // Handle missing cachedData gracefully
      const cachedData = friend.cachedData || {};
      
      return {
        _id: friend.friendUserId,
        userId: friend.friendUserId,
        name: cachedData.name || 'Unknown',
        phoneNumber: friend.phoneNumber || '',
        email: '',
        profileImage: cachedData.profileImage || '',
        currentStatus: cachedData.isOnline ? 'online' : 'offline',
        isPublic: true
      };
    });
    
    console.log(`\n📊 [SYNC RESULT] Contact sync completed using Friend system:`);
    console.log(`   New friends added: ${syncResult.newFriends.length}`);
    console.log(`   Total friends: ${syncResult.totalFriends}`);
    console.log(`   Contacts being returned: ${formattedContacts.length}`);
    
    console.log(`\n📋 [CONTACTS RETURNED]:`);
    formattedContacts.forEach(c => {
      console.log(`   ✅ ${c.name} (${c.phoneNumber}) - userId: ${c.userId}`);
    });
  
    res.status(200).json({
      success: true,
      message: `${syncResult.newFriends.length} new contacts added`,
      registeredUsers: syncResult.newFriends.map(f => ({
        _id: f.friendUserId,
        name: f.name,
        phoneNumber: f.phoneNumber,
        profileImage: f.profileImage,
        currentStatus: 'offline'
      })),
      contacts: formattedContacts,
      debug: {
        originalPhoneNumbers: phoneNumbers,
        totalRegisteredUsers: syncResult.newFriends.length,
        totalContacts: formattedContacts.length,
        totalFriends: syncResult.totalFriends,
        usingFriendSystem: true
      }
    });
  } catch (error) {
    res.status(500);
    throw new Error(`Error syncing contacts: ${error.message}`);
  }
});

// @desc    Filter contacts by phone numbers
// @route   POST /api/contacts/filter
// @access  Private
const filterContacts = asyncHandler(async (req, res) => {
  try {
    const { phoneNumbers } = req.body;

    if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
      res.status(400);
      throw new Error('Phone numbers array is required');
    }

    console.log('Phone numbers for filtering:', phoneNumbers);
    
    // Use the contact service to filter contacts by phone numbers (with privacy filtering)
    const users = await contactService.filterContactsByPhone(phoneNumbers, req.user._id);
    
    console.log(`Found ${users.length} registered users matching phone numbers`);
    
    // Log each found user for debugging
    if (users.length > 0) {
      users.forEach(user => {
        console.log(`Matched user: ${user.name}, Phone: ${user.phoneNumber}, Status: ${user.status}`);
      });
    }

    res.status(200).json({
      success: true,
      users,
      debug: {
        originalPhoneNumbers: phoneNumbers
      }
    });
  } catch (error) {
    console.error('Error filtering contacts:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error filtering contacts');
  }
});

// @desc    Get user status by phone number
// @route   GET /api/contacts/phone/:phoneNumber/status
// @access  Private
const getStatusByPhone = asyncHandler(async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    
    if (!phoneNumber) {
      res.status(400);
      throw new Error('Phone number is required');
    }
    
    console.log(`Getting status for phone number: ${phoneNumber}`);
    
    // Get the raw user data first to check status values
    const rawUser = await User.findOne(
      { phoneNumber: phoneNumber.replace(/\D/g, '').slice(-10) },
      '_id userId name phoneNumber status customStatus statusUntil'
    );
    
    if (!rawUser) {
      console.log(`No user found with phone number: ${phoneNumber}`);
      res.status(404);
      throw new Error('User not found');
    }
    
    console.log('Raw user data:', {
      userId: rawUser.userId,
      name: rawUser.name,
      status: rawUser.status,
      customStatus: rawUser.customStatus,
      statusUntil: rawUser.statusUntil
    });
    
    // Check status expiration manually with detailed logging
    const now = new Date();
    const statusUntil = rawUser.statusUntil ? new Date(rawUser.statusUntil) : null;
    
    console.log(`Current time: ${now.toISOString()}`);
    console.log(`Status until: ${statusUntil ? statusUntil.toISOString() : 'No expiration'}`);
    
    if (statusUntil) {
      console.log(`Status expired? ${now > statusUntil ? 'Yes' : 'No'}`);
      console.log(`Time remaining: ${Math.floor((statusUntil - now) / 60000)} minutes`);
    }
    
    // Use the contact service to get user by phone number (with privacy filtering)
    const user = await contactService.getContactByPhone(phoneNumber, req.user._id);
    
    console.log('Processed user data from service:', {
      status: user.status,
      customStatus: user.customStatus,
      statusUntil: user.statusUntil
    });
    
    res.status(200).json({
      success: true,
      data: {
        userId: user.userId,
        name: user.name,
        phoneNumber: user.phoneNumber,
        profileImage: user.profileImage,
        status: user.status,
        customStatus: user.customStatus,
        statusUntil: user.statusUntil,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen,
        // ✅ FIX Bug B: Include hierarchical status fields in response
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
    console.error('Error getting status by phone:', error);
    res.status(error.statusCode || 500);
    throw new Error(error.message || 'Error getting status by phone');
  }
});

/**
 * Get status for a list of contacts
 * @param {Object} req - Express request object with contactIds in request body
 * @param {Object} res - Express response object
 * @returns {Object} - JSON response with contact statuses
 */
const getStatusForContactsList = async (req, res) => {
  try {
    const { contactIds } = req.body;
    
    if (!contactIds || !Array.isArray(contactIds)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Contact IDs array is required' 
      });
    }
    
    const contacts = await contactService.getStatusForContacts(contactIds, req.user._id);
    
    return res.status(200).json({
      success: true,
      data: contacts
    });
  } catch (error) {
    console.error('Error in getStatusForContactsList:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

// @desc    Get cached contacts for a user (fast loading)
// @route   GET /api/contacts/cached
// @access  Private
const getCachedContacts = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    console.log(`Getting cached contacts for user ${user._id}`);
    console.log(`Found ${user.cachedContacts?.length || 0} cached contacts`);
    console.log(`Last synced: ${user.contactsLastSynced}`);

    res.status(200).json({
      success: true,
      data: {
        contacts: user.cachedContacts || [],
        lastSynced: user.contactsLastSynced,
        count: user.cachedContacts?.length || 0
      }
    });
  } catch (error) {
    console.error('Error getting cached contacts:', error);
    res.status(500);
    throw new Error(`Error getting cached contacts: ${error.message}`);
  }
});

// @desc    Save contacts to cache after sync
// @route   POST /api/contacts/cache
// @access  Private
const saveCachedContacts = asyncHandler(async (req, res) => {
  try {
    const { contacts } = req.body;

    if (!contacts || !Array.isArray(contacts)) {
      res.status(400);
      throw new Error('Contacts array is required');
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    console.log(`Saving ${contacts.length} contacts to cache for user ${user._id}`);

    // Update cached contacts and sync timestamp
    user.cachedContacts = contacts.map(contact => ({
      userId: contact.userId,
      name: contact.name,
      phoneNumber: contact.phoneNumber,
      profileImage: contact.profileImage || '',
      isRegistered: contact.isRegistered !== false,
      addedAt: new Date()
    }));
    user.contactsLastSynced = new Date();

    await user.save();

    console.log(`Successfully cached ${user.cachedContacts.length} contacts`);

    res.status(200).json({
      success: true,
      message: 'Contacts cached successfully',
      data: {
        count: user.cachedContacts.length,
        lastSynced: user.contactsLastSynced
      }
    });
  } catch (error) {
    console.error('Error saving cached contacts:', error);
    res.status(500);
    throw new Error(`Error saving cached contacts: ${error.message}`);
  }
});

// @desc    Check if contacts need refresh (based on last sync time)
// @route   GET /api/contacts/sync-status
// @access  Private
const getContactSyncStatus = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    const now = new Date();
    const lastSynced = user.contactsLastSynced;
    const hasCachedContacts = user.cachedContacts && user.cachedContacts.length > 0;
    
    // Consider contacts stale after 7 days
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    const needsSync = !lastSynced || (now - lastSynced) > maxAge;

    console.log(`Contact sync status for user ${user._id}:`);
    console.log(`- Has cached contacts: ${hasCachedContacts}`);
    console.log(`- Last synced: ${lastSynced}`);
    console.log(`- Needs sync: ${needsSync}`);

    res.status(200).json({
      success: true,
      data: {
        hasCachedContacts,
        lastSynced,
        needsSync,
        contactCount: user.cachedContacts?.length || 0,
        daysSinceSync: lastSynced ? Math.floor((now - lastSynced) / (24 * 60 * 60 * 1000)) : null
      }
    });
  } catch (error) {
    console.error('Error getting contact sync status:', error);
    res.status(500);
    throw new Error(`Error getting contact sync status: ${error.message}`);
  }
});

module.exports = {
  getContacts: getUserContacts,
  getContactsWithStatus,
  addContact,
  removeContact,
  getContactStatus,
  syncContacts,
  filterContacts,
  getStatusByPhone,
  getStatusForContactsList,
  getCachedContacts,
  saveCachedContacts,
  getContactSyncStatus
};
