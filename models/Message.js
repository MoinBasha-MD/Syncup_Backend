const mongoose = require('mongoose');

// Separate schema for post media to avoid casting issues
const postMediaSchema = new mongoose.Schema({
  url: { type: String },
  type: { type: String }
}, { _id: false });

const messageSchema = new mongoose.Schema({
  senderId: {
    type: String,
    required: true,
    index: true
  },
  receiverId: {
    type: String,
    required: true,
    index: true
  },
  message: {
    type: String,
    required: true
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'file', 'audio', 'video', 'gif', 'voice', 'shared_post', 'location'],
    default: 'text'
  },
  imageUrl: {
    type: String,
    default: null
  },
  // File metadata for file messages
  fileMetadata: {
    fileName: {
      type: String,
      default: null
    },
    fileSize: {
      type: Number,
      default: null
    },
    mimeType: {
      type: String,
      default: null
    },
    fileUrl: {
      type: String,
      default: null
    }
  },
  // Voice message metadata
  voiceMetadata: {
    duration: {
      type: Number,
      default: null
    },
    waveform: [{
      type: Number
    }],
    fileUrl: {
      type: String,
      default: null
    }
  },
  // Shared post metadata - using Mixed type to prevent Mongoose from converting arrays to strings
  sharedPost: {
    type: {
      postId: String,
      postCaption: String,
      postMedia: [postMediaSchema],
      postAuthor: {
        userId: String,
        userName: String,
        userProfileImage: String
      }
    },
    default: null
  },
  // Location sharing metadata
  locationData: {
    latitude: {
      type: Number,
      default: null
    },
    longitude: {
      type: Number,
      default: null
    },
    isLiveLocation: {
      type: Boolean,
      default: false
    },
    duration: {
      type: Number, // in minutes
      default: null
    },
    expiresAt: {
      type: Date,
      default: null
    },
    address: {
      type: String,
      default: null
    }
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
  },
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  },
  // Privacy modes (Burn, Ghost, Timer)
  privacyMode: {
    type: String,
    enum: ['normal', 'burn', 'ghost', 'timer'],
    default: 'normal'
  },
  burnViewTime: {
    type: Number, // seconds (5, 10, 30)
    default: null
  },
  burnViewedAt: {
    type: Date,
    default: null
  },
  burnViewedBy: {
    type: String,
    default: null
  },
  isGhost: {
    type: Boolean,
    default: false
  },
  ghostSessionId: {
    type: String,
    default: null
  },
  // ✅ FIX #2: Track who viewed ghost messages
  viewedBy: [{
    type: String // Array of userIds who viewed this message
  }],
  viewedAt: {
    type: Date,
    default: null
  },
  expiresAt: {
    type: Date,
    default: null,
    index: true // For efficient cleanup of expired messages
  },
  timerDuration: {
    type: Number, // milliseconds
    default: null
  },
  imageUrls: [{
    type: String // For multiple images (WhatsApp style)
  }],
  // Message reactions support
  reactions: [{
    emoji: {
      type: String,
      required: true,
      enum: ['👍', '❤️', '😂', '😮', '😢', '😡']
    },
    userId: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  // Enhanced attachments
  attachments: [{
    type: String,
    url: String,
    size: Number,
    mimeType: String,
    filename: String,
    thumbnail: String
  }],
  // Enhanced message encryption support
  encrypted: {
    type: Boolean,
    default: false
  },
  encryptionData: {
    encryptedContent: {
      type: String,
      default: null
    },
    iv: {
      type: String,
      default: null
    },
    keyId: {
      type: String,
      default: null
    },
    messageHash: {
      type: String,
      default: null
    }
  },
  // Search optimization
  searchText: {
    type: String,
    index: 'text' // Full-text search index
  },
  // Performance optimization - message preview for threading
  messagePreview: {
    type: String,
    maxlength: 100
  }
}, {
  timestamps: true
});

