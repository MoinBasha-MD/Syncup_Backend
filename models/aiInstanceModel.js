const mongoose = require('mongoose');

// AI Instance Model - Core model for individual AI assistants
const aiInstanceSchema = new mongoose.Schema({
  // Unique AI identifier
  aiId: {
    type: String,
    required: true,
    unique: true,
    default: () => `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  },
  
  // Reference to the user who owns this AI
  userId: {
    type: String,
    required: true,
    index: true
  },
  
  // AI display name
  aiName: {
    type: String,
    required: true,
    default: 'Maya',
    maxlength: 50
  },
  
  // Current AI status
  status: {
    type: String,
    enum: ['online', 'offline', 'busy', 'away'],
    default: 'offline',
    index: true
  },
  
  // AI capabilities and permissions
  capabilities: {
    canSchedule: {
      type: Boolean,
      default: true
    },
    canAccessCalendar: {
      type: Boolean,
      default: true
    },
    canMakeReservations: {
      type: Boolean,
      default: false
    },
    canShareLocation: {
      type: Boolean,
      default: false
    },
    maxConcurrentConversations: {
      type: Number,
      default: 5,
      min: 1,
      max: 20
    }
  },
  
  // AI preferences and behavior settings
  preferences: {
    responseStyle: {
      type: String,
      enum: ['formal', 'casual', 'friendly', 'professional'],
      default: 'friendly'
    },
    privacyLevel: {
      type: String,
      enum: ['strict', 'moderate', 'open'],
      default: 'moderate'
    },
    autoApprovalSettings: {
      lowPriorityRequests: {
        type: Boolean,
        default: false
      },
      trustedAIsOnly: {
        type: Boolean,
        default: true
      },
      maxAutoApprovalDuration: {
        type: Number,
        default: 30 // minutes
      }
    },
    responseTimePreference: {
      type: String,
      enum: ['immediate', 'quick', 'normal', 'delayed'],
      default: 'normal'
    }
  },
  
  // Network and communication settings
  networkSettings: {
    allowDirectMentions: {
      type: Boolean,
      default: true
    },
    allowGroupMentions: {
      type: Boolean,
      default: true
    },
    trustedAIs: [{
      type: String, // AI IDs
      index: true
    }],
    blockedAIs: [{
      type: String, // AI IDs
      index: true
    }],
    allowedGroups: [{
      type: String, // Group IDs
      index: true
    }]
  },
  
  // Activity tracking
  lastActive: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  lastHeartbeat: {
    type: Date,
    default: Date.now
  },
  
  // Statistics
  stats: {
    totalConversations: {
      type: Number,
      default: 0
    },
    successfulInteractions: {
      type: Number,
      default: 0
    },
    averageResponseTime: {
      type: Number,
      default: 0 // in seconds
    },
    lastCalculated: {
      type: Date,
      default: Date.now
    }
  },
  
  // Configuration metadata
  version: {
    type: String,
    default: '1.0.0'
  },
  
  isActive: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  timestamps: true
});

// Indexes for performance optimization
aiInstanceSchema.index({ userId: 1, isActive: 1 });
aiInstanceSchema.index({ status: 1, lastActive: -1 });
aiInstanceSchema.index({ 'networkSettings.trustedAIs': 1 });
aiInstanceSchema.index({ 'networkSettings.allowedGroups': 1 });
aiInstanceSchema.index({ createdAt: -1 });

// Virtual for checking if AI is online (heartbeat within last 2 minutes)
aiInstanceSchema.virtual('isOnline').get(function() {
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
  return this.status === 'online' && this.lastHeartbeat > twoMinutesAgo;
});

// Instance methods
aiInstanceSchema.methods.updateHeartbeat = function() {
  this.lastHeartbeat = new Date();
  this.lastActive = new Date();
  return this.save();
};

aiInstanceSchema.methods.updateStatus = function(newStatus) {
  this.status = newStatus;
  this.lastActive = new Date();
  return this.save();
};

aiInstanceSchema.methods.addTrustedAI = function(aiId) {
  if (!this.networkSettings.trustedAIs.includes(aiId)) {
    this.networkSettings.trustedAIs.push(aiId);
    return this.save();
  }
  return Promise.resolve(this);
};

aiInstanceSchema.methods.removeTrustedAI = function(aiId) {
  this.networkSettings.trustedAIs = this.networkSettings.trustedAIs.filter(id => id !== aiId);
  return this.save();
};

aiInstanceSchema.methods.blockAI = function(aiId) {
  if (!this.networkSettings.blockedAIs.includes(aiId)) {
    this.networkSettings.blockedAIs.push(aiId);
    // Also remove from trusted if present
    this.networkSettings.trustedAIs = this.networkSettings.trustedAIs.filter(id => id !== aiId);
    return this.save();
  }
  return Promise.resolve(this);
};

aiInstanceSchema.methods.unblockAI = function(aiId) {
  this.networkSettings.blockedAIs = this.networkSettings.blockedAIs.filter(id => id !== aiId);
  return this.save();
};

aiInstanceSchema.methods.canCommunicateWith = function(targetAiId) {
  // Check if target AI is blocked
  if (this.networkSettings.blockedAIs.includes(targetAiId)) {
    return false;
  }
  
  // If privacy level is strict, only allow trusted AIs
  if (this.preferences.privacyLevel === 'strict') {
    return this.networkSettings.trustedAIs.includes(targetAiId);
  }
  
  return true;
};

aiInstanceSchema.methods.updateStats = function(responseTime, success = true) {
  this.stats.totalConversations += 1;
  if (success) {
    this.stats.successfulInteractions += 1;
  }
  
  // Update average response time (simple moving average)
  const totalSuccessful = this.stats.successfulInteractions;
  if (totalSuccessful > 0) {
    this.stats.averageResponseTime = 
      ((this.stats.averageResponseTime * (totalSuccessful - 1)) + responseTime) / totalSuccessful;
  }
  
  this.stats.lastCalculated = new Date();
  return this.save();
};

// Static methods
aiInstanceSchema.statics.findByUserId = function(userId) {
  // Try to find with the provided userId first
  return this.findOne({ 
    $or: [
      { userId: userId },
      { userId: userId.toString() }
    ],
    isActive: true 
  });
};

aiInstanceSchema.statics.findByAiId = function(aiId) {
  return this.findOne({ aiId, isActive: true });
};

aiInstanceSchema.statics.findOnlineAIs = function() {
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
  return this.find({
    status: 'online',
    lastHeartbeat: { $gte: twoMinutesAgo },
    isActive: true
  });
};

aiInstanceSchema.statics.findByStatus = function(status) {
  return this.find({ status, isActive: true });
};

aiInstanceSchema.statics.findTrustedAIs = function(aiId) {
  return this.findOne({ aiId, isActive: true })
    .then(ai => {
      if (!ai) return [];
      return this.find({
        aiId: { $in: ai.networkSettings.trustedAIs },
        isActive: true
      });
    });
};

aiInstanceSchema.statics.createForUser = function(userId, options = {}) {
  const aiData = {
    userId,
    aiName: options.aiName || 'Maya',
    capabilities: { ...this.schema.paths.capabilities.defaultValue, ...options.capabilities },
    preferences: { ...this.schema.paths.preferences.defaultValue, ...options.preferences },
    networkSettings: { ...this.schema.paths.networkSettings.defaultValue, ...options.networkSettings }
  };
  
  return this.create(aiData);
};

// Pre-save middleware
aiInstanceSchema.pre('save', function(next) {
  // Update lastActive when status changes
  if (this.isModified('status')) {
    this.lastActive = new Date();
  }
  next();
});

// Post-save middleware for logging
aiInstanceSchema.post('save', function(doc) {
  console.log(`AI Instance ${doc.aiId} saved with status: ${doc.status}`);
});

module.exports = mongoose.model('AIInstance', aiInstanceSchema);
