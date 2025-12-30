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
  
  // ✅ PHASE 1: Demographics for targeting
  demographics: {
    age: Number,
    gender: {
      type: String,
      enum: ['male', 'female', 'other', 'prefer_not_to_say']
    },
    location: {
      country: String,
      countryCode: String, // ISO code (e.g., 'US', 'UK', 'IN')
      city: String,
      state: String,
      coordinates: {
        lat: Number,
        lng: Number
      }
    },
    language: String,
    timezone: String
  },
  
  // ✅ PHASE 1: Enhanced engagement tracking
  engagement: {
    lastInteraction: {
      type: Date,
      default: Date.now
    },
    totalLikes: { type: Number, default: 0 },
    totalComments: { type: Number, default: 0 },
    totalShares: { type: Number, default: 0 },
    totalViews: { type: Number, default: 0 },
    engagementScore: { 
      type: Number, 
      default: 0, 
      min: 0, 
      max: 100 
    },
    lastCalculated: Date
  },
  
  // ✅ PHASE 1: Follower segmentation
  segment: {
    type: String,
    enum: ['new', 'active', 'inactive', 'vip', 'at_risk'],
    default: 'new',
    index: true
  },
  segmentUpdatedAt: Date,
  
  // ✅ PHASE 1: Custom lists for targeting
  customLists: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PageFollowerList'
  }],
  
  // ✅ PHASE 1: Notification preferences
  notificationsEnabled: {
    type: Boolean,
    default: true
  },
  preferences: {
    emailNotifications: { type: Boolean, default: true },
    pushNotifications: { type: Boolean, default: true },
    postTypes: [String] // Types of content they engage with most
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

// ✅ PHASE 1: New indexes for targeting and segmentation
pageFollowerSchema.index({ 'demographics.countryCode': 1 });
pageFollowerSchema.index({ 'demographics.age': 1 });
pageFollowerSchema.index({ 'engagement.engagementScore': -1 });
pageFollowerSchema.index({ segment: 1 });
pageFollowerSchema.index({ pageId: 1, segment: 1 });
pageFollowerSchema.index({ pageId: 1, 'demographics.countryCode': 1 });

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

// ✅ PHASE 1: Track engagement action
pageFollowerSchema.methods.trackEngagement = async function(action) {
  const actionMap = {
    'like': 'totalLikes',
    'comment': 'totalComments',
    'share': 'totalShares',
    'view': 'totalViews'
  };
  
  const field = actionMap[action];
  if (field) {
    this.engagement[field] = (this.engagement[field] || 0) + 1;
    this.engagement.lastInteraction = new Date();
    await this.calculateEngagementScore();
    await this.save();
  }
};

// ✅ PHASE 1: Calculate engagement score (0-100)
pageFollowerSchema.methods.calculateEngagementScore = async function() {
  const weights = {
    likes: 1,
    comments: 3,
    shares: 5,
    views: 0.1
  };
  
  const score = (
    (this.engagement.totalLikes || 0) * weights.likes +
    (this.engagement.totalComments || 0) * weights.comments +
    (this.engagement.totalShares || 0) * weights.shares +
    (this.engagement.totalViews || 0) * weights.views
  );
  
  // Normalize to 0-100 scale (cap at 1000 total weighted actions)
  this.engagement.engagementScore = Math.min(100, (score / 1000) * 100);
  this.engagement.lastCalculated = new Date();
  
  // Update segment based on score
  await this.updateSegment();
};

// ✅ PHASE 1: Update follower segment
pageFollowerSchema.methods.updateSegment = async function() {
  const daysSinceFollow = (Date.now() - this.followedAt) / (1000 * 60 * 60 * 24);
  const daysSinceInteraction = this.engagement.lastInteraction 
    ? (Date.now() - this.engagement.lastInteraction) / (1000 * 60 * 60 * 24)
    : daysSinceFollow;
  
  const score = this.engagement.engagementScore || 0;
  
  let newSegment = 'new';
  
  if (daysSinceFollow <= 7) {
    newSegment = 'new';
  } else if (score >= 70 && daysSinceInteraction <= 7) {
    newSegment = 'vip';
  } else if (score >= 30 && daysSinceInteraction <= 30) {
    newSegment = 'active';
  } else if (daysSinceInteraction > 60) {
    newSegment = 'inactive';
  } else if (score < 20 && daysSinceInteraction > 30) {
    newSegment = 'at_risk';
  } else {
    newSegment = 'active';
  }
  
  if (this.segment !== newSegment) {
    this.segment = newSegment;
    this.segmentUpdatedAt = new Date();
  }
};

// ✅ PHASE 1: Static method to get followers by targeting criteria
pageFollowerSchema.statics.getTargetedFollowers = async function(pageId, targetAudience) {
  const query = { pageId };
  
  // Filter by countries
  if (targetAudience.countries && targetAudience.countries.length > 0) {
    query['demographics.countryCode'] = { $in: targetAudience.countries };
  }
  
  // Exclude countries
  if (targetAudience.excludeCountries && targetAudience.excludeCountries.length > 0) {
    query['demographics.countryCode'] = { 
      ...query['demographics.countryCode'],
      $nin: targetAudience.excludeCountries 
    };
  }
  
  // Filter by age range
  if (targetAudience.ageRange) {
    query['demographics.age'] = {
      $gte: targetAudience.ageRange.min,
      $lte: targetAudience.ageRange.max
    };
  }
  
  // Filter by custom lists
  if (targetAudience.customListIds && targetAudience.customListIds.length > 0) {
    query['customLists'] = { $in: targetAudience.customListIds };
  }
  
  return await this.find(query);
};

const PageFollower = mongoose.model('PageFollower', pageFollowerSchema);

module.exports = PageFollower;
