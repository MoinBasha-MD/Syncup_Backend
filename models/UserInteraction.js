/**
 * UserInteraction Model
 * Tracks all user interactions with posts for recommendation algorithm
 */

const mongoose = require('mongoose');

const userInteractionSchema = new mongoose.Schema({
  userId: {
    type: String, // Changed from ObjectId to String to support UUID-based userIds
    required: true,
    index: true
  },
  postId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FeedPost',
    required: true,
    index: true
  },
  interactionType: {
    type: String,
    enum: ['view', 'like', 'comment', 'share', 'save', 'skip'],
    required: true
  },
  hashtags: [{
    type: String,
    lowercase: true,
    trim: true
  }],
  engagementScore: {
    type: Number,
    default: 0
  },
  watchTime: {
    type: Number, // milliseconds
    default: 0
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
userInteractionSchema.index({ userId: 1, timestamp: -1 });
userInteractionSchema.index({ userId: 1, interactionType: 1 });
userInteractionSchema.index({ postId: 1, interactionType: 1 });
userInteractionSchema.index({ hashtags: 1 });

// Calculate engagement score before saving
userInteractionSchema.pre('save', function(next) {
  const weights = {
    view: 1,
    like: 3,
    comment: 5,
    share: 7,
    save: 10,
    skip: -2 // Negative signal
  };
  
  this.engagementScore = weights[this.interactionType] || 0;
  
  // Bonus for watch time (videos)
  if (this.watchTime > 0) {
    const watchTimeBonus = Math.min(this.watchTime / 1000 / 30, 1) * 2; // Max 2 points for 30s+ watch
    this.engagementScore += watchTimeBonus;
  }
  
  next();
});

// Static method to get user's interaction history
userInteractionSchema.statics.getUserInteractions = function(userId, days = 30, limit = 1000) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  return this.find({
    userId,
    timestamp: { $gte: cutoffDate }
  })
  .sort({ timestamp: -1 })
  .limit(limit)
  .lean();
};

// Static method to get post interactions
userInteractionSchema.statics.getPostInteractions = function(postId) {
  return this.find({ postId })
    .populate('userId', 'name username')
    .sort({ timestamp: -1 })
    .lean();
};

// Static method to check if user interacted with post
userInteractionSchema.statics.hasUserInteracted = async function(userId, postId, interactionType) {
  const interaction = await this.findOne({
    userId,
    postId,
    interactionType
  });
  return !!interaction;
};

// Static method to get engagement stats for a post
userInteractionSchema.statics.getPostEngagementStats = async function(postId) {
  const stats = await this.aggregate([
    { $match: { postId: new mongoose.Types.ObjectId(postId) } },
    {
      $group: {
        _id: '$interactionType',
        count: { $sum: 1 },
        totalEngagement: { $sum: '$engagementScore' }
      }
    }
  ]);
  
  const result = {
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    totalEngagement: 0
  };
  
  stats.forEach(stat => {
    result[stat._id + 's'] = stat.count;
    result.totalEngagement += stat.totalEngagement;
  });
  
  return result;
};

module.exports = mongoose.model('UserInteraction', userInteractionSchema);
