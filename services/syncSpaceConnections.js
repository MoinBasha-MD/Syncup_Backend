const crypto = require('crypto');
const SpaceConnectSession = require('../models/SpaceConnectSession');
const SpaceConnection = require('../models/SpaceConnection');
const SpaceMessage = require('../models/SpaceMessage');
const SpacePairingCode = require('../models/SpacePairingCode');
const SyncSpaceProfile = require('../models/SyncSpaceProfile');
const PartnerApp = require('../models/PartnerApp');
const PartnerAccount = require('../models/PartnerAccount');
const OAuthAccessToken = require('../models/OAuthAccessToken');
const OAuthRefreshToken = require('../models/OAuthRefreshToken');
const { decryptSecret, digestSecret, encryptSecret, pairwiseSubject } = require('../utils/syncSpaceCrypto');
const { enqueueConnectionEvent } = require('./partnerWebhooks');
const { MANDATORY_IDENTITY_SCOPES } = require('./syncSpacePermissions');
const {
  ApiError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
} = require('../utils/errorClasses');

const MESSAGE_TYPES = ['message', 'code', 'receipt', 'promotion'];
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const invalidSession = () => {
  const err = new NotFoundError('Connect session is invalid or expired');
  err.code = 'CONNECT_SESSION_INVALID';
  return err;
};

const requireActiveProfile = async (userId) => {
  const profile = await SyncSpaceProfile.findOne({ userId }).lean();
  if (!profile) {
    const err = new ConflictError('Activate Sync Space first');
    err.code = 'SYNC_SPACE_NOT_ACTIVATED';
    throw err;
  }
  if (profile.status === 'suspended') {
    const err = new ForbiddenError('Sync Space is suspended');
    err.code = 'SYNC_SPACE_SUSPENDED';
    throw err;
  }
  return profile;
};

const findPendingSession = async (token) => {
  if (typeof token !== 'string' || token.length === 0 || token.length > 200) {
    throw invalidSession();
  }
  const session = await SpaceConnectSession.findOne({ tokenHash: digestSecret(token) }).lean();
  if (!session || session.status !== 'pending' || session.expiresAt <= new Date()) {
    throw invalidSession();
  }
  return session;
};

// 'paused' = the app can't serve right now (disabled app, suspended partner, or
// a live app whose partner lost approval) — connection itself is untouched.
const connectionDto = (connection, app, partner) => ({
  connectionId: connection.connectionId,
  app: {
    appId: connection.appId,
    name: app ? app.name : '',
    website: app ? app.website : '',
    environment: connection.environment,
  },
  scopes: connection.scopes,
  requiredScopes: connection.requiredScopes || [],
  status: connection.status,
  appState:
    app && app.status === 'active' &&
    partner && partner.approvalStatus !== 'suspended' &&
    !(app.environment === 'live' && partner.approvalStatus !== 'approved')
      ? 'active'
      : 'paused',
  connectedAt: connection.connectedAt,
  revokedAt: connection.revokedAt,
});

const assertSessionUsable = async (session, userId) => {
  const [app, partner] = await Promise.all([
    PartnerApp.findOne({ appId: session.appId }).lean(),
    PartnerAccount.findOne({ partnerId: session.partnerId }).lean(),
  ]);
  const usable =
    app && app.status === 'active' &&
    partner && partner.approvalStatus !== 'suspended' &&
    (app.environment !== 'live' || partner.approvalStatus === 'approved');
  if (!usable) throw invalidSession();
  if (app.environment === 'sandbox' && !app.sandboxUserIds.includes(userId)) {
    const err = new ForbiddenError('This sandbox integration is not shared with your account');
    err.code = 'SANDBOX_TESTER_REQUIRED';
    throw err;
  }
  return { app, partner };
};

const previewConnect = async (userId, token) => {
  const session = await findPendingSession(token);
  const [{ app, partner }, existing] = await Promise.all([
    assertSessionUsable(session, userId),
    SpaceConnection.findOne({ userId, appId: session.appId }).lean(),
  ]);
  return {
    sessionId: session.sessionId,
    app: {
      name: app.name,
      website: app.website,
      environment: app.environment,
      partnerBusinessName: partner.businessName,
    },
    requestedScopes: session.requestedScopes,
    expiresAt: session.expiresAt,
    existingConnection: existing
      ? { scopes: existing.scopes, status: existing.status }
      : null,
  };
};

