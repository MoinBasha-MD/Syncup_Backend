const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const PartnerAccount = require('../models/PartnerAccount');
const PartnerApp = require('../models/PartnerApp');
const PartnerApiKey = require('../models/PartnerApiKey');
const PartnerEmailChallenge = require('../models/PartnerEmailChallenge');
const PartnerWebhookDelivery = require('../models/PartnerWebhookDelivery');
const SpaceConnection = require('../models/SpaceConnection');
const emailService = require('./emailService');
const SyncSpaceProfile = require('../models/SyncSpaceProfile');
const { ALL_SCOPES, BUSINESS_SCOPES } = require('./syncSpacePermissions');
const { encryptSecret, digestSecret } = require('../utils/syncSpaceCrypto');
const { validateWebhookUrl, generateWebhookSecret } = require('./partnerWebhooks');
const {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
} = require('../utils/errorClasses');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHALLENGE_ID_PATTERN = /^[a-f0-9]{64}$/i;
const API_KEY_PATTERN = /^sk_(test|live)_([a-f0-9]{12})\.([A-Za-z0-9_-]{43})$/;
const CODE_PATTERN = /^\d{6}$/;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const CHALLENGE_MAX_ATTEMPTS = 5;
const CHALLENGE_RESEND_COOLDOWN_MS = 60 * 1000;
const CHALLENGE_MAX_PER_HOUR = 5;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const API_KEY_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_REDIRECT_URIS = 10;
const BLOCKED_NATIVE_SCHEMES = new Set(['javascript', 'data', 'file', 'syncup', 'http', 'https']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DUMMY_PASSWORD_HASH = '$2b$12$KIXy3sGHwVjzj5FmdrBQRu2yQn0n5n0Z2c4XoYj6H9y6mVQ0n0n0W';

const REVIEW_TRANSITIONS = {
  approve: { from: 'pending', to: 'approved' },
  reject: { from: 'pending', to: 'rejected' },
  suspend: { from: 'approved', to: 'suspended' },
  restore: { from: 'suspended', to: 'approved' },
};

const normalizeEmail = (email) => {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
};

const requireString = (value, field, { min = 1, max = 500 } = {}) => {
  if (typeof value !== 'string') throw new BadRequestError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new BadRequestError(`${field} must be between ${min} and ${max} characters`);
  }
  return trimmed;
};

const optionalUrl = (value, field, { allowLoopbackHttp = false } = {}) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 500) {
    throw new BadRequestError(`${field} must be a string of at most 500 characters`);
  }
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new BadRequestError(`${field} must be a valid URL`);
  }
  const isHttps = parsed.protocol === 'https:';
  const isLoopback = parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname);
  if (!isHttps && !(allowLoopbackHttp && isLoopback)) {
    throw new BadRequestError(`${field} must use HTTPS`);
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new BadRequestError(`${field} must not contain credentials or fragments`);
  }
  return parsed.toString();
};

const isLoopbackHttp = (url) =>
  url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);

const validateRedirectUris = (uris, applicationType, environment) => {
  if (applicationType === 'service') return [];
  if (!Array.isArray(uris) || uris.length === 0) {
    throw new BadRequestError('At least one redirect URI is required');
  }
  if (uris.length > MAX_REDIRECT_URIS) {
    throw new BadRequestError(`At most ${MAX_REDIRECT_URIS} redirect URIs are allowed`);
  }
  const seen = new Set();
  return uris.map((raw) => {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 500) {
      throw new BadRequestError('Each redirect URI must be a string of at most 500 characters');
    }
    let parsed;
    try {
      parsed = new URL(raw.trim());
    } catch {
      throw new BadRequestError('Redirect URIs must be valid absolute URIs');
    }
    if (parsed.hash) throw new BadRequestError('Redirect URIs must not contain fragments');
    if (parsed.username || parsed.password) {
      throw new BadRequestError('Redirect URIs must not contain userinfo');
    }
    let normalized;
    if (applicationType === 'web') {
      if (parsed.protocol === 'https:') {
        normalized = parsed.toString();
      } else if (environment === 'sandbox' && isLoopbackHttp(parsed)) {
        normalized = parsed.toString();
      } else {
        throw new BadRequestError('Web redirect URIs must use HTTPS (loopback HTTP is allowed in sandbox only)');
      }
    } else if (parsed.protocol === 'https:') {
      normalized = parsed.toString();
    } else if (isLoopbackHttp(parsed)) {
      if (environment !== 'sandbox') {
        throw new BadRequestError('Loopback HTTP callbacks are only allowed in sandbox');
      }
      normalized = parsed.toString();
    } else {
      const scheme = parsed.protocol.slice(0, -1).toLowerCase();
      if (BLOCKED_NATIVE_SCHEMES.has(scheme) || !scheme.includes('.')) {
        throw new BadRequestError('Native callback schemes must be reverse-DNS custom schemes or HTTPS');
      }
      normalized = raw.trim();
    }
    if (seen.has(normalized)) throw new BadRequestError('Duplicate redirect URIs are not allowed');
    seen.add(normalized);
    return normalized;
  });
};

