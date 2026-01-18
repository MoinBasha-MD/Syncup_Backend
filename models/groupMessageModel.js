const mongoose = require('mongoose');

/**
 * Group Message Schema - For messages in group chats
 */
const groupMessageSchema = mongoose.Schema(
  {
    messageId: {
      type: String,
      unique: true,
      index: true,
      default: () => require('crypto').randomUUID()
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GroupChat',
      required: true,
      index: true
    },
    senderId: {
      type: String,
      required: true,
      index: true
    },
    senderName: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true,
      maxlength: [5000, 'Message cannot exceed 5000 characters']
    },
    messageType: {
      type: String,
      enum: ['text', 'image', 'file', 'audio', 'video', 'gif', 'voice'],
      default: 'text'
    },
    // File/media metadata
    fileMetadata: {
      fileName: String,
      fileSize: Number,
      mimeType: String,
      fileUrl: String,
      thumbnailUrl: String,
      duration: Number // For audio/video files
    },
    // Image/GIF URL
    imageUrl: {
      type: String,
      default: null
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
      voiceUrl: {
        type: String,
        default: null
      }
    },
    // Message status
    status: {
      type: String,
      enum: ['sending', 'sent', 'delivered', 'failed'],
      default: 'sent'
    },
    // Reply to another message
    replyTo: {
      messageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GroupMessage'
      },
      message: String,
      senderName: String
    },
    // Message reactions
    reactions: [{
      emoji: {
        type: String,
        enum: ['👍', '❤️', '😂', '😮', '😢', '😡'],
        required: true
      },
      userId: {
        type: String,
        required: true
      },
      userName: {
        type: String,
        required: true
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }],
    // Message encryption support
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
      }
    },
    // Message read status by members
    readBy: [{
      userId: {
        type: String,
        required: true
      },
      readAt: {
        type: Date,
        default: Date.now
      }
    }],
    // Message delivery status
    deliveredTo: [{
      userId: {
        type: String,
        required: true
      },
      deliveredAt: {
        type: Date,
        default: Date.now
      }
    }],
    // Edit history
    editedAt: {
      type: Date,
      default: null
    },
    originalMessage: {
      type: String,
      default: null
    },
    // Deletion
    deletedAt: {
      type: Date,
      default: null
    },
    deletedBy: {
      type: String,
      default: null
    },
    deletedFor: {
      type: String,
      enum: ['sender', 'everyone'],
      default: null
    },
    // Disappearing message
    expiresAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true,
  }
);

// Create indexes for efficient queries
groupMessageSchema.index({ groupId: 1, createdAt: -1 }); // Group messages by time
groupMessageSchema.index({ senderId: 1, createdAt: -1 }); // Sender's messages
groupMessageSchema.index({ groupId: 1, status: 1 }); // Message status queries
groupMessageSchema.index({ groupId: 1, messageType: 1 }); // Filter by message type
groupMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Auto-delete expired messages
groupMessageSchema.index({ message: 'text' }); // Text search in messages

// Instance methods
groupMessageSchema.methods.addReaction = function(userId, userName, emoji) {
  // Remove existing reaction from this user
  this.reactions = this.reactions.filter(reaction => reaction.userId !== userId);
  
  // Add new reaction
  this.reactions.push({
    emoji,
    userId,
    userName,
    createdAt: new Date()
  });
  
  return this;
};

groupMessageSchema.methods.removeReaction = function(userId, emoji) {
  this.reactions = this.reactions.filter(reaction => 
    !(reaction.userId === userId && reaction.emoji === emoji)
  );
  return this;
};

groupMessageSchema.methods.markAsRead = function(userId) {
  // Remove existing read status for this user
  this.readBy = this.readBy.filter(read => read.userId !== userId);
  
  // Add new read status
  this.readBy.push({
    userId,
    readAt: new Date()
  });
  
  return this;
};

groupMessageSchema.methods.markAsDelivered = function(userId) {
  // Check if already delivered to this user
  const alreadyDelivered = this.deliveredTo.some(delivery => delivery.userId === userId);
  
  if (!alreadyDelivered) {
    this.deliveredTo.push({
      userId,
      deliveredAt: new Date()
    });
  }
  
  return this;
};

groupMessageSchema.methods.editMessage = function(newMessage) {
  this.originalMessage = this.message;
  this.message = newMessage;
  this.editedAt = new Date();
  return this;
};

groupMessageSchema.methods.deleteMessage = function(deletedBy, deleteFor = 'sender') {
  this.deletedAt = new Date();
  this.deletedBy = deletedBy;
  this.deletedFor = deleteFor;
  return this;
};

groupMessageSchema.methods.setExpiration = function(durationInSeconds) {
  this.expiresAt = new Date(Date.now() + (durationInSeconds * 1000));
  return this;
};

// Static methods
groupMessageSchema.statics.findGroupMessages = function(groupId, page = 1, limit = 50) {
  const skip = (page - 1) * limit;
  return this.find({ 
    groupId,
    deletedAt: null 
  })
  .sort({ createdAt: 1 }) // ✅ FIX: Sort ASCENDING (oldest first) for inverted FlatList
  .skip(skip)
  .limit(limit);
};

groupMessageSchema.statics.searchGroupMessages = function(groupId, searchQuery) {
  return this.find({
    groupId,
    deletedAt: null,
    $text: { $search: searchQuery }
  })
  .sort({ score: { $meta: 'textScore' }, createdAt: -1 });
};

groupMessageSchema.statics.getUnreadCount = function(groupId, userId, lastSeenMessageId) {
  const query = {
    groupId,
    deletedAt: null,
    senderId: { $ne: userId } // Don't count own messages
  };
  
  if (lastSeenMessageId) {
    query._id = { $gt: lastSeenMessageId };
  }
  
  return this.countDocuments(query);
};

const GroupMessage = mongoose.model('GroupMessage', groupMessageSchema);

module.exports = GroupMessage;
