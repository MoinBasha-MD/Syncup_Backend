process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-user-jwt-secret';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { generateSecret, generateSync } = require('otplib');

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

const { getAdminJwtSecret, ADMIN_JWT_AUDIENCE } = require('../config/adminSecrets');
const { encrypt, sha256hex, randomToken } = require('../utils/adminCrypto');

const responseMock = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const findRoute = (routerArg, path, method) =>
  routerArg.stack.find(layer =>
    layer.route?.path === path && layer.route.methods[method]);

const invoke = async (routerArg, path, method, req) => {
  const layer = findRoute(routerArg, path, method);
  assert.ok(layer, `route ${method} ${path} not found`);
  const res = responseMock();
  const handlers = layer.route.stack.map(s => s.handle);
  for (const handler of handlers) {
    let nextCalled = false;
    let nextError;
    await Promise.resolve(handler(req, res, (e) => { nextCalled = true; nextError = e; }));
    if (nextError) throw nextError;
    if (res.body !== undefined) return res; // handler responded
    void nextCalled;
  }
  return res;
};

const makeDeviceKey = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    publicKeyBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey,
  };
};

const signPayload = (privateKey, payload) =>
  crypto.sign('RSA-SHA256', Buffer.from(payload, 'utf8'), privateKey).toString('base64');

const totpSecret = generateSecret();
const deviceKey = makeDeviceKey();

const makeAdmin = (over = {}) => ({
  _id: 'admin-1',
  username: 'root',
  email: 'root@x.io',
  role: 'owner',
  isActive: true,
  tokenVersion: 0,
  loginAttempts: 0,
  devices: [],
  totp: { enabled: true, secretEnc: encrypt(totpSecret), recoveryCodes: [sha256hex('AAAA-BBBB-CCCC')] },
  enrollment: {},
  lockUntil: undefined,
  isLocked() { return !!(this.lockUntil && this.lockUntil > Date.now()); },
  comparePassword: async (pw) => pw === 'correct-password',
  incLoginAttempts: async function () {
    this.loginAttempts += 1;
    if (this.loginAttempts >= 5) this.lockUntil = Date.now() + 2 * 60 * 60 * 1000;
  },
  resetLoginAttempts: async function () { this.loginAttempts = 0; this.lockUntil = undefined; },
  async save() { return this; },
  ...over,
});

const sessions = [];
const adminState = { doc: makeAdmin() };

// Query-like thenable supporting await / .select() / .lean()
const queryResult = (value) =>
  Object.assign(Promise.resolve(value), {
    select: () => Promise.resolve(value),
    lean: () => Promise.resolve(value),
  });

// No-op rate-limiter stubs (identity matters for the wiring test)
const passThrough = () => (req, res, next) => next();
const STUB_AUTH = passThrough();
const STUB_MFA = passThrough();
const STUB_SESSION = passThrough();
const limiterMocks = {
  authLimiter: STUB_AUTH,
  adminMfaLimiter: STUB_MFA,
  adminSessionLimiter: STUB_SESSION,
};

const mocks = () => ({
  '../../middleware/rateLimiter': limiterMocks,
  '../../models/Admin': {
    findOne: () => queryResult(adminState.doc),
    findById: () => queryResult(adminState.doc),
  },
  '../../models/AdminSession': {
    create: async (doc) => { const s = { _id: `sess-${sessions.length}`, ...doc }; sessions.push(s); return s; },
    findOne: (q) => queryResult(sessions.find(s => s.refreshHash === q.refreshHash) || null),
    findById: async (id) => sessions.find(s => String(s._id) === String(id)) || null,
    findByIdAndUpdate: async (id, u) => {
      const s = sessions.find(x => String(x._id) === String(id));
      if (s && u.$set) Object.assign(s, u.$set);
      return s;
    },
    updateMany: async (q, u) => {
      let n = 0;
      for (const s of sessions) {
        if (s.familyId === q.familyId && !s.revokedAt) { Object.assign(s, u.$set); n++; }
      }
      return { modifiedCount: n };
    },
  },
  '../../services/adminAudit': { recordAdminAction: async () => ({}) },
  '../../services/adminSocket': { emitAdminEvent: () => {} },
});

const reqMock = (body, headers = {}) => ({
  body,
  headers,
  ip: '1.2.3.4',
});

