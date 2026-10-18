const crypto = require('crypto');
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  deliveryId: {
    type: String,
    required: true,
    unique: true,
    immutable: true,
    default: () => `whd_${crypto.randomBytes(16).toString('hex')}`,
  },
  appId: { type: String, required: true, index: true, immutable: true },
  event: {
    type: String,
    enum: ['connection.created', 'connection.revoked'],
    required: true,
    immutable: true,
  },
  payload: { type: Object, required: true },
  status: { type: String, enum: ['pending', 'delivered', 'failed'], default: 'pending', index: true },
  attempts: { type: Number, default: 0, min: 0 },
  nextAttemptAt: { type: Date, default: () => new Date(), index: true },
  lastError: { type: String, default: '', maxlength: 60 },
  createdAt: { type: Date, default: Date.now, immutable: true },
});

// Deliveries are audit data for 30 days, then removed.
schema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
schema.index({ status: 1, nextAttemptAt: 1 });

module.exports = mongoose.model('PartnerWebhookDelivery', schema);
