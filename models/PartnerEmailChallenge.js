const crypto = require('crypto');
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  challengeId: {
    type: String,
    required: true,
    unique: true,
    immutable: true,
    default: () => crypto.randomBytes(32).toString('hex'),
  },
  partnerId: { type: String, required: true, index: true, immutable: true },
  purpose: { type: String, enum: ['verify', 'reset'], required: true, immutable: true },
  codeHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0, min: 0 },
  consumedAt: { type: Date, default: null },
  sentAt: { type: Date, default: Date.now },
}, { timestamps: { createdAt: true, updatedAt: false } });

schema.index({ partnerId: 1, purpose: 1, sentAt: -1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PartnerEmailChallenge', schema);
