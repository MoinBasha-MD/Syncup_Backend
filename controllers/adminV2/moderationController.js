const mongoose = require('mongoose');
const Ripple = require('../../models/Ripple');
const RippleReport = require('../../models/RippleReport');
const RippleEvent = require('../../models/RippleEvent');
const FeedPost = require('../../models/FeedPost');
const Comment = require('../../models/Comment');
const Story = require('../../models/storyModel');
const ModeratedContent = require('../../models/ModeratedContent');
const { ok, fail, handle, parseLimit, isValidObjectId, escapeRegex } = require('../../utils/adminV2Response');

// ---- reports ------------------------------------------------------------------

const listReports = handle(async (req, res) => {
  const limit = parseLimit(req.query.limit);
  const status = req.query.status || 'open';
  const filter = status === 'all' ? {} : { status: { $in: ['open', 'reviewing'] } };
  if (req.query.cursor && isValidObjectId(req.query.cursor)) {
    filter._id = { $gt: new mongoose.Types.ObjectId(req.query.cursor) };
  }

  const reports = await RippleReport.find(filter)
    .sort({ _id: 1 })
    .limit(limit + 1)
    .lean();

  const page = reports.slice(0, limit);
  const rippleIds = [...new Set(page.map(r => String(r.rippleId)))]
    .map(id => new mongoose.Types.ObjectId(id));
  const ripples = rippleIds.length
    ? await Ripple.find({ _id: { $in: rippleIds } }).select('title kind hostUserId hostName lifecycle moderation').lean()
    : [];
  const rippleById = new Map(ripples.map(r => [String(r._id), r]));

  const nextCursor = reports.length > limit ? String(page[page.length - 1]._id) : null;
  return ok(res, page.map(report => ({
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
  })), nextCursor);
});

