const crypto = require('crypto');
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  connectionId: {
    type: String,
    required: true,
    unique: true,
    immutable: true,
    default: () => `conn_${crypto.randomBytes(16).toString('hex')}`,
  },
  userId: { type: String, required: true, index: true },
  appId: { type: String, required: true, index: true, immutable: true },
  partnerId: { type: String, required: true, immutable: true },
  environment: { type: String, enum: ['sandbox', 'live'], required: true, immutable: true },
  subject: { type: String, required: true },
  scopes: { type: [String], default: [] },
  status: { type: String, enum: ['active', 'revoked'], default: 'active', required: true },
  consentVersion: { type: Number, default: 1, min: 1 },
  connectedAt: { type: Date, default: Date.now },
  revokedAt: { type: Date, default: null },
}, { timestamps: true });

schema.index({ userId: 1, appId: 1 }, { unique: true });
schema.index({ appId: 1, subject: 1 });

module.exports = mongoose.model('SpaceConnection', schema);
