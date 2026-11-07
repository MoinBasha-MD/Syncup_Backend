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
        'impersonation',
        'inappropriate',
        'no_show',
        'other',
      ],
      required: true,
    },
    details: { type: String, default: '', maxlength: 1000 },

    // Triage fields. Severity defaults are derived from `reason` at read time
    // when this is unset (see moderationController).
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      index: true,
    },
    assignedTo: { type: String, default: null, index: true },
    assignedAt: { type: Date, default: null },
    notes: [
      {
        by: String,
        at: { type: Date, default: Date.now },
        text: { type: String, maxlength: 2000 },
      },
    ],
    appealId: { type: mongoose.Schema.Types.ObjectId, ref: 'ModerationAppeal', default: null },

    status: {
      type: String,
      enum: ['open', 'reviewing', 'escalated', 'actioned', 'dismissed'],
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
