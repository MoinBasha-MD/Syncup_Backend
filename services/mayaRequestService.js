/**
 * mayaRequestService — business logic for Maya-to-Maya requests.
 * The friend always decides; everything here enforces that.
 *
 *   invite         — ask friends for coffee/lunch/etc
 *   location_share — ask a friend to share their live location for 1h
 *                    (the recipient's device must stream coordinates, so
 *                    accept returns needsClientShare — the app starts the
 *                    existing client share session on accept)
 */

const MayaRequest = require('../models/MayaRequest');
const Friend = require('../models/Friend');
const Block = require('../models/blockModel');
const User = require('../models/userModel');
const { dispatchNotification } = require('./notificationDispatcher');

const MAX_RECIPIENTS = 10;
const CREATES_PER_HOUR = 20;
const MAX_OPEN_PER_RECIPIENT = 3;
const NUDGE_INTERVAL_MS = 30 * 60 * 1000;
const LOCATION_SHARE_MINUTES = 60;
const MAX_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

const ACTIVITIES = ['coffee', 'lunch', 'dinner', 'movie', 'call', 'meet', 'custom'];

class BadRequestError extends Error {
  constructor(message, code = 'BAD_REQUEST') { super(message); this.status = 400; this.code = code; }
}
class NotFoundError extends Error {
  constructor() { super('Not found'); this.status = 404; this.code = 'NOT_FOUND'; }
}
class ForbiddenError extends Error {
  constructor() { super('Not allowed'); this.status = 403; this.code = 'FORBIDDEN'; }
}
class ConflictError extends Error {
  constructor(message = 'Request is no longer open') {
    super(message); this.status = 409; this.code = 'NOT_OPEN';
  }
}

const firstName = (name) => (name || 'Someone').trim().split(/\s+/)[0];
const isDnd = (u) => /dnd|do not disturb|sleep/i.test(`${u?.status || ''} ${u?.mainStatus || ''}`);

const userCache = new Map();
const fetchUser = async (userId) => {
  if (userCache.has(userId)) return userCache.get(userId);
  const u = await User.findOne({ userId }).select('userId name profileImage status mainStatus').lean();
  userCache.set(userId, u);
  return u;
};

/** Generic recipient rejection — never reveals which check failed. */
const recipientNotAllowed = () => new BadRequestError('One or more recipients cannot be added', 'RECIPIENT_NOT_ALLOWED');

const allowedRecipient = async (fromUserId, toUserId) => {
  if (!toUserId || typeof toUserId !== 'string' || toUserId === fromUserId) return false;
  const [friends, blocked] = await Promise.all([
    Friend.areFriends(fromUserId, toUserId),
    Block.isMutuallyBlocked(fromUserId, toUserId),
  ]);
  return friends && !blocked;
};

const isRecipient = (doc, userId) => doc.recipients.some((r) => r.userId === userId);
const recipientOf = (doc, userId) => doc.recipients.find((r) => r.userId === userId);

const minimalRecipientView = (doc) => ({
  requestId: doc.requestId,
  kind: doc.kind,
  activity: doc.activity,
  title: doc.title,
  note: doc.note,
  timeText: doc.timeText,
  proposedTime: doc.proposedTime,
  place: doc.place,
  status: doc.status,
  confirmedTime: doc.confirmedTime,
  expiresAt: doc.expiresAt,
  createdAt: doc.createdAt,
  // privacy: other recipients appear as first-name + status only
  recipients: doc.recipients.map((r) => ({
    userId: r.userId,
    status: r.status,
  })),
});

const senderView = (doc) => doc.toObject ? doc.toObject() : doc;

const notify = async ({ toUserId, envelopeType, title, body, requestId, silent }) => {
  try {
    const target = await fetchUser(toUserId);
    await dispatchNotification({
      toUserId,
      fromUserId: 'maya',
      type: envelopeType,
      category: 'social',
      title,
      body,
      groupKey: `maya:${requestId}`,
      action: { screen: 'MayaChat', params: { requestId } },
      data: { kind: 'maya', requestId, requestKind: envelopeType },
      silentPush: silent === undefined ? isDnd(target) : silent,
    });
  } catch (e) {
    console.error(`❌ [MAYA REQUEST] notify ${envelopeType} → ${toUserId}:`, e.message);
  }
};

