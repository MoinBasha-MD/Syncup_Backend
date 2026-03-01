const mongoose = require('mongoose');

const imageSpaceSchema = new mongoose.Schema({
  // Chat identifier (sorted userId pair to ensure uniqueness)
  chatId: {
    type: String,
    required: true,
    index: true,
  },
  
  // User IDs (sorted alphabetically for consistency)
  userId1: {
    type: String,
    required: true,
    index: true,
  },
  
  userId2: {
    type: String,
    required: true,
    index: true,
  },
  
  // Items array (supports both images and text messages)
  items: [{
    itemId: {
      type: String,
      required: true,
      unique: true,
    },
    type: {
      type: String,
      enum: ['image', 'text'],
      required: true,
    },
    // For images
    imageUrl: {
      type: String,
    },
    // For text messages
    text: {
      type: String,
    },
    uploadedBy: {
      type: String,
      required: true,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
    caption: {
      type: String,
      default: '',
    },
    metadata: {
      width: Number,
      height: Number,
      size: Number,
      mimeType: String,
      // Original message metadata
      originalMessageId: String,
      originalTimestamp: Date,
    },
    viewedBy: [{
      userId: String,
      viewedAt: Date,
    }],
  }],
  
  // Legacy support - keep old images field for backward compatibility
  images: [{
    imageId: String,
    imageUrl: String,
    uploadedBy: String,
    uploadedAt: Date,
    caption: String,
    metadata: {
      width: Number,
      height: Number,
      size: Number,
      mimeType: String,
    },
    viewedBy: [{
      userId: String,
      viewedAt: Date,
    }],
  }],
  
  // Unread counts for each user
  unreadCount: {
    type: Map,
    of: Number,
    default: {},
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Compound index for efficient queries
imageSpaceSchema.index({ userId1: 1, userId2: 1 });
imageSpaceSchema.index({ chatId: 1 });

// Static method to generate chatId from two userIds
imageSpaceSchema.statics.generateChatId = function(userId1, userId2) {
  const sortedIds = [userId1, userId2].sort();
  return `${sortedIds[0]}_${sortedIds[1]}`;
};

// Update timestamp on save
imageSpaceSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const ImageSpace = mongoose.model('ImageSpace', imageSpaceSchema);

module.exports = ImageSpace;
