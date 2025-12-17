const mongoose = require('mongoose');

const storyItemSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ['image', 'video', 'text'],
    default: 'image'
  },
  // For image/video content
  url: {
    type: String,
    required: function() { return this.type === 'image' || this.type === 'video'; }
  },
  // For text content
  text: {
    type: String,
    required: function() { return this.type === 'text'; },
    maxlength: 500
  },
  // Styling options for text stories
  backgroundColor: {
    type: String,
    default: '#000000'
  },
  textColor: {
    type: String,
    default: '#FFFFFF'
  },
  fontSize: {
    type: String,
    enum: ['small', 'medium', 'large'],
    default: 'medium'
  },
  fontFamily: {
    type: String,
    enum: ['default', 'bold', 'italic', 'cursive'],
    default: 'default'
  },
  textAlign: {
    type: String,
    enum: ['left', 'center', 'right'],
    default: 'center'
  },
  durationMs: {
    type: Number,
    default: 5000
  },
  // E2EE Phase 5: Encrypted story support
  encrypted: {
    type: Boolean,
    default: false
  },
  encryptedChunks: [{
    index: Number,
    ciphertext: String,
    iv: String,
    authTag: String
  }],
  encryptedContentKey: {
    type: String,
    default: null
  },
  keyIv: {
    type: String,
    default: null
  },
  keyAuthTag: {
    type: String,
    default: null
  },
  totalChunks: {
    type: Number,
    default: null
  },
  originalSize: {
    type: Number,
    default: null
  },
  mimeType: {
    type: String,
    default: null
  },
  fileName: {
    type: String,
    default: null
  }
}, { _id: false });

const storySchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  items: [storyItemSchema]
}, {
  timestamps: true
});

// TTL index for automatic cleanup of expired stories
storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index for finding user's active stories
storySchema.index({ userId: 1, expiresAt: 1 });

// Pre-save middleware to set expiresAt to 24 hours from creation
storySchema.pre('save', function(next) {
  if (this.isNew && !this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  }
  next();
});

// Virtual for checking if story is expired
storySchema.virtual('isExpired').get(function() {
  return new Date() > this.expiresAt;
});

// Static method to find active stories for contacts (handles string userIds)
storySchema.statics.findActiveStoriesForContacts = function(contactUserIds) {
  return this.find({
    userId: { $in: contactUserIds },
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });
};

// Static method to cleanup expired stories
storySchema.statics.cleanupExpiredStories = function() {
  return this.deleteMany({
    expiresAt: { $lte: new Date() }
  });
};

module.exports = mongoose.model('Story', storySchema);
