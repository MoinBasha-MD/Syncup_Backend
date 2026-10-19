process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-user-jwt-secret-for-cleanup-tests';

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

const responseMock = () => ({
  statusCode: 200,
  body: undefined,
  headersSent: false,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    this.headersSent = true;
    return this;
  },
});

const findRoute = (router, path, method) =>
  router.stack.find(layer =>
    layer.route?.path === path && layer.route.methods[method]
  ).route;

// Run the middleware chain until a response is sent or next() stops being called
const runRoute = async (route, req) => {
  const res = responseMock();
  for (const layer of route.stack) {
    if (res.headersSent) break;
    let continued = false;
    await layer.handle(req, res, () => { continued = true; });
    if (!continued) break;
  }
  return res;
};

const adminDoc = (role) => ({
  _id: 'admin-1',
  username: 'root',
  role,
  isActive: true,
  tokenVersion: 0,
});

// adminCleanupRoutes requires './adminAuthRoutes' (relative specifier), so the
// mock key must match exactly.
const loadRouter = (admin) => {
  const adminMock = {
    findById: () => ({ select: () => Promise.resolve(admin) }),
  };
  return loadWithMocks('../routes/adminCleanupRoutes', {
    '../models/userModel': {
      updateMany: async () => ({ modifiedCount: 5 }),
      updateOne: async () => ({ matchedCount: 1 }),
      aggregate: async () => [{ totalUsers: 1 }],
    },
    './adminAuthRoutes': loadWithMocks('../routes/adminAuthRoutes', {
      '../models/Admin': adminMock,
      '../services/adminAudit': { recordAdminAction: async () => ({}) },
    }),
    '../services/adminAudit': { recordAdminAction: async () => ({}) },
  });
};

const signAdmin = (admin) =>
  jwt.sign(
    { id: admin._id, username: admin.username, role: admin.role, typ: 'admin', tv: admin.tokenVersion },
    getAdminJwtSecret(),
    { audience: ADMIN_JWT_AUDIENCE }
  );

const reqFor = (token, params = {}) => ({
  headers: token ? { authorization: `Bearer ${token}` } : {},
  params,
  body: {},
  ip: '127.0.0.1',
});

test('cleanup routes reject requests with no admin token', async () => {
  const router = loadRouter(adminDoc('super_admin'));
  const res = await runRoute(
    findRoute(router, '/cleanup/fcm-tokens-all', 'post'),
    reqFor(null)
  );
  assert.equal(res.statusCode, 401);
});

test('cleanup routes reject user JWTs (wrong secret)', async () => {
  const router = loadRouter(adminDoc('super_admin'));
  const userToken = jwt.sign({ id: 'u1', userId: 'u-1' }, process.env.JWT_SECRET);
  const res = await runRoute(
    findRoute(router, '/cleanup/fcm-tokens-all', 'post'),
    reqFor(userToken)
  );
  assert.equal(res.statusCode, 401);
});

test('cleanup routes reject moderators with 403', async () => {
  const mod = adminDoc('moderator');
  const router = loadRouter(mod);
  const res = await runRoute(
    findRoute(router, '/cleanup/fcm-tokens-all', 'post'),
    reqFor(signAdmin(mod))
  );
  assert.equal(res.statusCode, 403);
});

test('cleanup routes allow super_admin', async () => {
  const sa = adminDoc('super_admin');
  const router = loadRouter(sa);
  const res = await runRoute(
    findRoute(router, '/cleanup/fcm-tokens-all', 'post'),
    reqFor(signAdmin(sa))
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
});
