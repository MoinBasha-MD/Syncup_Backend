const crypto = require('crypto');
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    immutable: true,
    default: () => `cs_${crypto.randomBytes(16).toString('hex')}`,
  },
  tokenHash: { type: String, required: true, unique: true, select: false, immutable: true },
  appId: { type: String, required: true, index: true, immutable: true },
  partnerId: { type: String, required: true, immutable: true },
  environment: { type: String, enum: ['sandbox', 'live'], required: true, immutable: true },
  requestedScopes: { type: [String], default: [] },
  status: { type: String, enum: ['pending', 'approved', 'declined'], default: 'pending', required: true },
  userId: { type: String, default: null },
  connectionId: { type: String, default: null },
  grantedScopes: { type: [String], default: [] },
  expiresAt: { type: Date, required: true },
  decidedAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('SpaceConnectSession', schema);
