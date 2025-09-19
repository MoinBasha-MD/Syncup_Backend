const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  content: {
    type: String,
    required: true,
    maxlength: 50,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  timestamps: true
});

// Index for automatic cleanup of expired posts
postSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index for finding user's active posts
postSchema.index({ userId: 1, isActive: 1 });

// Virtual for checking if post is expired
postSchema.virtual('isExpired').get(function() {
  return new Date() > this.expiresAt;
});

// Method to deactivate post
postSchema.methods.deactivate = function() {
  this.isActive = false;
  return this.save();
};

// Static method to find active posts for contacts
postSchema.statics.findActivePostsForContacts = function(contactUserIds) {
  return this.find({
    userId: { $in: contactUserIds },
    isActive: true,
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });
};

// Static method to find user's active post
postSchema.statics.findUserActivePost = function(userId) {
  return this.findOne({
    userId: userId,
    isActive: true,
    expiresAt: { $gt: new Date() }
  });
};

// Static method to cleanup expired posts
postSchema.statics.cleanupExpiredPosts = function() {
  return this.updateMany(
    { 
      isActive: true,
      expiresAt: { $lte: new Date() }
    },
    { 
      isActive: false 
    }
  );
};

module.exports = mongoose.model('Post', postSchema);
