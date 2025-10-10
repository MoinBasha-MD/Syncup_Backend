const mongoose = require('mongoose');

/**
 * Status Privacy Schema for managing who can see user status
 */
const statusPrivacySchema = mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    statusId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StatusHistory',
      required: false, // Can be null for default privacy settings
      index: true,
    },
    visibility: {
      type: String,
      enum: ['public', 'contacts_only', 'app_connections_only', 'selected_groups', 'custom_list', 'private', 'friends'],
      default: 'public',
      required: true,
    },
    allowedGroups: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
    }],
    allowedContacts: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    }],
    blockedContacts: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    }],
    locationSharing: {
      enabled: {
        type: Boolean,
        default: true,
      },
      shareWith: {
        type: String,
        enum: ['none', 'groups', 'contacts', 'all'],
        default: 'all',
      },
      allowedGroups: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
      }],
      allowedContacts: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      }],
    },
    isDefault: {
      type: Boolean,
      default: false, // True for user's default privacy settings
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient queries
statusPrivacySchema.index({ userId: 1, isDefault: 1 });
statusPrivacySchema.index({ userId: 1, statusId: 1 });
statusPrivacySchema.index({ visibility: 1, userId: 1 });

// Static method to get user's default privacy settings
statusPrivacySchema.statics.getDefaultPrivacySettings = async function(userId) {
  // If userId is a UUID string, find the user first to get MongoDB ObjectId
  const User = mongoose.model('User');
  let userObjectId = userId;
  
  // Check if userId is a UUID (36 characters with dashes) vs MongoDB ObjectId (24 hex chars)
  if (typeof userId === 'string' && userId.length === 36 && userId.includes('-')) {
    const user = await User.findOne({ userId: userId });
    if (!user) {
      console.log(`User not found for userId: ${userId}`);
      return null;
    }
    userObjectId = user._id;
  }
  
  let defaultSettings = await this.findOne({ userId: userObjectId, isDefault: true });
  
  if (!defaultSettings) {
    // Create default privacy settings if they don't exist
    defaultSettings = await this.create({
      userId: userObjectId,
      visibility: 'public',
      allowedGroups: [],
      allowedContacts: [],
      blockedContacts: [],
      locationSharing: {
        enabled: true,
        shareWith: 'all',
        allowedGroups: [],
        allowedContacts: [],
      },
      isDefault: true,
    });
  }
  
  return defaultSettings;
};

// Static method to get privacy settings for a user (with default fallback)
statusPrivacySchema.statics.getPrivacySettings = async function(userId) {
  try {
    let privacySettings = await this.findOne({ userId });
    
    if (!privacySettings) {
      // Create default privacy settings if none exist
      privacySettings = await this.create({
        userId,
        visibility: 'public', // Default to public for better UX
        allowedGroups: [],
        allowedContacts: [],
        blockedContacts: [],
        locationSharing: true
      });
      console.log(`🔒 [Privacy] Created default privacy settings for user ${userId} - defaulting to PUBLIC visibility`);
    }
    
    console.log(`🔒 [Privacy] Retrieved settings for user ${userId}:`, {
      visibility: privacySettings.visibility,
      allowedGroups: privacySettings.allowedGroups.length,
      allowedContacts: privacySettings.allowedContacts.length,
      locationSharing: privacySettings.locationSharing
    });
    
    return privacySettings;
  } catch (error) {
    console.error('❌ Error getting privacy settings:', error);
    console.log(`🔒 [Privacy] Falling back to PUBLIC default for user ${userId} due to error`);
    // Return default settings on error - PUBLIC for maximum compatibility
    return {
      userId,
      visibility: 'public',
      allowedGroups: [],
      allowedContacts: [],
      blockedContacts: [],
      locationSharing: true
    };
  }
};

// Static method to check if user can see another user's status
statusPrivacySchema.statics.canUserSeeStatus = async function(statusUserId, viewerUserId, statusId = null) {
  try {
    console.log(`🔒 [Privacy] Checking if user ${viewerUserId} can see status of user ${statusUserId}`);
    
    // Get privacy settings for the status
    let privacySettings;
    
    if (statusId) {
      // Check for status-specific privacy settings
      privacySettings = await this.findOne({ userId: statusUserId, statusId });
    }
    
    if (!privacySettings) {
      // Fall back to default privacy settings
      privacySettings = await this.getDefaultPrivacySettings(statusUserId);
    }
    
    console.log(`🔒 [Privacy] Privacy settings for user ${statusUserId}:`, {
      visibility: privacySettings.visibility,
      allowedGroups: privacySettings.allowedGroups,
      allowedContacts: privacySettings.allowedContacts
    });
    
    // If status owner is viewing their own status
    if (statusUserId.toString() === viewerUserId.toString()) {
      console.log(`🔒 [Privacy] Self-view allowed for user ${statusUserId}`);
      return true;
    }
    
    // Check visibility level
    switch (privacySettings.visibility) {
      case 'public':
        console.log(`🔒 [Privacy] Public visibility - access granted`);
        return true;
        
      case 'private':
        console.log(`🔒 [Privacy] Private visibility - access denied`);
        return false;
        
      case 'contacts_only':
        console.log(`🔒 [Privacy] Device contacts only - checking device contact relationship`);
        const isDeviceContact = await this.areUsersDeviceContacts(statusUserId, viewerUserId);
        console.log(`🔒 [Privacy] Users are device contacts: ${isDeviceContact}`);
        return isDeviceContact;
        
      case 'app_connections_only':
        console.log(`🔒 [Privacy] App connections only - checking app connection relationship`);
        const isAppConnection = await this.areUsersAppConnections(statusUserId, viewerUserId);
        console.log(`🔒 [Privacy] Users are app connections: ${isAppConnection}`);
        return isAppConnection;
        
      case 'selected_groups':
        console.log(`🔒 [Privacy] Selected groups visibility - checking group membership`);
        const isInGroups = await this.isUserInAllowedGroups(viewerUserId, privacySettings.allowedGroups);
        console.log(`🔒 [Privacy] User in allowed groups: ${isInGroups}`);
        return isInGroups;
        
      case 'custom_list':
        console.log(`🔒 [Privacy] Custom list visibility - checking allowed contacts`);
        const isAllowedContact = privacySettings.allowedContacts.some(contactId => 
          contactId.toString() === viewerUserId.toString()
        );
        console.log(`🔒 [Privacy] User in custom allowed list: ${isAllowedContact}`);
        return isAllowedContact;
        
      case 'friends':
        console.log(`🔒 [Privacy] Friends visibility - checking both device contacts and app connections`);
        const isFriendDeviceContact = await this.areUsersDeviceContacts(statusUserId, viewerUserId);
        const isFriendAppConnection = await this.areUsersAppConnections(statusUserId, viewerUserId);
        const isFriend = isFriendDeviceContact || isFriendAppConnection;
        console.log(`🔒 [Privacy] Users are friends (device contact: ${isFriendDeviceContact}, app connection: ${isFriendAppConnection}): ${isFriend}`);
        return isFriend;
        
      default:
        console.log(`🔒 [Privacy] Unknown visibility setting: ${privacySettings.visibility}`);
        return false;
    }
  } catch (error) {
    console.error('Error checking status visibility:', error);
    return false;
  }
};

// Helper method to check if users are device contacts
statusPrivacySchema.statics.areUsersDeviceContacts = async function(userId1, userId2) {
  try {
    const User = mongoose.model('User');
    
    // Get both users
    const [user1, user2] = await Promise.all([
      User.findById(userId1),
      User.findById(userId2)
    ]);
    
    if (!user1 || !user2) return false;
    
    console.log(`🔍 [Privacy] Checking device contact between ${user1.name} and ${user2.name}`);
    
    // Check if user2 is in user1's device contacts
    const user1Contacts = user1.contacts || [];
    console.log(`🔍 [Privacy] User1 has ${user1Contacts.length} device contacts`);
    
    // The contacts array contains MongoDB ObjectIds of other users
    const isDeviceContact = user1Contacts.some(contactId => {
      return contactId.toString() === userId2.toString();
    });
    
    console.log(`🔍 [Privacy] Device contact result: ${isDeviceContact}`);
    
    // Also check the reverse relationship (bidirectional check)
    if (!isDeviceContact) {
      const user2Contacts = user2.contacts || [];
      const isReverseDeviceContact = user2Contacts.some(contactId => {
        return contactId.toString() === userId1.toString();
      });
      console.log(`🔍 [Privacy] Reverse device contact check: ${isReverseDeviceContact}`);
      return isReverseDeviceContact;
    }
    
    return isDeviceContact;
  } catch (error) {
    console.error('Error checking device contact relationship:', error);
    return false;
  }
};

// Helper method to check if users are app connections
statusPrivacySchema.statics.areUsersAppConnections = async function(userId1, userId2) {
  try {
    const User = mongoose.model('User');
    
    // Get both users
    const [user1, user2] = await Promise.all([
      User.findById(userId1),
      User.findById(userId2)
    ]);
    
    if (!user1 || !user2) return false;
    
    console.log(`🔍 [Privacy] Checking app connection between ${user1.name} and ${user2.name}`);
    
    // Check if user2 is in user1's app connections
    const appConnections = user1.appConnections || [];
    console.log(`🔍 [Privacy] User1 has ${appConnections.length} app connections`);
    
    // Check multiple possible connection formats
    let isAppConnection = false;
    
    // Method 1: Check by userId
    if (user2.userId) {
      isAppConnection = appConnections.some(connection => 
        connection.userId === user2.userId || connection === user2.userId
      );
    }
    
    // Method 2: Check by MongoDB ObjectId
    if (!isAppConnection) {
      isAppConnection = appConnections.some(connection => 
        connection.toString() === userId2.toString() || 
        connection._id?.toString() === userId2.toString()
      );
    }
    
    // Method 3: Check by phone number (fallback)
    if (!isAppConnection && user2.phoneNumber) {
      isAppConnection = appConnections.some(connection => 
        connection.phoneNumber === user2.phoneNumber
      );
    }
    
    console.log(`🔍 [Privacy] App connection result: ${isAppConnection}`);
    return isAppConnection;
  } catch (error) {
    console.error('Error checking app connection relationship:', error);
    return false;
  }
};

// Helper method to check if user is in allowed groups
statusPrivacySchema.statics.isUserInAllowedGroups = async function(userId, allowedGroups) {
  if (!allowedGroups || allowedGroups.length === 0) {
    console.log(`🔍 [Privacy] No allowed groups specified for user ${userId}`);
    return false;
  }
  
  console.log(`🔍 [Privacy] Checking if user ${userId} is in allowed groups:`, allowedGroups);
  
  const Group = mongoose.model('Group');
  const User = mongoose.model('User');
  
  // Get the user's details
  const user = await User.findById(userId);
  if (!user) {
    console.log(`🔍 [Privacy] User ${userId} not found`);
    return false;
  }
  
  console.log(`🔍 [Privacy] User ${userId} details: name=${user.name}, phone=${user.phoneNumber}, userId=${user.userId}`);
  
  // Find groups where user is a member
  const userGroups = await Group.find({
    _id: { $in: allowedGroups }
  });
  
  console.log(`🔍 [Privacy] Found ${userGroups.length} groups to check`);
  
  let foundInGroup = false;
  
  for (const group of userGroups) {
    console.log(`📋 [Privacy] Checking group: ${group.name} (${group._id})`);
    console.log(`📋 [Privacy] Group has ${group.members?.length || 0} members`);
    
    // Check if user is the group owner
    if (group.userId && group.userId.toString() === userId.toString()) {
      console.log(`✅ [Privacy] User ${userId} is owner of group ${group.name}`);
      foundInGroup = true;
      break;
    }
    
    // Check if user is in group admins
    if (group.admins && group.admins.includes(user.userId)) {
      console.log(`✅ [Privacy] User ${userId} is admin of group ${group.name}`);
      foundInGroup = true;
      break;
    }
    
    // Check if user is in group members
    if (group.members && Array.isArray(group.members)) {
      const isMember = group.members.some(member => {
        // Check by memberId (could be userId or phone)
        if (member.memberId === user.userId || member.memberId === user.phoneNumber) {
          console.log(`✅ [Privacy] Found match by memberId: ${member.memberId}`);
          return true;
        }
        
        // Check by userId field in member
        if (member.userId === user.userId) {
          console.log(`✅ [Privacy] Found match by userId: ${member.userId}`);
          return true;
        }
        
        // Check by phone number with normalization
        if (member.phoneNumber && user.phoneNumber) {
          const normalizePhone = (phone) => phone.replace(/[\s\-\(\)]/g, '');
          const memberPhone = normalizePhone(member.phoneNumber);
          const userPhone = normalizePhone(user.phoneNumber);
          
          if (memberPhone === userPhone || 
              memberPhone.slice(-10) === userPhone.slice(-10)) {
            console.log(`✅ [Privacy] Found match by phone: ${member.phoneNumber} matches ${user.phoneNumber}`);
            return true;
          }
        }
        
        return false;
      });
      
      if (isMember) {
        foundInGroup = true;
        console.log(`✅ [Privacy] User ${userId} is member of group ${group.name}`);
        break;
      }
    }
  }
  
  console.log(`🔍 [Privacy] Final result: User ${userId} found in groups: ${foundInGroup}`);
  return foundInGroup;
};

module.exports = mongoose.model('StatusPrivacy', statusPrivacySchema);
