const mongoose = require('mongoose');

/**
 * LiveChatMessage — a chat line sent during a LiveSession broadcast.
 *
 * Real-time delivery happens over LiveKit's data channel; this collection is
 * the durable copy so a viewer who joins mid-broadcast can load the recent
 * history and so hosts keep a record of their stream's chat after it ends.
 * Rows are intentionally minimal — the live room is the source of truth for
 * who is currently present; this is just the transcript.
 */
const liveChatMessageSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LiveSession',
      required: true,
      index: true,
    },
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    text: { type: String, required: true, maxlength: 240 },
  },
  { timestamps: true },
);

liveChatMessageSchema.index({ sessionId: 1, createdAt: 1 });

const LiveChatMessage = mongoose.model('LiveChatMessage', liveChatMessageSchema);

module.exports = LiveChatMessage;
