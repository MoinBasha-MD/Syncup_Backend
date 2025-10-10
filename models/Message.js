const mongoose = require('mongoose');

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
    enum: ['text', 'image', 'file', 'audio', 'video', 'gif', 'voice'],
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
    }
  ];

  return this.aggregate(pipeline);
};

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;