const resolveReports = handle(async (req, res) => {
  const { rippleId } = req.params;
  if (!isValidObjectId(rippleId)) return fail(res, 400, 'BAD_REQUEST', 'Invalid ripple id');
  const action = String(req.body.action || '');
  if (!['dismiss', 'remove'].includes(action)) {
    return fail(res, 400, 'BAD_REQUEST', 'action must be dismiss or remove');
  }

  const ripple = await Ripple.findById(rippleId);
  if (!ripple) return fail(res, 404, 'NOT_FOUND', 'Ripple not found');

  const reviewedBy = String(req.admin?._id || req.session?.adminUser?.userId || 'admin');
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

  res.locals.auditBefore = { lifecycle: ripple.lifecycle, moderation: ripple.moderation };

  await Ripple.updateOne(
    { _id: ripple._id },
    {
      $set: action === 'remove'
        ? {
            lifecycle: 'removed',
            'moderation.reviewStatus': 'actioned',
            'moderation.removedAt': reviewedAt,
            'moderation.removedReason': req.body.reason || 'moderation_report',
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

  res.locals.auditAfter = { action, status };
  return ok(res, { rippleId: String(ripple._id), action });
});

// ---- content listing + takedown ----------------------------------------------

const CONTENT_TYPES = {
  posts: { model: FeedPost, userField: 'userId' },
  ripples: { model: Ripple, userField: 'hostUserId', match: { kind: 'ripple' }, inPlace: true },
  shorts: { model: Ripple, userField: 'hostUserId', match: { kind: 'short' }, inPlace: true },
  comments: { model: Comment, userField: 'userId' },
  stories: { model: Story, userField: 'userId' },
  ripple_events: { model: RippleEvent, userField: 'authorId' },
};

const listContent = handle(async (req, res) => {
  const { type, q, state = 'active' } = req.query;
  const def = CONTENT_TYPES[type];
  if (!def) return fail(res, 400, 'BAD_REQUEST', `type must be one of: ${Object.keys(CONTENT_TYPES).join(', ')}`);
  const limit = parseLimit(req.query.limit);

  if (state === 'takendown') {
    const filter = { contentType: type, restoredAt: null };
    if (req.query.cursor && isValidObjectId(req.query.cursor)) {
      filter._id = { $lt: new mongoose.Types.ObjectId(req.query.cursor) };
    }
    const docs = await ModeratedContent.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
    const page = docs.slice(0, limit);
    const nextCursor = docs.length > limit ? String(page[page.length - 1]._id) : null;
    return ok(res, page, nextCursor);
  }

  const filter = { ...(def.match || {}) };
  if (type === 'ripples' || type === 'shorts') filter.lifecycle = { $nin: ['removed'] };
  if (typeof q === 'string' && q.trim()) {
    const rx = new RegExp(escapeRegex(q.trim()), 'i');
    filter.$or = def.userField === 'hostUserId'
      ? [{ title: rx }, { hostName: rx }, { hostUserId: rx }]
      : [{ [def.userField]: rx }];
  }
  if (req.query.cursor && isValidObjectId(req.query.cursor)) {
    filter._id = { $lt: new mongoose.Types.ObjectId(req.query.cursor) };
  }

  const docs = await def.model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const page = docs.slice(0, limit);
  const nextCursor = docs.length > limit ? String(page[page.length - 1]._id) : null;
  return ok(res, page, nextCursor);
});

const takedown = handle(async (req, res) => {
  const { type, id } = req.params;
  const def = CONTENT_TYPES[type];
  if (!def) return fail(res, 400, 'BAD_REQUEST', `type must be one of: ${Object.keys(CONTENT_TYPES).join(', ')}`);
  if (!isValidObjectId(id)) return fail(res, 400, 'BAD_REQUEST', 'Invalid content id');

  const existing = await ModeratedContent.findOne({ contentType: type, originalId: id, restoredAt: null }).lean();
  if (existing) return fail(res, 409, 'ALREADY_TAKEN_DOWN', 'Content is already taken down');

  if (def.inPlace) {
    // Ripples/shorts stay in place: flip lifecycle + moderation fields
    const ripple = await Ripple.findById(id);
    if (!ripple) return fail(res, 404, 'NOT_FOUND', 'Content not found');
    res.locals.auditBefore = { lifecycle: ripple.lifecycle, moderation: ripple.moderation };

    await ModeratedContent.create({
      contentType: type,
      originalId: ripple._id,
      collectionName: Ripple.collection.name,
      ownerUserId: ripple.hostUserId,
      doc: { lifecycle: ripple.lifecycle, moderation: ripple.moderation },
      reason: req.body.reason,
      takenDownBy: String(req.admin._id),
    });

    await Ripple.updateOne(
      { _id: ripple._id },
      {
        $set: {
          lifecycle: 'removed',
          'moderation.reviewStatus': 'actioned',
          'moderation.removedAt': new Date(),
          'moderation.removedReason': req.body.reason,
          'moderation.reviewedBy': String(req.admin._id),
          'moderation.reviewedAt': new Date(),
        },
      },
    );
    res.locals.auditAfter = { lifecycle: 'removed' };
    return ok(res, { id, contentType: type, takenDown: true });
  }

  // Everything else moves into quarantine: snapshot first, then delete
  const original = await def.model.findById(id).lean();
  if (!original) return fail(res, 404, 'NOT_FOUND', 'Content not found');

  await ModeratedContent.create({
    contentType: type,
    originalId: original._id,
    collectionName: def.model.collection.name,
    ownerUserId: original[def.userField],
    doc: original,
    reason: req.body.reason,
    takenDownBy: String(req.admin._id),
  });
  await def.model.deleteOne({ _id: original._id });

  res.locals.auditBefore = { id };
  res.locals.auditAfter = { takenDown: true };
  return ok(res, { id, contentType: type, takenDown: true });
});

const restore = handle(async (req, res) => {
  const { type, id } = req.params;
  const def = CONTENT_TYPES[type];
  if (!def) return fail(res, 400, 'BAD_REQUEST', `type must be one of: ${Object.keys(CONTENT_TYPES).join(', ')}`);
  if (!isValidObjectId(id)) return fail(res, 400, 'BAD_REQUEST', 'Invalid content id');

  const record = await ModeratedContent.findOne({ contentType: type, originalId: id, restoredAt: null });
  if (!record) return fail(res, 404, 'NOT_FOUND', 'No active takedown found for this content');

  if (def.inPlace) {
    const prior = record.doc || {};
    await Ripple.updateOne(
      { _id: record.originalId },
      {
        $set: {
          lifecycle: prior.lifecycle || 'active',
          'moderation.reviewStatus': 'clear',
          'moderation.removedAt': null,
          'moderation.removedReason': null,
          'moderation.reviewedBy': String(req.admin._id),
          'moderation.reviewedAt': new Date(),
        },
      },
    );
  } else {
    // Re-insert the original document with its preserved _id
    await def.model.collection.insertOne(record.doc);
  }

  record.restoredAt = new Date();
  record.restoredBy = String(req.admin._id);
  await record.save();

  res.locals.auditBefore = { takenDown: true };
  res.locals.auditAfter = { restored: true };
  return ok(res, { id, contentType: type, restored: true });
});

module.exports = { listReports, resolveReports, listContent, takedown, restore };
