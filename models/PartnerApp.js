const crypto = require('crypto');
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  appId: {
    type: String,
    required: true,
    unique: true,
    immutable: true,
    default: () => `sp_${crypto.randomBytes(16).toString('hex')}`,
  },
  partnerId: { type: String, required: true, index: true, immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  kind: { type: String, enum: ['business', 'app'], required: true },
  applicationType: { type: String, enum: ['service', 'web', 'native'], required: true },
  environment: { type: String, enum: ['sandbox', 'live'], default: 'sandbox', required: true },
  website: { type: String, default: '', trim: true, maxlength: 500 },
  requestedScopes: { type: [String], default: [] },
  redirectUris: { type: [String], default: [] },
  status: { type: String, enum: ['active', 'disabled'], default: 'active', required: true },
  clientSecretEncrypted: { type: String, select: false },
  webhookUrl: { type: String, default: '', trim: true, maxlength: 500 },
  webhookSecretEncrypted: { type: String, select: false },
  secretVersion: { type: Number, default: 0, min: 0 },
  sandboxUserIds: {
    type: [String],
    default: [],
    validate: {
      validator: (value) => Array.isArray(value) && value.length <= 20,
      message: 'At most 20 sandbox testers are allowed',
    },
  },
}, { timestamps: true });

schema.index({ partnerId: 1, environment: 1 });

module.exports = mongoose.model('PartnerApp', schema);