test('login: wrong password returns INVALID_CREDENTIALS and increments lockout', async () => {
  const router = loadWithMocks('../routes/adminV2/auth', mocks());
  adminState.doc = makeAdmin();
  const res = await invoke(router, '/login', 'post', reqMock({ username: 'root', password: 'wrong' }));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'INVALID_CREDENTIALS');
  assert.equal(adminState.doc.loginAttempts, 1);
});

test('login: correct password returns mfaTicket + nonce', async () => {
  const router = loadWithMocks('../routes/adminV2/auth', mocks());
  adminState.doc = makeAdmin();
  const res = await invoke(router, '/login', 'post', reqMock({ username: 'root', password: 'correct-password' }));
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.data.mfaTicket);
  assert.ok(res.body.data.nonce);
  assert.equal(res.body.data.totpEnrolled, true);
});

test('login: unknown user returns same INVALID_CREDENTIALS', async () => {
  const router = loadWithMocks('../routes/adminV2/auth', {
    ...mocks(),
    '../../models/Admin': { findOne: () => ({ select: () => Promise.resolve(null) }) },
  });
  const res = await invoke(router, '/login', 'post', reqMock({ username: 'ghost', password: 'x' }));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'INVALID_CREDENTIALS');
});

const loginFlow = async (router) => {
  const res = await invoke(router, '/login', 'post', reqMock({ username: 'root', password: 'correct-password' }));
  assert.equal(res.statusCode, 200);
  return res.body.data;
};

test('mfa: invalid TOTP rejected with 401', async () => {
  const router = loadWithMocks('../routes/adminV2/auth', mocks());
  adminState.doc = makeAdmin();
  const { mfaTicket, nonce } = await loginFlow(router);
  const signature = signPayload(deviceKey.privateKey, `syncup-admin-login:${nonce}:dev-1`);
  const res = await invoke(router, '/mfa', 'post', reqMock({
    mfaTicket, code: '000000', deviceId: 'dev-1',
    devicePublicKey: deviceKey.publicKeyBase64, signature,
  }));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'INVALID_MFA_CODE');
});

test('mfa: unknown device returns 202 pending_device', async () => {
  const router = loadWithMocks('../routes/adminV2/auth', mocks());
  adminState.doc = makeAdmin();
  const { mfaTicket, nonce } = await loginFlow(router);
  const code = generateSync({ secret: totpSecret, period: 30, digits: 6 });
  const signature = signPayload(deviceKey.privateKey, `syncup-admin-login:${nonce}:dev-new`);
  const res = await invoke(router, '/mfa', 'post', reqMock({
    mfaTicket, code, deviceId: 'dev-new', deviceName: 'Pixel',
    devicePublicKey: deviceKey.publicKeyBase64, signature,
  }));
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.data.status, 'pending_device');
});

