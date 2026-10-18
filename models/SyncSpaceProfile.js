const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, immutable: true },
  syncId: { type: String, required: true, unique: true, immutable: true, match: /^SYNC-(?:[A-F0-9]{4}-){4}[A-F0-9]{4}$/ },
  status: { type: String, enum: ['active', 'suspended'], default: 'active', required: true },
  activatedAt: { type: Date, required: true, default: Date.now },
  allowPromotions: { type: Boolean, default: false },
  // Per-field sharing policy for Sign in with Syncup — 'allow' auto-shares,
  // 'ask' shows a consent checkbox, 'never' blocks except a one-time override.
  sharingPolicy: {
    type: {
      phone: { type: String, enum: ['allow', 'ask', 'never'], default: 'ask' },
      sync_id: { type: String, enum: ['allow', 'ask', 'never'], default: 'ask' },
      picture: { type: String, enum: ['allow', 'ask', 'never'], default: 'allow' },
      birthdate: { type: String, enum: ['allow', 'ask', 'never'], default: 'ask' },
      gender: { type: String, enum: ['allow', 'ask', 'never'], default: 'ask' },
    },
    default: () => ({}),
  }
}, { timestamps: true });

module.exports = mongoose.model('SyncSpaceProfile', schema);
