const crypto = require('crypto');
const SpaceConnectSession = require('../models/SpaceConnectSession');
const SpaceConnection = require('../models/SpaceConnection');
const SpaceMessage = require('../models/SpaceMessage');
const SpacePairingCode = require('../models/SpacePairingCode');
const SyncSpaceProfile = require('../models/SyncSpaceProfile');
const User = require('../models/userModel');
const { BUSINESS_SCOPES } = require('./syncSpacePermissions');
const { encryptSecret, digestSecret } = require('../utils/syncSpaceCrypto');
const { upsertConnection } = require('./syncSpaceConnections');
const { dispatchNotification } = require('./notificationDispatcher');
const {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} = require('../utils/errorClasses');

const SESSION_TTL_MS = 10 * 60 * 1000;
const SESSION_ID_PATTERN = /^cs_[a-f0-9]{32}$/;
const SUBJECT_PATTERN = /^sub_[A-Za-z0-9_-]{32}$/;
const MESSAGE_ID_PREFIX = 'msg_';
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const CODE_PATTERN = /^[A-Za-z0-9]{4,10}$/;
const MESSAGE_TYPES = ['message', 'code', 'receipt', 'promotion'];
const TYPE_SCOPES = Object.freeze({
  message: 'space.messages',
  code: 'space.codes',
  receipt: 'space.receipts',
  promotion: 'space.promotions',
});
const MESSAGE_BODY_KEYS = new Set(['subject', 'type', 'title', 'body', 'code', 'expiresInSeconds', 'receipt']);
const SESSION_BODY_KEYS = new Set(['scopes']);

const insufficientScope = () => {
  const err = new ForbiddenError('API key lacks the required scope');
  err.code = 'INSUFFICIENT_SCOPE';
  return err;
};

const connectionNotFound = () => {
  const err = new NotFoundError('No active connection for this subject');
  err.code = 'CONNECTION_NOT_FOUND';
  return err;
};

const rejectExtraKeys = (body, allowed, label) => {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError(`${label} must be an object`);
  }
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw new BadRequestError(`Unknown field: ${key}`);
  }
};

const createConnectSession = async ({ app, key }, body) => {
  rejectExtraKeys(body, SESSION_BODY_KEYS, 'Request body');
  const scopes = body.scopes;
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new BadRequestError('scopes must be a non-empty array');
  }
  const requested = [];
  for (const scope of scopes) {
    if (typeof scope !== 'string' || !BUSINESS_SCOPES.includes(scope)) {
      throw new BadRequestError('scopes must only contain Sync Space business scopes');
    }
    if (!app.requestedScopes.includes(scope)) {
      throw new BadRequestError(`Scope ${scope} is not requested by this integration`);
    }
    if (requested.includes(scope)) throw new BadRequestError('Duplicate scopes are not allowed');
    requested.push(scope);
  }
  if (!key.scopes.some((scope) => BUSINESS_SCOPES.includes(scope))) {
    throw insufficientScope();
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await SpaceConnectSession.create({
    tokenHash: digestSecret(token),
    appId: app.appId,
    partnerId: app.partnerId,
    environment: app.environment,
    requestedScopes: requested,
    expiresAt,
  });
  return {
    sessionId: session.sessionId,
    token,
    connectUrl: `syncup://sync-space/connect?token=${encodeURIComponent(token)}`,
    expiresAt,
  };
};

const getConnectSession = async (appId, sessionId) => {
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new NotFoundError('Connect session not found');
  }
  const session = await SpaceConnectSession.findOne({ sessionId, appId }).lean();
  if (!session) throw new NotFoundError('Connect session not found');
  const now = new Date();
  if (session.status === 'pending' && session.expiresAt <= now) {
    return { status: 'expired', expiresAt: session.expiresAt };
  }
  const result = {
    status: session.status,
    expiresAt: session.expiresAt,
  };
  if (session.status === 'approved' && session.connectionId) {
    const connection = await SpaceConnection.findOne({ connectionId: session.connectionId }).lean();
    if (connection) {
      result.subject = connection.subject;
      result.grantedScopes = session.grantedScopes;
    }
  }
  return result;
};

const connectionDto = (connection) => ({
  subject: connection.subject,
  status: connection.status,
  scopes: connection.scopes,
  connectedAt: connection.connectedAt,
  revokedAt: connection.revokedAt,
});