/** Notify every recipient of a new request. */
const notifyCreated = async (doc, fromUser) => {
  const title = `${firstName(fromUser?.name)}'s Maya`;
  const summary = doc.title
    || (doc.kind === 'location_share' ? 'Share your location for an hour?'
      : [doc.activity, doc.timeText].filter(Boolean).join(', ') + '?');
  await Promise.allSettled(
    doc.recipients.map((r) =>
      notify({ toUserId: r.userId, envelopeType: 'maya_request', title, body: summary, requestId: doc.requestId })),
  );
};

/** Response → sender only (group recipients never see each other's replies). */
const notifyResponse = async (doc, responder, recipient) => {
  const verb = recipient.status === 'accepted' ? 'is in'
    : recipient.status === 'declined' ? 'can\'t make it'
      : `suggested ${recipient.suggestedTimeText || 'another time'}`;
  await notify({
    toUserId: doc.fromUserId,
    envelopeType: 'maya_reply',
    title: `${firstName(responder?.name)} ${verb}`,
    body: recipient.reply || doc.title || '',
    requestId: doc.requestId,
    silent: false,
  });
};

const notifyAll = async (doc, type, title, body) => {
  await Promise.allSettled(
    doc.recipients.map((r) => notify({ toUserId: r.userId, envelopeType: type, title, body, requestId: doc.requestId })),
  );
};

// ---------- public API ----------

const createRequest = async ({ fromUserId, body }) => {
  const kind = body.kind;
  if (!['invite', 'location_share'].includes(kind)) throw new BadRequestError('kind must be invite or location_share');
  const activity = body.activity !== undefined ? body.activity : undefined;
  if (activity !== undefined && !ACTIVITIES.includes(activity)) {
    throw new BadRequestError(`activity must be one of: ${ACTIVITIES.join(', ')}`);
  }
  const rawRecipients = Array.isArray(body.recipients) ? body.recipients : [];
  const unique = [...new Set(rawRecipients.map(String))];
  if (unique.length < 1 || unique.length > MAX_RECIPIENTS || unique.length !== rawRecipients.length) {
    throw new BadRequestError(`recipients must be 1-${MAX_RECIPIENTS} unique user ids`);
  }
  if (unique.includes(String(fromUserId))) throw recipientNotAllowed();

  // Rate limits: 20 creates/hour; ≤3 open requests per recipient
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentCount = await MayaRequest.countDocuments({ fromUserId, createdAt: { $gte: hourAgo } });
  if (recentCount >= CREATES_PER_HOUR) {
    throw new BadRequestError('Too many requests — try later', 'RATE_LIMITED');
  }

  const checks = await Promise.all(unique.map((rid) => allowedRecipient(fromUserId, rid)));
  if (checks.some((ok) => !ok)) throw recipientNotAllowed();

  const openToSame = await MayaRequest.countDocuments({
    fromUserId,
    status: 'open',
    'recipients.userId': { $in: unique },
  });
  // per-recipient cap — count docs where ANY recipient is in the set, then check each
  if (openToSame > 0) {
    const existing = await MayaRequest.find({
      fromUserId, status: 'open', 'recipients.userId': { $in: unique },
    }).select('recipients').lean();
    const perRecipient = new Map();
    existing.forEach((d) => d.recipients.forEach((r) => {
      if (unique.includes(String(r.userId)) && r.status === 'pending') {
        perRecipient.set(r.userId, (perRecipient.get(r.userId) || 0) + 1);
      }
    }));
    if ([...perRecipient.values()].some((n) => n >= MAX_OPEN_PER_RECIPIENT)) {
      throw new BadRequestError('You already have open requests to this friend', 'RATE_LIMITED');
    }
  }

  const proposedTime = body.proposedTime ? new Date(body.proposedTime) : undefined;
  if (body.proposedTime && Number.isNaN(proposedTime.getTime())) throw new BadRequestError('proposedTime is invalid');

  let expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new BadRequestError('expiresAt is invalid');
  if (!expiresAt) expiresAt = proposedTime ? new Date(proposedTime.getTime() + 2 * 3600_000) : new Date(Date.now() + 24 * 3600_000);
  const maxExpiry = Date.now() + MAX_EXPIRY_MS;
  if (expiresAt.getTime() > maxExpiry) expiresAt = new Date(maxExpiry);

  const doc = await MayaRequest.create({
    fromUserId,
    kind,
    activity,
    title: typeof body.title === 'string' ? body.title.slice(0, 80) : undefined,
    note: typeof body.note === 'string' ? body.note.slice(0, 280) : undefined,
    proposedTime,
    timeText: typeof body.timeText === 'string' ? body.timeText.slice(0, 60) : undefined,
    place: body.place && typeof body.place === 'object' ? {
      label: String(body.place.label || '').slice(0, 120),
      lat: typeof body.place.lat === 'number' ? body.place.lat : undefined,
      lng: typeof body.place.lng === 'number' ? body.place.lng : undefined,
    } : undefined,
    recipients: unique.map((userId) => ({ userId })),
    expiresAt,
  });

  const fromUser = await fetchUser(fromUserId);
  await notifyCreated(doc, fromUser);
  return senderView(doc);
};