// Webhook enqueue is best-effort: a delivery failure must never break the
// user-facing connection flow. The worker owns retries.
const tryEnqueueConnectionEvent = async (appId, connection, event) => {
  try {
    await enqueueConnectionEvent({ appId, connection, event });
  } catch {
    // swallow — delivery lifecycle is the worker's responsibility
  }
};

// Shared connection upsert: new connection → consentVersion 1; re-consent → $inc + clears revocation.
// merge: union the granted scopes with any already-granted ones (OAuth consent
// must not drop business scopes the app earned through pairing).
const upsertConnection = async ({ userId, app, scopes, merge = false, requiredScopes }) => {
  const now = new Date();
  const subject = pairwiseSubject(app.appId, userId);
  if (merge) {
    const existing = await SpaceConnection.findOne({ userId, appId: app.appId }).lean();
    if (existing && Array.isArray(existing.scopes)) {
      scopes = [...new Set([...existing.scopes, ...scopes])];
    }
    // Re-consent widens the required snapshot only when the app asks for it.
    if (requiredScopes && existing && Array.isArray(existing.requiredScopes)) {
      requiredScopes = [...new Set([...existing.requiredScopes, ...requiredScopes])];
    }
  }
  const applyUpdate = {
    $set: {
      status: 'active',
      scopes,
      subject,
      connectedAt: now,
      revokedAt: null,
      ...(requiredScopes ? { requiredScopes } : {}),
    },
    $inc: { consentVersion: 1 },
  };
  let connection = await SpaceConnection.findOneAndUpdate(
    { userId, appId: app.appId },
    applyUpdate,
    { new: true }
  );
  if (!connection) {
    try {
      connection = await SpaceConnection.create({
        connectionId: `conn_${crypto.randomBytes(16).toString('hex')}`,
        userId,
        appId: app.appId,
        partnerId: app.partnerId,
        environment: app.environment,
        subject,
        scopes,
        requiredScopes: requiredScopes || [],
        status: 'active',
        consentVersion: 1,
        connectedAt: now,
      });
    } catch (error) {
      if (!error || error.code !== 11000) throw error;
      connection = await SpaceConnection.findOneAndUpdate(
        { userId, appId: app.appId },
        applyUpdate,
        { new: true }
      );
      if (!connection) throw error;
    }
  }
  await tryEnqueueConnectionEvent(app.appId, connection, 'connection.created');
  return connection;
};

const approveConnect = async (userId, token, scopes) => {
  const session = await findPendingSession(token);
  await assertSessionUsable(session, userId);
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new BadRequestError('scopes must be a non-empty subset of the requested scopes');
  }
  const granted = [];
  for (const scope of scopes) {
    if (typeof scope !== 'string' || !session.requestedScopes.includes(scope)) {
      throw new BadRequestError('scopes must be a subset of the requested scopes');
    }
    if (!granted.includes(scope)) granted.push(scope);
  }
  const now = new Date();
  const claimed = await SpaceConnectSession.findOneAndUpdate(
    { sessionId: session.sessionId, status: 'pending', expiresAt: { $gt: now } },
    { $set: { status: 'approved', userId, decidedAt: now } },
    { new: true }
  );
  if (!claimed) throw invalidSession();

  const connection = await upsertConnection({
    userId,
    app: {
      appId: session.appId,
      partnerId: session.partnerId,
      environment: session.environment,
    },
    scopes: granted,
  });
  await SpaceConnectSession.updateOne(
    { sessionId: session.sessionId },
    { $set: { connectionId: connection.connectionId, grantedScopes: granted } }
  );
  return connectionDto(
    connection,
    await PartnerApp.findOne({ appId: session.appId }).lean(),
    await PartnerAccount.findOne({ partnerId: session.partnerId }).lean()
  );
};

const declineConnect = async (userId, token) => {
  const session = await findPendingSession(token);
  const now = new Date();
  const declined = await SpaceConnectSession.findOneAndUpdate(
    { sessionId: session.sessionId, status: 'pending', expiresAt: { $gt: now } },
    { $set: { status: 'declined', userId, decidedAt: now } },
    { new: true }
  );
  if (!declined) throw invalidSession();
  return { status: 'declined' };
};

