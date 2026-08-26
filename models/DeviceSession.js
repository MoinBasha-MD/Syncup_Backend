const mongoose = require('mongoose');
const crypto = require('crypto');

const deviceSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
    },
    deviceName: {
      type: String,
      default: 'Unknown browser',
    },
    platform: {
      type: String,
      default: 'web',
    },
    refreshTokenHash: {
      type: String,
      required: true,
      index: true,
    },
    refreshTokenFamily: {
      type: String,
      required: true,
    },
    refreshTokenVersion: {
      type: Number,
      default: 1,
    },
    status: {
      type: String,
      enum: ['active', 'revoked'],
      default: 'active',
      index: true,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

deviceSessionSchema.index({ userId: 1, status: 1 });
deviceSessionSchema.index({ refreshTokenHash: 1, status: 1 });

deviceSessionSchema.statics.createSession = async function (userId, deviceName = 'Unknown browser', platform = 'web', metadata = null) {
  const sessionId = crypto.randomUUID();
  const deviceId = `web-${crypto.randomBytes(8).toString('hex')}`;
  const refreshToken = crypto.randomBytes(32).toString('base64url');
  const refreshTokenFamily = crypto.randomUUID();

  const session = await this.create({
    sessionId,
    userId,
    deviceId,
    deviceName,
    platform,
    refreshTokenHash: crypto.createHash('sha256').update(refreshToken).digest('hex'),
    refreshTokenFamily,
    refreshTokenVersion: 1,
    status: 'active',
    metadata,
  });

  return { session, refreshToken };
};

deviceSessionSchema.statics.findByRefreshToken = async function (token) {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return this.findOne({ refreshTokenHash: hash, status: 'active' });
};

deviceSessionSchema.statics.revokeBySessionId = async function (sessionId, userId) {
  const session = await this.findOne({ sessionId, userId });
  if (!session) return null;

  session.status = 'revoked';
  session.revokedAt = new Date();
  await session.save();

  return session;
};

const DeviceSession = mongoose.model('DeviceSession', deviceSessionSchema);

module.exports = DeviceSession;
