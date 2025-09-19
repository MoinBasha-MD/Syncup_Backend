const mongoose = require('mongoose');

const diyaRequestSchema = new mongoose.Schema({
  // Request identification
  requesterId: {
    type: String,
    required: true,
    index: true
  },
  targetUserId: {
    type: String,
    required: true,
    index: true
  },
  
  // Request details
  requestType: {
    type: String,
    enum: ['availability', 'status', 'location', 'custom'],
    default: 'availability',
    required: true
  },
  requestMessage: {
    type: String,
    required: true,
    maxlength: 500
  },
  
  // Response details
  status: {
    type: String,
    enum: ['pending', 'responded', 'declined', 'expired'],
    default: 'pending',
    required: true,
    index: true
  },
  response: {
    type: String,
    enum: ['share', 'decline'],
    default: null
  },
  responseMessage: {
    type: String,
    maxlength: 500,
    default: null
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    required: true,
    index: true
  },
  respondedAt: {
    type: Date,
    default: null
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  
  // Additional metadata
  metadata: {
    requestContext: String, // Context of the original request
    requesterLocation: String, // Location of requester if relevant
    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'urgent'],
      default: 'normal'
    }
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt automatically
  collection: 'diya_requests'
});

// Indexes for better query performance
diyaRequestSchema.index({ requesterId: 1, createdAt: -1 });
diyaRequestSchema.index({ targetUserId: 1, status: 1 });
diyaRequestSchema.index({ expiresAt: 1 }); // For cleanup operations
diyaRequestSchema.index({ status: 1, expiresAt: 1 }); // For finding expired requests

// Virtual for checking if request is expired
diyaRequestSchema.virtual('isExpired').get(function() {
  return new Date() > this.expiresAt;
});

// Virtual for time remaining
diyaRequestSchema.virtual('timeRemaining').get(function() {
  const now = new Date();
  const remaining = this.expiresAt - now;
  return remaining > 0 ? remaining : 0;
});

// Method to check if request can be responded to
diyaRequestSchema.methods.canRespond = function() {
  return this.status === 'pending' && !this.isExpired;
};

// Method to expire the request
diyaRequestSchema.methods.expire = function() {
  this.status = 'expired';
  this.respondedAt = new Date();
  return this.save();
};

// Static method to find pending requests for a user
diyaRequestSchema.statics.findPendingForUser = function(userId) {
  return this.find({
    targetUserId: userId,
    status: 'pending',
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });
};

// Static method to cleanup expired requests
diyaRequestSchema.statics.cleanupExpired = function() {
  return this.updateMany(
    {
      status: 'pending',
      expiresAt: { $lt: new Date() }
    },
    {
      $set: {
        status: 'expired',
        respondedAt: new Date()
      }
    }
  );
};

// Pre-save middleware to ensure expiresAt is set
diyaRequestSchema.pre('save', function(next) {
  if (this.isNew && !this.expiresAt) {
    // Default to 24 hours from creation
    this.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
  next();
});

// Post-save middleware for logging
diyaRequestSchema.post('save', function(doc) {
  console.log(`📝 Diya request ${doc.isNew ? 'created' : 'updated'}:`, {
    id: doc._id,
    requester: doc.requesterId,
    target: doc.targetUserId,
    status: doc.status,
    type: doc.requestType
  });
});

const DiyaRequest = mongoose.model('DiyaRequest', diyaRequestSchema);

module.exports = DiyaRequest;