const validateScopes = (scopes, { allowIdentity = false } = {}) => {
  if (scopes === undefined || scopes === null) return [];
  if (!Array.isArray(scopes)) throw new BadRequestError('scopes must be an array');
  const allowed = allowIdentity ? ALL_SCOPES : BUSINESS_SCOPES;
  const result = [];
  for (const scope of scopes) {
    if (typeof scope !== 'string' || !allowed.includes(scope)) {
      throw new BadRequestError(`Unsupported scope: ${typeof scope === 'string' ? scope.slice(0, 40) : 'value'}`);
    }
    if (!result.includes(scope)) result.push(scope);
  }
  return result;
};

const requireVerifiedPartner = (partner) => {
  if (!partner) throw new NotFoundError('Partner account not found');
  if (partner.approvalStatus === 'suspended') {
    const err = new ForbiddenError('Partner account is suspended');
    err.code = 'PARTNER_SUSPENDED';
    throw err;
  }
  if (!partner.emailVerifiedAt) {
    const err = new ForbiddenError('Verify your email address to continue');
    err.code = 'PARTNER_EMAIL_UNVERIFIED';
    throw err;
  }
  return partner;
};

const partnerDto = (partner) => {
  if (!partner) return null;
  return {
    partnerId: partner.partnerId,
    email: partner.email,
    businessName: partner.businessName,
    website: partner.website,
    emailVerified: !!partner.emailVerifiedAt,
    approvalStatus: partner.approvalStatus,
    reviewVersion: partner.reviewVersion,
    reviewReason: partner.reviewReason,
    requestedAt: partner.requestedAt,
    createdAt: partner.createdAt,
  };
};

const appDto = (app) => {
  if (!app) return null;
  return {
    appId: app.appId,
    name: app.name,
    kind: app.kind,
    applicationType: app.applicationType,
    environment: app.environment,
    website: app.website,
    requestedScopes: app.requestedScopes,
    redirectUris: app.redirectUris,
    status: app.status,
    secretVersion: app.secretVersion,
    hasClientSecret: !!app.clientSecretEncrypted,
    sandboxUserIds: app.sandboxUserIds,
    webhookUrl: app.webhookUrl || '',
    hasWebhookSecret: !!app.webhookSecretEncrypted,
    createdAt: app.createdAt,
  };
};

const apiKeyDto = (key) => {
  if (!key) return null;
  return {
    keyId: key.keyId,
    name: key.name,
    environment: key.environment,
    scopes: key.scopes,
    expiresAt: key.expiresAt,
    revokedAt: key.revokedAt,
    lastUsedAt: key.lastUsedAt,
    createdAt: key.createdAt,
  };
};

const issueChallenge = async (partner, purpose) => {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const recent = await PartnerEmailChallenge
    .find({ partnerId: partner.partnerId, purpose, sentAt: { $gt: hourAgo } })
    .sort({ sentAt: -1 })
    .select('sentAt')
    .lean();
  if (recent.length >= CHALLENGE_MAX_PER_HOUR) {
    throw new TooManyRequestsError('Too many codes requested, please try again later');
  }
  if (recent[0] && recent[0].sentAt > new Date(now.getTime() - CHALLENGE_RESEND_COOLDOWN_MS)) {
    throw new TooManyRequestsError('Please wait before requesting another code');
  }
  await PartnerEmailChallenge.updateMany(
    { partnerId: partner.partnerId, purpose, consumedAt: null },
    { $set: { consumedAt: now } }
  );
  const code = String(crypto.randomInt(100000, 1000000));
  const challenge = await PartnerEmailChallenge.create({
    partnerId: partner.partnerId,
    purpose,
    codeHash: await bcrypt.hash(code, 12),
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
    attempts: 0,
    sentAt: now,
  });
  const sendResult = await emailService.sendOTP(
    partner.email,
    code,
    purpose === 'reset' ? 'partner_password_reset' : 'partner_verification'
  );
  return { challengeId: challenge.challengeId, sent: !!(sendResult && sendResult.success) };
};

