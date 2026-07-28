const mongoose = require('mongoose');

const blinkSchema = new mongoose.Schema({
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
  mediaUrl: {
    type: String,
    required: true
  },
  mediaType: {
    type: String,
    required: true,
    enum: ['image', 'video']
  },
  musicUrl: {
    type: String,
    default: null
  },
  ringColor: {
    type: String,
    default: '#8B5CF6'
  },
  caption: {
    type: String,
    default: '',
    maxlength: 200
  },
  seenBy: [{
    userId: { type: String, required: true },
    seenAt: { type: Date, default: Date.now }
  }],
  likes: [{
    userId: { type: String, required: true },
    likedAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

// TTL index for automatic cleanup of expired blinks
blinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index for finding active blinks for contacts
blinkSchema.index({ userId: 1, expiresAt: 1 });

// Pre-save middleware to set expiresAt to 12 hours from creation
blinkSchema.pre('save', function(next) {
  if (this.isNew && !this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
  }
  next();
});

// Virtual for checking if blink is expired
blinkSchema.virtual('isExpired').get(function() {
  return new Date() > this.expiresAt;
});

// Static method to find active blinks for contacts
blinkSchema.statics.findActiveBlinksForContacts = function(contactUserIds) {
  return this.find({
    userId: { $in: contactUserIds },
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });
};

// Static method to cleanup expired blinks
blinkSchema.statics.cleanupExpiredBlinks = function() {
  return this.deleteMany({
    expiresAt: { $lte: new Date() }
  });
};

module.exports = mongoose.model('Blink', blinkSchema);