// Compound indexes for efficient querying
messageSchema.index({ senderId: 1, receiverId: 1, timestamp: -1 });
messageSchema.index({ receiverId: 1, senderId: 1, timestamp: -1 });
messageSchema.index({ receiverId: 1, status: 1 });
// Search optimization indexes
messageSchema.index({ searchText: 'text' });
messageSchema.index({ senderId: 1, receiverId: 1, searchText: 'text' });

// Pre-save middleware to generate search text and message preview
messageSchema.pre('save', function(next) {
  if (this.isModified('message')) {
    // Generate searchable text (lowercase for case-insensitive search)
    this.searchText = this.message.toLowerCase();
    
    // Generate message preview for threading
    this.messagePreview = this.message.length > 100 
      ? this.message.substring(0, 97) + '...'
      : this.message;
  }
  
  // Clean sharedPost data - remove newlines and extra whitespace
  if (this.sharedPost && Array.isArray(this.sharedPost.postMedia)) {
    this.sharedPost.postMedia = this.sharedPost.postMedia.map(media => {
      const cleanedMedia = {};
      if (media.url && typeof media.url === 'string') {
        cleanedMedia.url = media.url.replace(/[\n\r\t]/g, '').replace(/\s+/g, ' ').trim();
      }
      if (media.type && typeof media.type === 'string') {
        cleanedMedia.type = media.type.replace(/[\n\r\t]/g, '').trim();
      }
      return cleanedMedia;
    }).filter(media => media.url && media.type); // Remove invalid entries
    
    // Clean other sharedPost fields
    if (this.sharedPost.postId && typeof this.sharedPost.postId === 'string') {
      this.sharedPost.postId = this.sharedPost.postId.replace(/[\n\r\t]/g, '').trim();
    }
    if (this.sharedPost.postCaption && typeof this.sharedPost.postCaption === 'string') {
      this.sharedPost.postCaption = this.sharedPost.postCaption.replace(/[\n\r\t]/g, ' ').trim();
    }
    if (this.sharedPost.postAuthor) {
      if (this.sharedPost.postAuthor.userId && typeof this.sharedPost.postAuthor.userId === 'string') {
        this.sharedPost.postAuthor.userId = this.sharedPost.postAuthor.userId.replace(/[\n\r\t]/g, '').trim();
      }
      if (this.sharedPost.postAuthor.userName && typeof this.sharedPost.postAuthor.userName === 'string') {
        this.sharedPost.postAuthor.userName = this.sharedPost.postAuthor.userName.replace(/[\n\r\t]/g, ' ').trim();
      }
      if (this.sharedPost.postAuthor.userProfileImage && typeof this.sharedPost.postAuthor.userProfileImage === 'string') {
        this.sharedPost.postAuthor.userProfileImage = this.sharedPost.postAuthor.userProfileImage.replace(/[\n\r\t]/g, '').trim();
      }
    }
  }
  
  next();
});

// Static method to get conversation between two users
messageSchema.statics.getConversation = async function(userId1, userId2, skip = 0, limit = 50) {
  return this.find({
    $or: [
      { senderId: userId1, receiverId: userId2 },
      { senderId: userId2, receiverId: userId1 }
    ]
  })
  .sort({ timestamp: -1 })
  .skip(skip)
  .limit(limit)
  .lean();
};

// Static method to mark messages as read
messageSchema.statics.markAsRead = async function(senderId, receiverId) {
  return this.updateMany(
    {
      senderId: senderId,
      receiverId: receiverId,
      status: { $ne: 'read' }
    },
    {
      $set: { status: 'read' }
    }
  );
};

// Static method to get unread count from a specific sender
messageSchema.statics.getUnreadCount = async function(senderId, receiverId) {
  return this.countDocuments({
    senderId: senderId,
    receiverId: receiverId,
    status: { $ne: 'read' }
  });
};

