const mongoose = require('mongoose');

/**
 * E2EE backup pointer — metadata for the user's encrypted backup blob.
 * The blob itself lives in opaque /api/blobs storage (owner-only); this
 * record lets the owner find it on a fresh device. The server cannot read
 * the backup (SYNCUP-MEDIA-v1, key = HKDF(recovery-key)).
 */
const e2eeBackupSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    blobId: {
      type: String,
      required: true,
      match: /^[0-9a-f]{32}$/,
    },
    noncePrefix: {
      type: String,
      required: true,
    },
    encSize: {
      type: Number,
      required: true,
      min: 0,
    },
    encSha256: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('E2EEBackup', e2eeBackupSchema);
