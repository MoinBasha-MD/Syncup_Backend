const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name: { type: String, required: true },
  profileImage: { type: String, default: null }
}, { _id: false });

const lastPulseSchema = new mongoose.Schema({
  type: { type: String, default: 'text' },
  senderId: { type: String, default: '' },
  caption: { type: String, default: '' }
}, { _id: false });

const pulseChainSchema = new mongoose.Schema({
  chainId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  participants: [participantSchema],
  pulseCount: {
    type: Number,
    default: 0
  },
  lastPulseAt: {
    type: Date,
    default: Date.now
  },
  lastPulse: {
    type: lastPulseSchema,
    default: () => ({ type: 'text', senderId: '', caption: '' })
  },
  unseenCounts: {
    type: Map,
    of: Number,
    default: () => new Map()
  }
}, {
  timestamps: true
});

pulseChainSchema.index({ 'participants.userId': 1 });

module.exports = mongoose.model('PulseChain', pulseChainSchema);
