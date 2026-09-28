const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Ripple = require('../models/Ripple');
const RippleReport = require('../models/RippleReport');

const listRippleReports = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
  const reports = await RippleReport.find({ status: { $in: ['open', 'reviewing'] } })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();
  const rippleIds = [...new Set(reports.map((report) => String(report.rippleId)))]
    .map((id) => new mongoose.Types.ObjectId(id));
  const ripples = rippleIds.length
    ? await Ripple.find({ _id: { $in: rippleIds } })
        .select('title kind hostUserId hostName lifecycle moderation')
        .lean()
    : [];
  const rippleById = new Map(ripples.map((ripple) => [String(ripple._id), ripple]));

  res.status(200).json({
    success: true,
    reports: reports.map((report) => ({
      id: String(report._id),
      rippleId: String(report.rippleId),
      eventId: report.eventId ? String(report.eventId) : null,
      reporterId: report.reporterId,
      reportedUserId: report.reportedUserId,
      reason: report.reason,
      details: report.details,
      status: report.status,
      createdAt: report.createdAt,
      ripple: rippleById.get(String(report.rippleId)) || null,
    })),
  });
});

const resolveRippleReports = asyncHandler(async (req, res) => {
  const { rippleId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(rippleId)) {
    return res.status(400).json({ success: false, message: 'Invalid Ripple id' });
  }
  const action = String(req.body.action || '');
  if (!['dismiss', 'remove'].includes(action)) {
    return res.status(400).json({ success: false, message: 'action must be dismiss or remove' });
  }

  const ripple = await Ripple.findById(rippleId);
  if (!ripple) return res.status(404).json({ success: false, message: 'Ripple not found' });

  const admin = req.session?.adminUser || {};
  const reviewedBy = String(admin.userId || admin._id || admin.email || 'admin');
  const reviewedAt = new Date();
  const status = action === 'remove' ? 'actioned' : 'dismissed';

  await RippleReport.updateMany(
    { rippleId: ripple._id, status: { $in: ['open', 'reviewing'] } },
    {
      $set: {
        status,
        reviewedBy,
        reviewedAt,
        ...(action === 'remove' ? { confirmedSafety: req.body.confirmedSafety === true } : {}),
      },
    },
  );

  await Ripple.updateOne(
    { _id: ripple._id },
    {
      $set: action === 'remove'
        ? {
            lifecycle: 'removed',
            'moderation.reviewStatus': 'actioned',
            'moderation.removedAt': reviewedAt,
            'moderation.removedReason': 'moderation_report',
            'moderation.reviewedBy': reviewedBy,
            'moderation.reviewedAt': reviewedAt,
          }
        : {
            'moderation.reviewStatus': 'dismissed',
            'moderation.reviewFlaggedAt': null,
            'moderation.reviewedBy': reviewedBy,
            'moderation.reviewedAt': reviewedAt,
          },
    },
  );

  res.status(200).json({ success: true, rippleId: String(ripple._id), action });
});

module.exports = { listRippleReports, resolveRippleReports };
