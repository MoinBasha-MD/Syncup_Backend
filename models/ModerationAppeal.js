const mongoose = require('mongoose');

/**
 * An appeal against a moderation decision. App-side submission is not live
 * yet; admins can record appeals received through support, then decide them.
 * Overturning restores the quarantined content through ModeratedContent.
 */
const moderationAppealSchema = new mongoose.Schema(
  {
    contentType: {
      type: String,
      required: true,
      enum: [
        'posts', 'ripples', 'shorts', 'comments', 'stories', 'ripple_events',
        'display_pictures', 'profiles', 'groups',
      ],
    },
    originalId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'RippleReport', default: null },
    userId: { type: String, default: null, index: true },
    message: { type: String, required: true, maxlength: 2000 },
    status: {
      type: String,
      enum: ['pending', 'upheld', 'overturned'],
      default: 'pending',
      index: true,
    },
    createdBy: { type: String, default: null },
    decidedBy: { type: String, default: null },
    decidedAt: { type: Date, default: null },
    decisionNotes: { type: String, default: null, maxlength: 2000 },
  },
  { timestamps: true },
);

moderationAppealSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ModerationAppeal', moderationAppealSchema);
