const mongoose = require('mongoose');

// AI-to-AI Conversation Model
const aiConversationSchema = new mongoose.Schema({
  // Conversation identifier
  conversationId: {
    type: String,
    required: true,
    unique: true,
    default: () => `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  },
  
  // Participating AIs
  participants: {
    initiatorAI: {
      aiId: { type: String, required: true },
      userId: { type: String, required: true }, // Changed to String to support UUIDs
      aiName: { type: String, required: true }
    },
    responderAI: {
      aiId: { type: String, required: true },
      userId: { type: String, required: true }, // Changed to String to support UUIDs
      aiName: { type: String, required: true }
    }
  },
  
  // Conversation metadata
  topic: {
    type: String,
    enum: ['availability_check', 'meeting_request', 'social_invitation', 'information_request', 'general'],
    default: 'general'
  },
  
  context: {
    originalRequest: String, // What the human user asked
    activity: String, // coffee, meeting, call, etc.
    timeframe: String, // now, later, specific time
    urgency: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    }
  },
  
  // Conversation status
  status: {
    type: String,
    enum: ['active', 'completed', 'failed', 'timeout'],
    default: 'active'
  },
  
  // Messages in this conversation
  messages: [{
    messageId: {
      type: String,
      default: () => `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
    },
    fromAI: String, // aiId of sender
    toAI: String, // aiId of receiver
    messageType: {
      type: String,
      enum: ['request', 'response', 'info', 'confirmation', 'error', 'autonomous_response'],
      required: true
    },
    content: {
      text: { type: String, required: true },
      sharedData: {
        availability: Boolean,
        status: String,
        timeSlots: [String],
        location: String,
        preferences: mongoose.Schema.Types.Mixed
      }
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    processed: {
      type: Boolean,
      default: false
    }
  }],
  
  // Final result of the conversation
  result: {
    success: Boolean,
    finalResponse: String,
    agreedTime: String,
    agreedLocation: String,
    nextSteps: [String]
  },
  
  // Privacy compliance
  privacyCompliance: {
    dataShared: [String], // List of data types that were shared
    permissionsChecked: Boolean,
    violationsDetected: [String]
  }
}, {
  timestamps: true
});

// Indexes
aiConversationSchema.index({ 'participants.initiatorAI.aiId': 1 });
aiConversationSchema.index({ 'participants.responderAI.aiId': 1 });
aiConversationSchema.index({ 'participants.initiatorAI.userId': 1 });
aiConversationSchema.index({ 'participants.responderAI.userId': 1 });
aiConversationSchema.index({ status: 1 });
aiConversationSchema.index({ createdAt: -1 });

// Methods
aiConversationSchema.methods.addMessage = function(fromAI, toAI, messageType, content) {
  this.messages.push({
    fromAI,
    toAI,
    messageType,
    content,
    timestamp: new Date()
  });
  return this.save();
};

aiConversationSchema.methods.markCompleted = function(result) {
  this.status = 'completed';
  this.result = result;
  return this.save();
};

aiConversationSchema.methods.getMessagesForAI = function(aiId) {
  return this.messages.filter(msg => msg.fromAI === aiId || msg.toAI === aiId);
};

// Static methods
aiConversationSchema.statics.findByAI = function(aiId) {
  return this.find({
    $or: [
      { 'participants.initiatorAI.aiId': aiId },
      { 'participants.responderAI.aiId': aiId }
    ]
  }).sort({ createdAt: -1 });
};

aiConversationSchema.statics.findActiveConversations = function() {
  return this.find({ status: 'active' });
};

module.exports = mongoose.model('AIConversation', aiConversationSchema);
