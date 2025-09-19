const User = require('../models/userModel');
const { getAsync, setAsync } = require('../config/redis');

/**
 * Contact service - handles business logic for contact operations
 */
class ContactService {
  /**
   * Get all contacts for a user with optimized status information
   * @param {string} userId - User ID (UUID)
   * @returns {Promise<Array>} - Contacts with status information
   */
  async getContactsWithStatus(userId) {
    try {
      // Get the user to get MongoDB ObjectId
      const user = await User.findOne({ userId });
      if (!user) {
        const error = new Error('User not found');
        error.statusCode = 404;
        throw error;
      }

      // Get contacts with their status information
      const contacts = await User.find(
        { _id: { $in: user.contacts } },
        'name email phoneNumber profileImage userId status customStatus statusUntil'
      );

      // Format the response
      return contacts.map(contact => ({
        _id: contact._id,
        userId: contact.userId,
        name: contact.name,
        email: contact.email,
        phoneNumber: contact.phoneNumber,
        profileImage: contact.profileImage,
        currentStatus: {
          status: contact.status,
          customStatus: contact.customStatus,
          statusUntil: contact.statusUntil
        }
      }));
    } catch (error) {
      console.error('Error getting contacts with status:', error);
      throw error;
    }
  }

  /**
   * Get status of a specific contact
   * @param {string} userId - User ID (UUID)
   * @param {string} contactId - Contact ID (MongoDB ObjectId)
   * @returns {Promise<Object>} - Contact status information
   */
  async getContactStatus(userId, contactId) {
    try {
      // Get the user to get MongoDB ObjectId
      const user = await User.findOne({ userId });
      if (!user) {
        const error = new Error('User not found');
        error.statusCode = 404;
        throw error;
      }

      // Check if contact exists in user's contacts
      if (!user.contacts.includes(contactId)) {
        const error = new Error('Contact not found in your contacts');
        error.statusCode = 404;
        throw error;
      }

      // Get contact's status
      const contact = await User.findById(contactId, 'status customStatus statusUntil');

      if (!contact) {
        const error = new Error('Contact user not found');
        error.statusCode = 404;
        throw error;
      }

      // Check if status timer has expired
      if (contact.statusUntil && new Date() > new Date(contact.statusUntil)) {
        contact.status = 'available';
        contact.customStatus = '';
        contact.statusUntil = null;
        await contact.save();
      }

      return {
        status: contact.status,
        customStatus: contact.customStatus,
        statusUntil: contact.statusUntil
      };
    } catch (error) {
      console.error('Error getting contact status:', error);
      throw error;
    }
  }

