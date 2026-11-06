const mongoose = require('mongoose');

const waitlistEntrySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      maxlength: 254,
    },
    source: {
      type: String,
      default: 'website',
      maxlength: 40,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WaitlistEntry', waitlistEntrySchema);
