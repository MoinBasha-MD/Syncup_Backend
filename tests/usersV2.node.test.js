process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-user-jwt-secret';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const loadWithMocks = (request, mocks) => {
  const modulePath = require.resolve(request);
  const originalLoad = Module._load;
  const cachedModule = require.cache[modulePath];
  delete require.cache[modulePath];
  Module._load = function (id, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
    return originalLoad.call(this, id, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
    if (cachedModule) require.cache[modulePath] = cachedModule;
    else delete require.cache[modulePath];
  }
};

const responseMock = () => ({
  statusCode: 200,
  body: undefined,
  locals: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const noopModel = { find: () => ({ select: () => ({ lean: () => [] }) }), countDocuments: async () => 0, findById: async () => null };

const baseMocks = (user) => ({
  '../../models/userModel': {
    findOne: async () => user,
    findById: async () => null,
    find: () => ({ select: () => ({ sort: () => ({ limit: () => ({ lean: () => [] }) }) }) }),
    countDocuments: async () => 0,
  },
  '../../models/Friend': noopModel,
  '../../models/FeedPost': noopModel,
  '../../models/Ripple': noopModel,
  '../../models/RippleReport': noopModel,
  '../../models/Message': noopModel,
  '../../models/Comment': noopModel,
  '../../models/storyModel': noopModel,
  '../../models/Notification': noopModel,
  '../../models/DeviceSession': { find: () => ({ select: () => ({ lean: () => [] }) }) },
  '../../models/groupMemberModel': { find: () => ({ select: () => ({ lean: () => [] }) }) },
  '../../models/AdminAuditLog': noopModel,
  '../../services/userSessionControl': {
    setAccountState: async (userId, payload) => ({ userId, accountStatus: { state: payload.state, reason: payload.reason, until: payload.until } }),
    forceLogoutUser: async () => 3,
  },
  '../../services/notificationDispatcher': { dispatchNotification: async () => ({}), CATEGORY_COLORS: {} },
});

const reqMock = (over = {}) => ({
  params: {}, query: {}, body: {},
  admin: { _id: 'a1', username: 'root', role: 'admin' },
  adminDevice: { deviceId: 'dev-1' },
  ip: '1.2.3.4',
  headers: {},
  ...over,
});

// requireReason
const { requireReason } = require('../middleware/adminV2Auth');
const callMw = (mw, req) => {
  const res = responseMock();
  let called = false;
  mw(req, res, () => { called = true; });
  return { res, called };
};

test('requireReason: missing/short reason → 400 REASON_REQUIRED', () => {
  for (const reason of [undefined, '', 'ab']) {
    const { res, called } = callMw(requireReason, reqMock({ body: { reason } }));
    assert.equal(called, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'REASON_REQUIRED');
  }
  const { called } = callMw(requireReason, reqMock({ body: { reason: 'valid reason' } }));
  assert.equal(called, true);
});

test('PATCH /users ignores non-allowlisted fields', async () => {
  const saved = {};
  const user = {
    userId: 'u-1', name: 'Old', bio: 'b', email: 'a@x.io', phoneNumber: '12345',
    accountStatus: { state: 'active' },
    save: async function () { Object.assign(saved, this); },
    toObject() { return this; },
  };
  const ctl = loadWithMocks('../controllers/adminV2/usersController', baseMocks(user));
  const req = reqMock({
    params: { userId: 'u-1' },
    body: { name: 'New Name', password: 'hax', isPremium: true, email: 'new@x.io' },
  });
  const res = responseMock();
  await ctl.patchUser(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body.data.updated).sort(), ['email', 'name']);
  assert.equal(user.name, 'New Name');
  assert.equal(user.password, undefined);
  assert.equal(user.isPremium, undefined);
});

test('suspend rejects a past `until`', async () => {
  const user = { userId: 'u-1', accountStatus: { state: 'active' }, toObject() { return this; } };
  const ctl = loadWithMocks('../controllers/adminV2/usersController', baseMocks(user));
  const res = responseMock();
  await ctl.suspendUser(reqMock({
    params: { userId: 'u-1' },
    body: { reason: 'spam', until: new Date(Date.now() - 60000).toISOString() },
  }), res);
  assert.equal(res.statusCode, 400);
});

test('suspend rejects `until` beyond 365 days', async () => {
  const user = { userId: 'u-1', accountStatus: { state: 'active' }, toObject() { return this; } };
  const ctl = loadWithMocks('../controllers/adminV2/usersController', baseMocks(user));
  const res = responseMock();
  await ctl.suspendUser(reqMock({
    params: { userId: 'u-1' },
    body: { reason: 'spam', until: new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString() },
  }), res);
  assert.equal(res.statusCode, 400);
});

test('suspend accepts a valid future `until`', async () => {
  const user = { userId: 'u-1', accountStatus: { state: 'active' }, toObject() { return this; } };
  const ctl = loadWithMocks('../controllers/adminV2/usersController', baseMocks(user));
  const res = responseMock();
  await ctl.suspendUser(reqMock({
    params: { userId: 'u-1' },
    body: { reason: 'spam', until: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.state, 'suspended');
});

test('360 projection never leaks sensitive fields', async () => {
  const user = {
    userId: 'u-1', name: 'N',
    password: 'secret', emailVerificationToken: 't', fcmTokens: [{ token: 'fcm-secret', platform: 'android', lastUsed: new Date() }],
    deviceTokens: [{ token: 'dev-secret', platform: 'android', lastActive: new Date(), isActive: true }],
    encryptionPrivateKey: 'pk', otpSecret: 'otp', recoveryHash: 'h', salt: 's',
    accountStatus: { state: 'active' }, tokenVersion: 2,
    toObject() { return { ...this }; },
  };
  const ctl = loadWithMocks('../controllers/adminV2/usersController', baseMocks(user));
  const res = responseMock();
  await ctl.getUser360(reqMock({ params: { userId: 'u-1' } }), res);
  assert.equal(res.statusCode, 200);
  const serialized = JSON.stringify(res.body.data);
  for (const banned of ['password', 'secret', 'otpSecret', 'encryptionPrivateKey', 'recoveryHash', 'salt', 'fcm-secret', 'dev-secret']) {
    assert.equal(serialized.includes(banned), false, `response leaks ${banned}`);
  }
  // deliberate exceptions
  assert.equal(res.body.data.tokenVersion, 2);
  assert.equal(res.body.data.fcmTokens.count, 1);
});
