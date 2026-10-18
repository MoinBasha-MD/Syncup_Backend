const crypto = require('crypto');
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  partnerId: {
    type: String,
    required: true,
    unique: true,
    immutable: true,
    default: () => crypto.randomUUID(),
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 254,
  },
  passwordHash: { type: String, required: true, select: false },
  businessName: { type: String, required: true, trim: true, maxlength: 120 },
  website: { type: String, default: '', trim: true, maxlength: 500 },
  emailVerifiedAt: { type: Date, default: null },
  approvalStatus: {
    type: String,
    enum: ['sandbox', 'pending', 'approved', 'rejected', 'suspended'],
    default: 'sandbox',
    required: true,
  },
  reviewVersion: { type: Number, default: 0, min: 0 },
  reviewReason: { type: String, default: '', maxlength: 1000 },
  requestedAt: { type: Date, default: null },
  useCase: { type: String, default: '', maxlength: 2000 },
  privacyPolicyUrl: { type: String, default: '', maxlength: 500 },
  reviewHistory: [{
    action: { type: String, enum: ['requested', 'approve', 'reject', 'suspend', 'restore'], required: true },
    reason: { type: String, default: '', maxlength: 1000 },
    actorKeyId: { type: String, default: null },
    actorLabel: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  }],
  failedLoginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date, default: null },
  sessionVersion: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

schema.index({ approvalStatus: 1, createdAt: -1 });

module.exports = mongoose.model('PartnerAccount', schema);
