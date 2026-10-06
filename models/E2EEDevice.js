const mongoose = require('mongoose');

const e2eeDeviceSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
    },
    identityKey: {
      type: String,
      required: true,
    },
    signedPreKey: {
      id: { type: Number, required: true },
      publicKey: { type: String, required: true },
      signature: { type: String, required: true },
      createdAt: { type: Date, default: Date.now },
    },
    // Feature flags the build advertises (e.g. 'call-livekit-e2ee-v1') —
    // lets callers negotiate transports without breaking old installs.
    capabilities: {
      type: [String],
      default: [],
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

e2eeDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

const E2EEDevice = mongoose.model('E2EEDevice', e2eeDeviceSchema);

module.exports = E2EEDevice;
