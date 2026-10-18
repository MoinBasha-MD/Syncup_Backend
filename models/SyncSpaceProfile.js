const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, immutable: true },
  syncId: { type: String, required: true, unique: true, immutable: true, match: /^SYNC-(?:[A-F0-9]{4}-){4}[A-F0-9]{4}$/ },
  status: { type: String, enum: ['active', 'suspended'], default: 'active', required: true },
  activatedAt: { type: Date, required: true, default: Date.now },
  allowPromotions: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('SyncSpaceProfile', schema);
