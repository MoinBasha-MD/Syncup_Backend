const mongoose = require('mongoose');

/**
 * OpenNetworkProfile — a user's opt-in state, defaults and reputation for
 * the Open Network feature. Created lazily via getOrCreate.
 */
const openNetworkProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    joined: { type: Boolean, default: false },
    joinedAt: { type: Date, default: null },
    leftAt: { type: Date, default: null },
    settings: {
      discoverable: { type: Boolean, default: true },
      defaultReach: {
        type: String,
        enum: ['neighborhood', 'city', 'region', 'global', 'online'],
        default: 'city',
      },
      defaultVisibility: {
        type: String,
        enum: ['public', 'friends', 'invite'],
        default: 'public',
      },
      notifyNearby: { type: Boolean, default: true },
    },
    reputation: {
      hostSum: { type: Number, default: 0 },
      hostCount: { type: Number, default: 0 },
      hostScore: { type: Number, default: null },
      attendedCount: { type: Number, default: 0 },
      noShowCount: { type: Number, default: 0 },
    },
    limits: {
      ripplesCreatedToday: { type: Number, default: 0 },
      lastCreateAt: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

openNetworkProfileSchema.statics.getOrCreate = async function (userId) {
  const existing = await this.findOne({ userId });
  if (existing) return existing;
  try {
    return await this.create({ userId });
  } catch (err) {
    // Two concurrent first requests can race the unique index — the loser
    // just reads the row the winner created.
    if (err && err.code === 11000) return this.findOne({ userId });
    throw err;
  }
};

const OpenNetworkProfile = mongoose.model('OpenNetworkProfile', openNetworkProfileSchema);

module.exports = OpenNetworkProfile;
