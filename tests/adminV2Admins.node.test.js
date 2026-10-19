process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-user-jwt-secret';

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

const responseMock = () => ({
  statusCode: 200,
  body: undefined,
  locals: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const reqMock = (over = {}) => ({
  params: {}, query: {}, body: {},
  admin: { _id: 'req-1', username: 'root', role: 'admin' },
  adminDevice: { deviceId: 'dev-1' },
  adminPermissions: [],
  ip: '1.2.3.4',
  headers: {},
  ...over,
});

// ---- step-up middleware ----

const { requireStepUp } = require('../middleware/adminV2Auth');
const { getAdminJwtSecret } = require('../config/adminSecrets');

const stepUpToken = (payload) =>
  jwt.sign({ typ: 'admin_stepup', scope: 'critical', ...payload }, getAdminJwtSecret(), {
    audience: 'syncup-admin-stepup', expiresIn: '5m',
  });

const callMw = (mw, req) => {
  const res = responseMock();
  let called = false;
  mw(req, res, () => { called = true; });
  return { res, called };
};

test('step-up: missing header → 403 STEP_UP_REQUIRED', () => {
  const req = reqMock();
  const { res, called } = callMw(requireStepUp, req);
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'STEP_UP_REQUIRED');
});

test('step-up: token for another device → 403', () => {
  const req = reqMock({ headers: { 'x-admin-stepup': stepUpToken({ sub: 'req-1', did: 'dev-OTHER' }) } });
  const { res, called } = callMw(requireStepUp, req);
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'STEP_UP_REQUIRED');
});

test('step-up: token for another admin → 403', () => {
  const req = reqMock({ headers: { 'x-admin-stepup': stepUpToken({ sub: 'other-admin', did: 'dev-1' }) } });
  const { res, called } = callMw(requireStepUp, req);
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
});

test('step-up: valid token passes', () => {
  const req = reqMock({ headers: { 'x-admin-stepup': stepUpToken({ sub: 'req-1', did: 'dev-1' }) } });
  const { called } = callMw(requireStepUp, req);
  assert.equal(called, true);
});

// ---- adminsController RBAC ----

const loadController = (adminModel) =>
  loadWithMocks('../controllers/adminV2/adminsController', {
    '../../models/Admin': adminModel,
    '../../models/AdminSession': { updateMany: async () => ({ modifiedCount: 0 }) },
    '../../services/adminAudit': { recordAdminAction: async () => ({}) },
    '../../services/adminSocket': { emitAdminEvent: () => {} },
  });

test('PATCH on the owner → 403 OWNER_IMMUTABLE', async () => {
  const owner = { _id: 'owner-1', role: 'owner', save: async () => {} };
  const ctl = loadController({
    findById: async () => owner,
    findByIdAndUpdate: async () => {},
  });
  const req = reqMock({ params: { id: '507f1f77bcf86cd799439011' }, body: { role: 'admin' } });
  req.params.id = '507f1f77bcf86cd799439011';
  const res = responseMock();
  await ctl.patchAdmin(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'OWNER_IMMUTABLE');
});

test('non-owner cannot create a super_admin', async () => {
  const ctl = loadController({ create: async () => { throw new Error('should not reach'); } });
  const req = reqMock({
    body: { username: 'newadmin', password: 'long-enough-password', role: 'super_admin' },
  });
  const res = responseMock();
  await ctl.createAdmin(req, res);
  assert.equal(res.statusCode, 403);
});

test('owner CAN create a super_admin', async () => {
  let created;
  const ctl = loadController({
    create: async (doc) => { created = doc; return { _id: 'new-1', ...doc }; },
  });
  const req = reqMock({
    admin: { _id: 'owner-1', username: 'boss', role: 'owner' },
    body: { username: 'newadmin', password: 'long-enough-password', role: 'super_admin' },
  });
  const res = responseMock();
  await ctl.createAdmin(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(created.role, 'super_admin');
});

test('creating an owner is always refused', async () => {
  const ctl = loadController({ create: async () => { throw new Error('should not reach'); } });
  const req = reqMock({
    admin: { _id: 'owner-1', username: 'boss', role: 'owner' },
    body: { username: 'x', password: 'long-enough-password', role: 'owner' },
  });
  const res = responseMock();
  await ctl.createAdmin(req, res);
  assert.equal(res.statusCode, 403);
});

test('non-owner cannot modify a super_admin target', async () => {
  const target = { _id: 'sa-1', role: 'super_admin', save: async () => {} };
  const ctl = loadController({
    findById: async () => target,
    findByIdAndUpdate: async () => {},
  });
  const req = reqMock({ params: { id: '507f1f77bcf86cd799439011' }, body: { isActive: false } });
  const res = responseMock();
  await ctl.patchAdmin(req, res);
  assert.equal(res.statusCode, 403);
});
