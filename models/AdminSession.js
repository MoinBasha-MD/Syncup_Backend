const mongoose = require('mongoose');

/**
 * Admin refresh-token session. Refresh tokens are opaque, stored hashed,
 * rotated on every use; reuse of a rotated/revoked token revokes the family.
 */
const adminSessionSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    index: true
  },
  deviceId: {
    type: String,
    required: true
  },
  familyId: {
    type: String,
    required: true,
    index: true
  },
  refreshHash: {
    type: String,
    required: true,
    unique: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  revokedAt: {
    type: Date,
    default: null
  },
  rotatedAt: {
    type: Date,
    default: null
  },
  replacedBy: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  ip: String,
  ua: String
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: false }
});

adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
adminSessionSchema.index({ adminId: 1, revokedAt: 1 });

module.exports = mongoose.model('AdminSession', adminSessionSchema);