test('mfa: valid enrollment code auto-approves and issues tokens', async () => {
  const router = loadWithMocks('../routes/adminV2/auth', mocks());
  const admin = makeAdmin({
    enrollment: { codeHash: sha256hex('ENROLL-123'), expiresAt: new Date(Date.now() + 60000) },
  });
  adminState.doc = admin;
  const { mfaTicket, nonce } = await loginFlow(router);
  const code = generateSync({ secret: totpSecret, period: 30, digits: 6 });
  const signature = signPayload(deviceKey.privateKey, `syncup-admin-login:${nonce}:dev-auto`);
  const res = await invoke(router, '/mfa', 'post', reqMock({
    mfaTicket, code, deviceId: 'dev-auto', devicePublicKey: deviceKey.publicKeyBase64,
    signature, enrollmentCode: 'ENROLL-123',
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.status, 'ok');
  assert.ok(res.body.data.accessToken);
  assert.ok(res.body.data.refreshToken);
  const device = admin.devices.find(d => d.deviceId === 'dev-auto');
  assert.equal(device.status, 'approved');
  assert.equal(admin.enrollment.codeHash, undefined);
});

test('mfa: device key mismatch rejected', async () => {
  const router = loadWithMocks('../routes/adminV2/auth', mocks());
  const otherKey = makeDeviceKey();
  const admin = makeAdmin({
    devices: [{ deviceId: 'dev-1', publicKey: otherKey.publicKeyBase64, status: 'approved' }],
  });
  adminState.doc = admin;
  const { mfaTicket, nonce } = await loginFlow(router);
  const code = generateSync({ secret: totpSecret, period: 30, digits: 6 });
  const signature = signPayload(deviceKey.privateKey, `syncup-admin-login:${nonce}:dev-1`);
  const res = await invoke(router, '/mfa', 'post', reqMock({
    mfaTicket, code, deviceId: 'dev-1', devicePublicKey: deviceKey.publicKeyBase64, signature,
  }));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'DEVICE_KEY_MISMATCH');
});

const seedSession = (over = {}) => {
  const s = {
    _id: `sess-${sessions.length}`,
    adminId: 'admin-1',
    deviceId: 'dev-ok',
    familyId: 'fam-1',
    refreshHash: sha256hex('refresh-1'),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    revokedAt: null,
    rotatedAt: null,
    async save() { return this; },
    ...over,
  };
  sessions.push(s);
  return s;
};

test('refresh: rotation returns new tokens, reuse revokes the family', async () => {
  sessions.length = 0;
  const router = loadWithMocks('../routes/adminV2/auth', mocks());
  adminState.doc = makeAdmin({
    devices: [{ deviceId: 'dev-ok', publicKey: deviceKey.publicKeyBase64, status: 'approved' }],
  });
  seedSession();

  const res = await invoke(router, '/refresh', 'post', reqMock({ refreshToken: 'refresh-1', deviceId: 'dev-ok' }));
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.data.accessToken);
  assert.ok(res.body.data.refreshToken);
  assert.notEqual(res.body.data.refreshToken, 'refresh-1');

  const old = sessions.find(s => s.refreshHash === sha256hex('refresh-1'));
  assert.ok(old.rotatedAt, 'old session should be marked rotated');
  assert.ok(old.replacedBy, 'old session should point at the replacement');

  // Reuse of the rotated token → family revoked
  const reuse = await invoke(router, '/refresh', 'post', reqMock({ refreshToken: 'refresh-1', deviceId: 'dev-ok' }));
  assert.equal(reuse.statusCode, 401);
  assert.equal(reuse.body.code, 'SESSION_REVOKED');
  assert.ok(sessions.filter(s => s.familyId === 'fam-1').every(s => s.revokedAt), 'whole family revoked');
});

test('refresh: device no longer approved is rejected', async () => {
  sessions.length = 0;
  const router = loadWithMocks('../routes/adminV2/auth', mocks());
  adminState.doc = makeAdmin({
    devices: [{ deviceId: 'dev-ok', publicKey: deviceKey.publicKeyBase64, status: 'revoked' }],
  });
  seedSession();
  const res = await invoke(router, '/refresh', 'post', reqMock({ refreshToken: 'refresh-1', deviceId: 'dev-ok' }));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'DEVICE_NOT_APPROVED');
});

// ---- requireAdminV2 middleware ----

const loadMiddleware = (admin, session) =>
  loadWithMocks('../middleware/adminV2Auth', {
    '../models/Admin': {
      findById: () => queryResult(admin),
    },
    '../models/AdminSession': {
      findById: () => queryResult(session),
    },
    '../services/adminAudit': { recordAdminAction: async () => ({}) },
  });

const callRequireAdminV2 = async (middleware, token) => {
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = responseMock();
  let called = false;
  await middleware.requireAdminV2(req, res, () => { called = true; });
  return { res, called, req };
};

const accessToken = (payload, secret = getAdminJwtSecret(), audience = ADMIN_JWT_AUDIENCE) =>
  jwt.sign({ typ: 'admin_access', ...payload }, secret, { audience, expiresIn: '10m' });

const liveSession = { _id: 'sess-live', revokedAt: null, rotatedAt: null, expiresAt: new Date(Date.now() + 60000) };
const adminWithDevice = makeAdmin({
  devices: [{ deviceId: 'dev-ok', publicKey: deviceKey.publicKeyBase64, status: 'approved' }],
});

test('requireAdminV2: token signed with the USER secret is rejected', async () => {
  const mw = loadMiddleware(adminWithDevice, liveSession);
  const token = accessToken({ sub: 'admin-1', tv: 0, did: 'dev-ok', sid: 'sess-live' }, process.env.JWT_SECRET);
  const { res, called } = await callRequireAdminV2(mw, token);
  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
});

test('requireAdminV2: stale tv rejected with TOKEN_REVOKED', async () => {
  const admin = makeAdmin({
    tokenVersion: 5,
    devices: [{ deviceId: 'dev-ok', publicKey: deviceKey.publicKeyBase64, status: 'approved' }],
  });
  const mw = loadMiddleware(admin, liveSession);
  const token = accessToken({ sub: 'admin-1', tv: 2, did: 'dev-ok', sid: 'sess-live' });
  const { res, called } = await callRequireAdminV2(mw, token);
  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'TOKEN_REVOKED');
});