const consumeChallenge = async (challengeId, purpose, code) => {
  if (typeof challengeId !== 'string' || !CHALLENGE_ID_PATTERN.test(challengeId)) {
    throw new BadRequestError('Invalid or expired code');
  }
  if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
    throw new BadRequestError('Invalid or expired code');
  }
  const now = new Date();
  const challenge = await PartnerEmailChallenge.findOneAndUpdate(
    {
      challengeId,
      purpose,
      consumedAt: null,
      attempts: { $lt: CHALLENGE_MAX_ATTEMPTS },
      expiresAt: { $gt: now },
    },
    { $inc: { attempts: 1 } },
    { new: true }
  ).select('+codeHash');
  if (!challenge) throw new BadRequestError('Invalid or expired code');
  const matches = await bcrypt.compare(code, challenge.codeHash);
  if (!matches) throw new BadRequestError('Invalid or expired code');
  const consumed = await PartnerEmailChallenge.findOneAndUpdate(
    { _id: challenge._id, consumedAt: null },
    { $set: { consumedAt: new Date() } },
    { new: true }
  );
  if (!consumed) throw new BadRequestError('Invalid or expired code');
  return challenge.partnerId;
};

const createPartner = async (input) => {
  const { email, password, businessName, website } = input || {};
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new BadRequestError('A valid email address is required');
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new BadRequestError(`Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters`);
  }
  const name = requireString(businessName, 'businessName', { min: 1, max: 120 });
  const site = optionalUrl(website, 'website');
  const existing = await PartnerAccount.findOne({ email: normalizedEmail }).select('_id').lean();
  if (existing) throw new ConflictError('An account with this email already exists');
  const account = await PartnerAccount.create({
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(password, 12),
    businessName: name,
    website: site,
    approvalStatus: 'sandbox',
  });
  const { challengeId, sent } = await issueChallenge(account, 'verify');
  return { partner: partnerDto(account), challengeId, emailSent: sent };
};

const resendChallenge = async (input) => {
  const { challengeId, purpose = 'verify' } = input || {};
  if (purpose !== 'verify' && purpose !== 'reset') throw new BadRequestError('Invalid request');
  if (typeof challengeId !== 'string' || !CHALLENGE_ID_PATTERN.test(challengeId)) {
    throw new BadRequestError('Invalid or expired challenge');
  }
  const last = await PartnerEmailChallenge.findOne({ challengeId, purpose }).lean();
  if (!last) throw new BadRequestError('Invalid or expired challenge');
  const partner = await PartnerAccount.findOne({ partnerId: last.partnerId });
  if (!partner) throw new BadRequestError('Invalid or expired challenge');
  if (purpose === 'verify' && partner.emailVerifiedAt) {
    return { challengeId: null, sent: false, alreadyVerified: true };
  }
  return issueChallenge(partner, purpose);
};

const requestVerificationEmail = async (partnerId) => {
  const partner = await PartnerAccount.findOne({ partnerId });
  if (!partner) throw new NotFoundError('Partner account not found');
  if (partner.emailVerifiedAt) return { challengeId: null, alreadyVerified: true };
  return issueChallenge(partner, 'verify');
};

const verifyPartnerEmail = async (input) => {
  const { challengeId, code } = input || {};
  const partnerId = await consumeChallenge(challengeId, 'verify', code);
  const partner = await PartnerAccount.findOneAndUpdate(
    { partnerId, emailVerifiedAt: null },
    { $set: { emailVerifiedAt: new Date() } },
    { new: true }
  );
  if (partner) return partnerDto(partner);
  const existing = await PartnerAccount.findOne({ partnerId });
  if (!existing) throw new NotFoundError('Partner account not found');
  return partnerDto(existing);
};

const requestPasswordReset = async (email) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: true };
  const account = await PartnerAccount.findOne({ email: normalized });
  if (!account) return { ok: true };
  try {
    await issueChallenge(account, 'reset');
  } catch (error) {
    if (!(error instanceof TooManyRequestsError)) throw error;
  }
  return { ok: true };
};

const resetPassword = async (input) => {
  const { challengeId, code, password } = input || {};
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new BadRequestError(`Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters`);
  }
  const partnerId = await consumeChallenge(challengeId, 'reset', code);
  const account = await PartnerAccount.findOneAndUpdate(
    { partnerId },
    {
      $set: { passwordHash: await bcrypt.hash(password, 12), failedLoginAttempts: 0, lockUntil: null },
      $inc: { sessionVersion: 1 },
    },
    { new: true }
  );
  if (!account) throw new NotFoundError('Partner account not found');
  return partnerDto(account);
};

