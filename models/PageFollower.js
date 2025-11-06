const mongoose = require('mongoose');

const pageFollowerSchema = new mongoose.Schema({
  // Page being followed
  pageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Page',
    required: [true, 'Page ID is required']
  },
  
  // User following the page
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required']
  },
  
  // Follow date
  followedAt: {
    type: Date,
    default: Date.now
  },
  
  // Notification settings
  notificationsEnabled: {
    type: Boolean,
    default: true
  },
  
  // Engagement tracking
  lastEngagement: {
    type: Date,
    default: Date.now
  },
  totalEngagement: {
    type: Number,
    default: 0
  },
  
  // Subscription (for monetization - Phase 4)
  isSubscriber: {
    type: Boolean,
    default: false
  },
  subscriptionTier: {
    type: String,
    default: ''
  },
  subscriptionStartDate: {
    type: Date,
    default: null
  },
  subscriptionEndDate: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Compound index to ensure a user can only follow a page once
pageFollowerSchema.index({ pageId: 1, userId: 1 }, { unique: true });

// Indexes for queries
pageFollowerSchema.index({ pageId: 1, followedAt: -1 });
pageFollowerSchema.index({ userId: 1, followedAt: -1 });

// Static method to follow a page
pageFollowerSchema.statics.followPage = async function(pageId, userId) {
  try {
    // Check if already following
    const existing = await this.findOne({ pageId, userId });
    if (existing) {
      return { success: false, message: 'Already following this page' };
    }
    
    // Create follow relationship
    const follow = await this.create({ pageId, userId });
    
    // Update page follower count
    const Page = mongoose.model('Page');
    await Page.findByIdAndUpdate(pageId, { $inc: { followerCount: 1 } });
    
    return { success: true, follow };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

// Static method to unfollow a page
pageFollowerSchema.statics.unfollowPage = async function(pageId, userId) {
  try {
    // Remove follow relationship
    const result = await this.deleteOne({ pageId, userId });
    
    if (result.deletedCount === 0) {
      return { success: false, message: 'Not following this page' };
    }
    
    // Update page follower count
    const Page = mongoose.model('Page');
    await Page.findByIdAndUpdate(pageId, { $inc: { followerCount: -1 } });
    
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

// Static method to check if user follows page
pageFollowerSchema.statics.isFollowing = async function(pageId, userId) {
  const follow = await this.findOne({ pageId, userId });
  return !!follow;
};

// Static method to get page followers
pageFollowerSchema.statics.getPageFollowers = async function(pageId, options = {}) {
  const { limit = 20, skip = 0, sort = '-followedAt' } = options;
  
  const followers = await this.find({ pageId })
    .populate('userId', 'name username profileImage')
    .sort(sort)
    .limit(limit)
    .skip(skip);
  
  return followers;
};

// Static method to get user's followed pages
pageFollowerSchema.statics.getUserFollowedPages = async function(userId, options = {}) {
  const { limit = 20, skip = 0, sort = '-followedAt' } = options;
  
  const follows = await this.find({ userId })
    .populate('pageId')
    .sort(sort)
    .limit(limit)
    .skip(skip);
  
  return follows.map(f => f.pageId);
};

const PageFollower = mongoose.model('PageFollower', pageFollowerSchema);

module.exports = PageFollower;
