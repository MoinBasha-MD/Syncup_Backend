/**
 * ✅ WEEK 1 FIX: UserSeenPost Model
 * Tracks which posts users have already seen in Explore feed
 * Prevents showing duplicate posts
 * TTL: 30 days (posts can be shown again after 30 days)
 */

const mongoose = require('mongoose');

const userSeenPostSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  postId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FeedPost',
    required: true,
    index: true
  },
  seenAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  seenCount: {
    type: Number,
    default: 1
  },
  // Context about where/how it was seen
  context: {
    source: {
      type: String,
      enum: ['explore', 'feed', 'profile', 'hashtag', 'search'],
      default: 'explore'
    },
    position: Number, // Position in feed when shown
    sessionId: String // Track viewing session
  }
}, {
  timestamps: true
});

// Compound unique index - user can only see a post once (per 30 days)
userSeenPostSchema.index({ userId: 1, postId: 1 }, { unique: true });

// TTL index - automatically delete records after 30 days
userSeenPostSchema.index({ seenAt: 1 }, { expireAfterSeconds: 2592000 }); // 30 days

// Index for efficient queries
userSeenPostSchema.index({ userId: 1, seenAt: -1 });

// Static method to track a post view
userSeenPostSchema.statics.trackView = async function(userId, postId, context = {}) {
  try {
    const result = await this.findOneAndUpdate(
      { userId, postId },
      { 
        $inc: { seenCount: 1 },
        $set: { 
          seenAt: new Date(),
          context: {
            source: context.source || 'explore',
            position: context.position,
            sessionId: context.sessionId
          }
        }
      },
      { upsert: true, new: true }
    );
    
    console.log(`👁️ [SEEN POST] Tracked view: User ${userId} saw post ${postId} (count: ${result.seenCount})`);
    return result;
  } catch (error) {
    // Ignore duplicate key errors (race condition)
    if (error.code === 11000) {
      console.log(`👁️ [SEEN POST] Already tracked: User ${userId} saw post ${postId}`);
      return null;
    }
    throw error;
  }
};

// Static method to track multiple post views (batch)
userSeenPostSchema.statics.trackViewsBatch = async function(userId, postIds, context = {}) {
  const records = postIds.map(postId => ({
    userId,
    postId,
    seenAt: new Date(),
    seenCount: 1,
    context: {
      source: context.source || 'explore',
      position: context.position,
      sessionId: context.sessionId
    }
  }));
  
  try {
    // Use insertMany with ordered: false to continue on duplicates
    const result = await this.insertMany(records, { ordered: false });
    console.log(`👁️ [SEEN POST] Batch tracked: ${result.length}/${postIds.length} new views for user ${userId}`);
    return result;
  } catch (error) {
    // Some inserts may have failed due to duplicates, that's okay
    if (error.code === 11000) {
      console.log(`👁️ [SEEN POST] Batch tracked with some duplicates for user ${userId}`);
      return error.insertedDocs || [];
    }
    throw error;
  }
};

// Static method to get posts user has already seen
userSeenPostSchema.statics.getSeenPostIds = async function(userId, limit = 10000) {
  const seen = await this.find({ userId })
    .select('postId')
    .sort({ seenAt: -1 })
    .limit(limit)
    .lean();
  
  return seen.map(s => s.postId);
};

// Static method to check if user has seen a specific post
userSeenPostSchema.statics.hasSeen = async function(userId, postId) {
  const seen = await this.findOne({ userId, postId });
  return !!seen;
};

// Static method to get user's viewing stats
userSeenPostSchema.statics.getUserStats = async function(userId) {
  const totalSeen = await this.countDocuments({ userId });
  const recentSeen = await this.countDocuments({ 
    userId, 
    seenAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
  });
  
  return {
    totalSeen,
    recentSeen,
    averagePerDay: recentSeen / 7
  };
};

// Instance method to mark as seen again (refresh TTL)
userSeenPostSchema.methods.refresh = async function() {
  this.seenAt = new Date();
  this.seenCount += 1;
  return await this.save();
};

const UserSeenPost = mongoose.model('UserSeenPost', userSeenPostSchema);

module.exports = UserSeenPost;
