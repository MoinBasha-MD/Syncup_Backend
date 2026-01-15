const mongoose = require('mongoose');

const intentNotificationSchema = new mongoose.Schema({
  fromUserId: {
    type: String,
    required: true,
    index: true
  },
  toUserId: {
    type: String,
    required: true,
    index: true
  },
  intentType: {
    type: String,
    enum: ['call', 'text', 'emergency'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'acknowledged', 'expired'],
    default: 'pending',
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  acknowledgedAt: {
    type: Date
  },
  expiresAt: {
    type: Date,
    index: true
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
intentNotificationSchema.index({ toUserId: 1, status: 1, createdAt: -1 });
intentNotificationSchema.index({ fromUserId: 1, toUserId: 1, status: 1 });

// Auto-expire old notifications (24 hours)
intentNotificationSchema.pre('save', function(next) {
  if (this.isNew && !this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  }
  next();
});

// Method to check if notification is expired
intentNotificationSchema.methods.isExpired = function() {
  return this.expiresAt && new Date() > this.expiresAt;
};

// Static method to get active intent for a user pair
intentNotificationSchema.statics.getActiveIntent = async function(fromUserId, toUserId) {
  return this.findOne({
    fromUserId,
    toUserId,
    status: 'pending',
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });
};

// Static method to get all pending intents for a user
intentNotificationSchema.statics.getPendingIntents = async function(userId) {
  const User = mongoose.model('User');
  const intents = await this.find({
    toUserId: userId,
    status: 'pending',
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });
  
  // Manually populate user data using userId field
  const populatedIntents = await Promise.all(
    intents.map(async (intent) => {
      const fromUser = await User.findOne({ userId: intent.fromUserId }).select('name phoneNumber profileImage userId');
      return {
        ...intent.toObject(),
        fromUserId: fromUser
      };
    })
  );
  
  return populatedIntents;
};

// Static method to cleanup expired intents
intentNotificationSchema.statics.cleanupExpired = async function() {
  return this.updateMany(
    {
      status: 'pending',
      expiresAt: { $lte: new Date() }
    },
    {
      $set: { status: 'expired' }
    }
  );
};

module.exports = mongoose.model('IntentNotification', intentNotificationSchema);
