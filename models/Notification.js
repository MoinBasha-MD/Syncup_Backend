/**
 * Notification Model
 * Handles all types of notifications (mentions, likes, comments, etc.)
 */

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: [
      'comment_mention',
      'story_tag',
      'vibe_tag',
      'like',
      'comment',
      'comment_reply',
      'comment_like',
      'reply_like',
      'follow',
      'friend_request',
      'call_missed',
      'message',
      'blink_like',
      'blink_screenshot',
      'blink_screen_recording',
      // Open Network — connection lifecycle + nearby-Ripple alerts, plus the
      // ripple_* types notifyRipple has always written (they were missing
      // from this enum, so those creates silently failed validation).
      'on_connect_request',
      'on_connect_accepted',
      'ripple_nearby',
      'ripple_join_request',
      'ripple_approved',
      'ripple_removed',
      'ripple_invited'
    ]
  },
  fromUserId: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Indexes for efficient queries
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
