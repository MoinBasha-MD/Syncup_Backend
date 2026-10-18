const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  keyId: { type: String, required: true, unique: true, immutable: true },
  partnerId: { type: String, required: true, index: true, immutable: true },
  appId: { type: String, required: true, index: true, immutable: true },
  environment: { type: String, enum: ['sandbox', 'live'], required: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  secretHash: { type: String, required: true, select: false },
  scopes: { type: [String], default: [] },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  lastUsedAt: { type: Date, default: null },
}, { timestamps: true });

schema.index({ appId: 1, revokedAt: 1 });

module.exports = mongoose.model('PartnerApiKey', schema);