const listConnections = async (userId) => {
  const connections = await SpaceConnection.find({ userId }).sort({ connectedAt: -1 }).lean();
  if (connections.length === 0) return [];
  const appIds = [...new Set(connections.map((connection) => connection.appId))];
  const apps = await PartnerApp.find({ appId: { $in: appIds } }).lean();
  const appById = new Map(apps.map((app) => [app.appId, app]));
  const partnerIds = [...new Set(connections.map((connection) => connection.partnerId))];
  const partners = await PartnerAccount.find({ partnerId: { $in: partnerIds } }).lean();
  const partnerById = new Map(partners.map((partner) => [partner.partnerId, partner]));
  return connections.map((connection) =>
    connectionDto(connection, appById.get(connection.appId), partnerById.get(connection.partnerId))
  );
};

const revokeConnection = async (userId, connectionId) => {
  const connection = await SpaceConnection.findOne({ connectionId, userId });
  if (!connection) throw new NotFoundError('Connection not found');
  const app = await PartnerApp.findOne({ appId: connection.appId }).lean();
  const partner = await PartnerAccount.findOne({ partnerId: connection.partnerId }).lean();
  if (connection.status === 'revoked') {
    return connectionDto(connection, app, partner);
  }
  const updated = await SpaceConnection.findOneAndUpdate(
    { connectionId, userId, status: 'active' },
    { $set: { status: 'revoked', revokedAt: new Date() } },
    { new: true }
  );
  if (!updated) throw new NotFoundError('Connection not found');
  await tryEnqueueConnectionEvent(updated.appId, updated, 'connection.revoked');
  return connectionDto(updated, app, partner);
};

// Per-app scope narrowing: the user may only remove OPTIONAL extra scopes —
// never mandatory sign-in scopes or scopes the app marked required, and no
// additions. Any change bumps consentVersion and revokes the app's OAuth
// tokens for this user.
const updateConnectionScopes = async (userId, connectionId, scopes) => {
  if (!Array.isArray(scopes) || scopes.length === 0 ||
      !scopes.every((s) => typeof s === 'string')) {
    throw new BadRequestError('scopes must be a non-empty array of strings');
  }
  const connection = await SpaceConnection.findOne({ connectionId, userId });
  if (!connection || connection.status !== 'active') {
    throw new NotFoundError('Connection not found');
  }
  const current = new Set(connection.scopes);
  const removableFloor = new Set([
    ...MANDATORY_IDENTITY_SCOPES,
    ...(connection.requiredScopes || []),
  ]);
  const requested = new Set(scopes);
  for (const scope of requested) {
    if (!current.has(scope)) throw new BadRequestError('Scopes can only be removed, not added');
  }
  for (const scope of current) {
    if (!requested.has(scope) && removableFloor.has(scope)) {
      throw new BadRequestError('This scope is required by the app');
    }
  }
  if (requested.size === current.size && [...requested].every((s) => current.has(s))) {
    const appNow = await PartnerApp.findOne({ appId: connection.appId }).lean();
    const partnerNow = await PartnerAccount.findOne({ partnerId: connection.partnerId }).lean();
    return connectionDto(connection, appNow, partnerNow);
  }
  const updated = await SpaceConnection.findOneAndUpdate(
    { connectionId, userId, status: 'active' },
    { $set: { scopes: scopes.filter((s, i) => scopes.indexOf(s) === i) }, $inc: { consentVersion: 1 } },
    { new: true }
  );
  if (!updated) throw new NotFoundError('Connection not found');
  // Revoke every OAuth token this app holds for the user.
  const revokedAt = new Date();
  await Promise.all([
    OAuthAccessToken.updateMany(
      { userId, appId: connection.appId, revokedAt: null },
      { $set: { revokedAt } }
    ),
    OAuthRefreshToken.updateMany(
      { userId, appId: connection.appId, revokedAt: null },
      { $set: { revokedAt } }
    ),
  ]);
  const app = await PartnerApp.findOne({ appId: connection.appId }).lean();
  const partner = await PartnerAccount.findOne({ partnerId: connection.partnerId }).lean();
  return connectionDto(updated, app, partner);
};

