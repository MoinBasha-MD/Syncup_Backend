const mongoose = require('mongoose');

/**
 * RippleReport — a moderation report against a Ripple or one of its events.
 *
 * Reports are the input to trust decisions: enough *confirmed safety* reports
 * revoke the ability to publish at global reach, regardless of host score.
 * A report is never shown to the reported party.
 */
const rippleReportSchema = new mongoose.Schema(
  {
    rippleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ripple',
      required: true,
      index: true,
    },
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RippleEvent',
      default: null,
    },
    reporterId: { type: String, required: true, index: true },
    reportedUserId: { type: String, required: true, index: true },

    reason: {
      type: String,
      enum: [
        'spam',
        'harassment',
        'safety',
        'misleading',
        'inappropriate',
        'no_show',
        'other',
      ],
      required: true,
    },
    details: { type: String, default: '', maxlength: 1000 },

    status: {
      type: String,
      enum: ['open', 'reviewing', 'actioned', 'dismissed'],
      default: 'open',
      index: true,
    },
    // A confirmed *safety* report is what actually moves a host's privileges.
    confirmedSafety: { type: Boolean, default: false },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One open report per reporter per Ripple — stops a single user flooding.
rippleReportSchema.index({ rippleId: 1, reporterId: 1 }, { unique: true });
rippleReportSchema.index({ reportedUserId: 1, status: 1 });
rippleReportSchema.index({ status: 1, createdAt: -1 });

const RippleReport = mongoose.model('RippleReport', rippleReportSchema);

module.exports = RippleReport;