const authenticatePartner = async (email, password) => {
  const normalized = normalizeEmail(email);
  const account = normalized
    ? await PartnerAccount.findOne({ email: normalized }).select('+passwordHash')
    : null;
  if (account && account.lockUntil && account.lockUntil > new Date()) {
    throw new TooManyRequestsError('Too many failed attempts, please try again later');
  }
  const candidate = typeof password === 'string' ? password : '';
  const matches = await bcrypt.compare(candidate, account ? account.passwordHash : DUMMY_PASSWORD_HASH);
  if (!account || !matches) {
    if (account) {
      const now = Date.now();
      const prior = account.lockUntil && account.lockUntil.getTime() <= now
        ? 0
        : (account.failedLoginAttempts || 0);
      const update = { $set: { failedLoginAttempts: prior + 1 } };
      if (prior + 1 >= LOGIN_MAX_ATTEMPTS) {
        update.$set.failedLoginAttempts = 0;
        update.$set.lockUntil = new Date(now + LOGIN_LOCK_MS);
      } else if (account.lockUntil) {
        update.$set.lockUntil = null;
      }
      await PartnerAccount.updateOne({ _id: account._id }, update);
    }
    throw new UnauthorizedError('Invalid email or password');
  }
  if (account.failedLoginAttempts || account.lockUntil) {
    await PartnerAccount.updateOne(
      { _id: account._id },
      { $set: { failedLoginAttempts: 0, lockUntil: null } }
    );
  }
  return account;
};

const getPartner = async (partnerId) => {
  if (typeof partnerId !== 'string' || partnerId.length === 0) {
    throw new BadRequestError('Invalid partner id');
  }
  return partnerDto(await PartnerAccount.findOne({ partnerId }));
};

const requireOwnedApp = async (partner, appId, { selectSecret = false, selectWebhook = false } = {}) => {
  if (typeof appId !== 'string' || !/^sp_[a-f0-9]{32}$/.test(appId)) {
    throw new NotFoundError('Integration not found');
  }
  let query = PartnerApp.findOne({ appId, partnerId: partner.partnerId });
  if (selectSecret) query = query.select('+clientSecretEncrypted');
  if (selectWebhook) query = query.select('+webhookSecretEncrypted');
  const app = await query;
  if (!app) throw new NotFoundError('Integration not found');
  return app;
};

const createApp = async (partnerId, body = {}) => {
  const partner = requireVerifiedPartner(await PartnerAccount.findOne({ partnerId }));
  const name = requireString(body.name, 'name', { min: 1, max: 100 });
  const kind = requireString(body.kind, 'kind', { max: 20 });
  if (!['business', 'app'].includes(kind)) throw new BadRequestError('kind must be business or app');
  const applicationType = requireString(body.applicationType, 'applicationType', { max: 20 });
  if (!['service', 'web', 'native'].includes(applicationType)) {
    throw new BadRequestError('applicationType must be service, web, or native');
  }
  let environment = 'sandbox';
  if (body.environment !== undefined && body.environment !== null && body.environment !== '') {
    if (body.environment !== 'sandbox' && body.environment !== 'live') {
      throw new BadRequestError('environment must be sandbox or live');
    }
    environment = body.environment;
  }
  if (environment === 'live' && partner.approvalStatus !== 'approved') {
    const err = new ForbiddenError('Production access requires an approved partner account');
    err.code = 'PARTNER_NOT_APPROVED';
    throw err;
  }
  const website = optionalUrl(body.website, 'website');
  const requestedScopes = validateScopes(body.requestedScopes, { allowIdentity: true });
  const redirectUris = validateRedirectUris(body.redirectUris, applicationType, environment);
  const appId = `sp_${crypto.randomBytes(16).toString('hex')}`;
  const doc = {
    appId,
    partnerId: partner.partnerId,
    name,
    kind,
    applicationType,
    environment,
    website,
    requestedScopes,
    redirectUris,
    status: 'active',
    sandboxUserIds: [],
  };
  let clientSecret = null;
  if (applicationType === 'web') {
    clientSecret = crypto.randomBytes(32).toString('base64url');
    doc.clientSecretEncrypted = encryptSecret(clientSecret, `client:${appId}`);
  }
  const app = await PartnerApp.create(doc);
  return { app: appDto(app), clientSecret };
};

const updateApp = async (partnerId, appId, body = {}) => {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('Invalid update payload');
  }
  const blocked = ['environment', 'kind', 'applicationType', 'appId', 'partnerId', 'status',
    'clientSecret', 'clientSecretEncrypted', 'secretVersion', 'sandboxUserIds', '_id'];
  for (const key of Object.keys(body)) {
    if (blocked.includes(key)) throw new BadRequestError(`${key} cannot be updated here`);
    if (!['name', 'website', 'redirectUris', 'requestedScopes'].includes(key)) {
      throw new BadRequestError(`Unknown field: ${key}`);
    }
  }
  const partner = requireVerifiedPartner(await PartnerAccount.findOne({ partnerId }));
  const app = await requireOwnedApp(partner, appId);
  const update = {};
  if (Object.hasOwn(body, 'name')) update.name = requireString(body.name, 'name', { min: 1, max: 100 });
  if (Object.hasOwn(body, 'website')) update.website = optionalUrl(body.website, 'website');
  const metadataChanged =
    Object.hasOwn(body, 'redirectUris') || Object.hasOwn(body, 'requestedScopes');
  if (Object.hasOwn(body, 'redirectUris')) {
    update.redirectUris = validateRedirectUris(body.redirectUris, app.applicationType, app.environment);
  }
  if (Object.hasOwn(body, 'requestedScopes')) {
    update.requestedScopes = validateScopes(body.requestedScopes, { allowIdentity: true });
  }
  if (Object.keys(update).length === 0) return appDto(app);
  const updated = await PartnerApp.findOneAndUpdate(
    { appId, partnerId: partner.partnerId },
    metadataChanged
      ? { $set: update, $inc: { secretVersion: 1 } }
      : { $set: update },
    { new: true, runValidators: true }
  );
  return appDto(updated);
};

