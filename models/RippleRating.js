const mongoose = require('mongoose');

/**
 * RippleRating — one post-Ripple rating of the experience/host.
 *
 * Anti-abuse rules enforced in the controller, restated here because the
 * schema is where they must never be bypassed:
 *  - Only an approved Rippler (never the host, never a follower) may rate.
 *  - One rating per person per Ripple, immutable once written.
 *  - Only after the Ripple reaches 'wrapping'/'memory', and within the window.
 *  - An individual rating is NEVER returned to the host — only aggregates
 *    (which the read path additionally suppresses below 3 samples). That is
 *    deliberately stronger than double-blind: with no per-rater exposure there
 *    is no retaliation surface at all.
 */
const rippleRatingSchema = new mongoose.Schema(
  {
    rippleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ripple',
      required: true,
      index: true,
    },
    raterId: { type: String, required: true, index: true },
    hostUserId: { type: String, required: true, index: true },

    score: { type: Number, required: true, min: 1, max: 5 },
    tags: { type: [String], default: [] },
    comment: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true },
);

// One rating per rater per Ripple.
rippleRatingSchema.index({ rippleId: 1, raterId: 1 }, { unique: true });
rippleRatingSchema.index({ hostUserId: 1, createdAt: -1 });

const RippleRating = mongoose.model('RippleRating', rippleRatingSchema);

module.exports = RippleRating;
