const mongoose = require('mongoose');
const { getInstance: getPostEncryption } = require('../utils/postEncryption');

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
  },
  // 🔐 Media file encryption metadata
  encrypted: {
    type: Boolean,
    default: false
  },
  encryptionIv: {
    type: String // Base64 encoded IV
  },
  encryptionAuthTag: {
    type: String // Base64 encoded auth tag
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
  
  // ✅ PHASE 1: Page post visibility tracking
  pageVisibility: {
    type: String,
    enum: ['public', 'followers', 'custom'],
    index: true
  },
  
  // ✅ PHASE 1: Targeted user (for followers-only and custom posts)
  targetUserId: {
    type: String,
    index: true
  },
  
  // ✅ WEEK 1 FIX: Array of targeted users (replaces creating multiple documents)
  targetUserIds: {
    type: [String],
    index: true,
    default: []
  },
  type: {
    type: String,
    enum: ['photo', 'video', 'carousel'],
    required: true
  },
  caption: {
    type: String,
    maxlength: 5000, // Increased for encrypted content
    trim: true,
    default: ''
  },
  _captionEncrypted: {
    type: Boolean,
    default: false,
    select: false // Don't include in queries by default
  },
  media: [mediaItemSchema],
  location: {
    name: {
      type: String
    },
    coordinates: {
      lat: Number,
      lng: Number
    },
    _nameEncrypted: {
      type: Boolean,
      default: false
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
// ✅ PHASE 1: New indexes for targeted distribution
feedPostSchema.index({ pageVisibility: 1 });
feedPostSchema.index({ targetUserId: 1, createdAt: -1 });
feedPostSchema.index({ pageId: 1, pageVisibility: 1, targetUserId: 1 });

// 🔐 ENCRYPTION DISABLED - Captions and locations stored as plain text for better performance
feedPostSchema.pre('save', async function(next) {
  try {
    // Extract hashtags and mentions (no encryption)
    if (this.isModified('caption') && this.caption) {
      // Extract hashtags
      const hashtagRegex = /#(\w+)/g;
      const hashtags = [];
      let match;
      
      while ((match = hashtagRegex.exec(this.caption)) !== null) {
        hashtags.push(match[1].toLowerCase());
      }
      
      this.hashtags = [...new Set(hashtags)];
      
      // Extract mentions
      const mentionRegex = /@(\w+)/g;
      const mentions = [];
      
      while ((match = mentionRegex.exec(this.caption)) !== null) {
        mentions.push(match[1].toLowerCase());
      }
      
      this.mentions = [...new Set(mentions)];
      
      console.log('✅ [FEED POST] Caption saved (encryption disabled)');
    }
    
    next();
  } catch (error) {
    console.error('❌ [FEED POST] Save error:', error);
    next();
  }
});

// Note: Hashtag and mention extraction moved to encryption pre-save hook above

// 🔓 DECRYPTION: Decrypt post after loading from database
feedPostSchema.methods.decrypt = function() {
  try {
    const postEncryption = getPostEncryption();
    
    // Decrypt caption
    if (this._captionEncrypted && this.caption) {
      this.caption = postEncryption.decryptText(this.caption);
      this._captionEncrypted = false;
    }
    
    // Decrypt location name
    if (this.location && this.location._nameEncrypted && this.location.name) {
      this.location.name = postEncryption.decryptText(this.location.name);
      this.location._nameEncrypted = false;
    }
    
    return this;
  } catch (error) {
    console.error('❌ [FEED POST] Decryption error:', error);
    return this; // Return as-is on error
  }
};

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
// IMPORTANT: This returns ONLY friends' posts + own posts (For You feed)
// For Explore feed, use getExplorePosts() method
feedPostSchema.statics.getFeedPosts = async function(userId, page = 1, limit = 20, contactIds = [], followedPageIds = []) {
  const skip = (page - 1) * limit;
  
  console.log('');
  console.log('📱 [FEED POST MODEL] ==========================================');
  console.log('📱 [FEED POST MODEL] getFeedPosts called');
  console.log('📱 [FEED POST MODEL] userId:', userId);
  console.log('📱 [FEED POST MODEL] contactIds count:', contactIds.length);
  console.log('📱 [FEED POST MODEL] contactIds:', contactIds);
  console.log('📱 [FEED POST MODEL] followedPageIds count:', followedPageIds.length);
  console.log('📱 [FEED POST MODEL] ==========================================');
  console.log('');
  
  // FOR YOU FEED LOGIC (Friends + Own PUBLIC Posts ONLY):
  // 1. Your own PUBLIC posts only (not private/friends-only)
  // 2. Posts from contacts/friends with 'public' or 'friends' privacy
  // 3. Posts from pages you follow
  // NO PUBLIC POSTS FROM NON-FRIENDS!
  
  const query = {
    isActive: true,
    $or: [
      // Own PUBLIC posts only - not page posts
      { 
        userId: userId, 
        privacy: 'public',
        $or: [{ isPagePost: false }, { isPagePost: { $exists: false } }] 
      },
      
      // Contacts' posts with 'public' or 'friends' privacy - not page posts
      { 
        userId: { $in: contactIds },
        privacy: { $in: ['public', 'friends'] },
        $or: [{ isPagePost: false }, { isPagePost: { $exists: false } }]
      },
      
      // ✅ PHASE 1: Page posts - PUBLIC (everyone can see)
      {
        pageId: { $in: followedPageIds },
        isPagePost: true,
        $or: [
          { pageVisibility: 'public' },
          { pageVisibility: { $exists: false } } // Backward compatibility
        ]
      },
      
      // ✅ PHASE 1: Page posts - FOLLOWERS ONLY (targeted to this user)
      {
        pageId: { $in: followedPageIds },
        isPagePost: true,
        pageVisibility: 'followers',
        $or: [
          { targetUserId: userId }, // Old format (single user)
          { targetUserIds: userId } // ✅ WEEK 1 FIX: New format (array)
        ]
      },
      
      // ✅ PHASE 1: Page posts - CUSTOM (targeted to this user)
      {
        pageId: { $in: followedPageIds },
        isPagePost: true,
        pageVisibility: 'custom',
        $or: [
          { targetUserId: userId }, // Old format (single user)
          { targetUserIds: userId } // ✅ WEEK 1 FIX: New format (array)
        ]
      }
    ]
  };
  
  const posts = await this.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('pageId', 'name username profileImage isVerified')
    .lean();
  
  console.log('');
  console.log('📱 [FEED POST MODEL] ==========================================');
  console.log('📱 [FEED POST MODEL] Found', posts.length, 'posts for For You feed');
  console.log('📱 [FEED POST MODEL] Breakdown:', {
    ownPosts: posts.filter(p => p.userId === userId).length,
    contactPosts: posts.filter(p => contactIds.includes(p.userId)).length,
    pagePosts: posts.filter(p => p.isPagePost).length
  });
  
  // Show details of each post
  posts.forEach((post, index) => {
    console.log(`📱 [FEED POST MODEL] Post ${index + 1}:`, {
      _id: post._id,
      userId: post.userId,
      userName: post.userName,
      privacy: post.privacy,
      isPagePost: post.isPagePost,
      caption: post.caption?.substring(0, 30) + '...',
      isOwnPost: post.userId === userId,
      isFriendPost: contactIds.includes(post.userId)
    });
  });
  console.log('📱 [FEED POST MODEL] ==========================================');
  console.log('');
  
  return posts;
};

// Static method to get explore posts (public posts from non-friends)
feedPostSchema.statics.getExplorePosts = async function(userId, page = 1, limit = 20, contactIds = [], followedPageIds = []) {
  const skip = (page - 1) * limit;
  
  console.log('');
  console.log('🔍 [FEED POST MODEL] ==========================================');
  console.log('🔍 [FEED POST MODEL] getExplorePosts called');
  console.log('🔍 [FEED POST MODEL] userId:', userId);
  console.log('🔍 [FEED POST MODEL] Excluding contactIds count:', contactIds.length);
  console.log('🔍 [FEED POST MODEL] Excluding contactIds:', contactIds);
  console.log('🔍 [FEED POST MODEL] Excluding followedPageIds count:', followedPageIds.length);
  console.log('🔍 [FEED POST MODEL] ==========================================');
  console.log('');
  
  // EXPLORE FEED LOGIC (Public posts from non-friends):
  // 1. Must be active and public
  // 2. Exclude own posts
  // 3. For user posts: exclude friends
  // 4. For page posts: exclude followed pages
  
  const query = {
    isActive: true,
    privacy: 'public',
    $and: [
      // Exclude own posts
      { userId: { $ne: userId } },
      
      // Either:
      // - User post from non-friend
      // - Page post from non-followed page
      {
        $or: [
          // User posts (not page posts) from non-friends
          {
            $and: [
              { $or: [{ isPagePost: false }, { isPagePost: { $exists: false } }] },
              { userId: { $nin: contactIds } }
            ]
          },
          
          // Page posts from non-followed pages
          {
            $and: [
              { isPagePost: true },
              { pageId: { $nin: followedPageIds } }
            ]
          }
        ]
      }
    ]
  };
  
  console.log('🔍 [FEED POST MODEL] Query:', JSON.stringify(query, null, 2));
  
  const posts = await this.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('pageId', 'name username profileImage isVerified')
    .lean();
  
  console.log('');
  console.log('🔍 [FEED POST MODEL] ==========================================');
  console.log('🔍 [FEED POST MODEL] Found', posts.length, 'posts for Explore feed');
  
  // Show details of each post to debug
  posts.forEach((post, index) => {
    console.log(`🔍 [FEED POST MODEL] Post ${index + 1}:`, {
      _id: post._id,
      userId: post.userId,
      userName: post.userName,
      privacy: post.privacy,
      isPagePost: post.isPagePost,
      caption: post.caption?.substring(0, 30) + '...',
      isOwnPost: post.userId === userId,
      isFriendPost: contactIds.includes(post.userId),
      WARNING_OWN: post.userId === userId ? '⚠️ OWN POST SHOWING IN EXPLORE!' : '',
      WARNING_FRIEND: contactIds.includes(post.userId) ? '⚠️ FRIEND POST SHOWING IN EXPLORE!' : ''
    });
  });
  
  // Count issues
  const ownPostsCount = posts.filter(p => p.userId === userId).length;
  const friendPostsCount = posts.filter(p => contactIds.includes(p.userId)).length;
  
  if (ownPostsCount > 0) {
    console.log(`🔍 [FEED POST MODEL] ⚠️⚠️⚠️ ERROR: ${ownPostsCount} OWN POSTS showing in Explore!`);
  }
  if (friendPostsCount > 0) {
    console.log(`🔍 [FEED POST MODEL] ⚠️⚠️⚠️ ERROR: ${friendPostsCount} FRIEND POSTS showing in Explore!`);
  }
  
  if (posts.length === 0) {
    // Debug: Check if there are ANY public posts
    const totalPublicPosts = await this.countDocuments({ isActive: true, privacy: 'public' });
    console.log('🔍 [FEED POST MODEL] Total public posts in DB:', totalPublicPosts);
  }
  console.log('🔍 [FEED POST MODEL] ==========================================');
  console.log('');
  
  return posts;
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
