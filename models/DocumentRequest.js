const mongoose = require('mongoose');

/**
 * DocumentRequest Model - Manages document access requests
 * When a user requests access to another user's document
 */
const documentRequestSchema = new mongoose.Schema(
  {
    // Unique request ID
    requestId: {
      type: String,
      required: true,
      unique: true,
      default: () => `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    },
    
    // Requester information
    requesterId: {
      type: String,
      required: true,
      index: true
    },
    
    requesterName: {
      type: String,
      required: true
    },
    
    requesterProfileImage: {
      type: String,
      default: ''
    },
    
    // Target user (document owner)
    targetUserId: {
      type: String,
      required: true,
      index: true
    },
    
    targetUserName: {
      type: String,
      required: true
    },
    
    // Document information
    documentType: {
      type: String,
      required: true
    },
    
    documentId: {
      type: String, // If requesting a specific document
      default: null
    },
    
    // Request details
    requestMessage: {
      type: String,
      maxlength: 500,
      default: ''
    },
    
    requestedVia: {
      type: String,
      enum: ['maya_ai', 'direct', 'chat'],
      default: 'maya_ai'
    },
    
    // Request status
    status: {
      type: String,
      enum: ['pending', 'approved', 'denied', 'expired', 'cancelled'],
      default: 'pending',
      index: true
    },
    
    // Timestamps
    requestedAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    
    respondedAt: {
      type: Date,
      default: null
    },
    
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      index: true
    },
    
    // Approval details
    approvalType: {
      type: String,
      enum: ['document-specific', 'full-access', null],
      default: null
    },
    
    accessType: {
      type: String,
      enum: ['one-time', 'permanent', null],
      default: null
    },
    
    // Response details
    responseMessage: {
      type: String,
      maxlength: 500,
      default: ''
    },
    
    respondedBy: {
      type: String, // userId who responded
      default: null
    },
    
    // Metadata
    metadata: {
      aiConversationId: {
        type: String,
        default: null
      },
      requestSource: {
        type: String, // "maya_chat", "notification", etc.
        default: null
      },
      priority: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium'
      }
    },
    
    // Notification tracking
    notifications: {
      requestSent: {
        type: Boolean,
        default: false
      },
      requestSentAt: {
        type: Date,
        default: null
      },
      responseSent: {
        type: Boolean,
        default: false
      },
      responseSentAt: {
        type: Date,
        default: null
      },
      reminderSent: {
        type: Boolean,
        default: false
      },
      reminderSentAt: {
        type: Date,
        default: null
      }
    }
  },
  {
    timestamps: true
  }
);

// Indexes
documentRequestSchema.index({ requesterId: 1, status: 1 });
documentRequestSchema.index({ targetUserId: 1, status: 1 });
documentRequestSchema.index({ status: 1, expiresAt: 1 });
documentRequestSchema.index({ requestedAt: -1 });

// Auto-expire old pending requests
documentRequestSchema.pre('save', function(next) {
  if (this.status === 'pending' && this.expiresAt < new Date()) {
    this.status = 'expired';
  }
  next();
});

// Static method: Get pending requests for a user
documentRequestSchema.statics.getPendingRequests = async function(userId, type = 'received') {
  const query = {
    status: 'pending',
    expiresAt: { $gt: new Date() }
  };
  
  if (type === 'received') {
    query.targetUserId = userId;
  } else {
    query.requesterId = userId;
  }
  
  return await this.find(query)
    .sort({ requestedAt: -1 })
    .lean();
};

// Static method: Check if request already exists
documentRequestSchema.statics.requestExists = async function(requesterId, targetUserId, documentType) {
  const existingRequest = await this.findOne({
    requesterId,
    targetUserId,
    documentType,
    status: 'pending',
    expiresAt: { $gt: new Date() }
  });
  
  return !!existingRequest;
};

// Static method: Create new request
documentRequestSchema.statics.createRequest = async function(requestData) {
  // Check if request already exists
  const exists = await this.requestExists(
    requestData.requesterId,
    requestData.targetUserId,
    requestData.documentType
  );
  
  if (exists) {
    throw new Error('A pending request for this document already exists');
  }
  
  return await this.create(requestData);
};

// Instance method: Approve request
documentRequestSchema.methods.approve = async function(approvalType, accessType = 'permanent', respondedBy, responseMessage = '') {
  this.status = 'approved';
  this.approvalType = approvalType;
  this.accessType = accessType;
  this.respondedAt = new Date();
  this.respondedBy = respondedBy;
  this.responseMessage = responseMessage;
  
  return await this.save();
};

// Instance method: Deny request
documentRequestSchema.methods.deny = async function(respondedBy, responseMessage = '') {
  this.status = 'denied';
  this.respondedAt = new Date();
  this.respondedBy = respondedBy;
  this.responseMessage = responseMessage;
  
  return await this.save();
};

// Instance method: Cancel request
documentRequestSchema.methods.cancel = async function() {
  this.status = 'cancelled';
  return await this.save();
};

// Instance method: Mark notification sent
documentRequestSchema.methods.markNotificationSent = async function(type) {
  const now = new Date();
  
  switch(type) {
    case 'request':
      this.notifications.requestSent = true;
      this.notifications.requestSentAt = now;
      break;
    case 'response':
      this.notifications.responseSent = true;
      this.notifications.responseSentAt = now;
      break;
    case 'reminder':
      this.notifications.reminderSent = true;
      this.notifications.reminderSentAt = now;
      break;
  }
  
  return await this.save();
};

// Instance method: Check if expired
documentRequestSchema.methods.isExpired = function() {
  return this.status === 'pending' && this.expiresAt < new Date();
};

// Instance method: Check if needs reminder
documentRequestSchema.methods.needsReminder = function() {
  // Send reminder if pending for more than 12 hours and no reminder sent yet
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
  
  return (
    this.status === 'pending' &&
    this.requestedAt < twelveHoursAgo &&
    !this.notifications.reminderSent &&
    this.expiresAt > new Date()
  );
};

const DocumentRequest = mongoose.model('DocumentRequest', documentRequestSchema);

module.exports = DocumentRequest;
