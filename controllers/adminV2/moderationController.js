const mongoose = require('mongoose');
const Ripple = require('../../models/Ripple');
const RippleReport = require('../../models/RippleReport');
const RippleEvent = require('../../models/RippleEvent');
const FeedPost = require('../../models/FeedPost');
const Comment = require('../../models/Comment');
const Story = require('../../models/storyModel');
const ModeratedContent = require('../../models/ModeratedContent');
const ModerationAppeal = require('../../models/ModerationAppeal');
const AdminAuditLog = require('../../models/AdminAuditLog');
const User = require('../../models/userModel');
const Group = require('../../models/groupModel');
const { ok, fail, handle, parseLimit, isValidObjectId, escapeRegex } = require('../../utils/adminV2Response');

const SEVERITY_BY_REASON = {
  safety: 'critical',
  harassment: 'high',
  inappropriate: 'high',
  impersonation: 'high',
  misleading: 'medium',
  other: 'medium',
  spam: 'low',
  no_show: 'low',
};

const severityFor = (report) => report.severity || SEVERITY_BY_REASON[report.reason] || 'medium';

const toReport = (report, ripple) => ({
  id: String(report._id),
  rippleId: String(report.rippleId),
  eventId: report.eventId ? String(report.eventId) : null,
  reporterId: report.reporterId,
  reportedUserId: report.reportedUserId,
  reason: report.reason,
  details: report.details,
  status: report.status,
  severity: severityFor(report),
  assignedTo: report.assignedTo || null,
  assignedAt: report.assignedAt || null,
  notesCount: (report.notes || []).length,
  createdAt: report.createdAt,
  ripple: ripple || null,
});

const findReport = async (id) =>
  isValidObjectId(id) ? RippleReport.findById(id) : null;

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
  return ok(res, page.map(report => toReport(report, rippleById.get(String(report.rippleId)) || null)), nextCursor);
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

const SURFACE_TYPES = new Set(['display_pictures', 'profiles', 'groups']);

const listSurface = async (req, res, { model, filter, select }) => {
  const limit = parseLimit(req.query.limit);
  const query = { ...filter };
  if (req.query.cursor && isValidObjectId(req.query.cursor)) {
    query._id = { $lt: new mongoose.Types.ObjectId(req.query.cursor) };
  }
  const docs = await model.find(query).select(select).sort({ _id: -1 }).limit(limit + 1).lean();
  const page = docs.slice(0, limit);
  const nextCursor = docs.length > limit ? String(page[page.length - 1]._id) : null;
  return ok(res, page, nextCursor);
};

const takeDownSurface = async (req, res, type) => {
  if (!isValidObjectId(req.params.id)) return fail(res, 400, 'BAD_REQUEST', 'Invalid content id');
  const existing = await ModeratedContent.findOne({
    contentType: type,
    originalId: req.params.id,
    restoredAt: null,
  }).lean();
  if (existing) return fail(res, 409, 'ALREADY_TAKEN_DOWN', 'Content is already taken down');

  if (type === 'display_pictures' || type === 'profiles') {
    const user = await User.findById(req.params.id);
    if (!user) return fail(res, 404, 'NOT_FOUND', 'User not found');
    const snapshot = type === 'display_pictures'
      ? { profileImage: user.profileImage }
      : { bio: user.bio };
    await ModeratedContent.create({
      contentType: type,
      originalId: user._id,
      collectionName: User.collection.name,
      ownerUserId: user.userId,
      doc: snapshot,
      reason: req.body.reason,
      takenDownBy: String(req.admin._id),
    });
    res.locals.auditBefore = snapshot;
    if (type === 'display_pictures') user.profileImage = null;
    else user.bio = '';
    await user.save();
    res.locals.auditAfter = { contentType: type, takenDown: true };
    return ok(res, { id: req.params.id, contentType: type, takenDown: true });
  }

  const group = await Group.findById(req.params.id);
  if (!group) return fail(res, 404, 'NOT_FOUND', 'Group not found');
  await ModeratedContent.create({
    contentType: type,
    originalId: group._id,
    collectionName: Group.collection.name,
    ownerUserId: group.userId,
    doc: { description: group.description },
    reason: req.body.reason,
    takenDownBy: String(req.admin._id),
  });
  res.locals.auditBefore = { description: group.description };
  group.description = '';
  await group.save();
  res.locals.auditAfter = { contentType: type, takenDown: true };
  return ok(res, { id: req.params.id, contentType: type, takenDown: true });
};

