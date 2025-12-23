/**
 * SavedVibe Model
 * Represents a vibe that a user has saved/bookmarked
 */

const mongoose = require('mongoose');

const savedVibeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  vibeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FeedPost',
    required: true,
    index: true
  },
  collectionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Collection',
    default: null,
    index: true
  },
  savedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index for unique constraint
savedVibeSchema.index({ userId: 1, vibeId: 1 }, { unique: true });

// Index for sorting by savedAt
savedVibeSchema.index({ userId: 1, savedAt: -1 });

// Index for collection queries
savedVibeSchema.index({ collectionId: 1 });

module.exports = mongoose.model('SavedVibe', savedVibeSchema);
