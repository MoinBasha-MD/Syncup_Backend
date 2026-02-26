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
  
  // Images array
  images: [{
    imageId: {
      type: String,
      required: true,
      unique: true,
    },
    imageUrl: {
      type: String,
      required: true,
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
    },
  }],
  
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
