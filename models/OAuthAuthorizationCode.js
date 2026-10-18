const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  codeHash: { type: String, required: true, unique: true, select: false },
  appId: { type: String, required: true, index: true, immutable: true },
  userId: { type: String, required: true, index: true, immutable: true },
  connectionId: { type: String, required: true, immutable: true },
  consentVersion: { type: Number, required: true },
  redirectUri: { type: String, required: true },
  scopes: { type: [String], required: true },
  nonce: { type: String, default: null },
  codeChallenge: { type: String, required: true },
  authTime: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
  issuedTokenIds: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now, immutable: true },
});

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OAuthAuthorizationCode', schema);
