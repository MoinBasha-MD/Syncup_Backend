const mongoose = require('mongoose');

/**
 * Quarantine store for admin takedowns. For content types whose originals are
 * physically removed (posts, comments, stories, ripple_events) `doc` holds the
 * full pre-delete document so restore can re-insert it with the same _id.
 * For ripples/shorts the original stays in place (lifecycle 'removed') and
 * `doc` holds the fields needed to revert.
 */
const moderatedContentSchema = new mongoose.Schema({
  contentType: {
    type: String,
    required: true,
    enum: ['posts', 'ripples', 'shorts', 'comments', 'stories', 'ripple_events']
  },
  originalId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  collectionName: {
    type: String,
    required: true
  },
  ownerUserId: String,
  doc: mongoose.Schema.Types.Mixed,
  reason: String,
  takenDownBy: String,
  takenDownAt: {
    type: Date,
    default: Date.now
  },
  restoredAt: {
    type: Date,
    default: null
  },
  restoredBy: {
    type: String,
    default: null
  }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: false }
});

// One active takedown per original document at a time
moderatedContentSchema.index(
  { contentType: 1, originalId: 1 },
  { unique: true, partialFilterExpression: { restoredAt: null } }
);

module.exports = mongoose.model('ModeratedContent', moderatedContentSchema);
