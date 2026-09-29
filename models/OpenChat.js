const mongoose = require('mongoose');

/**
 * OpenChat — a 1:1 conversation inside Open Network. Plain text (not the
 * app's E2EE Syncup chat — ON chat is deliberately separate). Created when a
 * connect request is accepted; one row per unordered pair.
 *
 * `unread` / `readAt` are Maps keyed by userId String — a chat row only ever
 * has two participants, so a map beats two parallel counter fields.
 */
const openChatSchema = new mongoose.Schema(
  {
    participants: {
      type: [String], // sorted userIds, always length 2
      required: true,
    },
    pairKey: { type: String, required: true, unique: true },
    connectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OpenConnection',
      default: null,
    },
    lastMessage: {
      body: { type: String, default: '', maxlength: 120 },
      type: { type: String, enum: ['text', 'image', 'ripple', 'system', null], default: null },
      senderId: { type: String, default: null },
      at: { type: Date, default: null },
    },
    unread: { type: Map, of: Number, default: {} },
    readAt: { type: Map, of: Date, default: {} },
    mutedBy: { type: [String], default: [] },
    archivedBy: { type: [String], default: [] },
  },
  { timestamps: true },
);

openChatSchema.index({ participants: 1, 'lastMessage.at': -1 });

/** One chat per pair — callers find-or-create on connection accept. */
openChatSchema.statics.findOrCreate = async function (userA, userB, connectionId = null) {
  const pairKey = [userA, userB].sort().join('|');
  const participants = [userA, userB].sort();
  const existing = await this.findOne({ pairKey });
  if (existing) return existing;
  try {
    return await this.create({ participants, pairKey, connectionId });
  } catch (err) {
    // Concurrent accepts — the loser reads the winner's row.
    if (err && err.code === 11000) return this.findOne({ pairKey });
    throw err;
  }
};

const OpenChat = mongoose.model('OpenChat', openChatSchema);

module.exports = OpenChat;