const getConnectionBySubject = async (appId, subject) => {
  if (typeof subject !== 'string' || !SUBJECT_PATTERN.test(subject)) {
    throw new NotFoundError('Connection not found');
  }
  const connection = await SpaceConnection.findOne({ appId, subject }).lean();
  if (!connection) throw new NotFoundError('Connection not found');
  return connectionDto(connection);
};

const requireString = (value, field, { min = 0, max = 500 } = {}) => {
  if (typeof value !== 'string') throw new BadRequestError(`${field} must be a string`);
  if (value.length < min || value.length > max) {
    throw new BadRequestError(`${field} must be between ${min} and ${max} characters`);
  }
  return value;
};

const validateReceipt = (receipt) => {
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new BadRequestError('receipt must be an object');
  }
  for (const key of Object.keys(receipt)) {
    if (!['amount', 'currency', 'reference', 'items', 'orderedAt', 'storeName', 'tax', 'total'].includes(key)) {
      throw new BadRequestError(`Unknown receipt field: ${key}`);
    }
  }
  if (typeof receipt.amount !== 'number' || !Number.isFinite(receipt.amount) || receipt.amount < 0) {
    throw new BadRequestError('receipt.amount must be a non-negative number');
  }
  requireString(receipt.currency, 'receipt.currency', { min: 3, max: 3 });
  if (!/^[A-Z]{3}$/.test(receipt.currency)) {
    throw new BadRequestError('receipt.currency must be an ISO 4217 code');
  }
  const result = {
    amount: receipt.amount,
    currency: receipt.currency,
    reference: '',
    items: [],
  };
  if (receipt.orderedAt !== undefined) {
    const ordered = new Date(receipt.orderedAt);
    if (typeof receipt.orderedAt !== 'string' || Number.isNaN(ordered.getTime())) {
      throw new BadRequestError('receipt.orderedAt must be an ISO date');
    }
    const now = Date.now();
    if (ordered.getTime() > now + 5 * 60 * 1000) {
      throw new BadRequestError('receipt.orderedAt cannot be in the future');
    }
    if (ordered.getTime() < now - 2 * 365 * 24 * 60 * 60 * 1000) {
      throw new BadRequestError('receipt.orderedAt is too old');
    }
    result.orderedAt = ordered;
  }
  if (receipt.storeName !== undefined) {
    result.storeName = requireString(receipt.storeName, 'receipt.storeName', { min: 1, max: 120 });
  }
  if (receipt.tax !== undefined) {
    if (typeof receipt.tax !== 'number' || !Number.isFinite(receipt.tax) || receipt.tax < 0) {
      throw new BadRequestError('receipt.tax must be a non-negative number');
    }
    result.tax = receipt.tax;
  }
  if (receipt.total !== undefined) {
    if (typeof receipt.total !== 'number' || !Number.isFinite(receipt.total) || receipt.total < 0) {
      throw new BadRequestError('receipt.total must be a non-negative number');
    }
    result.total = receipt.total;
  }
  if (receipt.reference !== undefined) {
    result.reference = requireString(receipt.reference, 'receipt.reference', { max: 100 });
  }
  if (receipt.items !== undefined) {
    if (!Array.isArray(receipt.items) || receipt.items.length > 50) {
      throw new BadRequestError('receipt.items must be an array of at most 50 items');
    }
    result.items = receipt.items.map((item, index) => {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        throw new BadRequestError(`receipt.items[${index}] must be an object`);
      }
      for (const key of Object.keys(item)) {
        if (!['name', 'quantity', 'amount'].includes(key)) {
          throw new BadRequestError(`Unknown receipt item field: ${key}`);
        }
      }
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) {
        throw new BadRequestError(`receipt.items[${index}].quantity must be an integer 1-999`);
      }
      if (typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount < 0) {
        throw new BadRequestError(`receipt.items[${index}].amount must be a non-negative number`);
      }
      return {
        name: requireString(item.name, `receipt.items[${index}].name`, { min: 1, max: 120 }),
        quantity: item.quantity,
        amount: item.amount,
      };
    });
  }
  return result;
};

