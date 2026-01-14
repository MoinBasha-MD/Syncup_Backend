const mongoose = require('mongoose');
const { getInstance: getPostEncryption } = require('../utils/postEncryption');

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
    maxlength: 1000, // Increased for encrypted content
    trim: true
  },
  _textEncrypted: {
    type: Boolean,
    default: false
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
    maxlength: 5000, // Increased for encrypted content
    trim: true
  },
  _textEncrypted: {
    type: Boolean,
    default: false,
    select: false // Don't include in queries by default
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

// 🔐 ENCRYPTION DISABLED - Comments stored as plain text for better performance
commentSchema.pre('save', async function(next) {
  try {
    // Extract mentions and hashtags (no encryption)
    if (this.isModified('text') && this.text) {
      // Extract mentions
      const mentionRegex = /@(\w+)/g;
      const mentions = [];
      let match;
      
      while ((match = mentionRegex.exec(this.text)) !== null) {
        mentions.push(match[1].toLowerCase());
      }
      
      this.mentions = [...new Set(mentions)];
      
      // Extract hashtags
      const hashtagRegex = /#(\w+)/g;
      const hashtags = [];
      
      while ((match = hashtagRegex.exec(this.text)) !== null) {
        hashtags.push(match[1].toLowerCase());
      }
      
      this.hashtags = [...new Set(hashtags)];
      
      console.log('✅ [COMMENT] Comment text saved (encryption disabled)');
    }
    
    next();
  } catch (error) {
    console.error('❌ [COMMENT] Save error:', error);
    next();
  }
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

// 🔓 DECRYPTION: Decrypt comment after loading from database
commentSchema.methods.decrypt = async function() {
  try {
    const postEncryption = getPostEncryption();
    
    // Decrypt main comment text
    if (this._textEncrypted && this.text) {
      this.text = await postEncryption.decryptText(this.text);
      this._textEncrypted = false;
    }
    
    // Decrypt reply texts
    if (this.replies && this.replies.length > 0) {
      for (let reply of this.replies) {
        if (reply._textEncrypted && reply.text) {
          reply.text = await postEncryption.decryptText(reply.text);
          reply._textEncrypted = false;
        }
      }
    }
    
    return this;
  } catch (error) {
    console.error('❌ [COMMENT] Decryption error:', error);
    return this; // Return as-is on error
  }
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
commentSchema.statics.getPostComments = async function(postId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  
  const comments = await this.find({
    postId: postId,
    isActive: true
  })
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limit)
  .select('+_textEncrypted') // Include encryption flag
  .lean();
  
  // Decrypt comments before returning
  const postEncryption = getPostEncryption();
  const decryptedComments = await Promise.all(comments.map(async comment => {
    const decrypted = { ...comment };
    
    try {
      // Decrypt main comment text
      if (decrypted._textEncrypted && decrypted.text) {
        decrypted.text = await postEncryption.decryptText(decrypted.text);
      }
      
      // Decrypt replies
      if (decrypted.replies && decrypted.replies.length > 0) {
        decrypted.replies = await Promise.all(decrypted.replies.map(async reply => {
          if (reply._textEncrypted && reply.text) {
            reply.text = await postEncryption.decryptText(reply.text);
          }
          return reply;
        }));
      }
    } catch (decryptError) {
      console.error('❌ [COMMENT] Decryption error:', decryptError);
    }
    
    return decrypted;
  }));
  
  return decryptedComments;
};

// Static method to get comment count for a post
commentSchema.statics.getCommentCount = async function(postId) {
  return this.countDocuments({
    postId: postId,
    isActive: true
  });
};

const Comment = mongoose.model('Comment', commentSchema);

module.exports = Comment;