const messageDto = (message, app) => {
  const dto = {
    messageId: message.messageId,
    type: message.type,
    title: message.title,
    body: message.body,
    app: { appId: message.appId, name: app ? app.name : '' },
    environment: message.environment,
    createdAt: message.createdAt,
    readAt: message.readAt,
  };
  if (message.type === 'receipt' && message.receipt) dto.receipt = message.receipt;
  if (message.type === 'code') {
    dto.codeExpiresAt = message.codeExpiresAt;
    dto.codeAvailable = !!message.codeExpiresAt && message.codeExpiresAt > new Date();
  }
  return dto;
};

const encodeCursor = (message) =>
  Buffer.from(JSON.stringify({ createdAt: message.createdAt, _id: message._id })).toString('base64url');

const decodeCursor = (cursor) => {
  if (typeof cursor !== 'string' || !CURSOR_PATTERN.test(cursor) || cursor.length > 200) {
    throw new BadRequestError('Invalid cursor');
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime()) || typeof parsed._id !== 'string' || !OBJECT_ID_PATTERN.test(parsed._id)) {
      throw new Error('bad cursor');
    }
    return { createdAt, _id: parsed._id };
  } catch {
    throw new BadRequestError('Invalid cursor');
  }
};

const listMessages = async (userId, { type, cursor, limit } = {}) => {
  let pageSize = 20;
  if (limit !== undefined && limit !== null && limit !== '') {
    const parsed = Number.parseInt(limit, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50 || String(parsed) !== String(limit).trim()) {
      throw new BadRequestError('limit must be an integer between 1 and 50');
    }
    pageSize = parsed;
  }
  const query = { userId };
  if (type !== undefined && type !== null && type !== '') {
    if (!MESSAGE_TYPES.includes(type)) throw new BadRequestError('Unknown message type');
    query.type = type;
  }
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    const { createdAt, _id } = decodeCursor(cursor);
    query.$or = [
      { createdAt: { $lt: createdAt } },
      { createdAt, _id: { $lt: _id } },
    ];
  }
  const found = await SpaceMessage.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(pageSize + 1)
    .lean();
  const page = found.slice(0, pageSize);
  const hasMore = found.length > pageSize;
  const appIds = [...new Set(page.map((message) => message.appId))];
  const apps = appIds.length
    ? await PartnerApp.find({ appId: { $in: appIds } }).lean()
    : [];
  const appById = new Map(apps.map((app) => [app.appId, app]));
  return {
    messages: page.map((message) => messageDto(message, appById.get(message.appId))),
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
  };
};

// Everspace: per-partner history built from the user's own connections plus
// one aggregation over receipt messages.
const listEverspace = async (userId) => {
  const connections = await SpaceConnection.find({ userId }).lean();
  if (!connections.length) return { partners: [] };
  const rows = await SpaceMessage.aggregate([
    { $match: { userId, type: 'receipt' } },
    {
      $group: {
        _id: { appId: '$appId', currency: '$receipt.currency' },
        count: { $sum: 1 },
        total: { $sum: { $ifNull: ['$receipt.total', '$receipt.amount'] } },
        last: { $max: '$createdAt' },
      },
    },
  ]);
  const stats = {};
  for (const row of rows) {
    const s = stats[row._id.appId] || (stats[row._id.appId] = {
      receiptCount: 0,
      lastActivityAt: null,
      totals: [],
    });
    s.receiptCount += row.count;
    if (row._id.currency) {
      s.totals.push({ currency: row._id.currency, amount: row.total });
    }
    if (!s.lastActivityAt || (row.last && row.last > s.lastActivityAt)) {
      s.lastActivityAt = row.last;
    }
  }
  const appIds = [...new Set(connections.map((c) => c.appId))];
  const apps = await PartnerApp.find({ appId: { $in: appIds } }).lean();
  const appById = new Map(apps.map((app) => [app.appId, app]));
  const partnerIds = [...new Set(connections.map((c) => c.partnerId))];
  const partnerAccounts = await PartnerAccount.find({ partnerId: { $in: partnerIds } }).lean();
  const partnerById = new Map(partnerAccounts.map((p) => [p.partnerId, p]));
  const appStateFor = (conn) => {
    const app = appById.get(conn.appId);
    const partner = partnerById.get(conn.partnerId);
    return app && app.status === 'active' &&
      partner && partner.approvalStatus !== 'suspended' &&
      !(app.environment === 'live' && partner.approvalStatus !== 'approved')
      ? 'active'
      : 'paused';
  };
  const partners = connections.map((conn) => {
    const app = appById.get(conn.appId) || {};
    return {
      connectionId: conn.connectionId,
      app: {
        appId: conn.appId,
        name: app.name || '',
        website: app.website || '',
        environment: conn.environment,
      },
      status: conn.status,
      appState: appStateFor(conn),
      connectedAt: conn.connectedAt,
      stats: stats[conn.appId] || { receiptCount: 0, lastActivityAt: null, totals: [] },
    };
  });
  partners.sort((a, b) => {
    const at = a.stats.lastActivityAt && new Date(a.stats.lastActivityAt).getTime();
    const bt = b.stats.lastActivityAt && new Date(b.stats.lastActivityAt).getTime();
    if (at && bt && at !== bt) return bt - at;
    if (at) return -1;
    if (bt) return 1;
    return new Date(b.connectedAt) - new Date(a.connectedAt);
  });
  return { partners };
};

