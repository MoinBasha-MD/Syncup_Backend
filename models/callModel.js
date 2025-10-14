const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  callId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  callerId: {
    type: String,
    required: true,
    index: true
  },
  callerName: {
    type: String,
    default: ''
  },
  callerAvatar: {
    type: String,
    default: null
  },
  receiverId: {
    type: String,
    required: true,
    index: true
  },
  receiverName: {
    type: String,
    default: ''
  },
  receiverAvatar: {
    type: String,
    default: null
  },
  callType: {
    type: String,
    enum: ['voice', 'video'],
    required: true
  },
  status: {
    type: String,
    enum: ['initiated', 'ringing', 'connected', 'ended', 'completed', 'missed', 'rejected', 'busy', 'failed', 'timeout'],
    default: 'initiated',
    index: true
  },
  startTime: {
    type: Date,
    default: null
  },
  endTime: {
    type: Date,
    default: null
  },
  duration: {
    type: Number, // in seconds
    default: 0
  },
  callQuality: {
    type: String,
    enum: ['excellent', 'good', 'poor', 'unknown'],
    default: 'unknown'
  },
  endReason: {
    type: String,
    enum: ['user_ended', 'timeout', 'network_error', 'rejected', 'busy', 'missed', 'cancelled'],
    default: null
  },
  // WebRTC signaling data (optional, for debugging)
  offerSDP: {
    type: String,
    default: null
  },
  answerSDP: {
    type: String,
    default: null
  },
  // Metadata
  missedCallSeen: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient queries
callSchema.index({ callerId: 1, createdAt: -1 });
callSchema.index({ receiverId: 1, createdAt: -1 });
callSchema.index({ status: 1, createdAt: -1 });

// Virtual for call duration in minutes
callSchema.virtual('durationMinutes').get(function() {
  return this.duration ? Math.ceil(this.duration / 60) : 0;
});

// Method to calculate duration
callSchema.methods.calculateDuration = function() {
  if (this.startTime && this.endTime) {
    this.duration = Math.floor((this.endTime - this.startTime) / 1000);
  }
  return this.duration;
};

// Static method to get call history for a user
callSchema.statics.getCallHistory = async function(userId, limit = 50) {
  return this.find({
    $or: [
      { callerId: userId },
      { receiverId: userId }
    ]
  })
  .sort({ createdAt: -1 })
  .limit(limit);
};

// Static method to get missed calls
callSchema.statics.getMissedCalls = async function(userId) {
  return this.find({
    receiverId: userId,
    status: 'missed',
    missedCallSeen: false
  })
  .sort({ createdAt: -1 });
};

// Static method to mark missed calls as seen
callSchema.statics.markMissedCallsAsSeen = async function(userId) {
  return this.updateMany(
    {
      receiverId: userId,
      status: 'missed',
      missedCallSeen: false
    },
    {
      $set: { missedCallSeen: true }
    }
  );
};

const Call = mongoose.model('Call', callSchema);

module.exports = Call;
