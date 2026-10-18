const mongoose = require('mongoose');
const crypto = require('crypto');

const schema = new mongoose.Schema({
  tokenId: {
    type: String,
    required: true,
    unique: true,
    immutable: true,
    default: () => `sat_${crypto.randomBytes(16).toString('hex')}`,
  },
  tokenHash: { type: String, required: true, unique: true, select: false },
  appId: { type: String, required: true, index: true, immutable: true },
  userId: { type: String, required: true, index: true, immutable: true },
  connectionId: { type: String, required: true, immutable: true },
  familyId: { type: String, default: null, immutable: true },
  consentVersion: { type: Number, required: true },
  scopes: { type: [String], required: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now, immutable: true },
});

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OAuthAccessToken', schema);
