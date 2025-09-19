const mongoose = require('mongoose');

const blockSchema = new mongoose.Schema({
  // User who is doing the blocking
  blockerId: {
    type: String,
    required: true,
    index: true
  },
  
  // User being blocked
  blockedUserId: {
    type: String,
    required: true,
    index: true
  },
  
  // Blocker's details (for easy display)
  blockerName: {
    type: String,
    required: true
  },
  
  blockerUsername: {
    type: String,
    default: ''
  },
  
  blockerProfileImage: {
    type: String,
    default: ''
  },
  
  // Blocked user's details (for easy display)
  blockedUserName: {
    type: String,
    required: true
  },
  
  blockedUserUsername: {
    type: String,
    default: ''
  },
  
  blockedUserProfileImage: {
    type: String,
    default: ''
  },
  
  // Block reason (optional)
  reason: {
    type: String,
    maxlength: 200,
    default: ''
  },
  
  // Timestamps
  blockedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound index to ensure one block record per user pair
blockSchema.index({ blockerId: 1, blockedUserId: 1 }, { unique: true });

// Index for efficient queries
blockSchema.index({ blockerId: 1, blockedAt: -1 });
blockSchema.index({ blockedUserId: 1, blockedAt: -1 });

// Prevent self-blocking
blockSchema.pre('save', function(next) {
  if (this.blockerId === this.blockedUserId) {
    const error = new Error('Cannot block yourself');
    return next(error);
  }
  next();
});

// Static method to check if user is blocked
blockSchema.statics.isBlocked = async function(blockerId, blockedUserId) {
  const block = await this.findOne({ blockerId, blockedUserId });
  return !!block;
};

// Static method to check mutual blocking
blockSchema.statics.isMutuallyBlocked = async function(userId1, userId2) {
  const [block1, block2] = await Promise.all([
    this.findOne({ blockerId: userId1, blockedUserId: userId2 }),
    this.findOne({ blockerId: userId2, blockedUserId: userId1 })
  ]);
  return { 
    user1BlockedUser2: !!block1, 
    user2BlockedUser1: !!block2,
    anyBlocked: !!(block1 || block2)
  };
};

// Static method to get all users blocked by a user
blockSchema.statics.getBlockedUsers = async function(blockerId, options = {}) {
  const { limit = 50, offset = 0 } = options;
  
  return await this.find({ blockerId })
    .sort({ blockedAt: -1 })
    .limit(parseInt(limit))
    .skip(parseInt(offset))
    .lean();
};

// Static method to get all users who blocked a specific user
blockSchema.statics.getBlockedByUsers = async function(blockedUserId, options = {}) {
  const { limit = 50, offset = 0 } = options;
  
  return await this.find({ blockedUserId })
    .sort({ blockedAt: -1 })
    .limit(parseInt(limit))
    .skip(parseInt(offset))
    .lean();
};

const Block = mongoose.model('Block', blockSchema);

module.exports = Block;
