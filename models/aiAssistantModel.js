const mongoose = require('mongoose');

// AI Assistant Model - Each user has their own AI with unique ID
const aiAssistantSchema = new mongoose.Schema({
  // Unique AI identifier
  aiId: {
    type: String,
    required: true,
    unique: true,
    default: () => `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  },
  
  // Owner of this AI
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true // Each user has exactly one AI
  },
  
  // AI Configuration
  aiName: {
    type: String,
    default: 'Maya',
    maxlength: 50
  },
  
  personality: {
    type: String,
    enum: ['professional', 'friendly', 'casual', 'motivational'],
    default: 'friendly'
  },
  
  // Privacy Settings for AI-to-AI communication
  privacySettings: {
    // Availability & Status
    shareStatus: { type: Boolean, default: true },
    shareCalendarAvailability: { type: Boolean, default: true },
    shareTimePreferences: { type: Boolean, default: false },
    
    // Location Information
    shareGeneralLocation: { type: Boolean, default: false },
    shareSpecificLocation: { type: Boolean, default: false },
    shareTravelStatus: { type: Boolean, default: true },
    
    // Personal Preferences
    shareActivityPreferences: { type: Boolean, default: false },
    shareDietaryInfo: { type: Boolean, default: false },
    shareInterests: { type: Boolean, default: false },
    
    // Communication
    shareResponseStyle: { type: Boolean, default: false },
    shareUrgencyPreferences: { type: Boolean, default: true },
    shareContactMethods: { type: Boolean, default: false },
    
    // Work & Professional
    shareWorkHours: { type: Boolean, default: true },
    shareMeetingPreferences: { type: Boolean, default: false },
    shareProjectAvailability: { type: Boolean, default: false }
  },
  
  // AI Learning Data
  learningData: {
    communicationStyle: String,
    commonPhrases: [String],
    responsePatterns: mongoose.Schema.Types.Mixed,
    userPreferences: mongoose.Schema.Types.Mixed
  },
  
  // AI Status
  isActive: {
    type: Boolean,
    default: true
  },
  
  lastActiveAt: {
    type: Date,
    default: Date.now
  },
  
  // WebSocket Connection Info
  socketId: {
    type: String,
    default: null
  },
  
  isOnline: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
aiAssistantSchema.index({ userId: 1 });
aiAssistantSchema.index({ aiId: 1 });
aiAssistantSchema.index({ isOnline: 1 });

// Methods
aiAssistantSchema.methods.updatePrivacySetting = function(category, setting, value) {
  if (this.privacySettings[category] !== undefined) {
    this.privacySettings[category][setting] = value;
    return this.save();
  }
  throw new Error('Invalid privacy setting');
};

aiAssistantSchema.methods.canShare = function(dataType) {
  return this.privacySettings[dataType] === true;
};

aiAssistantSchema.methods.setOnline = function(socketId) {
  this.isOnline = true;
  this.socketId = socketId;
  this.lastActiveAt = new Date();
  return this.save();
};

aiAssistantSchema.methods.setOffline = function() {
  this.isOnline = false;
  this.socketId = null;
  return this.save();
};

// Static methods
aiAssistantSchema.statics.findByUserId = async function(userId) {
  // First find the user by their string userId to get their MongoDB _id
  const User = require('./userModel');
  const user = await User.findOne({ userId: userId }).select('_id');
  
  if (!user) {
    return null;
  }
  
  // Then find the AIAssistant using the MongoDB _id
  return this.findOne({ userId: user._id });
};

aiAssistantSchema.statics.findByAiId = function(aiId) {
  return this.findOne({ aiId });
};

aiAssistantSchema.statics.findOnlineAIs = function() {
  return this.find({ isOnline: true });
};

module.exports = mongoose.model('AIAssistant', aiAssistantSchema);
