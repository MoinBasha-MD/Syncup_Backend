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
    enum: ['announcement', 'update', 'alert', 'maintenance', 'promotion'],
    default: 'announcement'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  targetAudience: {
    type: String,
    enum: ['all', 'active', 'inactive', 'premium'],
    default: 'all'
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
    enum: ['draft', 'sent', 'scheduled'],
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
  link: {
    type: String
  },
  imageUrl: {
    type: String
  },
  expiresAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes
broadcastSchema.index({ sentAt: -1 });
broadcastSchema.index({ status: 1 });
broadcastSchema.index({ type: 1 });

module.exports = mongoose.model('Broadcast', broadcastSchema);