const getApp = async (partnerId, appId) => {
  const partner = await PartnerAccount.findOne({ partnerId });
  if (!partner) throw new NotFoundError('Partner account not found');
  return appDto(await requireOwnedApp(partner, appId, { selectWebhook: true }));
};

const getPartnerPortalDetail = async (partnerId) => {
  if (typeof partnerId !== 'string' || partnerId.length === 0) {
    throw new BadRequestError('Invalid partner id');
  }
  const partner = await PartnerAccount.findOne({ partnerId }).lean();
  if (!partner) throw new NotFoundError('Partner account not found');
  return {
    ...partnerDto(partner),
    useCase: partner.useCase,
    privacyPolicyUrl: partner.privacyPolicyUrl,
    reviewHistory: (partner.reviewHistory || []).map((entry) => ({
      action: entry.action,
      reason: entry.reason,
      at: entry.at,
    })),
  };
};

const listApps = async (partnerId) => {
  const partner = await PartnerAccount.findOne({ partnerId }).lean();
  if (!partner) throw new NotFoundError('Partner account not found');
  const apps = await PartnerApp.find({ partnerId }).sort({ createdAt: -1 }).lean();
  return apps.map(appDto);
};

const disableApp = async (partnerId, appId) => {
  const partner = requireVerifiedPartner(await PartnerAccount.findOne({ partnerId }));
  await requireOwnedApp(partner, appId);
  const updated = await PartnerApp.findOneAndUpdate(
    { appId, partnerId: partner.partnerId },
    { $set: { status: 'disabled' } },
    { new: true }
  );
  return appDto(updated);
};

const createApiKey = async (partnerId, appId, options) => {
  const { name, scopes } = options || {};
  const partner = requireVerifiedPartner(await PartnerAccount.findOne({ partnerId }));
  const app = await requireOwnedApp(partner, appId);
  if (app.status !== 'active') {
    const err = new ForbiddenError('This integration is disabled');
    err.code = 'PARTNER_APP_DISABLED';
    throw err;
  }
  if (app.environment === 'live' && partner.approvalStatus !== 'approved') {
    const err = new ForbiddenError('Production credentials require an approved partner account');
    err.code = 'PARTNER_NOT_APPROVED';
    throw err;
  }
  const keyName = name === undefined || name === null || name === ''
    ? 'Default key'
    : requireString(name, 'name', { min: 1, max: 80 });
  const keyScopes = validateScopes(scopes === undefined ? app.requestedScopes : scopes);
  if (keyScopes.length === 0) {
    throw new BadRequestError('At least one business scope is required');
  }
  for (const scope of keyScopes) {
    if (!app.requestedScopes.includes(scope)) {
      throw new BadRequestError(`Scope ${scope} is not requested by this integration`);
    }
  }
  const keyId = `sk_${app.environment === 'live' ? 'live' : 'test'}_${crypto.randomBytes(6).toString('hex')}`;
  const token = `${keyId}.${crypto.randomBytes(32).toString('base64url')}`;
  const record = await PartnerApiKey.create({
    keyId,
    partnerId: partner.partnerId,
    appId: app.appId,
    environment: app.environment,
    name: keyName,
    secretHash: digestSecret(token),
    scopes: keyScopes,
    expiresAt: new Date(Date.now() + API_KEY_TTL_MS),
  });
  return { key: token, record: apiKeyDto(record) };
};

const listApiKeys = async (partnerId, appId) => {
  const partner = requireVerifiedPartner(await PartnerAccount.findOne({ partnerId }));
  await requireOwnedApp(partner, appId);
  const keys = await PartnerApiKey.find({ partnerId, appId }).sort({ createdAt: -1 }).lean();
  return keys.map(apiKeyDto);
};

