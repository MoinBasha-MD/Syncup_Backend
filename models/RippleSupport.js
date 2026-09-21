const mongoose = require('mongoose');

/**
 * RippleSupport — one row per (ripple, user) "Support" tap. Support is the
 * Short's only reaction besides Comments; the tally is denormalized onto
 * `Ripple.counts.supports` and this collection is the per-user truth so a
 * tap toggles instead of double-counting.
 */
const rippleSupportSchema = new mongoose.Schema(
  {
    rippleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ripple',
      required: true,
    },
    userId: { type: String, required: true },
  },
  { timestamps: true },
);

rippleSupportSchema.index({ rippleId: 1, userId: 1 }, { unique: true });
rippleSupportSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('RippleSupport', rippleSupportSchema);
