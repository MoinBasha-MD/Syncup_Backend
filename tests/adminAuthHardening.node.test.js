process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-user-jwt-secret-for-admin-hardening';
delete process.env.ADMIN_SETUP_ENABLED;

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const jwt = require('jsonwebtoken');

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

const adminDoc = {
  _id: 'admin-1',
  username: 'root',
  role: 'super_admin',
  isActive: true,
  tokenVersion: 2,
};

const { router, verifyToken } = loadWithMocks('../routes/adminAuthRoutes', {
  '../models/Admin': {
    findById: () => ({ select: () => Promise.resolve(adminDoc) }),
    hasAdmins: async () => true,
  },
  '../services/adminAudit': { recordAdminAction: async () => ({}) },
});

const responseMock = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const findRoute = (routerArg, path, method) =>
  routerArg.stack.find(layer =>
    layer.route?.path === path && layer.route.methods[method]
  ).route;

const runVerify = async (token) => {
  const req = { headers: { authorization: token ? `Bearer ${token}` : undefined } };
  const res = responseMock();
  let nextCalled = false;
  let nextError;
  await verifyToken(req, res, (err) => { nextCalled = true; nextError = err; });
  return { req, res, nextCalled, nextError };
};

const signAdmin = (payload, options = {}) =>
  jwt.sign(payload, getAdminJwtSecret(), { audience: ADMIN_JWT_AUDIENCE, ...options });

test('verifyToken rejects a token signed with the USER secret', async () => {
  const userToken = jwt.sign(
    { id: adminDoc._id, typ: 'admin', tv: 99 },
    process.env.JWT_SECRET
  );
  const { res, nextCalled } = await runVerify(userToken);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('verifyToken rejects a token with the wrong audience', async () => {
  const token = jwt.sign(
    { id: adminDoc._id, typ: 'admin', tv: 2 },
    getAdminJwtSecret(),
    { audience: 'someone-else' }
  );
  const { res, nextCalled } = await runVerify(token);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('verifyToken rejects non-admin typ claims', async () => {
  const token = signAdmin({ id: adminDoc._id, tv: 2 });
  const { res, nextCalled } = await runVerify(token);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('verifyToken rejects tokens older than admin.tokenVersion', async () => {
  const stale = signAdmin({ id: adminDoc._id, typ: 'admin', tv: 1 });
  const { res, nextCalled } = await runVerify(stale);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'TOKEN_REVOKED');
});

test('verifyToken accepts a valid admin token', async () => {
  const valid = signAdmin({ id: adminDoc._id, typ: 'admin', tv: 2 });
  const { req, nextCalled, nextError } = await runVerify(valid);
  assert.equal(nextError, undefined);
  assert.equal(nextCalled, true);
  assert.equal(req.admin.username, 'root');
});

test('POST /setup is 404 when ADMIN_SETUP_ENABLED is not set', async () => {
  delete process.env.ADMIN_SETUP_ENABLED;
  const handler = findRoute(router, '/setup', 'post').stack[0].handle;
  const res = responseMock();
  await handler({ body: { username: 'eve', password: 'password1' } }, res);
  assert.equal(res.statusCode, 404);
});

test('GET /setup/check reports setupRequired:false when setup is disabled', async () => {
  const handler = findRoute(router, '/setup/check', 'get').stack[0].handle;
  const res = responseMock();
  await handler({}, res);
  assert.equal(res.body.setupRequired, false);
});

const withEnv = (overrides, fn) => {
  const keys = ['NODE_ENV', 'ADMIN_JWT_SECRET', 'JWT_SECRET'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    for (const k of keys) {
      if (overrides[k] === undefined) delete process.env[k];
      else process.env[k] = overrides[k];
    }
    fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
};

test('getAdminJwtSecret throws in production when missing', () => {
  withEnv({ NODE_ENV: 'production', JWT_SECRET: 'user-secret' }, () => {
    assert.throws(() => getAdminJwtSecret(), /ADMIN_JWT_SECRET is required/);
  });
});

test('getAdminJwtSecret throws in production when equal to JWT_SECRET or too short', () => {
  withEnv({ NODE_ENV: 'production', JWT_SECRET: 'same-secret-value-that-is-long-enough' }, () => {
    process.env.ADMIN_JWT_SECRET = 'same-secret-value-that-is-long-enough';
    assert.throws(() => getAdminJwtSecret(), /must differ from JWT_SECRET/);
    process.env.ADMIN_JWT_SECRET = 'short';
    assert.throws(() => getAdminJwtSecret(), /at least 32 characters/);
  });
});