const revokeApiKey = async (partnerId, keyId) => {
  if (typeof partnerId !== 'string' || typeof keyId !== 'string') {
    throw new BadRequestError('Invalid request');
  }
  const updated = await PartnerApiKey.findOneAndUpdate(
    { keyId, partnerId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { new: true }
  );
  if (!updated) throw new NotFoundError('Credential not found');
  return apiKeyDto(updated);
};

const rotateClientSecret = async (partnerId, appId) => {
  const partner = requireVerifiedPartner(await PartnerAccount.findOne({ partnerId }));
  const app = await requireOwnedApp(partner, appId);
  if (app.applicationType !== 'web') {
    throw new BadRequestError('Only web integrations have client secrets');
  }
  const clientSecret = crypto.randomBytes(32).toString('base64url');
  const updated = await PartnerApp.findOneAndUpdate(
    { appId, partnerId: partner.partnerId },
    {
      $set: { clientSecretEncrypted: encryptSecret(clientSecret, `client:${app.appId}`) },
      $inc: { secretVersion: 1 },
    },
    { new: true }
  );
  if (!updated) throw new NotFoundError('Integration not found');
  return { clientSecret, app: appDto(updated) };
};

const SYNC_ID_PATTERN_SERVICE = /^SYNC-(?:[A-F0-9]{4}-){4}[A-F0-9]{4}$/;

const requireSandboxApp = async (partner, appId) => {
  const app = await requireOwnedApp(partner, appId);
  if (app.environment !== 'sandbox') {
    throw new ForbiddenError('Test users only exist on sandbox integrations');
  }
  return app;
};

const listSandboxTesters = async (partnerId, appId) => {
  const partner = requireVerifiedPartner(await PartnerAccount.findOne({ partnerId }));
  const app = await requireSandboxApp(partner, appId);
  if (!app.sandboxUserIds.length) return [];
  const profiles = await SyncSpaceProfile.find({
    userId: { $in: app.sandboxUserIds },
  }).lean();
  const syncIdByUser = new Map(profiles.map((profile) => [profile.userId, profile.syncId]));
  return app.sandboxUserIds
    .map((userId) => syncIdByUser.get(userId))
    .filter(Boolean);
};

const addSandboxTester = async (partnerId, appId, syncId) => {
  const partner = requireVerifiedPartner(await PartnerAccount.findOne({ partnerId }));
  const app = await requireSandboxApp(partner, appId);
  if (typeof syncId !== 'string' || !SYNC_ID_PATTERN_SERVICE.test(syncId.trim())) {
    throw new BadRequestError('A valid Sync ID is required');
  }
  const profile = await SyncSpaceProfile.findOne({ syncId: syncId.trim(), status: 'active' }).lean();
  if (!profile) throw new NotFoundError('No active Sync Space profile uses that Sync ID');
  if (app.sandboxUserIds.includes(profile.userId)) {
    return listSandboxTesters(partnerId, appId);
  }
  if (app.sandboxUserIds.length >= 20) {
    throw new BadRequestError('At most 20 test users per sandbox integration');
  }
  const updated = await PartnerApp.findOneAndUpdate(
    { appId, partnerId: partner.partnerId, 'sandboxUserIds.19': { $exists: false } },
    { $addToSet: { sandboxUserIds: profile.userId } },
    { new: true }
  );
  if (!updated) throw new ConflictError('Tester list changed, please retry');
  return listSandboxTesters(partnerId, appId);
};

const removeSandboxTester = async (partnerId, appId, syncId) => {
  const partner = requireVerifiedPartner(await PartnerAccount.findOne({ partnerId }));
  await requireSandboxApp(partner, appId);
  if (typeof syncId !== 'string' || !SYNC_ID_PATTERN_SERVICE.test(syncId.trim())) {
    throw new BadRequestError('A valid Sync ID is required');
  }
  const profile = await SyncSpaceProfile.findOne({ syncId: syncId.trim() }).lean();
  if (profile) {
    await PartnerApp.updateOne(
      { appId, partnerId: partner.partnerId },
      { $pull: { sandboxUserIds: profile.userId } }
    );
  }
  return listSandboxTesters(partnerId, appId);
};

const authenticateApiKey = async (rawToken) => {
  const match = typeof rawToken === 'string' ? rawToken.match(API_KEY_PATTERN) : null;
  if (!match) throw new UnauthorizedError('Invalid API key');
  const keyId = `sk_${match[1]}_${match[2]}`;
  const record = await PartnerApiKey.findOne({ keyId }).select('+secretHash');
  const now = new Date();
  const usable = record && !record.revokedAt && record.expiresAt > now;
  const digest = digestSecret(rawToken);
  const valid = usable && crypto.timingSafeEqual(
    Buffer.from(digest),
    Buffer.from(record.secretHash)
  );
  if (!valid) throw new UnauthorizedError('Invalid API key');
  const [app, partner] = await Promise.all([
    PartnerApp.findOne({ appId: record.appId }).lean(),
    PartnerAccount.findOne({ partnerId: record.partnerId }).lean(),
  ]);
  if (!app || !partner || app.status !== 'active' || partner.approvalStatus === 'suspended') {
    throw new UnauthorizedError('Invalid API key');
  }
  if (record.environment === 'live' && partner.approvalStatus !== 'approved') {
    throw new UnauthorizedError('Invalid API key');
  }
  await PartnerApiKey.updateOne({ _id: record._id }, { $set: { lastUsedAt: now } });
  return { partner: partnerDto(partner), app: appDto(app), key: apiKeyDto(record) };
};

const requestProduction = async (partnerId, input) => {
  const { useCase, privacyPolicyUrl } = input || {};
  if (typeof partnerId !== 'string' || partnerId.length === 0) {
    throw new BadRequestError('Invalid partner id');
  }
  const text = requireString(useCase, 'useCase', { min: 5, max: 2000 });
  const policy = optionalUrl(privacyPolicyUrl, 'privacyPolicyUrl');
  if (!policy) throw new BadRequestError('A privacy policy URL is required');
  const now = new Date();
  const updated = await PartnerAccount.findOneAndUpdate(
    {
      partnerId,
      approvalStatus: { $in: ['sandbox', 'rejected'] },
      emailVerifiedAt: { $ne: null },
    },
    {
      $set: {
        approvalStatus: 'pending',
        useCase: text,
        privacyPolicyUrl: policy,
        requestedAt: now,
        reviewReason: '',
      },
      $inc: { reviewVersion: 1 },
      $push: { reviewHistory: { action: 'requested', reason: '', actorKeyId: null, actorLabel: '', at: now } },
    },
    { new: true }
  );
  if (!updated) {
    const current = await PartnerAccount.findOne({ partnerId });
    if (!current) throw new NotFoundError('Partner account not found');
    if (!current.emailVerifiedAt) {
      const err = new ForbiddenError('Verify your email address to continue');
      err.code = 'PARTNER_EMAIL_UNVERIFIED';
      throw err;
    }
    const err = new ConflictError('This account is not eligible for a production request');
    err.code = 'PARTNER_INVALID_TRANSITION';
    throw err;
  }
  return partnerDto(updated);
};

const reviewPartner = async (admin, partnerId, input) => {
  const { decision, reason, expectedVersion } = input || {};
  const transition = REVIEW_TRANSITIONS[decision];
  if (!transition) throw new BadRequestError('decision must be approve, reject, suspend, or restore');
  const text = requireString(reason, 'reason', { min: 5, max: 1000 });
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw new BadRequestError('expectedVersion must be a non-negative integer');
  }
  const actorKeyId = admin && admin.keyId;
  if (!actorKeyId) throw new UnauthorizedError('Admin authentication required');
  const now = new Date();
  const updated = await PartnerAccount.findOneAndUpdate(
    {
      partnerId,
      approvalStatus: transition.from,
      reviewVersion: expectedVersion,
      emailVerifiedAt: { $ne: null },
    },
    {
      $set: { approvalStatus: transition.to, reviewReason: text },
      $inc: { reviewVersion: 1 },
      $push: {
        reviewHistory: {
          action: decision,
          reason: text,
          actorKeyId: String(actorKeyId),
          actorLabel: String(admin.label || ''),
          at: now,
        },
      },
    },
    { new: true }
  );
  if (!updated) {
    const current = await PartnerAccount.findOne({ partnerId });
    if (!current) throw new NotFoundError('Partner account not found');
    const err = new ConflictError(
      current.approvalStatus !== transition.from
        ? `Cannot ${decision} an account in status ${current.approvalStatus}`
        : 'This account changed since you loaded it, reload and try again'
    );
    err.code = 'PARTNER_REVIEW_CONFLICT';
    throw err;
  }
  // Confirmation email is best-effort — a mail outage must never fail a review.
  try {
    await emailService.sendPartnerDecision(updated.email, {
      businessName: updated.businessName,
      decision,
      reason: text,
    });
  } catch {
    // swallowed
  }
  return partnerDto(updated);
};