  /**
   * Filter contacts by phone numbers
   * @param {Array} phoneNumbers - Array of phone numbers to filter by
   * @returns {Promise<Array>} - Matching users with status information
   */
  async filterContactsByPhone(phoneNumbers) {
    try {
      if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
        return [];
      }

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
        
        return normalized;
      }).filter(phone => phone); // Remove any null/empty values
      
      // Find users with matching phone numbers
      const registeredUsers = await User.find(
        { phoneNumber: { $in: normalizedPhoneNumbers } },
        '_id userId name phoneNumber email profileImage status customStatus statusUntil'
      );
      
      // Format the response
      return registeredUsers.map(user => ({
        _id: user._id,
        userId: user.userId,
        name: user.name,
        phoneNumber: user.phoneNumber,
        email: user.email,
        profileImage: user.profileImage,
        status: user.status,
        customStatus: user.customStatus,
        statusUntil: user.statusUntil
      }));
    } catch (error) {
      console.error('Error filtering contacts by phone:', error);
      throw error;
    }
  }

  /**
   * Get contact by phone number
   * @param {string} phoneNumber - Phone number to search for
   * @returns {Promise<Object>} - User with status information
   */
  async getContactByPhone(phoneNumber) {
    try {
      if (!phoneNumber) {
        const error = new Error('Phone number is required');
        error.statusCode = 400;
        throw error;
      }
      
      // Normalize phone number
      let normalized = String(phoneNumber).replace(/\D/g, '');
      
      // For numbers with leading 0, remove it
      if (normalized.length > 10 && normalized.startsWith('0')) {
        normalized = normalized.substring(1);
      }
      
      // If we still have more than 10 digits, take the last 10
      if (normalized.length > 10) {
        normalized = normalized.slice(-10);
      }
      
      console.log(`Looking for user with normalized phone number: ${normalized}`);
      
      // Find user with matching phone number
      const user = await User.findOne(
        { phoneNumber: normalized },
        '_id userId name phoneNumber email profileImage status customStatus statusUntil'
      );
      
      if (!user) {
        const error = new Error('User not found');
        error.statusCode = 404;
        throw error;
      }
      
      console.log(`Found user: ${user.name}, current status: ${user.status}, statusUntil: ${user.statusUntil}`);
      
      // Check if status timer has expired - with more careful date handling
      if (user.statusUntil) {
        const now = new Date();
        const expirationTime = new Date(user.statusUntil);
        
        console.log(`Status expiration check - Current time: ${now.toISOString()}, Expiration: ${expirationTime.toISOString()}`);
        console.log(`Time difference: ${(expirationTime - now) / 1000} seconds`);
        
        // Only reset if the status has actually expired (with a small buffer)
        if (now.getTime() > expirationTime.getTime() + 1000) { // 1 second buffer
          console.log('Status has expired, resetting to available');
          user.status = 'available';
          user.customStatus = '';
          user.statusUntil = null;
          await user.save();
        } else {
          console.log('Status is still active, not resetting');
        }
      }
      
      // Format the response
      return {
        _id: user._id,
        userId: user.userId,
        name: user.name,
        phoneNumber: user.phoneNumber,
        email: user.email,
        profileImage: user.profileImage,
        status: user.status,
        customStatus: user.customStatus,
        statusUntil: user.statusUntil
      };
    } catch (error) {
      console.error('Error getting contact by phone:', error);
      throw error;
    }
  }
  
  /**
   * Get status for a list of contacts
   * @param {Array} contactIds - Array of contact IDs (can be MongoDB ObjectIds or UUIDs)
   * @returns {Promise<Array>} - Array of contacts with their status information
   */
  async getStatusForContacts(contactIds) {
    try {
      if (!Array.isArray(contactIds) || contactIds.length === 0) {
        return [];
      }

      // Limit the number of contacts processed at once to prevent overloading
      const BATCH_SIZE = 50;
      const contactBatches = [];
      
      // Split contactIds into batches
      for (let i = 0; i < contactIds.length; i += BATCH_SIZE) {
        contactBatches.push(contactIds.slice(i, i + BATCH_SIZE));
      }
      
      console.log(`Processing ${contactIds.length} contacts in ${contactBatches.length} batches`);
      
      const allResults = [];
      
      // Process each batch
      for (const batch of contactBatches) {
        const batchResults = await this._processContactBatch(batch);
        allResults.push(...batchResults);
      }
      
      return allResults;
    } catch (error) {
      console.error('Error getting status for contacts:', error);
      throw error;
    }
  }
  
  /**
   * Process a batch of contact IDs to get their status
   * @param {Array} contactBatch - Batch of contact IDs to process
   * @returns {Promise<Array>} - Contacts with their status information
   * @private
   */
  async _processContactBatch(contactBatch) {
    // Check cache first for each contact
    const cachedResults = [];
    const uncachedIds = [];
    
    // Try to get cached status for each contact
    for (const id of contactBatch) {
      // Skip null or undefined IDs
      if (!id) continue;
      
      // Use a try-catch to handle any Redis errors gracefully
      try {
        const cacheKey = `contact:status:${id}`;
        const cachedData = await getAsync(cacheKey);
        
        if (cachedData) {
          try {
            const parsedData = JSON.parse(cachedData);
            cachedResults.push(parsedData);
            continue;
          } catch (parseErr) {
            console.error(`Error parsing cached data for contact ${id}:`, parseErr);
            // If parsing fails, treat as cache miss
          }
        }
        // If we get here, either there was no cached data or parsing failed
        uncachedIds.push(id);
      } catch (err) {
        console.error(`Cache error for contact ${id}:`, err);
        uncachedIds.push(id);
      }
    }
    
    console.log(`Found ${cachedResults.length} cached contacts, fetching ${uncachedIds.length} from database`);
    
    if (uncachedIds.length === 0) {
      return cachedResults;
    }
    
    // Separate ObjectIds and UUIDs
    const objectIdPattern = /^[0-9a-fA-F]{24}$/;
    const objectIds = [];
    const userIds = [];
    
    uncachedIds.forEach(id => {
      if (objectIdPattern.test(id)) {
        objectIds.push(id);
      } else {
        userIds.push(id);
      }
    });
    
    // Build query to find users by either ObjectId or UUID
    const query = {};
    if (objectIds.length > 0 && userIds.length > 0) {
      query['$or'] = [
        { _id: { $in: objectIds } },
        { userId: { $in: userIds } }
      ];
    } else if (objectIds.length > 0) {
      query['_id'] = { $in: objectIds };
    } else if (userIds.length > 0) {
      query['userId'] = { $in: userIds };
    } else {
      return cachedResults;
    }
    
    // Get contacts with their status information
    const contacts = await User.find(
      query,
      'name email phoneNumber profileImage userId status customStatus statusUntil'
    );
    
    // Check for expired statuses and reset them
    const now = new Date();
    const updatedContacts = [];
    
    for (const contact of contacts) {
      // Check if status timer has expired
      if (contact.statusUntil && now > new Date(contact.statusUntil)) {
        contact.status = 'available';
        contact.customStatus = '';
        contact.statusUntil = null;
        await contact.save();
      }
      
      const contactData = {
        _id: contact._id,
        userId: contact.userId,
        name: contact.name,
        email: contact.email,
        phoneNumber: contact.phoneNumber,
        profileImage: contact.profileImage,
        status: contact.status,
        customStatus: contact.customStatus,
        statusUntil: contact.statusUntil
      };
      
      // Cache the contact status for 5 minutes (300 seconds)
      try {
        // Only cache if we have valid IDs
        if (contact._id) {
          const cacheKey = `contact:status:${contact._id}`;
          await setAsync(cacheKey, JSON.stringify(contactData), 'EX', 300);
        }
        
        if (contact.userId) {
          const cacheKeyAlt = `contact:status:${contact.userId}`;
          await setAsync(cacheKeyAlt, JSON.stringify(contactData), 'EX', 300);
        }
      } catch (err) {
        // Log error but continue - caching failures shouldn't break the app
        console.error(`Error caching contact ${contact._id || contact.userId || 'unknown'}:`, err);
        // Continue without caching
      }
      
      updatedContacts.push(contactData);
    }
    
    return [...cachedResults, ...updatedContacts];
    } catch (error) {
      console.error('Error getting status for contacts:', error);
      throw error;
    }
  }


/**
 * Create and export a singleton instance of the ContactService
 */
module.exports = new ContactService();
