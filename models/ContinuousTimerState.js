const mongoose = require('mongoose');

/**
 * Continuous Timer State Model
 * Stores the state of continuous auto-delete timer mode for each chat
 */
const continuousTimerStateSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  chatId: {
    type: String,
    required: true,
    index: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  timerDuration: {
    type: Number, // milliseconds (e.g., 86400000 for 24 hours)
    required: true
  },
  activatedAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound index for efficient lookups
continuousTimerStateSchema.index({ userId: 1, chatId: 1 }, { unique: true });

// Static method to check if continuous timer is active for a chat
continuousTimerStateSchema.statics.isActive = async function(userId, chatId) {
  const state = await this.findOne({
    userId: userId,
    chatId: chatId,
    isActive: true
  });
  
  return state ? { active: true, duration: state.timerDuration } : { active: false };
};

// Static method to activate continuous timer for both users
continuousTimerStateSchema.statics.activateForChat = async function(userId1, userId2, timerDuration) {
  // Activate for user 1
  await this.findOneAndUpdate(
    { userId: userId1, chatId: userId2 },
    {
      userId: userId1,
      chatId: userId2,
      isActive: true,
      timerDuration: timerDuration,
      activatedAt: new Date(),
      updatedAt: new Date()
    },
    { upsert: true, new: true }
  );
  
  // Activate for user 2
  await this.findOneAndUpdate(
    { userId: userId2, chatId: userId1 },
    {
      userId: userId2,
      chatId: userId1,
      isActive: true,
      timerDuration: timerDuration,
      activatedAt: new Date(),
      updatedAt: new Date()
    },
    { upsert: true, new: true }
  );
  
  console.log(`✅ [CONTINUOUS TIMER] Activated for chat between ${userId1} and ${userId2}`);
  console.log(`⏳ [CONTINUOUS TIMER] Duration: ${timerDuration}ms (${timerDuration / (1000 * 60 * 60)} hours)`);
};

// Static method to deactivate continuous timer for both users
continuousTimerStateSchema.statics.deactivateForChat = async function(userId1, userId2) {
  await this.deleteMany({
    $or: [
      { userId: userId1, chatId: userId2 },
      { userId: userId2, chatId: userId1 }
    ]
  });
  
  console.log(`✅ [CONTINUOUS TIMER] Deactivated for chat between ${userId1} and ${userId2}`);
};

const ContinuousTimerState = mongoose.model('ContinuousTimerState', continuousTimerStateSchema);

module.exports = ContinuousTimerState;