const listPartnersAdmin = async ({ status, page = 1, limit = 20, q, sort } = {}) => {
  const filter = {};
  if (status && status !== 'all') {
    if (!['sandbox', 'pending', 'approved', 'rejected', 'suspended'].includes(status)) {
      throw new BadRequestError('Unknown status filter');
    }
    filter.approvalStatus = status;
  }
  const query = typeof q === 'string' ? q.trim().slice(0, 120) : '';
  if (query) {
    const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ businessName: rx }, { email: rx }];
  }
  const direction = sort === 'oldest' ? 1 : -1;
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 50 ? limit : 20;
  const [items, total] = await Promise.all([
    PartnerAccount.find(filter).sort({ requestedAt: direction, createdAt: direction })
      .skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    PartnerAccount.countDocuments(filter),
  ]);
  // Status counts for the filter tabs — one aggregation, ignored on error.
  let counts = {};
  try {
    const rows = await PartnerAccount.aggregate([
      { $group: { _id: '$approvalStatus', n: { $sum: 1 } } },
    ]);
    for (const row of rows) counts[row._id] = row.n;
  } catch {
    counts = {};
  }
  return {
    items: items.map((partner) => ({
      ...partnerDto(partner),
      useCase: partner.useCase,
      requestedAt: partner.requestedAt,
    })),
    total,
    counts,
    q: query,
    sort: direction === 1 ? 'oldest' : 'newest',
    page: safePage,
    pages: Math.max(1, Math.ceil(total / safeLimit)),
  };
};

