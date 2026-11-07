const mongoose = require('mongoose');

/**
 * Stores the response of a mutating admin request keyed by (admin, key,
 * method, path) so a retried request (double-click, step-up replay, network
 * retry) returns the original result instead of executing twice.
 */
const idempotencyKeySchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, required: true },
    key: { type: String, required: true, maxlength: 128 },
    method: { type: String, required: true },
    path: { type: String, required: true },
    status: { type: Number, default: 200 },
    body: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now, expires: 24 * 60 * 60 },
  },
  { versionKey: false },
);

idempotencyKeySchema.index({ adminId: 1, key: 1, method: 1, path: 1 }, { unique: true });

module.exports = mongoose.model('IdempotencyKey', idempotencyKeySchema);