test('requireAdminV2: revoked session rejected', async () => {
  const mw = loadMiddleware(adminWithDevice, { ...liveSession, revokedAt: new Date() });
  const token = accessToken({ sub: 'admin-1', tv: 0, did: 'dev-ok', sid: 'sess-live' });
  const { res, called } = await callRequireAdminV2(mw, token);
  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'SESSION_REVOKED');
});

test('requireAdminV2: valid token populates req.admin + device', async () => {
  const mw = loadMiddleware(adminWithDevice, liveSession);
  const token = accessToken({ sub: 'admin-1', tv: 0, did: 'dev-ok', sid: 'sess-live' });
  const { called, req } = await callRequireAdminV2(mw, token);
  assert.equal(called, true);
  assert.equal(req.admin.username, 'root');
  assert.equal(req.adminDevice.deviceId, 'dev-ok');
  assert.ok(req.adminPermissions.includes('*'));
});

// ---- MFA brute-force lockout + TOTP replay + limiter placement ----

const mfaAttempt = async (router, { totpCode } = {}) => {
  const { mfaTicket, nonce } = await loginFlow(router);
  return invoke(router, '/mfa', 'post', reqMock({
    mfaTicket, code: totpCode, deviceId: 'dev-1',
    devicePublicKey: deviceKey.publicKeyBase64,
    signature: signPayload(deviceKey.privateKey, `syncup-admin-login:${nonce}:dev-1`),
  }));
};

test('mfa: 5 bad codes lock the account (423 ACCOUNT_LOCKED)', async () => {
  const router = loadWithMocks('../routes/adminV2/auth', mocks());
  adminState.doc = makeAdmin({
    devices: [{ deviceId: 'dev-1', publicKey: deviceKey.publicKeyBase64, status: 'approved' }],
  });
  const { mfaTicket, nonce } = await loginFlow(router);
  const badAttempt = () => invoke(router, '/mfa', 'post', reqMock({
    mfaTicket, code: '000000', deviceId: 'dev-1',
    devicePublicKey: deviceKey.publicKeyBase64,
    signature: signPayload(deviceKey.privateKey, `syncup-admin-login:${nonce}:dev-1`),
  }));

  for (let i = 0; i < 5; i++) {
    const res = await badAttempt();
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'INVALID_MFA_CODE');
  }
  assert.equal(adminState.doc.loginAttempts, 5);
  assert.equal(adminState.doc.isLocked(), true);
  // 6th attempt is refused at the lockout gate before checking the code
  const res = await badAttempt();
  assert.equal(res.statusCode, 423);
  assert.equal(res.body.code, 'ACCOUNT_LOCKED');
});

test('mfa: the same TOTP code cannot be replayed', async () => {
  const router = loadWithMocks('../routes/adminV2/auth', mocks());
  adminState.doc = makeAdmin({
    devices: [{ deviceId: 'dev-1', publicKey: deviceKey.publicKeyBase64, status: 'approved' }],
  });
  const code = generateSync({ secret: totpSecret, period: 30, digits: 6 });
  const first = await mfaAttempt(router, { totpCode: code });
  assert.equal(first.statusCode, 200);
  assert.ok(adminState.doc.totp.lastUsedStep !== undefined);

  const second = await mfaAttempt(router, { totpCode: code });
  assert.equal(second.statusCode, 401);
  assert.equal(second.body.code, 'INVALID_MFA_CODE');
});

test('rate limits: refresh is NOT behind the 5-per-15min authLimiter', async () => {
  const router = loadWithMocks('../routes/adminV2/auth', mocks());
  const refreshStack = findRoute(router, '/refresh', 'post').route.stack.map(s => s.handle);
  assert.equal(refreshStack.includes(STUB_AUTH), false, 'refresh must not use authLimiter');
  assert.ok(refreshStack.includes(STUB_SESSION), 'refresh should use adminSessionLimiter');

  const loginStack = findRoute(router, '/login', 'post').route.stack.map(s => s.handle);
  assert.ok(loginStack.includes(STUB_AUTH), 'login should keep authLimiter');
  assert.equal(loginStack.includes(STUB_MFA), false);

  const mfaStack = findRoute(router, '/mfa', 'post').route.stack.map(s => s.handle);
  assert.ok(mfaStack.includes(STUB_MFA), 'mfa should use adminMfaLimiter');
  assert.equal(mfaStack.includes(STUB_AUTH), false);
});