const notifyMessage = async ({ app, connection, message }) => {
  try {
    await dispatchNotification({
      toUserId: connection.userId,
      fromUserId: 'sync-space',
      type: 'sync_space_message',
      category: 'system',
      title: app.name,
      body: message.type === 'code' ? 'You received a verification code' : message.title,
      action: { screen: 'Home', params: { screen: 'SocialSpace' } },
      data: { kind: 'sync_space_message', messageId: message.messageId, appId: app.appId },
    });
  } catch (error) {
    console.error('sync-space message notification failed:', error.message);
  }
};

const sendMessage = async ({ app, key }, body, idempotencyKey) => {
  rejectExtraKeys(body, MESSAGE_BODY_KEYS, 'Request body');
  const subject = requireString(body.subject, 'subject', { min: 1, max: 64 });
  if (!SUBJECT_PATTERN.test(subject)) throw new BadRequestError('subject is invalid');
  const type = body.type;
  if (typeof type !== 'string' || !MESSAGE_TYPES.includes(type)) {
    throw new BadRequestError(`type must be one of: ${MESSAGE_TYPES.join(', ')}`);
  }
  const requiredScope = TYPE_SCOPES[type];
  if (!key.scopes.includes(requiredScope)) throw insufficientScope();

  const title = requireString(body.title, 'title', { min: 1, max: 120 });
  let text = '';
  if (body.body !== undefined) {
    text = requireString(body.body, 'body', { max: 2000 });
  }

  let code;
  let codeExpiresAt;
  if (type === 'code') {
    code = requireString(body.code, 'code', { min: 4, max: 10 });
    if (!CODE_PATTERN.test(code)) throw new BadRequestError('code must be 4-10 alphanumeric characters');
    let seconds = 300;
    if (body.expiresInSeconds !== undefined) {
      if (!Number.isInteger(body.expiresInSeconds) || body.expiresInSeconds < 60 || body.expiresInSeconds > 900) {
        throw new BadRequestError('expiresInSeconds must be an integer between 60 and 900');
      }
      seconds = body.expiresInSeconds;
    }
    codeExpiresAt = new Date(Date.now() + seconds * 1000);
  } else if (body.code !== undefined || body.expiresInSeconds !== undefined) {
    throw new BadRequestError('code and expiresInSeconds are only valid for type code');
  }

  let receipt;
  if (type === 'receipt') {
    if (body.receipt === undefined) throw new BadRequestError('receipt is required for type receipt');
    receipt = validateReceipt(body.receipt);
  } else if (body.receipt !== undefined) {
    throw new BadRequestError('receipt is only valid for type receipt');
  }

  if (idempotencyKey !== undefined) {
    if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
      throw new BadRequestError('Idempotency-Key must be 8-100 characters of [A-Za-z0-9_-]');
    }
  }

  const connection = await SpaceConnection.findOne({
    appId: app.appId,
    subject,
    status: 'active',
    environment: app.environment,
  });
  if (!connection || !connection.scopes.includes(requiredScope)) {
    throw connectionNotFound();
  }
  const profile = await SyncSpaceProfile.findOne({ userId: connection.userId }).lean();
  if (!profile || profile.status !== 'active' || (type === 'promotion' && !profile.allowPromotions)) {
    throw connectionNotFound();
  }
  if (app.environment === 'sandbox' && !app.sandboxUserIds.includes(connection.userId)) {
    throw connectionNotFound();
  }

  const messageId = `${MESSAGE_ID_PREFIX}${crypto.randomBytes(16).toString('hex')}`;
  try {
    const message = await SpaceMessage.create({
      messageId,
      userId: connection.userId,
      appId: app.appId,
      partnerId: app.partnerId,
      connectionId: connection.connectionId,
      environment: app.environment,
      type,
      title,
      body: text,
      codeEncrypted: code ? encryptSecret(code, `code:${messageId}`) : undefined,
      codeExpiresAt,
      expireAt: type === 'code'
        ? new Date(codeExpiresAt.getTime() + 24 * 60 * 60 * 1000)
        : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      receipt,
      idempotencyKey: idempotencyKey || undefined,
    });
    await notifyMessage({ app, connection, message });
    return { messageId, createdAt: message.createdAt, duplicated: false };
  } catch (error) {
    if (error && error.code === 11000 && idempotencyKey) {
      const existing = await SpaceMessage.findOne({ appId: app.appId, idempotencyKey }).lean();
      if (existing) {
        return { messageId: existing.messageId, createdAt: existing.createdAt, duplicated: true };
      }
    }
    throw error;
  }
};