const getPartnerAdminDetail = async (partnerId) => {
  if (typeof partnerId !== 'string' || partnerId.length === 0) {
    throw new BadRequestError('Invalid partner id');
  }
  const partner = await PartnerAccount.findOne({ partnerId }).lean();
  if (!partner) throw new NotFoundError('Partner account not found');
  const apps = await PartnerApp.find({ partnerId }).sort({ createdAt: -1 }).lean();
  return {
    partner: {
      ...partnerDto(partner),
      emailVerifiedAt: partner.emailVerifiedAt,
      useCase: partner.useCase,
      privacyPolicyUrl: partner.privacyPolicyUrl,
      reviewHistory: (partner.reviewHistory || []).map((entry) => ({
        action: entry.action,
        reason: entry.reason,
        actorKeyId: entry.actorKeyId,
        actorLabel: entry.actorLabel,
        at: entry.at,
      })),
    },
    apps: apps.map(appDto),
  };
};

// ---- Webhook config + customer connections --------------------------------

const setWebhookUrl = async (partnerId, appId, rawUrl) => {
  const partner = await PartnerAccount.findOne({ partnerId });
  if (!partner) throw new NotFoundError('Partner account not found');
  const app = await requireOwnedApp(partner, appId);
  const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (url === '') {
    app.webhookUrl = '';
  } else {
    app.webhookUrl = validateWebhookUrl(url).toString();
  }
  await app.save();
  return appDto(app);
};

const rotateWebhookSecret = async (partnerId, appId) => {
  const partner = await PartnerAccount.findOne({ partnerId });
  if (!partner) throw new NotFoundError('Partner account not found');
  const app = await requireOwnedApp(partner, appId);
  const secret = generateWebhookSecret();
  app.webhookSecretEncrypted = encryptSecret(secret, `webhook:${appId}`);
  await app.save();
  return { secret, app: appDto(app) };
};

// "Customers" — the pairwise subjects this app is connected to. Never userId.
const listAppConnections = async (partnerId, appId, { cursor, limit = 25 } = {}) => {
  const partner = await PartnerAccount.findOne({ partnerId });
  if (!partner) throw new NotFoundError('Partner account not found');
  await requireOwnedApp(partner, appId);
  const pageSize = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 50);
  const query = { appId };
  if (cursor) {
    if (typeof cursor !== 'string' || !/^[a-f0-9]{24}$/i.test(cursor)) {
      throw new BadRequestError('Invalid cursor');
    }
    query._id = { $lt: cursor };
  }
  const docs = await SpaceConnection.find(query).sort({ _id: -1 }).limit(pageSize + 1).lean();
  const items = docs.slice(0, pageSize).map((c) => ({
    subject: c.subject,
    scopes: c.scopes,
    status: c.status,
    connectedAt: c.connectedAt,
    revokedAt: c.revokedAt,
    cursor: String(c._id),
  }));
  const activeCount = await SpaceConnection.countDocuments({ appId, status: 'active' });
  return {
    items,
    activeCount,
    nextCursor: docs.length > pageSize ? String(docs[pageSize - 1]._id) : null,
  };
};

const listWebhookDeliveries = async (partnerId, appId, { limit = 20 } = {}) => {
  const partner = await PartnerAccount.findOne({ partnerId });
  if (!partner) throw new NotFoundError('Partner account not found');
  await requireOwnedApp(partner, appId);
  const docs = await PartnerWebhookDelivery.find({ appId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50))
    .lean();
  return docs.map((d) => ({
    deliveryId: d.deliveryId,
    event: d.event,
    status: d.status,
    attempts: d.attempts,
    lastError: d.lastError,
    createdAt: d.createdAt,
  }));
};

module.exports = {
  createPartner,
  verifyPartnerEmail,
  resendChallenge,
  requestVerificationEmail,
  authenticatePartner,
  getPartner,
  createApp,
  updateApp,
  getApp,
  getPartnerPortalDetail,
  listApps,
  disableApp,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateClientSecret,
  addSandboxTester,
  removeSandboxTester,
  listSandboxTesters,
  authenticateApiKey,
  requestProduction,
  reviewPartner,
  listPartnersAdmin,
  getPartnerAdminDetail,
  requestPasswordReset,
  resetPassword,
  setWebhookUrl,
  rotateWebhookSecret,
  listAppConnections,
  listWebhookDeliveries,
  partnerDto,
  appDto,
  apiKeyDto,
};
