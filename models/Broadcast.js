const mongoose = require('mongoose');

const broadcastSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['announcement', 'update', 'alert', 'maintenance', 'promotion', 'event', 'survey'],
    default: 'announcement'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  targetAudience: {
    type: String,
    enum: ['all', 'active', 'inactive', 'premium', 'new_users', 'custom'],
    default: 'all'
  },
  // Advanced targeting
  customTargeting: {
    userIds: [String],
    minAge: Number,
    maxAge: Number,
    locations: [String],
    lastActiveWithin: Number, // days
    registeredAfter: Date,
    registeredBefore: Date
  },
  sentBy: {
    type: String,
    required: true
  },
  sentByName: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['draft', 'sent', 'scheduled', 'cancelled'],
    default: 'sent'
  },
  scheduledFor: {
    type: Date
  },
  sentAt: {
    type: Date,
    default: Date.now
  },
  recipientCount: {
    type: Number,
    default: 0
  },
  readCount: {
    type: Number,
    default: 0
  },
  clickCount: {
    type: Number,
    default: 0
  },
  dismissCount: {
    type: Number,
    default: 0
  },
  // Rich media
  link: {
    type: String
  },
  imageUrl: {
    type: String
  },
  buttons: [{
    text: String,
    action: String, // 'link', 'dismiss', 'custom'
    url: String,
    data: mongoose.Schema.Types.Mixed
  }],
  // Template
  templateId: {
    type: String
  },
  isTemplate: {
    type: Boolean,
    default: false
  },
  templateName: {
    type: String
  },
  // Analytics
  analytics: {
    deliveryRate: Number,
    readRate: Number,
    clickRate: Number,
    avgTimeToRead: Number, // seconds
    peakReadTime: Date
  },
  // Expiration
  expiresAt: {
    type: Date
  },
  // A/B Testing
  abTest: {
    enabled: Boolean,
    variant: String, // 'A' or 'B'
    testId: String
  }
}, {
  timestamps: true
});

// Indexes
broadcastSchema.index({ sentAt: -1 });
broadcastSchema.index({ status: 1 });
broadcastSchema.index({ type: 1 });

module.exports = mongoose.model('Broadcast', broadcastSchema);
