const mongoose = require('mongoose');

/**
 * One row per (user, contact) pair the user has muted for chat notifications.
 * Used by the push pipeline to skip FCM/wakeup for muted senders. Works for
 * friends and for people who only messaged (no Friend record).
 */
const chatMuteSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  mutedUserId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

chatMuteSchema.index({ userId: 1, mutedUserId: 1 }, { unique: true });

module.exports = mongoose.model('ChatMute', chatMuteSchema);
