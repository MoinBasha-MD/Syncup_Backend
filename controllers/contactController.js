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
const syncContacts = asyncHandler(async (req, res) => {
  try {
    const { phoneNumbers } = req.body;

    if (!phoneNumbers || !Array.isArray(phoneNumbers)) {
      res.status(400);
      throw new Error('Phone numbers array is required');
    }

    console.log('Received phone numbers for sync:', phoneNumbers);
    
    // Normalize phone numbers to ensure consistent format
    const normalizedPhoneNumbers = phoneNumbers.map(phone => {
      if (!phone) return null; // Skip empty or null phone numbers
      
      // Convert to string if not already
      let phoneStr = String(phone);
      
      // First handle international format with country code
      if (phoneStr.includes('+')) {
        // Handle +91 (India) and other country codes
        phoneStr = phoneStr.replace(/^\+\d{1,3}/, '');
      }
      
      // Remove all non-numeric characters
      let normalized = phoneStr.replace(/\D/g, '');
      
      // For numbers with leading 0, remove it
      if (normalized.length > 10 && normalized.startsWith('0')) {
        normalized = normalized.substring(1);
      }
      
      // If we still have more than 10 digits, take the last 10
      if (normalized.length > 10) {
        normalized = normalized.slice(-10);
      }
      
      // Ensure we have a valid 10-digit number
      if (normalized.length !== 10) {
        console.log(`Warning: Phone number ${phoneStr} normalized to ${normalized} is not 10 digits`);
      }
      
      return normalized;
    }).filter(phone => phone); // Remove any null/empty values
    
    console.log('Normalized phone numbers for sync:', normalizedPhoneNumbers);
    
    // Find users with matching phone numbers
    const registeredUsers = await User.find(
      { phoneNumber: { $in: normalizedPhoneNumbers } },
      '_id name phoneNumber email profileImage currentStatus'
    );
    
    console.log(`Found ${registeredUsers.length} registered users:`);
    
    // Log each found user for debugging
    if (registeredUsers.length > 0) {
      registeredUsers.forEach(user => {
        console.log(`Matched user: ${user.name}, Phone: ${user.phoneNumber}, ID: ${user._id}`);
      });
    } else {
      console.log('No matching users found in database. Checking database phone number format...');
      
      // Check a sample of users in the database to verify phone number format
      const sampleUsers = await User.find({}, 'name phoneNumber').limit(5);
      console.log('Sample users in database:', sampleUsers.map(u => ({ name: u.name, phone: u.phoneNumber })));
      
      // Check if any normalized numbers are close matches (debugging)
      const allUsers = await User.find({}, 'phoneNumber');
      const allPhones = allUsers.map(u => u.phoneNumber);
      console.log(`Database has ${allUsers.length} total users with phone numbers`);
      
      // Look for partial matches
      const partialMatches = [];
      normalizedPhoneNumbers.forEach(normalizedPhone => {
        allPhones.forEach(dbPhone => {
          // Check if last 8 digits match (in case of country code issues)
          if (normalizedPhone.slice(-8) === dbPhone.slice(-8)) {
            partialMatches.push({ normalized: normalizedPhone, dbPhone });
          }
        });
      });
      
      if (partialMatches.length > 0) {
        console.log('Found partial matches:', partialMatches);
      }
    }

    // Get current user
    const user = await User.findById(req.user.id);

    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    // Add registered users to contacts if not already added
    let newContactsAdded = 0;
    for (const registeredUser of registeredUsers) {
      // Don't add self as contact
      if (registeredUser._id.toString() === user._id.toString()) {
        console.log('Skipping self as contact');
        continue;
      }

      // Check if already a contact - convert both to strings for proper comparison
      const userIdStr = registeredUser._id.toString();
      const isAlreadyContact = user.contacts.some(contactId => 
        contactId.toString() === userIdStr
      );
      
      if (!isAlreadyContact) {
        console.log(`Adding ${registeredUser.name} (${registeredUser.phoneNumber}) to contacts`);
        user.contacts.push(registeredUser._id);
        newContactsAdded++;
      } else {
        console.log(`${registeredUser.name} is already a contact`);
      }
    }

    // Save user with updated contacts
    if (newContactsAdded > 0) {
      await user.save();
    }

    // Return both the success message and the updated contacts list
    const updatedContacts = await User.find(
      { _id: { $in: user.contacts } },
      '_id name phoneNumber email profileImage currentStatus'
    );
  
    console.log(`Returning ${updatedContacts.length} contacts to client`);
  
    res.status(200).json({
      success: true,
      message: `${newContactsAdded} new contacts added`,
      registeredUsers,
      contacts: updatedContacts,
      debug: {
        originalPhoneNumbers: phoneNumbers,
        normalizedPhoneNumbers: normalizedPhoneNumbers,
        totalRegisteredUsers: registeredUsers.length,
        totalContacts: updatedContacts.length,
        userContactsIds: user.contacts.map(id => id.toString())
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
    
    // Use the contact service to filter contacts by phone numbers
    const users = await contactService.filterContactsByPhone(phoneNumbers);
    
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
    
    // Use the contact service to get user by phone number
    const user = await contactService.getContactByPhone(phoneNumber);
    
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
        profileImage: user.profileImage, // ✅ FIXED: Add missing profileImage field
        status: user.status,
        customStatus: user.customStatus,
        statusUntil: user.statusUntil,
        debug: {
          currentTime: now.toISOString(),
          statusExpired: statusUntil ? now > statusUntil : false,
          timeRemaining: statusUntil ? Math.floor((statusUntil - now) / 60000) : null,
          rawStatus: rawUser.status
        }
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
    
    const contacts = await contactService.getStatusForContacts(contactIds);
    
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
