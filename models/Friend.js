const mongoose = require('mongoose');

/**
 * Friend Model - Persistent friendship/connection management
 * Replaces the unstable contacts + appConnections system
 * Provides single source of truth for user relationships
 */
const friendSchema = new mongoose.Schema(
  {
    // User who owns this friendship record
    userId: {
      type: String,
      required: true,
      index: true
    },
    
    // The friend's user ID
    friendUserId: {
      type: String,
      required: true,
      index: true
    },
    
    // How this friendship was established
    source: {
      type: String,
      enum: ['device_contact', 'app_search', 'qr_code', 'invite_link', 'mutual_friend', 'suggested'],
      required: true,
      default: 'device_contact'
    },
    
    // Friendship status
    status: {
      type: String,
      enum: ['pending', 'accepted', 'blocked', 'removed'],
      required: true,
      default: 'accepted', // Device contacts are auto-accepted
      index: true
    },
    
    // Timestamps
    addedAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    
    acceptedAt: {
      type: Date,
      default: null
    },
    
    blockedAt: {
      type: Date,
      default: null
    },
    
    removedAt: {
      type: Date,
      default: null
    },
    
    // Device contact tracking (for contacts synced from phone)
    isDeviceContact: {
      type: Boolean,
      default: false,
      index: true
    },
    
    phoneNumber: {
      type: String,
      default: null
    },
    
    lastDeviceSync: {
      type: Date,
      default: null
    },
    
    // Cached friend data (for performance - avoid constant User lookups)
    cachedData: {
      name: {
        type: String,
        default: ''
      },
      profileImage: {
        type: String,
        default: ''
      },
      username: {
        type: String,
        default: ''
      },
      lastSeen: {
        type: Date,
        default: null
      },
      isOnline: {
        type: Boolean,
        default: false
      },
      lastCacheUpdate: {
        type: Date,
        default: Date.now
      }
    },
    
    // Interaction tracking (for feed algorithms)
    interactions: {
      lastMessageAt: {
        type: Date,
        default: null
      },
      lastCallAt: {
        type: Date,
        default: null
      },
      lastViewedStoryAt: {
        type: Date,
        default: null
      },
      lastViewedPostAt: {
        type: Date,
        default: null
      },
      messageCount: {
        type: Number,
        default: 0
      },
      callCount: {
        type: Number,
        default: 0
      }
    },
    
    // Privacy settings for this specific friendship
    settings: {
      showOnlineStatus: {
        type: Boolean,
        default: true
      },
      showStories: {
        type: Boolean,
        default: true
      },
      showPosts: {
        type: Boolean,
        default: true
      },
      showLocation: {
        type: Boolean,
        default: false
      },
      muteNotifications: {
        type: Boolean,
        default: false
      }
    },
    
    // Friend request metadata (for pending friendships)
    requestMetadata: {
      requestedBy: {
        type: String, // userId of who sent the request
        default: null
      },
      requestMessage: {
        type: String,
        maxlength: 200,
        default: ''
      },
      mutualFriends: [{
        type: String // Array of mutual friend userIds
      }]
    },
    
    // Soft delete support
    isDeleted: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  {
    timestamps: true // Adds createdAt and updatedAt automatically
  }
);

// Compound indexes for efficient queries
friendSchema.index({ userId: 1, friendUserId: 1 }, { unique: true }); // Prevent duplicates
friendSchema.index({ userId: 1, status: 1 }); // Get all accepted friends
friendSchema.index({ userId: 1, isDeviceContact: 1 }); // Get device contacts
friendSchema.index({ userId: 1, status: 1, isDeleted: 1 }); // Active friends query
friendSchema.index({ friendUserId: 1, status: 1 }); // Reverse lookup (who has me as friend)
friendSchema.index({ phoneNumber: 1 }, { sparse: true }); // Contact sync lookup
friendSchema.index({ 'cachedData.username': 1 }, { sparse: true }); // Username search

// Static method: Get all friends for a user
friendSchema.statics.getFriends = async function(userId, options = {}) {
  const {
    status = 'accepted',
    includeDeviceContacts = true,
    includeAppConnections = true,
    limit = 1000,
    skip = 0,
    sortBy = 'addedAt',
    sortOrder = -1
  } = options;
  
  const query = {
    userId,
    isDeleted: false
  };
  
  // Filter by status
  if (status) {
    query.status = status;
  }
  
  // Filter by source
  if (!includeDeviceContacts || !includeAppConnections) {
    if (includeDeviceContacts && !includeAppConnections) {
      query.isDeviceContact = true;
    } else if (!includeDeviceContacts && includeAppConnections) {
      query.isDeviceContact = false;
    }
  }
  
  const friends = await this.find(query)
    .sort({ [sortBy]: sortOrder })
    .skip(skip)
    .limit(limit)
    .lean();
  
  // ✅ FIX: Only apply MUTUAL check to DEVICE CONTACTS, not app connections
  // App connections (friend requests) should always be shown if accepted
  const mutualFriends = [];
  
  console.log(`🔍 [GET FRIENDS] Processing ${friends.length} friendships for user: ${userId}`);
  
  for (const friend of friends) {
    console.log(`🔍 [GET FRIENDS] Checking friendship: ${userId} → ${friend.friendUserId}`);
    console.log(`   - Status: ${friend.status}`);
    console.log(`   - isDeviceContact: ${friend.isDeviceContact}`);
    console.log(`   - isDeleted: ${friend.isDeleted}`);
    console.log(`   - Source: ${friend.source}`);
    
    // If this is an app connection (friend request), always include it
    if (!friend.isDeviceContact) {
      mutualFriends.push(friend);
      console.log(`✅ [APP CONNECTION] ${userId} ↔ ${friend.friendUserId}: Friend request (always shown)`);
      console.log(`   - This friendship WILL BE VISIBLE to user ${userId}`);
      continue;
    }
    
    // For device contacts, check if reciprocal friendship exists
    console.log(`🔍 [DEVICE CONTACT] Checking reciprocal for ${userId} → ${friend.friendUserId}`);
    const reciprocal = await this.findOne({
      userId: friend.friendUserId,
      friendUserId: userId,
      status: 'accepted',
      isDeviceContact: true, // Must be from device contacts
      isDeleted: false
    }).lean();
    
    // Only include device contact if reciprocal exists (mutual contact)
    if (reciprocal) {
      mutualFriends.push(friend);
      console.log(`✅ [MUTUAL CHECK] ${userId} ↔ ${friend.friendUserId}: Mutual device contact`);
      console.log(`   - This friendship WILL BE VISIBLE to user ${userId}`);
    } else {
      console.log(`⚠️ [MUTUAL CHECK] ${userId} → ${friend.friendUserId}: One-way device contact, excluded`);
      console.log(`   - This friendship WILL NOT BE VISIBLE to user ${userId}`);
    }
  }
  
  console.log(`✅ [GET FRIENDS] Returning ${mutualFriends.length} visible friends for user: ${userId}`);
  
  return mutualFriends;
};

// Static method: Get friend by friendUserId
friendSchema.statics.getFriend = async function(userId, friendUserId) {
  return await this.findOne({
    userId,
    friendUserId,
    isDeleted: false
  }).lean();
};

// Static method: Check if friendship exists
friendSchema.statics.areFriends = async function(userId, friendUserId) {
  const friendship = await this.findOne({
    userId,
    friendUserId,
    status: 'accepted',
    isDeleted: false
  });
  
  return !!friendship;
};

// Static method: Get mutual friends
friendSchema.statics.getMutualFriends = async function(userId1, userId2) {
  // CRITICAL FIX: Get friends using the proper getFriends method which handles bidirectional friendships
  // This prevents counting the same friend twice (once for each direction)
  
  // Get User 1's friends (already deduplicated by getFriends)
  const user1FriendsData = await this.getFriends(userId1);
  const user1Friends = user1FriendsData.map(f => f.friendUserId);
  
  // Get User 2's friends (already deduplicated by getFriends)
  const user2FriendsData = await this.getFriends(userId2);
  const user2Friends = user2FriendsData.map(f => f.friendUserId);
  
  // Find intersection - friends that both users have
  const mutualFriendIds = user1Friends.filter(id => user2Friends.includes(id));
  
  console.log(`🤝 [MUTUAL FRIENDS] User1 has ${user1Friends.length} friends, User2 has ${user2Friends.length} friends, ${mutualFriendIds.length} mutual`);
  
  return mutualFriendIds;
};

// Static method: Get friend requests (pending)
friendSchema.statics.getFriendRequests = async function(userId, type = 'received') {
  if (type === 'received') {
    // Friend requests sent TO this user
    return await this.find({
      friendUserId: userId,
      status: 'pending',
      isDeleted: false
    }).sort({ addedAt: -1 }).lean();
  } else {
    // Friend requests sent BY this user
    return await this.find({
      userId,
      status: 'pending',
      isDeleted: false
    }).sort({ addedAt: -1 }).lean();
  }
};

// Instance method: Accept friend request
friendSchema.methods.accept = async function() {
  this.status = 'accepted';
  this.acceptedAt = new Date();
  return await this.save();
};

// Instance method: Block friend
friendSchema.methods.block = async function() {
  this.status = 'blocked';
  this.blockedAt = new Date();
  return await this.save();
};

// Instance method: Remove friend (soft delete)
friendSchema.method('remove', async function() {
  this.status = 'removed';
  this.removedAt = new Date();
  this.isDeleted = true;
  return await this.save();
}, { suppressWarning: true });

// Instance method: Update cached data
friendSchema.methods.updateCache = async function(userData) {
  this.cachedData = {
    name: userData.name || this.cachedData.name,
    profileImage: userData.profileImage || this.cachedData.profileImage,
    username: userData.username || this.cachedData.username,
    lastSeen: userData.lastSeen || this.cachedData.lastSeen,
    isOnline: userData.isOnline !== undefined ? userData.isOnline : this.cachedData.isOnline,
    lastCacheUpdate: new Date()
  };
  return await this.save();
};

// Instance method: Record interaction
friendSchema.methods.recordInteraction = async function(type) {
  const now = new Date();
  
  switch(type) {
    case 'message':
      this.interactions.lastMessageAt = now;
      this.interactions.messageCount += 1;
      break;
    case 'call':
      this.interactions.lastCallAt = now;
      this.interactions.callCount += 1;
      break;
    case 'story':
      this.interactions.lastViewedStoryAt = now;
      break;
    case 'post':
      this.interactions.lastViewedPostAt = now;
      break;
  }
  
  return await this.save();
};

const Friend = mongoose.model('Friend', friendSchema);

module.exports = Friend;