const listEverspaceReceipts = async (userId, connectionId, { cursor, limit } = {}) => {
  const connection = await SpaceConnection.findOne({ userId, connectionId }).lean();
  if (!connection) throw new NotFoundError('Connection not found');
  let pageSize = 20;
  if (limit !== undefined && limit !== null && limit !== '') {
    const parsed = Number.parseInt(limit, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50 || String(parsed) !== String(limit).trim()) {
      throw new BadRequestError('limit must be an integer between 1 and 50');
    }
    pageSize = parsed;
  }
  const query = { userId, appId: connection.appId, type: 'receipt' };
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    const { createdAt, _id } = decodeCursor(cursor);
    query.$or = [
      { createdAt: { $lt: createdAt } },
      { createdAt, _id: { $lt: _id } },
    ];
  }
  const found = await SpaceMessage.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(pageSize + 1)
    .lean();
  const page = found.slice(0, pageSize);
  const hasMore = found.length > pageSize;
  const app = await PartnerApp.findOne({ appId: connection.appId }).lean();
  return {
    receipts: page.map((message) => messageDto(message, app)),
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null,
  };
};

const unreadCount = async (userId) => {
  const unread = await SpaceMessage.countDocuments({ userId, readAt: null });
  return { unread };
};

const markAllRead = async (userId, { type } = {}) => {
  const query = { userId, readAt: null };
  if (type) {
    if (!MESSAGE_TYPES.includes(type)) throw new BadRequestError('Unknown message type');
    query.type = type;
  }
  const result = await SpaceMessage.updateMany(query, { $set: { readAt: new Date() } });
  return { unread: 0, marked: result.modifiedCount || 0 };
};

const markMessageRead = async (userId, messageId) => {
  const updated = await SpaceMessage.findOneAndUpdate(
    { messageId, userId, readAt: null },
    { $set: { readAt: new Date() } },
    { new: true }
  );
  if (updated) return messageDto(updated, null);
  const existing = await SpaceMessage.findOne({ messageId, userId }).lean();
  if (!existing) throw new NotFoundError('Message not found');
  return messageDto(existing, null);
};

const revealMessageCode = async (userId, messageId) => {
  const message = await SpaceMessage.findOne({ messageId, userId }).select('+codeEncrypted');
  if (!message || message.type !== 'code') throw new NotFoundError('Message not found');
  if (!message.codeExpiresAt || message.codeExpiresAt <= new Date()) {
    const err = new ApiError('This code has expired', 410);
    err.code = 'CODE_EXPIRED';
    throw err;
  }
  return {
    code: decryptSecret(message.codeEncrypted, `code:${message.messageId}`),
    expiresAt: message.codeExpiresAt,
  };
};

const QR_PAIR_PREFIX = 'syncspace:pair:';
const QR_PAIR_TTL_MS = 5 * 60 * 1000;
const QR_PAIR_HOURLY_LIMIT = 20;