const listRequests = async (userId, { box = 'received', cursor, limit = 20 } = {}) => {
  const query = box === 'sent'
    ? { fromUserId: userId }
    : { 'recipients.userId': userId };
  if (cursor) {
    const c = new Date(cursor);
    if (!Number.isNaN(c.getTime())) query.createdAt = { $lt: c };
  }
  const docs = await MayaRequest.find(query).sort({ createdAt: -1 }).limit(limit + 1).lean();
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit);
  return {
    items: page.map((d) => (d.fromUserId === userId ? senderView(d) : minimalRecipientView(d))),
    nextCursor: hasMore ? page[page.length - 1].createdAt : null,
  };
};

const getRequest = async (userId, requestId) => {
  const doc = await MayaRequest.findOne({ requestId }).lean();
  if (!doc || (doc.fromUserId !== userId && !isRecipient(doc, userId))) throw new NotFoundError();
  return doc.fromUserId === userId ? senderView(doc) : minimalRecipientView(doc);
};

const respond = async (userId, requestId, body) => {
  const action = body.action;
  if (!['accept', 'decline', 'suggest'].includes(action)) throw new BadRequestError('action must be accept, decline or suggest');

  const now = new Date();
  const patch = {
    'recipients.$.respondedAt': now,
    'recipients.$.reply': typeof body.reply === 'string' ? body.reply.slice(0, 280) : undefined,
  };
  let newStatus;
  if (action === 'suggest') {
    newStatus = 'suggested';
    const st = body.suggestedTime ? new Date(body.suggestedTime) : undefined;
    if (body.suggestedTime && Number.isNaN(st.getTime())) throw new BadRequestError('suggestedTime is invalid');
    patch['recipients.$.suggestedTime'] = st;
    patch['recipients.$.suggestedTimeText'] = typeof body.suggestedTimeText === 'string' ? body.suggestedTimeText.slice(0, 60) : undefined;
  } else {
    newStatus = action === 'accept' ? 'accepted' : 'declined';
  }
  patch['recipients.$.status'] = newStatus;

  // Atomic: only while open + recipient still pending/suggested
  const updated = await MayaRequest.findOneAndUpdate(
    {
      requestId,
      status: 'open',
      expiresAt: { $gt: now },
      recipients: { $elemMatch: { userId, status: { $in: ['pending', 'suggested'] } } },
    },
    { $set: patch },
    { new: true },
  );

  if (!updated) {
    // Idempotent: return current state when the recipient already responded
    // the same way — otherwise 404 to keep the action private.
    const existing = await MayaRequest.findOne({ requestId });
    if (!existing || (existing.fromUserId !== userId && !isRecipient(existing, userId))) throw new NotFoundError();
    const mine = recipientOf(existing, userId);
    if (existing.fromUserId === userId) throw new ForbiddenError();
    if (!mine) throw new NotFoundError();
    if (mine.status === newStatus) {
      const out = minimalRecipientView(existing);
      return { request: out, repeated: true };
    }
    throw new ConflictError();
  }

  const responder = await fetchUser(userId);
  const mine = recipientOf(updated, userId);
  await notifyResponse(updated, responder, mine);

  const out = minimalRecipientView(updated.toObject ? updated.toObject() : updated);
  // location_share: the recipient's device must create the live session —
  // server can't stream their coordinates, so flag it for the client.
  if (updated.kind === 'location_share' && action === 'accept') {
    out.needsClientShare = true;
    out.shareMinutes = LOCATION_SHARE_MINUTES;
    out.shareToUserId = updated.fromUserId;
  }
  return { request: out };
};

