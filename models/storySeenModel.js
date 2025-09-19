const mongoose = require('mongoose');

const storySeenSchema = new mongoose.Schema({
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
  seenAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Unique compound index to prevent duplicate seen records
storySeenSchema.index({ storyId: 1, userId: 1 }, { unique: true });

// Static method to mark story as seen (idempotent)
storySeenSchema.statics.markAsSeen = async function(storyId, userId) {
  try {
    const result = await this.findOneAndUpdate(
      { storyId, userId },
      { seenAt: new Date() },
      { upsert: true, new: true }
    );
    return result;
  } catch (error) {
    if (error.code === 11000) {
      // Duplicate key error - story already seen, return existing record
      return await this.findOne({ storyId, userId });
    }
    throw error;
  }
};

// Static method to get seen stories for a user
storySeenSchema.statics.getSeenStoriesForUser = function(userId, storyIds) {
  return this.find({
    userId,
    storyId: { $in: storyIds }
  }).select('storyId seenAt');
};

module.exports = mongoose.model('StorySeen', storySeenSchema);