const createPairingQr = async (userId) => {
  const count = await SpacePairingCode.countDocuments({
    userId,
    kind: 'qr',
    createdAt: { $gt: new Date(Date.now() - 60 * 60 * 1000) },
  });
  if (count >= QR_PAIR_HOURLY_LIMIT) {
    const err = new TooManyRequestsError('Too many pairing codes, try later');
    err.code = 'RATE_LIMITED';
    throw err;
  }
  await SpacePairingCode.updateMany(
    { userId, kind: 'qr', status: 'pending' },
    { $set: { expiresAt: new Date() } }
  );
  const token = crypto.randomBytes(24).toString('base64url');
  const doc = await SpacePairingCode.create({
    kind: 'qr',
    userId,
    status: 'pending',
    codeHash: digestSecret(token),
    expiresAt: new Date(Date.now() + QR_PAIR_TTL_MS),
  });
  return { qrPayload: `${QR_PAIR_PREFIX}${token}`, pairingId: doc.pairingId, expiresAt: doc.expiresAt };
};

// Owner-only status check so the mobile "Connect QR" modal can react the moment
// a business scans the code.
const getPairingQrStatus = async (userId, pairingId) => {
  const doc = await SpacePairingCode.findOne({ pairingId, userId, kind: 'qr' }).lean();
  if (!doc) throw new NotFoundError('Pairing code not found');
  let status = doc.status;
  if (status === 'pending' && doc.expiresAt <= new Date()) status = 'expired';
  const result = { status };
  if (status === 'consumed' && doc.appId) {
    const app = await PartnerApp.findOne({ appId: doc.appId }).lean();
    if (app) {
      result.app = { name: app.name, website: app.website, environment: app.environment };
    }
  }
  return result;
};

const listPairingRequests = async (userId) => {
  const docs = await SpacePairingCode.find({
    userId,
    kind: 'otp',
    status: 'pending',
    expiresAt: { $gt: new Date() },
  }).select('+codeEncrypted').lean();
  if (docs.length === 0) return [];
  const apps = await PartnerApp.find({ appId: { $in: docs.map((d) => d.appId) } }).lean();
  const byId = new Map(apps.map((app) => [app.appId, app]));
  return docs.map((doc) => ({
    pairingId: doc.pairingId,
    app: (() => {
      const app = byId.get(doc.appId);
      return {
        name: app ? app.name : '',
        website: app ? app.website : '',
        environment: app ? app.environment : 'sandbox',
      };
    })(),
    code: doc.codeEncrypted ? decryptSecret(doc.codeEncrypted, `pair:${doc.pairingId}`) : '',
    expiresAt: doc.expiresAt,
  }));
};

const declinePairingRequest = async (userId, pairingId) => {
  const updated = await SpacePairingCode.findOneAndUpdate(
    { pairingId, userId, kind: 'otp', status: 'pending' },
    { $set: { status: 'declined' } },
    { new: true }
  );
  if (!updated) throw new NotFoundError('Pairing request not found');
  return { status: 'declined' };
};

// Removes every Sync Space artifact for a user (account deletion path).
// Connections are revoked — not deleted — so partners still receive their
// connection.revoked webhooks before the data ages out.
const purgeSyncSpaceUser = async (userId) => {
  const connections = await SpaceConnection.find({ userId }).lean();
  await SpaceConnection.updateMany(
    { userId, status: 'active' },
    { $set: { status: 'revoked', revokedAt: new Date() } }
  );
  for (const connection of connections.filter((c) => c.status === 'active')) {
    await tryEnqueueConnectionEvent(
      connection.appId,
      { ...connection, status: 'revoked' },
      'connection.revoked'
    );
  }
  const [profiles, messages, pairings] = await Promise.all([
    SyncSpaceProfile.deleteMany({ userId }),
    SpaceMessage.deleteMany({ userId }),
    SpacePairingCode.deleteMany({ userId }),
  ]);
  return {
    connections: connections.length,
    revoked: connections.filter((c) => c.status === 'active').length,
    deletedProfiles: profiles.deletedCount || 0,
    deletedMessages: messages.deletedCount || 0,
    deletedPairings: pairings.deletedCount || 0,
  };
};

module.exports = {
  requireActiveProfile,
  previewConnect,
  approveConnect,
  declineConnect,
  listConnections,
  revokeConnection,
  updateConnectionScopes,
  listMessages,
  unreadCount,
  markAllRead,
  getPairingQrStatus,
  listEverspace,
  listEverspaceReceipts,
  markMessageRead,
  revealMessageCode,
  upsertConnection,
  createPairingQr,
  listPairingRequests,
  declinePairingRequest,
  purgeSyncSpaceUser,
  messageDto,
  connectionDto,
};
