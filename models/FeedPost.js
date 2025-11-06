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
  // Page post support (Phase 2)
  pageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Page',
    default: null,
    index: true
  },
  isPagePost: {
    type: Boolean,
    default: false,
    index: true
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
  isRepost: {
    type: Boolean,
    default: false
  },
  originalPostId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FeedPost'
  },
  originalUserId: {
    type: String
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
feedPostSchema.index({ pageId: 1, createdAt: -1 }); // For page posts
feedPostSchema.index({ isPagePost: 1, createdAt: -1 }); // For filtering

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

// Method to extract hashtags
feedPostSchema.methods.extractHashtags = function() {
  const hashtagRegex = /#(\w+)/g;
  const hashtags = [];
  let match;
  
  while ((match = hashtagRegex.exec(this.caption)) !== null) {
    hashtags.push(match[1].toLowerCase());
  }
  
  return [...new Set(hashtags)]; // Remove duplicates
};

// Method to extract mentions
feedPostSchema.methods.extractMentions = function() {
  const mentionRegex = /@(\w+)/g;
  const mentions = [];
  let match;
  
  while ((match = mentionRegex.exec(this.caption)) !== null) {
    mentions.push(match[1].toLowerCase());
  }
  
  return [...new Set(mentions)]; // Remove duplicates
};

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

// Static method to get feed posts for user (Instagram-style)
feedPostSchema.statics.getFeedPosts = async function(userId, page = 1, limit = 20, contactIds = [], followedPageIds = []) {
  const skip = (page - 1) * limit;
  
  // Instagram-style feed logic:
  // 1. Posts from people you follow (contacts) - all privacy levels
  // 2. Your own posts - all privacy levels
  // 3. Posts from pages you follow (NEW - Phase 2)
  // 4. Public posts from everyone (suggested content)
  
  const query = {
    isActive: true,
    $or: [
      // Own posts (all privacy levels) - not page posts
      { userId: userId, $or: [{ isPagePost: false }, { isPagePost: { $exists: false } }] },
      
      // Contacts' posts with 'public' or 'friends' privacy - not page posts
      { 
        userId: { $in: contactIds },
        privacy: { $in: ['public', 'friends'] },
        $or: [{ isPagePost: false }, { isPagePost: { $exists: false } }]
      },
      
      // Posts from followed pages (NEW - Phase 2)
      {
        pageId: { $in: followedPageIds },
        isPagePost: true
      },
      
      // Public posts from everyone (suggested content) - not page posts
      { 
        privacy: 'public',
        $or: [{ isPagePost: false }, { isPagePost: { $exists: false } }]
      }
    ]
  };
  
  const posts = await this.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('pageId', 'name username profileImage isVerified')
    .lean();
  
  // Prioritize: Own posts & contacts' posts & followed page posts first, then public posts
  const ownAndContactPosts = posts.filter(post => 
    post.userId === userId || 
    contactIds.includes(post.userId) ||
    (post.isPagePost && followedPageIds.includes(post.pageId?._id?.toString() || post.pageId?.toString()))
  );
  
  const publicPosts = posts.filter(post => 
    post.userId !== userId && 
    !contactIds.includes(post.userId) &&
    !(post.isPagePost && followedPageIds.includes(post.pageId?._id?.toString() || post.pageId?.toString()))
  );
  
  // Mix them: 70% own/contacts, 30% public (Instagram-style algorithm)
  const mixedPosts = [];
  let ownContactIndex = 0;
  let publicIndex = 0;
  
  for (let i = 0; i < posts.length; i++) {
    // Every 3-4 posts, show a public post (if available)
    if (i % 4 === 3 && publicIndex < publicPosts.length) {
      mixedPosts.push(publicPosts[publicIndex++]);
    } else if (ownContactIndex < ownAndContactPosts.length) {
      mixedPosts.push(ownAndContactPosts[ownContactIndex++]);
    } else if (publicIndex < publicPosts.length) {
      mixedPosts.push(publicPosts[publicIndex++]);
    }
  }
  
  return mixedPosts;
};

// Static method to get user's posts
feedPostSchema.statics.getUserPosts = function(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  
  return this.find({
    userId: userId,
    isActive: true,
    $or: [
      { isPagePost: false },
      { isPagePost: { $exists: false } }
    ]
  })
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limit)
  .lean();
};

// Static method to get page's posts (Phase 2)
feedPostSchema.statics.getPagePosts = function(pageId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  
  return this.find({
    pageId: pageId,
    isPagePost: true,
    isActive: true
  })
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limit)
  .populate('pageId', 'name username profileImage isVerified')
  .lean();
};

module.exports = mongoose.model('FeedPost', feedPostSchema);
