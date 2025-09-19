const mongoose = require('mongoose');

/**
 * Connection Request Schema for global user discovery
 * Manages connection requests between users who find each other via global search
 */
const connectionRequestSchema = mongoose.Schema(
  {
    fromUserId: {
      type: String,
      required: true,
      index: true
    },
    toUserId: {
      type: String,
      required: true,
      index: true
    },
    fromUserName: {
      type: String,
      required: true
    },
    fromUserUsername: {
      type: String,
      default: ''
    },
    fromUserProfileImage: {
      type: String,
      default: ''
    },
    toUserName: {
      type: String,
      required: true
    },
    toUserUsername: {
      type: String,
      default: ''
    },
    toUserProfileImage: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'cancelled'],
      default: 'pending'
    },
    message: {
      type: String,
      maxlength: 200,
      default: ''
    },
    mutualConnectionsCount: {
      type: Number,
      default: 0
    },
    respondedAt: {
      type: Date,
      default: null
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    }
  },
  {
    timestamps: true,
  }
);

// Create compound indexes for efficient queries (no unique constraint)
connectionRequestSchema.index({ fromUserId: 1, toUserId: 1, status: 1 });
connectionRequestSchema.index({ toUserId: 1, status: 1 }); // For incoming requests
connectionRequestSchema.index({ fromUserId: 1, status: 1 }); // For outgoing requests
connectionRequestSchema.index({ expiresAt: 1 }); // For cleanup of expired requests

// Remove the pre-save hook that was causing issues
// Duplicate prevention is now handled in the controller

const ConnectionRequest = mongoose.model('ConnectionRequest', connectionRequestSchema);

module.exports = ConnectionRequest;
