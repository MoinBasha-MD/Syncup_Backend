const mongoose = require('mongoose');
const crypto = require('crypto');

const deviceLinkChallengeSchema = new mongoose.Schema(
  {
    pairingId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    secret: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'consumed', 'expired', 'cancelled'],
      default: 'pending',
      index: true,
    },
    userId: {
      type: String,
      default: null,
      index: true,
    },
    browserKey: {
      type: String,
      required: true,
    },
    authCode: {
      type: String,
      default: null,
    },
    authCodeHash: {
      type: String,
      default: null,
    },
    authCodeExpiresAt: {
      type: Date,
      default: null,
    },
    browserInfo: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index: auto-remove expired pending/cancelled challenges
deviceLinkChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

deviceLinkChallengeSchema.statics.createChallenge = async function (ttlSeconds = 120, browserInfo = null) {
  const pairingId = crypto.randomBytes(16).toString('hex');
  const secret = crypto.randomBytes(32).toString('base64url');
  const browserKey = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const challenge = await this.create({
    pairingId,
    secret,
    browserKey,
    status: 'pending',
    browserInfo,
    expiresAt,
  });

  return challenge;
};

deviceLinkChallengeSchema.statics.consumeByAuthCode = async function (authCode) {
  const hash = crypto.createHash('sha256').update(authCode).digest('hex');
  const challenge = await this.findOne({
    authCodeHash: hash,
    status: 'approved',
    authCodeExpiresAt: { $gt: new Date() },
  });

  if (!challenge) return null;

  challenge.status = 'consumed';
  challenge.authCode = null;
  await challenge.save();

  return challenge;
};

const DeviceLinkChallenge = mongoose.model('DeviceLinkChallenge', deviceLinkChallengeSchema);

module.exports = DeviceLinkChallenge;
