const mongoose = require('mongoose');

const mediaItemSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['photo', 'video'],
    required: true
  },
  url: {
    type: String,
    required: true
  },
  thumbnail: {
    type: String
  },
  width: {
    type: Number,
    required: true
  },
  height: {
    type: Number,
    required: true
  },
  duration: {
    type: Number // For videos in seconds
  },
  order: {
    type: Number,
    required: true,
    default: 0
  }
}, { _id: false });

const feedPostSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  userName: {
    type: String,
    required: true
  },
  userProfileImage: {
    type: String
  },
  type: {
    type: String,
    enum: ['photo', 'video', 'carousel'],
    required: true
  },
  caption: {
    type: String,
    maxlength: 2200,
    trim: true,
    default: ''
  },
  media: [mediaItemSchema],
  location: {
    name: {
      type: String
    },
    coordinates: {
      lat: Number,
      lng: Number
    }
  },
  hashtags: [{
    type: String,
    trim: true
  }],
  mentions: [{
    type: String,
    trim: true
  }],
  privacy: {
    type: String,
    enum: ['public', 'friends', 'private'],
    default: 'public',
    index: true
  },
  likes: [{
    type: String // User IDs
  }],
  likesCount: {
    type: Number,
    default: 0
  },
  commentsCount: {
    type: Number,
    default: 0
  },
  sharesCount: {
    type: Number,
    default: 0
  },
  viewsCount: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
feedPostSchema.index({ userId: 1, createdAt: -1 });
feedPostSchema.index({ createdAt: -1 });
feedPostSchema.index({ privacy: 1, createdAt: -1 });
feedPostSchema.index({ hashtags: 1 });

// Extract hashtags from caption
feedPostSchema.pre('save', function(next) {
  if (this.isModified('caption')) {
    const hashtagRegex = /#(\w+)/g;
    const hashtags = [];
    let match;
    
    while ((match = hashtagRegex.exec(this.caption)) !== null) {
      hashtags.push(match[1].toLowerCase());
    }
    
    this.hashtags = [...new Set(hashtags)]; // Remove duplicates
  }
  next();
});

// Extract mentions from caption
feedPostSchema.pre('save', function(next) {
  if (this.isModified('caption')) {
    const mentionRegex = /@(\w+)/g;
    const mentions = [];
    let match;
    
    while ((match = mentionRegex.exec(this.caption)) !== null) {
      mentions.push(match[1].toLowerCase());
    }
    
    this.mentions = [...new Set(mentions)]; // Remove duplicates
  }
  next();
});

// Method to toggle like
feedPostSchema.methods.toggleLike = function(userId) {
  const index = this.likes.indexOf(userId);
  
  if (index > -1) {
    // Unlike
    this.likes.splice(index, 1);
    this.likesCount = Math.max(0, this.likesCount - 1);
  } else {
    // Like
    this.likes.push(userId);
    this.likesCount += 1;
  }
  
  return this.save();
};

// Method to increment view count
feedPostSchema.methods.incrementViews = function() {
  this.viewsCount += 1;
  return this.save();
};

// Static method to get feed posts for user
feedPostSchema.statics.getFeedPosts = function(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  
  return this.find({
    isActive: true,
    $or: [
      { privacy: 'public' },
      { userId: userId }, // User's own posts
      // TODO: Add friends-only logic when friendship system is implemented
    ]
  })
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limit)
  .lean();
};

// Static method to get user's posts
feedPostSchema.statics.getUserPosts = function(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  
  return this.find({
    userId: userId,
    isActive: true
  })
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limit)
  .lean();
};

module.exports = mongoose.model('FeedPost', feedPostSchema);
