const mongoose = require('mongoose');

/**
 * Opaque ciphertext blob for E2EE media attachments (SYNCUP-MEDIA-v1).
 * The server stores only encrypted bytes — the file key lives inside the
 * E2EE message envelope.
 */
const blobSchema = new mongoose.Schema(
  {
    blobId: {
      type: String,
      required: true,
      unique: true,
      match: /^[0-9a-f]{32}$/,
    },
    ownerUserId: { type: String, required: true, index: true },
    size: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model('Blob', blobSchema);
