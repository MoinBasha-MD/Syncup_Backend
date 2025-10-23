const mongoose = require('mongoose');

const commentReplySchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  userName: {
    type: String,
    required: true
  },
  userProfileImage: {
    type: String
  },
  text: {
    type: String,
    required: true,
    maxlength: 500,
    trim: true
  },
  likes: [{
    type: String // User IDs who liked this reply
  }],
  likesCount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

const commentSchema = new mongoose.Schema({
  postId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FeedPost',
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
    required: true
  },
  userProfileImage: {
    type: String
  },
  text: {
    type: String,
    required: true,
    maxlength: 2200,
    trim: true
  },
  mentions: [{
    type: String,
    trim: true
  }],
  hashtags: [{
    type: String,
    trim: true
  }],
  likes: [{
    type: String // User IDs who liked this comment
  }],
  likesCount: {
    type: Number,
    default: 0
  },
  replies: [commentReplySchema],
  repliesCount: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  isEdited: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
commentSchema.index({ postId: 1, createdAt: -1 });
commentSchema.index({ userId: 1, createdAt: -1 });
commentSchema.index({ postId: 1, isActive: 1, createdAt: -1 });
commentSchema.index({ mentions: 1 });
commentSchema.index({ hashtags: 1 });

// Pre-save middleware to extract mentions and hashtags
commentSchema.pre('save', function(next) {
  if (this.isModified('text')) {
    // Extract mentions (@username)
    const mentionRegex = /@(\w+)/g;
    const mentions = [];
    let match;
    
    while ((match = mentionRegex.exec(this.text)) !== null) {
      mentions.push(match[1].toLowerCase());
    }
    
    this.mentions = [...new Set(mentions)]; // Remove duplicates
    
    // Extract hashtags (#topic)
    const hashtagRegex = /#(\w+)/g;
    const hashtags = [];
    
    while ((match = hashtagRegex.exec(this.text)) !== null) {
      hashtags.push(match[1].toLowerCase());
    }
    
    this.hashtags = [...new Set(hashtags)]; // Remove duplicates
  }
  next();
});

// Method to toggle like on comment
commentSchema.methods.toggleLike = function(userId) {
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

// Method to add reply
commentSchema.methods.addReply = function(replyData) {
  this.replies.push(replyData);
  this.repliesCount = this.replies.length;
  return this.save();
};

// Method to toggle like on reply
commentSchema.methods.toggleReplyLike = function(replyId, userId) {
  const reply = this.replies.id(replyId);
  
  if (!reply) {
    throw new Error('Reply not found');
  }
  
  const index = reply.likes.indexOf(userId);
  
  if (index > -1) {
    // Unlike
    reply.likes.splice(index, 1);
    reply.likesCount = Math.max(0, reply.likesCount - 1);
  } else {
    // Like
    reply.likes.push(userId);
    reply.likesCount += 1;
  }
  
  return this.save();
};

// Method to delete reply
commentSchema.methods.deleteReply = function(replyId) {
  this.replies.pull(replyId);
  this.repliesCount = this.replies.length;
  return this.save();
};

// Static method to get comments for a post
commentSchema.statics.getPostComments = function(postId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  
  return this.find({
    postId: postId,
    isActive: true
  })
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limit)
  .lean();
};

// Static method to get comment count for a post
commentSchema.statics.getCommentCount = async function(postId) {
  return this.countDocuments({
    postId: postId,
    isActive: true
  });
};

module.exports = mongoose.model('Comment', commentSchema);
