process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-auth-enforcement';

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

const fakeUser = (over = {}) => {
  const data = { _id: 'abc123', userId: 'user-uuid-1', name: 'Test', tokenVersion: 0, ...over };
  return { ...data, toObject: () => ({ ...data }) };
};

const loadMiddleware = (user) =>
  loadWithMocks('../middleware/authMiddleware', {
    '../models/userModel': {
      findById: () => ({ select: () => Promise.resolve(user) }),
      findOne: () => ({ select: () => Promise.resolve(user) }),
    },
    '../models/DeviceSession': {
      findOne: () => ({ select: () => Promise.resolve({ _id: 'session-1' }) }),
    },
  });

const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET);

const runProtect = async (middleware, req) => {
  let captured;
  await middleware.protect(req, {}, (error) => { captured = error; });
  return captured;
};

const runOptionalProtect = async (middleware, req) => {
  let called = false;
  await middleware.optionalProtect(req, {}, () => { called = true; });
  return called;
};

const reqFor = (payload, method = 'GET') => ({
  headers: { authorization: `Bearer ${sign(payload)}` },
  method,
  path: '/x',
});

const HOUR = 60 * 60 * 1000;

test('protect rejects banned users with 403 ACCOUNT_BANNED', async () => {
  const { protect } = loadMiddleware(fakeUser({
    accountStatus: { state: 'banned', reason: 'spam' },
  }));
  const error = await runProtect({ protect }, reqFor({ id: 'abc123', userId: 'user-uuid-1' }));
  assert.equal(error.statusCode, 403);
  assert.equal(error.code, 'ACCOUNT_BANNED');
});

test('protect rejects future suspensions with 403 ACCOUNT_SUSPENDED + until', async () => {
  const until = new Date(Date.now() + HOUR);
  const { protect } = loadMiddleware(fakeUser({
    accountStatus: { state: 'suspended', until },
  }));
  const error = await runProtect({ protect }, reqFor({ id: 'abc123', userId: 'user-uuid-1' }));
  assert.equal(error.statusCode, 403);
  assert.equal(error.code, 'ACCOUNT_SUSPENDED');
  assert.equal(error.until, until);
});

test('protect lets an expired suspension through', async () => {
  const { protect } = loadMiddleware(fakeUser({
    accountStatus: { state: 'suspended', until: new Date(Date.now() - HOUR) },
  }));
  const req = reqFor({ id: 'abc123', userId: 'user-uuid-1' });
  const error = await runProtect({ protect }, req);
  assert.equal(error, undefined);
  assert.equal(req.user.userId, 'user-uuid-1');
});

test('protect rejects stale token versions with 401 TOKEN_REVOKED', async () => {
  const { protect } = loadMiddleware(fakeUser({ tokenVersion: 3 }));
  const error = await runProtect({ protect }, reqFor({ id: 'abc123', userId: 'user-uuid-1', tv: 2 }));
  assert.equal(error.statusCode, 401);
  assert.equal(error.code, 'TOKEN_REVOKED');
});

test('impersonation tokens pass GET with impersonatedBy set', async () => {
  const { protect } = loadMiddleware(fakeUser());
  const req = reqFor({ id: 'abc123', userId: 'user-uuid-1', tokenType: 'impersonation', imp: 'admin-9' }, 'GET');
  const error = await runProtect({ protect }, req);
  assert.equal(error, undefined);
  assert.equal(req.user.impersonatedBy, 'admin-9');
});

test('impersonation tokens are rejected on writes', async () => {
  const { protect } = loadMiddleware(fakeUser());
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const error = await runProtect({ protect }, reqFor(
      { id: 'abc123', userId: 'user-uuid-1', tokenType: 'impersonation', imp: 'admin-9' },
      method
    ));
    assert.equal(error.statusCode, 403, method);
    assert.equal(error.code, 'IMPERSONATION_READ_ONLY', method);
  }
});

test('optionalProtect leaves req.user unset for banned users but continues', async () => {
  const middleware = loadMiddleware(fakeUser({
    accountStatus: { state: 'banned' },
  }));
  const req = reqFor({ id: 'abc123', userId: 'user-uuid-1' });
  const called = await runOptionalProtect(middleware, req);
  assert.equal(called, true);
  assert.equal(req.user, undefined);
});

test('optionalProtect sets req.user for healthy accounts', async () => {
  const middleware = loadMiddleware(fakeUser());
  const req = reqFor({ id: 'abc123', userId: 'user-uuid-1' });
  await runOptionalProtect(middleware, req);
  assert.equal(req.user.userId, 'user-uuid-1');
});
