const mongoose = require('mongoose');

/**
 * OpenMessage — one message inside an OpenChat. 'ripple' messages share a
 * Ripple into the chat with a snapshot so the card renders even if the
 * Ripple later ends or is removed.
 */
const openMessageSchema = new mongoose.Schema(
  {
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OpenChat',
      required: true,
      index: true,
    },
    senderId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['text', 'image', 'ripple', 'system'],
      default: 'text',
    },
    body: { type: String, default: '', maxlength: 2000 },
    imageUrl: { type: String, default: null },
    rippleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ripple',
      default: null,
    },
    rippleSnapshot: {
      title: { type: String, default: '' },
      coverUrl: { type: String, default: null },
      kind: { type: String, default: 'ripple' },
      placeLabel: { type: String, default: '' },
    },
    /** Client-generated id for send retry idempotency (partial unique). */
    clientId: { type: String, default: undefined },
    /** E2EE v2 envelope — body/imageUrl stay empty when set. */
    e2ee: {
      v: Number,
      envelope: mongoose.Schema.Types.Mixed,
    },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

openMessageSchema.index({ chatId: 1, _id: -1 });
// Partial (not sparse) so uniqueness applies only to real string keys —
// same pitfall as Ripple.idempotencyKey: a stored null collides.
openMessageSchema.index(
  { senderId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } },
);

const OpenMessage = mongoose.model('OpenMessage', openMessageSchema);

module.exports = OpenMessage;