// ---- Pairing (QR + OTP fallback) ----------------------------------------

const QR_PAIR_PREFIX = 'syncspace:pair:';
const PAIRING_TTL_MS = 5 * 60 * 1000;
const PAIRING_BASE_SCOPES = ['space.messages', 'space.codes', 'space.receipts'];
const SYNC_ID_PATTERN = /^SYNC-(?:[A-F0-9]{4}-){4}[A-F0-9]{4}$/i;
const PAIRING_ID_PATTERN = /^pr_[a-f0-9]{16}$/;
const OTP_PATTERN = /^\d{6}$/;

const pairingInvalid = () => {
  const err = new NotFoundError('Pairing code is invalid or expired');
  err.code = 'PAIRING_INVALID';
  return err;
};

const pairingCodeInvalid = () => {
  const err = new BadRequestError('Pairing code is invalid');
  err.code = 'PAIRING_CODE_INVALID';
  return err;
};

// Rules shared by QR claim and OTP verify: active profile + sandbox tester membership.
const checkPairTarget = async (app, userId, invalidError = pairingInvalid) => {
  const profile = await SyncSpaceProfile.findOne({ userId }).lean();
  if (!profile || profile.status !== 'active') throw invalidError();
  if (app.environment === 'sandbox' && !app.sandboxUserIds.includes(userId)) {
    throw invalidError();
  }
  return profile;
};

// Granted scopes = key business scopes ∩ app.requestedScopes ∩ {messages,codes,receipts}
// plus space.promotions only when also requested AND the user opted into offers.
const pairingScopesFor = (key, app, profile) => {
  const allowed = (key.scopes || []).filter(
    (scope) => BUSINESS_SCOPES.includes(scope) && (app.requestedScopes || []).includes(scope)
  );
  const scopes = allowed.filter((scope) => PAIRING_BASE_SCOPES.includes(scope));
  if (allowed.includes('space.promotions') && profile.allowPromotions) {
    scopes.push('space.promotions');
  }
  if (scopes.length === 0) {
    throw new BadRequestError('No grantable permissions for pairing');
  }
  return scopes;
};

const notifyPaired = async ({ app, userId }) => {
  try {
    await dispatchNotification({
      toUserId: userId,
      fromUserId: 'sync-space',
      type: 'sync_space_connected',
      category: 'system',
      title: 'Sync Space',
      body: `You're now connected to ${app.name}`,
      action: { screen: 'Home', params: { screen: 'SocialSpace' } },
      data: { kind: 'sync_space_connected', appId: app.appId },
    });
  } catch {
    // notification failures must not fail pairing
  }
};

const pairByQr = async (credentials, qrPayload) => {
  const { app, key } = credentials;
  const token = typeof qrPayload === 'string' && qrPayload.startsWith(QR_PAIR_PREFIX)
    ? qrPayload.slice(QR_PAIR_PREFIX.length)
    : null;
  if (!token || token.length > 120) throw pairingInvalid();
  const pairing = await SpacePairingCode.findOne({ codeHash: digestSecret(token), kind: 'qr' }).lean();
  if (!pairing || pairing.status !== 'pending' || pairing.expiresAt <= new Date() || !pairing.userId) {
    throw pairingInvalid();
  }
  // Eligibility runs before the claim so a failed check never burns the code.
  const profile = await checkPairTarget(app, pairing.userId, pairingInvalid);
  const claimed = await SpacePairingCode.findOneAndUpdate(
    { _id: pairing._id, status: 'pending', expiresAt: { $gt: new Date() } },
    { $set: { status: 'consumed', consumedAt: new Date(), appId: app.appId } },
    { new: true }
  );
  if (!claimed) throw pairingInvalid();
  const scopes = pairingScopesFor(key, app, profile);
  const connection = await upsertConnection({ userId: pairing.userId, app, scopes });
  await notifyPaired({ app, userId: pairing.userId });
  return { subject: connection.subject, scopes: connection.scopes, connectedAt: connection.connectedAt };
};

const createDecoyPairing = async (app, expiresAt) => {
  const doc = await SpacePairingCode.create({
    kind: 'otp',
    appId: app.appId,
    userId: null,
    expiresAt,
  });
  return doc;
};

