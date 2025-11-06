const mongoose = require('mongoose');

const pageSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: [true, 'Page name is required'],
    trim: true,
    minlength: [3, 'Page name must be at least 3 characters'],
    maxlength: [50, 'Page name cannot exceed 50 characters']
  },
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^[a-z0-9_]+$/, 'Username can only contain lowercase letters, numbers, and underscores'],
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [30, 'Username cannot exceed 30 characters']
  },
  pageType: {
    type: String,
    required: [true, 'Page type is required'],
    enum: ['business', 'creator', 'meme', 'community', 'news', 'education'],
    default: 'creator'
  },
  bio: {
    type: String,
    trim: true,
    maxlength: [500, 'Bio cannot exceed 500 characters'],
    default: ''
  },
  description: {
    type: String,
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters'],
    default: ''
  },
  
  // Images
  profileImage: {
    type: String,
    default: ''
  },
  coverImage: {
    type: String,
    default: ''
  },
  
  // Category
  category: {
    type: String,
    trim: true,
    default: ''
  },
  subcategory: {
    type: String,
    trim: true,
    default: ''
  },
  
  // Contact Information
  contactInfo: {
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: ''
    },
    phone: {
      type: String,
      trim: true,
      default: ''
    },
    website: {
      type: String,
      trim: true,
      default: ''
    },
    address: {
      type: String,
      trim: true,
      default: ''
    },
    coordinates: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null }
    }
  },
  
  // Verification
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationTier: {
    type: String,
    enum: ['none', 'basic', 'premium', 'official'],
    default: 'none'
  },
  verifiedDate: {
    type: Date,
    default: null
  },
  
  // Ownership & Team
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Page owner is required']
  },
  team: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['admin', 'editor', 'moderator', 'analyst', 'contributor'],
      default: 'editor'
    },
    addedDate: {
      type: Date,
      default: Date.now
    },
    permissions: [{
      type: String
    }]
  }],
  
  // Statistics
  followerCount: {
    type: Number,
    default: 0,
    min: 0
  },
  postCount: {
    type: Number,
    default: 0,
    min: 0
  },
  totalLikes: {
    type: Number,
    default: 0,
    min: 0
  },
  totalComments: {
    type: Number,
    default: 0,
    min: 0
  },
  totalShares: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Settings
  isPublic: {
    type: Boolean,
    default: true
  },
  allowMessages: {
    type: Boolean,
    default: true
  },
  allowComments: {
    type: Boolean,
    default: true
  },
  allowCollaborations: {
    type: Boolean,
    default: false
  },
  autoReply: {
    enabled: {
      type: Boolean,
      default: false
    },
    message: {
      type: String,
      default: ''
    }
  },
  
  // Monetization (Phase 4)
  monetization: {
    enabled: {
      type: Boolean,
      default: false
    },
    subscriptionTiers: [{
      name: String,
      price: Number,
      benefits: [String]
    }],
    tipsEnabled: {
      type: Boolean,
      default: false
    },
    productsEnabled: {
      type: Boolean,
      default: false
    }
  },
  
  // Content
  pinnedPosts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PagePost'
  }],
  
  // Analytics
  analytics: {
    views: {
      type: Number,
      default: 0
    },
    reach: {
      type: Number,
      default: 0
    },
    impressions: {
      type: Number,
      default: 0
    },
    clickThroughRate: {
      type: Number,
      default: 0
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  },
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  isSuspended: {
    type: Boolean,
    default: false
  },
  suspensionReason: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Indexes for better query performance
pageSchema.index({ username: 1 });
pageSchema.index({ owner: 1 });
pageSchema.index({ pageType: 1 });
pageSchema.index({ category: 1 });
pageSchema.index({ isVerified: 1 });
pageSchema.index({ followerCount: -1 });
pageSchema.index({ createdAt: -1 });
pageSchema.index({ 'team.userId': 1 });

// Virtual for formatted follower count
pageSchema.virtual('formattedFollowerCount').get(function() {
  if (this.followerCount >= 1000000) {
    return (this.followerCount / 1000000).toFixed(1) + 'M';
  } else if (this.followerCount >= 1000) {
    return (this.followerCount / 1000).toFixed(1) + 'K';
  }
  return this.followerCount.toString();
});

// Method to check if user is owner
pageSchema.methods.isOwner = function(userId) {
  return this.owner.toString() === userId.toString();
};

// Method to check if user is team member
pageSchema.methods.isTeamMember = function(userId) {
  return this.team.some(member => member.userId.toString() === userId.toString());
};

// Method to check if user has specific role
pageSchema.methods.hasRole = function(userId, role) {
  const member = this.team.find(m => m.userId.toString() === userId.toString());
  return member && member.role === role;
};

// Method to check if user can post
pageSchema.methods.canPost = function(userId) {
  if (this.isOwner(userId)) return true;
  const member = this.team.find(m => m.userId.toString() === userId.toString());
  return member && ['admin', 'editor', 'contributor'].includes(member.role);
};

// Method to check if user can edit page
pageSchema.methods.canEdit = function(userId) {
  if (this.isOwner(userId)) return true;
  const member = this.team.find(m => m.userId.toString() === userId.toString());
  return member && ['admin'].includes(member.role);
};

// Static method to check username availability
pageSchema.statics.isUsernameAvailable = async function(username) {
  const page = await this.findOne({ username: username.toLowerCase() });
  return !page;
};

// Pre-save middleware to ensure username is lowercase
pageSchema.pre('save', function(next) {
  if (this.username) {
    this.username = this.username.toLowerCase();
  }
  next();
});

const Page = mongoose.model('Page', pageSchema);

module.exports = Page;
