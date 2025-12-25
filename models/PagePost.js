const mongoose = require('mongoose');

const pagePostSchema = new mongoose.Schema({
  // Page reference
  page: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Page',
    required: true,
    index: true
  },
  
  // Author (page owner or team member who created the post)
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Content
  content: {
    type: String,
    required: true,
    maxlength: 5000
  },
  
  // Media attachments
  media: [{
    type: {
      type: String,
      enum: ['image', 'video'],
      required: true
    },
    url: {
      type: String,
      required: true
    },
    thumbnail: String, // For videos
    duration: Number,  // For videos (in seconds)
    width: Number,
    height: Number
  }],
  
  // Engagement
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  likeCount: {
    type: Number,
    default: 0
  },
  
  comments: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    content: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  commentCount: {
    type: Number,
    default: 0
  },
  
  shares: {
    type: Number,
    default: 0
  },
  
  views: {
    type: Number,
    default: 0
  },
  
  // Hashtags and mentions
  hashtags: [String],
  showHashtags: {
    type: Boolean,
    default: false // Default: hide hashtags (used for discovery only)
  },
  mentions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  // Status
  isPublished: {
    type: Boolean,
    default: true
  },
  
  isPinned: {
    type: Boolean,
    default: false
  },
  
  // Scheduling
  scheduledFor: Date,
  publishedAt: Date,
  
  // Analytics
  analytics: {
    reach: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    engagement: { type: Number, default: 0 },
    clickThroughRate: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

// Indexes for performance
pagePostSchema.index({ page: 1, createdAt: -1 });
pagePostSchema.index({ page: 1, isPinned: -1, createdAt: -1 });
pagePostSchema.index({ hashtags: 1 });
pagePostSchema.index({ isPublished: 1, publishedAt: -1 });

// Virtual for engagement rate
pagePostSchema.virtual('engagementRate').get(function() {
  if (this.views === 0) return 0;
  return ((this.likeCount + this.commentCount + this.shares) / this.views) * 100;
});

// Methods
pagePostSchema.methods.toggleLike = function(userId) {
  const index = this.likes.indexOf(userId);
  if (index > -1) {
    this.likes.splice(index, 1);
    this.likeCount = Math.max(0, this.likeCount - 1);
  } else {
    this.likes.push(userId);
    this.likeCount += 1;
  }
  return this.save();
};

pagePostSchema.methods.addComment = function(userId, content) {
  this.comments.push({
    user: userId,
    content: content,
    createdAt: new Date()
  });
  this.commentCount += 1;
  return this.save();
};

pagePostSchema.methods.removeComment = function(commentId) {
  this.comments.id(commentId).remove();
  this.commentCount = Math.max(0, this.commentCount - 1);
  return this.save();
};

pagePostSchema.methods.incrementViews = function() {
  this.views += 1;
  this.analytics.impressions += 1;
  return this.save();
};

pagePostSchema.methods.incrementShares = function() {
  this.shares += 1;
  return this.save();
};

// Extract hashtags from content
pagePostSchema.pre('save', function(next) {
  if (this.isModified('content')) {
    const hashtagRegex = /#(\w+)/g;
    const hashtags = [];
    let match;
    
    while ((match = hashtagRegex.exec(this.content)) !== null) {
      hashtags.push(match[1].toLowerCase());
    }
    
    this.hashtags = [...new Set(hashtags)]; // Remove duplicates
  }
  next();
});

// Set publishedAt when publishing
pagePostSchema.pre('save', function(next) {
  if (this.isModified('isPublished') && this.isPublished && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  next();
});

const PagePost = mongoose.model('PagePost', pagePostSchema);

module.exports = PagePost;
