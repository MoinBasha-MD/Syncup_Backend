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
  
  // ✅ FIX: Only return MUTUAL friendships (both users have each other's numbers)
  // Filter to include only friends where reciprocal friendship exists
  const mutualFriends = [];
  
  for (const friend of friends) {
    // Check if reciprocal friendship exists (friend also has this user in their contacts)
    const reciprocal = await this.findOne({
      userId: friend.friendUserId,
      friendUserId: userId,
      status: 'accepted',
      isDeviceContact: true, // Must be from device contacts
      isDeleted: false
    }).lean();
    
    // Only include if reciprocal friendship exists (mutual contact)
    if (reciprocal) {
      mutualFriends.push(friend);
      console.log(`✅ [MUTUAL CHECK] ${userId} ↔ ${friend.friendUserId}: Mutual contact`);
    } else {
      console.log(`⚠️ [MUTUAL CHECK] ${userId} → ${friend.friendUserId}: One-way only, excluded`);
    }
  }
  
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
  const user1Friends = await this.find({
    userId: userId1,
    status: 'accepted',
    isDeleted: false
  }).distinct('friendUserId');
  
  const user2Friends = await this.find({
    userId: userId2,
    status: 'accepted',
    isDeleted: false
  }).distinct('friendUserId');
  
  // Find intersection
  const mutualFriendIds = user1Friends.filter(id => user2Friends.includes(id));
  
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