const restoreSurface = async (req, res, type) => {
  if (!isValidObjectId(req.params.id)) return fail(res, 400, 'BAD_REQUEST', 'Invalid content id');
  const record = await ModeratedContent.findOne({
    contentType: type,
    originalId: req.params.id,
    restoredAt: null,
  });
  if (!record) return fail(res, 404, 'NOT_FOUND', 'No active takedown found for this content');

  if (type === 'display_pictures') {
    await User.findByIdAndUpdate(record.originalId, { profileImage: record.doc?.profileImage ?? null });
  } else if (type === 'profiles') {
    await User.findByIdAndUpdate(record.originalId, { bio: record.doc?.bio ?? '' });
  } else {
    await Group.findByIdAndUpdate(record.originalId, { description: record.doc?.description ?? '' });
  }

  record.restoredAt = new Date();
  record.restoredBy = String(req.admin._id);
  await record.save();
  res.locals.auditBefore = { takenDown: true };
  res.locals.auditAfter = { restored: true, contentType: type };
  return ok(res, { id: req.params.id, contentType: type, restored: true });
};

const listContent = handle(async (req, res) => {
  const { type, q, state = 'active' } = req.query;

  if (type === 'display_pictures') {
    return listSurface(req, res, {
      model: User,
      filter: { profileImage: { $nin: [null, ''] } },
      select: 'userId name profileImage',
    });
  }
  if (type === 'profiles') {
    return listSurface(req, res, {
      model: User,
      filter: { bio: { $nin: [null, ''] } },
      select: 'userId name bio',
    });
  }
  if (type === 'groups') {
    return listSurface(req, res, {
      model: Group,
      filter: {},
      select: 'name description userId createdBy createdAt',
    });
  }

  const def = CONTENT_TYPES[type];
  if (!def) return fail(res, 400, 'BAD_REQUEST', `type must be one of: ${[...Object.keys(CONTENT_TYPES), ...SURFACE_TYPES].join(', ')}`);
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
  if (SURFACE_TYPES.has(type)) return takeDownSurface(req, res, type);
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
  if (SURFACE_TYPES.has(type)) return restoreSurface(req, res, type);
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

// ---- triage: assignment, notes, escalation, evidence -------------------------

const patchReport = handle(async (req, res) => {
  const report = await findReport(req.params.reportId);
  if (!report) return fail(res, 404, 'NOT_FOUND', 'Report not found');

  const { severity, assignedTo, status, note } = req.body || {};
  res.locals.auditBefore = {
    severity: severityFor(report),
    assignedTo: report.assignedTo || null,
    status: report.status,
  };

  if (severity !== undefined) {
    if (!['low', 'medium', 'high', 'critical'].includes(severity)) {
      return fail(res, 400, 'BAD_REQUEST', 'severity must be low, medium, high or critical');
    }
    report.severity = severity;
  }
  if (assignedTo !== undefined) {
    if (assignedTo !== null && typeof assignedTo !== 'string') {
      return fail(res, 400, 'BAD_REQUEST', 'assignedTo must be an admin id or null');
    }
    report.assignedTo = assignedTo || null;
    report.assignedAt = assignedTo ? new Date() : null;
  }
  if (status !== undefined) {
    if (!['open', 'reviewing', 'escalated'].includes(status)) {
      return fail(res, 400, 'BAD_REQUEST', 'status must be open, reviewing or escalated');
    }
    report.status = status;
  }
  if (typeof note === 'string' && note.trim()) {
    report.notes.push({ by: String(req.admin._id), at: new Date(), text: note.trim().slice(0, 2000) });
  }

  await report.save();
  res.locals.auditAfter = {
    severity: severityFor(report),
    assignedTo: report.assignedTo,
    status: report.status,
  };
  return ok(res, toReport(report));
});

const addNote = handle(async (req, res) => {
  const report = await findReport(req.params.reportId);
  if (!report) return fail(res, 404, 'NOT_FOUND', 'Report not found');
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > 2000) {
    return fail(res, 400, 'BAD_REQUEST', 'text is required (max 2000 chars)');
  }
  report.notes.push({ by: String(req.admin._id), at: new Date(), text });
  await report.save();
  res.locals.auditAfter = { reportId: String(report._id), notesCount: report.notes.length };
  return ok(res, { id: String(report._id), notesCount: report.notes.length });
});

const escalateReport = handle(async (req, res) => {
  const report = await findReport(req.params.reportId);
  if (!report) return fail(res, 404, 'NOT_FOUND', 'Report not found');
  res.locals.auditBefore = { status: report.status };
  report.status = 'escalated';
  report.notes.push({
    by: String(req.admin._id),
    at: new Date(),
    text: `Escalated: ${String(req.body?.reason || '').slice(0, 500)}`,
  });
  await report.save();
  res.locals.auditAfter = { status: 'escalated' };
  return ok(res, toReport(report));
});

const getEvidence = handle(async (req, res) => {
  const report = await findReport(req.params.reportId);
  if (!report) return fail(res, 404, 'NOT_FOUND', 'Report not found');
  const ripple = await Ripple.findById(report.rippleId).lean();
  const quarantine = await ModeratedContent.findOne({
    contentType: 'ripples',
    originalId: report.rippleId,
    restoredAt: null,
  }).lean();
  return ok(res, {
    report: toReport(report, ripple),
    content: ripple,
    quarantine,
    preservedAt: quarantine?.takenDownAt || report.createdAt,
  });
});

const moderationHistory = handle(async (req, res) => {
  const { userId } = req.params;
  const windowDays = req.query.window === '90' ? 90 : 30;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [reports, appeals, actions, reportsInWindow] = await Promise.all([
    RippleReport.find({ reportedUserId: userId }).sort({ createdAt: -1 }).limit(100).lean(),
    ModerationAppeal.find({ userId }).sort({ createdAt: -1 }).limit(100).lean(),
    AdminAuditLog.find({ targetType: 'user', targetId: userId }).sort({ seq: -1 }).limit(100)
      .select('-before -after -hash -prevHash').lean(),
    RippleReport.countDocuments({ reportedUserId: userId, createdAt: { $gte: since } }),
  ]);

  return ok(res, {
    windowDays,
    reportsInWindow,
    repeatOffender: reportsInWindow >= 3,
    reports: reports.map((report) => toReport(report)),
    appeals,
    actions,
  });
});

// ---- appeals ------------------------------------------------------------------

const listAppeals = handle(async (req, res) => {
  const limit = parseLimit(req.query.limit);
  const filter = {};
  if (req.query.status && req.query.status !== 'all') {
    if (!['pending', 'upheld', 'overturned'].includes(req.query.status)) {
      return fail(res, 400, 'BAD_REQUEST', 'status must be pending, upheld, overturned or all');
    }
    filter.status = req.query.status;
  }
  if (req.query.cursor && isValidObjectId(req.query.cursor)) {
    filter._id = { $lt: new mongoose.Types.ObjectId(req.query.cursor) };
  }
  const docs = await ModerationAppeal.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const page = docs.slice(0, limit);
  const nextCursor = docs.length > limit ? String(page[page.length - 1]._id) : null;
  return ok(res, page.map((appeal) => ({ id: String(appeal._id), ...appeal, _id: undefined })), nextCursor);
});

const recordAppeal = handle(async (req, res) => {
  const { contentType, originalId, reportId, userId, message } = req.body || {};
  const allTypes = [...Object.keys(CONTENT_TYPES), ...SURFACE_TYPES];
  if (!allTypes.includes(contentType)) {
    return fail(res, 400, 'BAD_REQUEST', `contentType must be one of: ${allTypes.join(', ')}`);
  }
  if (!isValidObjectId(originalId)) return fail(res, 400, 'BAD_REQUEST', 'originalId must be a valid id');
  if (typeof message !== 'string' || !message.trim() || message.length > 2000) {
    return fail(res, 400, 'BAD_REQUEST', 'message is required (max 2000 chars)');
  }
  if (reportId && !isValidObjectId(reportId)) return fail(res, 400, 'BAD_REQUEST', 'reportId must be a valid id');

  const appeal = await ModerationAppeal.create({
    contentType,
    originalId,
    reportId: reportId || null,
    userId: typeof userId === 'string' ? userId : null,
    message: message.trim(),
    createdBy: req.admin?.username || String(req.admin?._id),
  });
  res.locals.auditAfter = { appealId: String(appeal._id), contentType };
  return ok(res, { id: String(appeal._id), status: appeal.status });
});

const decideAppeal = handle(async (req, res) => {
  if (!isValidObjectId(req.params.id)) return fail(res, 400, 'BAD_REQUEST', 'Invalid appeal id');
  const appeal = await ModerationAppeal.findById(req.params.id);
  if (!appeal) return fail(res, 404, 'NOT_FOUND', 'Appeal not found');
  if (appeal.status !== 'pending') {
    return fail(res, 409, 'INVALID_STATE', 'This appeal is already decided');
  }

  const decision = req.body?.decision;
  if (!['uphold', 'overturn'].includes(decision)) {
    return fail(res, 400, 'BAD_REQUEST', 'decision must be uphold or overturn');
  }

  res.locals.auditBefore = { status: appeal.status };
  if (decision === 'overturn') {
    const record = await ModeratedContent.findOne({
      contentType: appeal.contentType,
      originalId: appeal.originalId,
      restoredAt: null,
    });
    if (record) {
      if (SURFACE_TYPES.has(appeal.contentType)) {
        if (appeal.contentType === 'display_pictures') {
          await User.findByIdAndUpdate(record.originalId, { profileImage: record.doc?.profileImage ?? null });
        } else if (appeal.contentType === 'profiles') {
          await User.findByIdAndUpdate(record.originalId, { bio: record.doc?.bio ?? '' });
        } else {
          await Group.findByIdAndUpdate(record.originalId, { description: record.doc?.description ?? '' });
        }
      } else {
        const def = CONTENT_TYPES[appeal.contentType];
        if (def?.inPlace) {
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
        } else if (def) {
          await def.model.collection.insertOne(record.doc);
        }
      }
      record.restoredAt = new Date();
      record.restoredBy = String(req.admin._id);
      await record.save();
    }
    if (appeal.reportId) {
      await RippleReport.updateOne(
        { _id: appeal.reportId },
        { $set: { status: 'dismissed', appealId: appeal._id, reviewedBy: String(req.admin._id), reviewedAt: new Date() } },
      );
    }
  }

  appeal.status = decision === 'overturn' ? 'overturned' : 'upheld';
  appeal.decidedBy = req.admin?.username || String(req.admin?._id);
  appeal.decidedAt = new Date();
  appeal.decisionNotes = typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 2000) : null;
  await appeal.save();

  res.locals.auditAfter = { status: appeal.status, decision };
  return ok(res, { id: String(appeal._id), status: appeal.status });
});

module.exports = {
  listReports,
  resolveReports,
  listContent,
  takedown,
  restore,
  patchReport,
  addNote,
  escalateReport,
  getEvidence,
  moderationHistory,
  listAppeals,
  recordAppeal,
  decideAppeal,
};
