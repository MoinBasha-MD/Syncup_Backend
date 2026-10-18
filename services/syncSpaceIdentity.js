const crypto = require('crypto');
const SyncSpaceProfile = require('../models/SyncSpaceProfile');
const {
  BadRequestError,
  ForbiddenError,
  ServiceUnavailableError,
} = require('../utils/errorClasses');

const MAX_ACTIVATION_ATTEMPTS = 5;

const { EXTRA_IDENTITY_SCOPES, SHARING_POLICIES } = require('./syncSpacePermissions');

const DEFAULT_SHARING_POLICY = {
  phone: 'ask',
  sync_id: 'ask',
  picture: 'allow',
  birthdate: 'ask',
  gender: 'ask',
};

const sharingPolicyOf = (profile) => ({
  ...DEFAULT_SHARING_POLICY,
  ...(profile && profile.sharingPolicy ? profile.sharingPolicy : {}),
});

const generateSyncId = () =>
  `SYNC-${crypto.randomBytes(10).toString('hex').toUpperCase().match(/.{4}/g).join('-')}`;

const profileDto = (profile) => {
  if (!profile) return null;
  return {
    syncId: profile.syncId,
    status: profile.status,
    activatedAt: new Date(profile.activatedAt).toISOString(),
    allowPromotions: profile.allowPromotions === true,
    sharingPolicy: sharingPolicyOf(profile),
  };
};

const requireUserId = (userId) => {
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    throw new BadRequestError('A valid authenticated user id is required');
  }
  return userId;
};

const suspendedError = () => {
  const err = new ForbiddenError('Sync Space is suspended');
  err.code = 'SYNC_SPACE_SUSPENDED';
  return err;
};

const isDuplicateKey = (error) => error && error.code === 11000;

const getProfile = async (userId) => {
  requireUserId(userId);
  return SyncSpaceProfile.findOne({ userId }).lean();
};

const activateProfile = async (userId) => {
  requireUserId(userId);
  const existing = await SyncSpaceProfile.findOne({ userId }).lean();
  if (existing) {
    if (existing.status === 'suspended') throw suspendedError();
    return existing;
  }
  for (let attempt = 0; attempt < MAX_ACTIVATION_ATTEMPTS; attempt += 1) {
    try {
      const profile = await SyncSpaceProfile.findOneAndUpdate(
        { userId },
        {
          $setOnInsert: {
            userId,
            syncId: generateSyncId(),
            activatedAt: new Date(),
            status: 'active',
            allowPromotions: false,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();
      if (!profile) continue;
      if (profile.status === 'suspended') throw suspendedError();
      return profile;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const winner = await SyncSpaceProfile.findOne({ userId }).lean();
      if (winner) {
        if (winner.status === 'suspended') throw suspendedError();
        return winner;
      }
    }
  }
  const err = new ServiceUnavailableError('Could not allocate a Sync ID, please retry');
  err.code = 'SYNC_ID_UNAVAILABLE';
  throw err;
};

const updateSettings = async (userId, body) => {
  requireUserId(userId);
  if (
    body === null ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length === 0 ||
    !Object.keys(body).every((k) => ['allowPromotions', 'sharingPolicy'].includes(k))
  ) {
    throw new BadRequestError('Settings accept allowPromotions and/or sharingPolicy');
  }
  const update = {};
  if (Object.hasOwn(body, 'allowPromotions')) {
    if (typeof body.allowPromotions !== 'boolean') {
      throw new BadRequestError('allowPromotions must be a boolean');
    }
    update.allowPromotions = body.allowPromotions;
  }
  if (Object.hasOwn(body, 'sharingPolicy')) {
    const policy = body.sharingPolicy;
    if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) {
      throw new BadRequestError('sharingPolicy must be an object');
    }
    for (const [field, value] of Object.entries(policy)) {
      if (!EXTRA_IDENTITY_SCOPES.includes(field)) {
        throw new BadRequestError(`Unknown sharing field: ${field}`);
      }
      if (!SHARING_POLICIES.includes(value)) {
        throw new BadRequestError('sharingPolicy values must be allow, ask or never');
      }
      update[`sharingPolicy.${field}`] = value;
    }
  }
  const updated = await SyncSpaceProfile.findOneAndUpdate(
    { userId, status: 'active' },
    { $set: update },
    { new: true, runValidators: true }
  ).lean();
  if (updated) return updated;
  const existing = await SyncSpaceProfile.findOne({ userId }).lean();
  if (existing && existing.status === 'suspended') throw suspendedError();
  const err = new ForbiddenError('Sync Space is not activated');
  err.code = 'SYNC_SPACE_NOT_ACTIVATED';
  throw err;
};

module.exports = {
  generateSyncId,
  profileDto,
  getProfile,
  activateProfile,
  updateSettings,
  DEFAULT_SHARING_POLICY,
  sharingPolicyOf,
};