const requestOtpPairing = async (credentials, identifier) => {
  const { app } = credentials;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
  const decoy = async () => {
    const doc = await createDecoyPairing(app, expiresAt);
    return { pairingId: doc.pairingId, expiresAt };
  };

  // Resolve the identifier — every miss produces an indistinguishable decoy.
  let userId = null;
  const text = typeof identifier === 'string' ? identifier.trim() : '';
  if (SYNC_ID_PATTERN.test(text)) {
    const profile = await SyncSpaceProfile.findOne({ syncId: text.toUpperCase(), status: 'active' }).lean();
    userId = profile ? profile.userId : null;
  } else {
    const user = await User.findOne({ username: text.toLowerCase() }).lean();
    if (user && user.userId) {
      const profile = await SyncSpaceProfile.findOne({ userId: user.userId, status: 'active' }).lean();
      userId = profile ? profile.userId : null;
    }
  }
  if (!userId) return decoy();
  if (app.environment === 'sandbox' && !app.sandboxUserIds.includes(userId)) return decoy();

  // Per-target caps still answer 202 — just without a real code or notification.
  const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000);
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const perApp = await SpacePairingCode.countDocuments({
    userId,
    appId: app.appId,
    kind: 'otp',
    status: 'pending',
    createdAt: { $gt: fifteenMinAgo },
  });
  if (perApp >= 3) return decoy();
  const perUser = await SpacePairingCode.countDocuments({
    userId,
    kind: 'otp',
    createdAt: { $gt: hourAgo },
  });
  if (perUser >= 10) return decoy();

  const pairingId = `pr_${crypto.randomBytes(8).toString('hex')}`;
  const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  const doc = await SpacePairingCode.create({
    pairingId,
    kind: 'otp',
    userId,
    appId: app.appId,
    codeHash: digestSecret(`${pairingId}:${code}`),
    codeEncrypted: encryptSecret(code, `pair:${pairingId}`),
    expiresAt,
  });
  try {
    await dispatchNotification({
      toUserId: userId,
      fromUserId: 'sync-space',
      type: 'sync_space_pairing',
      category: 'system',
      title: 'Sync Space',
      body: `${app.name} wants to connect. Open Sync Space to see the code.`,
      action: { screen: 'Home', params: { screen: 'SocialSpace' } },
      data: { kind: 'sync_space_pairing', pairingId: doc.pairingId, appId: app.appId },
    });
  } catch {
    // best effort only
  }
  return { pairingId: doc.pairingId, expiresAt };
};

const verifyOtpPairing = async (credentials, pairingId, code) => {
  const { app, key } = credentials;
  if (!PAIRING_ID_PATTERN.test(pairingId) || !OTP_PATTERN.test(code)) {
    throw pairingCodeInvalid();
  }
  const attempt = await SpacePairingCode.findOneAndUpdate(
    {
      pairingId,
      appId: app.appId,
      kind: 'otp',
      status: 'pending',
      expiresAt: { $gt: new Date() },
      userId: { $ne: null },
      attempts: { $lt: 5 },
    },
    { $inc: { attempts: 1 } },
    { new: true }
  ).select('+codeHash');
  if (!attempt) {
    await SpacePairingCode.updateOne(
      { pairingId, appId: app.appId, status: 'pending', attempts: { $gte: 5 } },
      { $set: { status: 'locked' } }
    );
    throw pairingCodeInvalid();
  }
  const given = Buffer.from(digestSecret(`${pairingId}:${code}`), 'hex');
  const stored = Buffer.from(attempt.codeHash || '', 'hex');
  if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) {
    throw pairingCodeInvalid();
  }
  const claimed = await SpacePairingCode.findOneAndUpdate(
    { pairingId: attempt.pairingId, status: 'pending' },
    { $set: { status: 'consumed', consumedAt: new Date() } },
    { new: true }
  );
  if (!claimed) throw pairingCodeInvalid();
  const profile = await checkPairTarget(app, attempt.userId, pairingInvalid);
  const scopes = pairingScopesFor(key, app, profile);
  const connection = await upsertConnection({ userId: attempt.userId, app, scopes });
  await notifyPaired({ app, userId: attempt.userId });
  return { subject: connection.subject, scopes: connection.scopes, connectedAt: connection.connectedAt };
};

module.exports = {
  TYPE_SCOPES,
  createConnectSession,
  getConnectSession,
  getConnectionBySubject,
  sendMessage,
  pairByQr,
  requestOtpPairing,
  verifyOtpPairing,
};
