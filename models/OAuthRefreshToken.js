const mongoose = require('mongoose');
const crypto = require('crypto');

const schema = new mongoose.Schema({
  tokenId: {
    type: String,
    required: true,
    unique: true,
    immutable: true,
    default: () => `srt_${crypto.randomBytes(16).toString('hex')}`,
  },
  tokenHash: { type: String, required: true, unique: true, select: false },
  familyId: { type: String, required: true, index: true, immutable: true },
  appId: { type: String, required: true, index: true, immutable: true },
  userId: { type: String, required: true, index: true, immutable: true },
  connectionId: { type: String, required: true, immutable: true },
  consentVersion: { type: Number, required: true },
  scopes: { type: [String], required: true },
  // Idle expiry (30 days from issue); absolute family expiry is familyExpiresAt.
  expiresAt: { type: Date, required: true },
  familyExpiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now, immutable: true },
});

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OAuthRefreshToken', schema);