// Static method to get all unread counts for a user
messageSchema.statics.getAllUnreadCounts = async function(userId) {
  const pipeline = [
    {
      $match: {
        receiverId: userId,
        status: { $ne: 'read' }
      }
    },
    {
      $group: {
        _id: '$senderId',
        count: { $sum: 1 },
        lastMessage: { $max: '$timestamp' }
      }
    },
    {
      $project: {
        senderId: '$_id',
        count: 1,
        lastMessage: 1,
        _id: 0
      }
    }
  ];

  return this.aggregate(pipeline);
};

// Static method to add/remove message reactions
messageSchema.statics.toggleReaction = async function(messageId, userId, emoji) {
  const message = await this.findById(messageId);
  if (!message) throw new Error('Message not found');

  const existingReactionIndex = message.reactions.findIndex(
    reaction => reaction.userId === userId && reaction.emoji === emoji
  );

  if (existingReactionIndex > -1) {
    // Remove existing reaction
    message.reactions.splice(existingReactionIndex, 1);
  } else {
    // Add new reaction (remove any existing reaction from same user first)
    message.reactions = message.reactions.filter(reaction => reaction.userId !== userId);
    message.reactions.push({ emoji, userId, timestamp: new Date() });
  }

  await message.save();
  return message;
};

// Static method to search messages
messageSchema.statics.searchMessages = async function(userId1, userId2, searchQuery, limit = 20) {
  const query = {
    $or: [
      { senderId: userId1, receiverId: userId2 },
      { senderId: userId2, receiverId: userId1 }
    ],
    $text: { $search: searchQuery }
  };

  return this.find(query)
    .sort({ score: { $meta: 'textScore' }, timestamp: -1 })
    .limit(limit)
    .lean();
};

// Static method to delete Ghost messages by session ID
messageSchema.statics.deleteGhostMessages = async function(ghostSessionId) {
  return this.deleteMany({
    isGhost: true,
    ghostSessionId: ghostSessionId
  });
};

// Static method to delete expired timer messages
messageSchema.statics.deleteExpiredMessages = async function() {
  const now = new Date();
  return this.deleteMany({
    expiresAt: { $lte: now },
    privacyMode: 'timer'
  });
};

// Static method to mark burn message as viewed
messageSchema.statics.markBurnViewed = async function(messageId, viewerId) {
  return this.findByIdAndUpdate(
    messageId,
    {
      $set: {
        burnViewedAt: new Date(),
        burnViewedBy: viewerId
      }
    },
    { new: true }
  );
};

// Optimized conversation loading with pagination and threading support
messageSchema.statics.getConversationOptimized = async function(userId1, userId2, skip = 0, limit = 50) {
  const pipeline = [
    {
      $match: {
        $or: [
          { senderId: userId1, receiverId: userId2 },
          { senderId: userId2, receiverId: userId1 }
        ]
      }
    },
    {
      $sort: { timestamp: -1 }
    },
    {
      $skip: skip
    },
    {
      $limit: limit
    },
    {
      $lookup: {
        from: 'messages',
        localField: 'replyTo',
        foreignField: '_id',
        as: 'replyToMessage',
        pipeline: [
          {
            $project: {
              senderId: 1,
              messagePreview: 1,
              timestamp: 1
            }
          }
        ]
      }
    },
    {
      $addFields: {
        replyToMessage: { $arrayElemAt: ['$replyToMessage', 0] }
      }
    },
    {
      $project: {
        senderId: 1,
        receiverId: 1,
        message: 1,
        messageType: 1,
        imageUrl: 1,
        voiceMetadata: 1,
        fileMetadata: 1,
        sharedPost: 1,
        locationData: 1,
        timestamp: 1,
        status: 1,
        isRead: 1,
        replyTo: 1,
        replyToMessage: 1,
        isGhost: 1,
        ghostSessionId: 1,
        burnAfterReading: 1,
        burnViewDuration: 1,
        burnViewedAt: 1,
        burnViewedBy: 1,
        reaction: 1
      }
    }
  ];

  return this.aggregate(pipeline);
};

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;
