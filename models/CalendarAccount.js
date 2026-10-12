const mongoose = require('mongoose');

const calendarAccountSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ['google', 'microsoft', 'imap'],
      required: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    // AES-256-GCM encrypted blobs (utils/tokenCrypto) — never plaintext.
    accessTokenEnc: { type: String },
    refreshTokenEnc: { type: String },
    tokenExpiresAt: { type: Date },
    // IMAP-only connection details (password lives in refreshTokenEnc).
    imap: {
      host: String,
      port: Number,
      secure: { type: Boolean, default: true },
    },
    scopes: { type: [String], default: [] },
    syncCursor: { type: String, default: null },
    lastSyncAt: { type: Date },
    status: {
      type: String,
      enum: ['active', 'error', 'revoked'],
      default: 'active',
      index: true,
    },
    lastError: { type: String, default: null },
    errorCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

calendarAccountSchema.index({ userId: 1, provider: 1, email: 1 }, { unique: true });
calendarAccountSchema.index({ status: 1, lastSyncAt: 1 });

module.exports = mongoose.model('CalendarAccount', calendarAccountSchema);
