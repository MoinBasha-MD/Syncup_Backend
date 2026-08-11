const mongoose = require('mongoose');

const musicTrackSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  artist: {
    type: String,
    required: true,
    trim: true
  },
  filename: {
    type: String,
    required: true,
    unique: true
  },
  // Duration in seconds
  duration: {
    type: Number,
    required: true
  },
  // Category for browsing/filtering
  category: {
    type: String,
    enum: ['chill', 'upbeat', 'lo-fi', 'acoustic', 'electronic', 'ambient', 'pop', 'indie'],
    default: 'chill'
  },
  // Tags for search
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  // How many vibes are using this track (for trending)
  usageCount: {
    type: Number,
    default: 0
  },
  // Normalized waveform data (array of amplitude values 0-1) for visual preview
  waveform: [{
    type: Number
  }],
  // Cover art URL (optional)
  coverArt: {
    type: String,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
musicTrackSchema.index({ category: 1, isActive: 1 });
musicTrackSchema.index({ usageCount: -1 }); // For trending
musicTrackSchema.index({ title: 'text', artist: 'text', tags: 'text' }); // Text search
musicTrackSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model('MusicTrack', musicTrackSchema);
