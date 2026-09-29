const mongoose = require('mongoose');

/**
 * OpenConnection — a connect request / accepted link between two Open
 * Network members. Distinct from Friend (the main app's relationship graph):
 * the ON layer is its own social space, so it keeps its own connection rows.
 *
 * `pairKey` is the sorted `${a}|${b}` — one row per unordered pair, so a
 * pending request in either direction collides on the same document.
 */
const openConnectionSchema = new mongoose.Schema(
  {
    requesterId: { type: String, required: true, index: true },
    recipientId: { type: String, required: true, index: true },
    pairKey: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'withdrawn', 'removed'],
      default: 'pending',
      index: true,
    },
    note: { type: String, default: '', maxlength: 150 },
    /** The Ripple the two met on, if the request came from a Ripple surface. */
    contextRippleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ripple',
      default: null,
    },
    /** Last time a request was created/re-requested — drives the 24h cap. */
    requestedAt: { type: Date, default: null },
    respondedAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

openConnectionSchema.index({ recipientId: 1, status: 1, updatedAt: -1 });
openConnectionSchema.index({ requesterId: 1, status: 1, updatedAt: -1 });

const OpenConnection = mongoose.model('OpenConnection', openConnectionSchema);

module.exports = OpenConnection;