const confirm = async (userId, requestId, body) => {
  const doc = await MayaRequest.findOne({ requestId });
  if (!doc || doc.fromUserId !== userId) throw new NotFoundError();
  if (doc.status !== 'open') throw new ConflictError();
  const time = body.time ? new Date(body.time) : undefined;
  if (body.time && Number.isNaN(time.getTime())) throw new BadRequestError('time is invalid');
  doc.status = 'confirmed';
  doc.confirmedTime = time || doc.proposedTime || undefined;
  await doc.save();
  const fromUser = await fetchUser(userId);
  await notifyAll(doc, 'maya_plan', `${firstName(fromUser?.name)} confirmed`,
    doc.title || `${doc.activity || 'Plan'}${doc.confirmedTime ? ` — ${doc.confirmedTime.toLocaleString()}` : ''}`);
  return senderView(doc);
};

const cancel = async (userId, requestId) => {
  const doc = await MayaRequest.findOne({ requestId });
  if (!doc || doc.fromUserId !== userId) throw new NotFoundError();
  if (doc.status !== 'open') throw new ConflictError();
  doc.status = 'cancelled';
  await doc.save();
  const fromUser = await fetchUser(userId);
  await notifyAll(doc, 'maya_request', `${firstName(fromUser?.name)} cancelled`, doc.title || 'Request cancelled');
  return senderView(doc);
};

const nudge = async (userId, requestId, body) => {
  const doc = await MayaRequest.findOne({ requestId });
  if (!doc || doc.fromUserId !== userId) throw new NotFoundError();
  if (doc.status !== 'open') throw new ConflictError();
  const rid = body.recipientUserId;
  const r = recipientOf(doc, rid);
  if (!r) throw new BadRequestError('No such pending recipient');
  if (r.status !== 'pending') throw new BadRequestError('Recipient already responded');
  const since = r.nudgedAt ? nowMs() - new Date(r.nudgedAt).getTime() : Infinity;
  if (since < NUDGE_INTERVAL_MS) {
    throw new BadRequestError('Nudged recently — wait a bit', 'NUDGE_THROTTLED');
  }
  r.nudgedAt = new Date();
  await doc.save();
  const fromUser = await fetchUser(userId);
  await notify({
    toUserId: rid,
    envelopeType: 'maya_request',
    title: `${firstName(fromUser?.name)} is waiting`,
    body: doc.title || 'A gentle nudge from Maya',
    requestId: doc.requestId,
  });
  return senderView(doc);
};

const nowMs = () => Date.now();

/** Scheduler job: open requests past expiresAt → expired (+ recipients). */
const expireDue = async () => {
  const now = new Date();
  const due = await MayaRequest.find({ status: 'open', expiresAt: { $lte: now } });
  for (const doc of due) {
    doc.status = 'expired';
    doc.recipients.forEach((r) => { if (r.status === 'pending' || r.status === 'suggested') r.status = 'expired'; });
    await doc.save();
    await notify({
      toUserId: doc.fromUserId,
      envelopeType: 'maya_request',
      title: 'Request expired',
      body: doc.title || 'A Maya request expired',
      requestId: doc.requestId,
      silent: true,
    });
  }
  return due.length;
};

module.exports = {
  createRequest,
  listRequests,
  getRequest,
  respond,
  confirm,
  cancel,
  nudge,
  expireDue,
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  _clearUserCache: () => userCache.clear(),
};
