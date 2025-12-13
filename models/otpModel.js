const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  identifier: {
    type: String,
    required: true,
    index: true,
  },
  otpHash: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    required: true,
    enum: ['registration', 'password_reset', 'email_change', 'phone_change', 'account_deletion', '2fa'],
  },
  attempts: {
    type: Number,
    default: 0,
  },
  maxAttempts: {
    type: Number,
    default: 3,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true,
  },
  ipAddress: String,
  userAgent: String,
  verified: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

// Auto-delete expired OTPs
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for faster lookups
otpSchema.index({ identifier: 1, type: 1, verified: 1 });

module.exports = mongoose.model('OTP', otpSchema);
