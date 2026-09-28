const mongoose = require('mongoose');

const rippleInteractorSchema = new mongoose.Schema(
  {
    rippleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ripple', required: true },
    userId: { type: String, required: true },
  },
  { timestamps: true },
);

rippleInteractorSchema.index({ rippleId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('RippleInteractor', rippleInteractorSchema);
