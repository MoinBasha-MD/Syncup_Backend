const mongoose = require('mongoose');

const partnerAdminKeySchema = new mongoose.Schema(
  {
    keyId: { type: String, required: true, unique: true, index: true },
    label: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    secretHash: { type: String, required: true, unique: true, select: false },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PartnerAdminKey', partnerAdminKeySchema);
