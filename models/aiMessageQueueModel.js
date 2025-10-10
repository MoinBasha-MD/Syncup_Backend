const mongoose = require('mongoose');

// AI Message Queue Model - Handles queuing and delivery of AI-to-AI messages
const aiMessageQueueSchema = new mongoose.Schema({
  // Unique queue entry identifier
  queueId: {
    type: String,
    required: true,
    unique: true,
    default: () => `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  },
  
  // Target AI that should receive this message
  targetAiId: {
    type: String,
    required: true,
    index: true
  },
  
  // Source AI that sent this message
  fromAiId: {
    type: String,
    required: true,
    index: true
  },
  
  // Message type classification
  messageType: {
    type: String,
    enum: ['request', 'response', 'notification', 'system'],
    required: true,
    index: true
  },
  
  // Message priority for processing order
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium',
    index: true
  },
  
  // Message content and data
  content: {
    text: {
      type: String,
      required: true,
      maxlength: 5000
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    attachments: [{
      type: {
        type: String,
        enum: ['calendar', 'location', 'contact', 'file', 'link']
      },
      data: mongoose.Schema.Types.Mixed,
      size: Number,
      url: String
    }],
    metadata: {
      conversationId: String,
      requestId: String,
      originalUserRequest: String,
      context: mongoose.Schema.Types.Mixed
    }
  },
  
  // Processing status
  status: {
    type: String,
    enum: ['queued', 'processing', 'delivered', 'failed', 'expired'],
    default: 'queued',
    index: true
  },
  
  // Retry mechanism
  retryCount: {
    type: Number,
    default: 0,
    min: 0
  },
  
  maxRetries: {
    type: Number,
    default: 3,
    min: 0,
    max: 10
  },
  
  // Scheduling
  scheduledFor: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  // Expiration handling
  expiresAt: {
    type: Date,
    index: true,
    default: function() {
      // Default expiration: 24 hours from now
      return new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
  },
  
  // Processing timestamps
  processedAt: {
    type: Date
  },
  
  deliveredAt: {
    type: Date
  },
  
  // Error tracking
  errors: [{
    timestamp: {
      type: Date,
      default: Date.now
    },
    errorType: {
      type: String,
      enum: ['network', 'validation', 'permission', 'timeout', 'system']
    },
    errorMessage: String,
    errorDetails: mongoose.Schema.Types.Mixed
  }],
  
  // Delivery confirmation
  deliveryConfirmation: {
    confirmed: {
      type: Boolean,
      default: false
    },
    confirmedAt: Date,
    responseReceived: {
      type: Boolean,
      default: false
    },
    responseAt: Date
  }
}, {
  timestamps: true
});

// Indexes for performance optimization
aiMessageQueueSchema.index({ targetAiId: 1, status: 1 });
aiMessageQueueSchema.index({ priority: -1, scheduledFor: 1 });
aiMessageQueueSchema.index({ status: 1, scheduledFor: 1 });
aiMessageQueueSchema.index({ expiresAt: 1 }); // For TTL cleanup
aiMessageQueueSchema.index({ fromAiId: 1, createdAt: -1 });
aiMessageQueueSchema.index({ 'content.metadata.conversationId': 1 });

// TTL index for automatic cleanup of expired messages
aiMessageQueueSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Virtual for checking if message is expired
aiMessageQueueSchema.virtual('isExpired').get(function() {
  return this.expiresAt < new Date();
});

// Virtual for checking if message can be retried
aiMessageQueueSchema.virtual('canRetry').get(function() {
  return this.retryCount < this.maxRetries && !this.isExpired;
});

// Instance methods
aiMessageQueueSchema.methods.markAsProcessing = function() {
  this.status = 'processing';
  this.processedAt = new Date();
  return this.save();
};

aiMessageQueueSchema.methods.markAsDelivered = function() {
  this.status = 'delivered';
  this.deliveredAt = new Date();
  this.deliveryConfirmation.confirmed = true;
  this.deliveryConfirmation.confirmedAt = new Date();
  return this.save();
};

aiMessageQueueSchema.methods.markAsFailed = function(errorType, errorMessage, errorDetails = {}) {
  this.status = 'failed';
  this.errors.push({
    timestamp: new Date(),
    errorType,
    errorMessage,
    errorDetails
  });
  return this.save();
};

aiMessageQueueSchema.methods.incrementRetry = function() {
  this.retryCount += 1;
  this.status = 'queued';
  // Exponential backoff for retry scheduling
  const backoffMinutes = Math.pow(2, this.retryCount) * 5; // 5, 10, 20, 40 minutes
  this.scheduledFor = new Date(Date.now() + backoffMinutes * 60 * 1000);
  return this.save();
};

aiMessageQueueSchema.methods.markAsExpired = function() {
  this.status = 'expired';
  return this.save();
};

aiMessageQueueSchema.methods.confirmResponse = function() {
  this.deliveryConfirmation.responseReceived = true;
  this.deliveryConfirmation.responseAt = new Date();
  return this.save();
};

aiMessageQueueSchema.methods.updatePriority = function(newPriority) {
  const validPriorities = ['low', 'medium', 'high', 'urgent'];
  if (validPriorities.includes(newPriority)) {
    this.priority = newPriority;
    return this.save();
  }
  throw new Error('Invalid priority level');
};

// Static methods
aiMessageQueueSchema.statics.getQueuedMessages = function(targetAiId, limit = 10) {
  return this.find({
    targetAiId,
    status: 'queued',
    scheduledFor: { $lte: new Date() },
    expiresAt: { $gt: new Date() }
  })
  .sort({ priority: -1, scheduledFor: 1 })
  .limit(limit);
};

aiMessageQueueSchema.statics.getHighPriorityMessages = function(targetAiId) {
  return this.find({
    targetAiId,
    status: 'queued',
    priority: { $in: ['high', 'urgent'] },
    scheduledFor: { $lte: new Date() },
    expiresAt: { $gt: new Date() }
  })
  .sort({ priority: -1, scheduledFor: 1 });
};

aiMessageQueueSchema.statics.getPendingMessages = function(targetAiId) {
  return this.find({
    targetAiId,
    status: { $in: ['queued', 'processing'] },
    expiresAt: { $gt: new Date() }
  })
  .sort({ priority: -1, scheduledFor: 1 });
};

aiMessageQueueSchema.statics.getFailedMessages = function(targetAiId) {
  return this.find({
    targetAiId,
    status: 'failed',
    retryCount: { $lt: this.maxRetries },
    expiresAt: { $gt: new Date() }
  })
  .sort({ priority: -1, createdAt: 1 });
};

aiMessageQueueSchema.statics.createMessage = function(fromAiId, targetAiId, messageType, content, options = {}) {
  const messageData = {
    fromAiId,
    targetAiId,
    messageType,
    content,
    priority: options.priority || 'medium',
    scheduledFor: options.scheduledFor || new Date(),
    expiresAt: options.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000),
    maxRetries: options.maxRetries || 3
  };
  
  return this.create(messageData);
};

aiMessageQueueSchema.statics.getQueueStatistics = function(aiId) {
  return Promise.all([
    this.countDocuments({ targetAiId: aiId, status: 'queued' }),
    this.countDocuments({ targetAiId: aiId, status: 'processing' }),
    this.countDocuments({ targetAiId: aiId, status: 'delivered' }),
    this.countDocuments({ targetAiId: aiId, status: 'failed' }),
    this.countDocuments({ targetAiId: aiId, status: 'expired' })
  ]).then(([queued, processing, delivered, failed, expired]) => ({
    queued,
    processing,
    delivered,
    failed,
    expired,
    total: queued + processing + delivered + failed + expired
  }));
};

aiMessageQueueSchema.statics.cleanupExpiredMessages = function() {
  return this.deleteMany({
    $or: [
      { status: 'expired' },
      { expiresAt: { $lt: new Date() } }
    ]
  });
};

aiMessageQueueSchema.statics.getMessagesForConversation = function(conversationId) {
  return this.find({
    'content.metadata.conversationId': conversationId
  }).sort({ createdAt: 1 });
};

// Pre-save middleware
aiMessageQueueSchema.pre('save', function(next) {
  // Auto-expire messages that are past their expiration date
  if (this.expiresAt < new Date() && this.status !== 'expired') {
    this.status = 'expired';
  }
  
  // Validate priority-based expiration
  if (this.priority === 'urgent' && !this.expiresAt) {
    // Urgent messages expire in 1 hour if not specified
    this.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  }
  
  next();
});

// Post-save middleware for logging
aiMessageQueueSchema.post('save', function(doc) {
  if (doc.status === 'failed') {
    console.log(`Message ${doc.queueId} failed delivery to ${doc.targetAiId}`);
  } else if (doc.status === 'delivered') {
    console.log(`Message ${doc.queueId} successfully delivered to ${doc.targetAiId}`);
  }
});

module.exports = mongoose.model('AIMessageQueue', aiMessageQueueSchema);
