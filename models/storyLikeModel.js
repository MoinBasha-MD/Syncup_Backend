const mongoose = require('mongoose');

const storyLikeSchema = new mongoose.Schema({
  storyId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: String,
    required: true,
    index: true
  },
  userName: {
    type: String,
    required: false
  },
  userProfileImage: {
    type: String,
    required: false
  },
  likedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Unique compound index to prevent duplicate likes
storyLikeSchema.index({ storyId: 1, userId: 1 }, { unique: true });

// Index for getting story likes sorted by time
storyLikeSchema.index({ storyId: 1, likedAt: -1 });

// Static method to toggle like (like/unlike)
storyLikeSchema.statics.toggleLike = async function(storyId, userId, userName, userProfileImage) {
  try {
    // Check if already liked
    const existingLike = await this.findOne({ storyId, userId });
    
    if (existingLike) {
      // Unlike - remove the like
      await this.deleteOne({ _id: existingLike._id });
      console.log('👍 Story unliked by user:', userId);
      return { liked: false, likeCount: await this.countLikes(storyId) };
    } else {
      // Like - create new like
      const like = await this.create({
        storyId,
        userId,
        userName,
        userProfileImage,
        likedAt: new Date()
      });
      console.log('❤️ Story liked by user:', userId);
      return { liked: true, likeCount: await this.countLikes(storyId), likeId: like._id };
    }
  } catch (error) {
    if (error.code === 11000) {
      // Race condition - duplicate key, treat as already liked
      await this.deleteOne({ storyId, userId });
      return { liked: false, likeCount: await this.countLikes(storyId) };
    }
    throw error;
  }
};

// Static method to count likes for a story
storyLikeSchema.statics.countLikes = function(storyId) {
  return this.countDocuments({ storyId });
};

// Static method to get all likes for a story
storyLikeSchema.statics.getLikesForStory = function(storyId, limit = 50) {
  return this.find({ storyId })
    .sort({ likedAt: -1 })
    .limit(limit)
    .select('userId userName userProfileImage likedAt');
};

// Static method to check if user liked a story
storyLikeSchema.statics.hasUserLiked = async function(storyId, userId) {
  const like = await this.findOne({ storyId, userId });
  return !!like;
};

// Static method to get stories liked by user
storyLikeSchema.statics.getLikedStoriesByUser = function(userId, storyIds) {
  return this.find({
    userId,
    storyId: { $in: storyIds }
  }).select('storyId likedAt');
};

module.exports = mongoose.model('StoryLike', storyLikeSchema);
