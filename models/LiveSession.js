const mongoose = require('mongoose');

/**
 * LiveSession — a one-to-many video broadcast in Open Network.
 *
 * Distinct from Ripple: a Ripple is a place-anchored intention that can live
 * for days and has its own membership/approval model; a LiveSession is a
 * single ephemeral broadcast (host publishes video, viewers subscribe) backed
 * by a LiveKit room. It disappears once ended — there is no "memory" lifecycle
 * for it the way there is for Ripples.
 */
const liveSessionSchema = new mongoose.Schema(
  {
    hostUserId: {
      type: String, // matches Friend/Block/Ripple convention
      required: true,
      index: true,
    },
    hostName: { type: String, required: true },
    hostAvatar: { type: String, default: null },

    title: { type: String, default: '', maxlength: 120 },
    thumbnailUrl: { type: String, default: null },

    // LiveKit room name — unique per session, never reused.
    roomName: { type: String, required: true, unique: true },

    visibility: { type: String, enum: ['public', 'friends'], default: 'public' },

    status: { type: String, enum: ['live', 'ended'], default: 'live', index: true },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },

    viewerCount: { type: Number, default: 0 },
    peakViewerCount: { type: Number, default: 0 },
    // Floating-heart taps, incremented in batches via POST /live/:id/react.
    reactionCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

liveSessionSchema.index({ status: 1, startedAt: -1 });
liveSessionSchema.index({ hostUserId: 1, status: 1 });

const LiveSession = mongoose.model('LiveSession', liveSessionSchema);

module.exports = LiveSession;
