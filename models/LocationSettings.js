const mongoose = require('mongoose');

const locationSettingsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  
  // Real-time location sharing enabled
  isRealTime: {
    type: Boolean,
    required: true,
    default: false
  },
  
  // Sharing mode
  sharingMode: {
    type: String,
    enum: ['all_friends', 'selected_friends', 'off'],
    default: 'all_friends'
  },
  
  // Selected friends (when mode is 'selected_friends')
  selectedFriends: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  // Active sharing sessions (WhatsApp-style)
  activeSessions: [{
    friendId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    duration: {
      type: Number, // in minutes: 15, 60, 480 (8 hours)
      required: true
    },
    startedAt: {
      type: Date,
      required: true,
      default: Date.now
    },
    expiresAt: {
      type: Date,
      required: true
    },
    isActive: {
      type: Boolean,
      default: true
    }
  }],
  
  // Hide location at specific places
  hideAtPlaces: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FavoritePlace'
  }],
  
  // Preferences
  preferences: {
    showAccuracy: {
      type: Boolean,
      default: true
    },
    showBattery: {
      type: Boolean,
      default: false
    },
    notifyOnShare: {
      type: Boolean,
      default: true
    }
  }
}, {
  timestamps: true
});

// Index for faster queries
locationSettingsSchema.index({ userId: 1 });
locationSettingsSchema.index({ 'activeSessions.friendId': 1 });
locationSettingsSchema.index({ 'activeSessions.expiresAt': 1 });

// Method to check if sharing with a specific friend
locationSettingsSchema.methods.isSharingWith = function(friendId) {
  // Check if there's an active session with this friend
  const session = this.activeSessions.find(s => 
    s.friendId.toString() === friendId.toString() && 
    s.isActive && 
    new Date(s.expiresAt) > new Date()
  );
  
  if (session) return true;
  
  // Check sharing mode
  if (this.sharingMode === 'off') return false;
  if (this.sharingMode === 'all_friends') return true;
  if (this.sharingMode === 'selected_friends') {
    return this.selectedFriends.some(id => id.toString() === friendId.toString());
  }
  
  return false;
};

// Method to start sharing session (WhatsApp-style)
locationSettingsSchema.methods.startSession = function(friendId, durationMinutes) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);
  
  // Remove any existing session with this friend
  this.activeSessions = this.activeSessions.filter(
    s => s.friendId.toString() !== friendId.toString()
  );
  
  // Add new session
  this.activeSessions.push({
    friendId,
    duration: durationMinutes,
    startedAt: now,
    expiresAt,
    isActive: true
  });
  
  return this.save();
};

// Method to stop sharing session
locationSettingsSchema.methods.stopSession = function(friendId) {
  const session = this.activeSessions.find(
    s => s.friendId.toString() === friendId.toString()
  );
  
  if (session) {
    session.isActive = false;
  }
  
  return this.save();
};

// Method to clean up expired sessions
locationSettingsSchema.methods.cleanupExpiredSessions = function() {
  const now = new Date();
  this.activeSessions = this.activeSessions.filter(
    s => s.isActive && new Date(s.expiresAt) > now
  );
  return this.save();
};

// Static method to cleanup all expired sessions
locationSettingsSchema.statics.cleanupAllExpiredSessions = async function() {
  const now = new Date();
  
  const result = await this.updateMany(
    { 'activeSessions.expiresAt': { $lt: now } },
    { 
      $pull: { 
        activeSessions: { 
          expiresAt: { $lt: now } 
        } 
      } 
    }
  );
  
  console.log(`✅ Cleaned up expired location sharing sessions: ${result.modifiedCount} users`);
  return result;
};

const LocationSettings = mongoose.model('LocationSettings', locationSettingsSchema);

module.exports = LocationSettings;
