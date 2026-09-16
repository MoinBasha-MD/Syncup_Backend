const mongoose = require('mongoose');

/**
 * Rippler — a person's membership/relationship to a Ripple.
 *
 * PRIVACY: `originCityKey` / `originCentroid` exist only to draw coarse
 * "arcs" on the globe (city → city). `originCentroid` must only ever be a
 * city-level centroid — NEVER a user's real coordinates. Nothing in this
 * feature may store or return a Rippler's precise location.
 */
const ripplerSchema = new mongoose.Schema(
  {
    rippleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ripple',
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['host', 'cohost', 'rippler', 'follower'],
      default: 'rippler',
    },
    status: {
      type: String,
      enum: ['requested', 'approved', 'rejected', 'left', 'removed', 'banned'],
      default: 'requested',
    },
    originCityKey: { type: String, default: null },
    originCentroid: {
      type: [Number], // [lng, lat] city centroid — coarse on purpose
      default: undefined,
    },
    attended: { type: Boolean, default: null },
    memoryOptOut: { type: Boolean, default: false },
    requestMessage: { type: String, default: '', maxlength: 200 },
    approvedBy: { type: String, default: null },
    joinedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ripplerSchema.index({ rippleId: 1, userId: 1 }, { unique: true });
ripplerSchema.index({ rippleId: 1, status: 1, role: 1 });
ripplerSchema.index({ userId: 1, status: 1 });

const Rippler = mongoose.model('Rippler', ripplerSchema);

module.exports = Rippler;
