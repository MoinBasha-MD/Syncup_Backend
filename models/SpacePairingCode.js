const mongoose = require('mongoose');
const crypto = require('crypto');

const spacePairingCodeSchema = new mongoose.Schema(
  {
    pairingId: {
      type: String,
      required: true,
      unique: true,
      default: () => `pr_${crypto.randomBytes(8).toString('hex')}`,
    },
    kind: { type: String, enum: ['qr', 'otp'], required: true },
    userId: { type: String, default: null },
    appId: { type: String, default: null },
    codeHash: { type: String, select: false },
    codeEncrypted: { type: String, select: false },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'consumed', 'declined', 'locked'],
      default: 'pending',
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

spacePairingCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
spacePairingCodeSchema.index({ userId: 1, kind: 1, status: 1 });

module.exports = mongoose.model('SpacePairingCode', spacePairingCodeSchema);
