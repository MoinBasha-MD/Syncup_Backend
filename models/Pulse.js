const mongoose = require('mongoose');

const contentSchema = new mongoose.Schema({
  mediaUrl: { type: String, default: null },
  thumbnailUrl: { type: String, default: null },
  width: { type: Number, default: null },
  height: { type: Number, default: null },
  duration: { type: Number, default: null },
  voiceUrl: { type: String, default: null },
  voiceDuration: { type: Number, default: null },
  waveform: [{ type: Number }],
  trackId: { type: String, default: null },
  songTitle: { type: String, default: null },
  artistName: { type: String, default: null },
  songUrl: { type: String, default: null },
  locationName: { type: String, default: null },
  coordinates: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null }
  },
  address: { type: String, default: null },
  memoryRefId: { type: String, default: null },
  reactionEmoji: { type: String, default: null },
}, { _id: false });

const pulseSchema = new mongoose.Schema({
  chainId: {
    type: String,
    required: true,
    index: true
  },
  senderId: {
    type: String,
    required: true,
    index: true
  },
  receiverId: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['photo', 'video', 'voice', 'text', 'song', 'location', 'memory', 'reaction'],
    required: true
  },
  content: {
    type: contentSchema,
    default: () => ({})
  },
  caption: {
    type: String,
    default: ''
  },
  moodTag: {
    type: String,
    default: ''
  },
  isHighlight: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'seen'],
    default: 'sent'
  },
  seenAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

pulseSchema.index({ chainId: 1, createdAt: -1 });
pulseSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });
// ✅ FIX: getChainMoments runs `Pulse.updateMany({ chainId, receiverId, status: { $ne: 'seen' } })`
// on every chain open to mark pulses as seen. Without a targeted index this
// falls back to scanning the chainId index and filtering receiverId/status
// per document. This compound index lets Mongo satisfy that filter directly.
pulseSchema.index({ chainId: 1, receiverId: 1, status: 1 });

module.exports = mongoose.model('Pulse', pulseSchema);
