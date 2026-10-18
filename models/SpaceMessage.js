const crypto = require('crypto');
const mongoose = require('mongoose');

const receiptItem = new mongoose.Schema({
  name: { type: String, required: true, maxlength: 120 },
  quantity: { type: Number, required: true, min: 1, max: 999 },
  amount: { type: Number, required: true, min: 0 },
}, { _id: false });

const receipt = new mongoose.Schema({
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
  reference: { type: String, default: '', maxlength: 100 },
  items: { type: [receiptItem], default: [] },
  orderedAt: { type: Date, default: null },
  storeName: { type: String, default: '', maxlength: 120 },
  tax: { type: Number, default: null, min: 0 },
  total: { type: Number, default: null, min: 0 },
}, { _id: false });

const schema = new mongoose.Schema({
  messageId: {
    type: String,
    required: true,
    unique: true,
    immutable: true,
    default: () => `msg_${crypto.randomBytes(16).toString('hex')}`,
  },
  userId: { type: String, required: true, index: true },
  appId: { type: String, required: true, index: true, immutable: true },
  partnerId: { type: String, required: true, immutable: true },
  connectionId: { type: String, required: true, immutable: true },
  environment: { type: String, enum: ['sandbox', 'live'], required: true, immutable: true },
  type: { type: String, enum: ['message', 'code', 'receipt', 'promotion'], required: true, immutable: true },
  title: { type: String, required: true, maxlength: 120 },
  body: { type: String, default: '', maxlength: 2000 },
  codeEncrypted: { type: String, select: false },
  codeExpiresAt: { type: Date, default: null },
  receipt: { type: receipt, default: undefined },
  idempotencyKey: { type: String, default: null },
  readAt: { type: Date, default: null },
  expireAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

schema.index(
  { appId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);
schema.index({ userId: 1, createdAt: -1, _id: -1 });
schema.index({ userId: 1, readAt: 1 });
schema.index({ userId: 1, type: 1, appId: 1, createdAt: -1 });
schema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('SpaceMessage', schema);
