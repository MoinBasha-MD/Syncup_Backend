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
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const loadMaintenance = (setting) =>
  loadWithMocks('../middleware/maintenanceMode', {
    '../models/SystemSetting': { getValue: async () => setting },
  });

const invoke = async (mod, req) => {
  const res = responseMock();
  let called = false;
  await mod.maintenanceMode(req, res, () => { called = true; });
  return { res, called };
};

const userToken = (userId) =>
  jwt.sign({ id: 'x', userId }, process.env.JWT_SECRET, { expiresIn: '1h' });

test('enabled maintenance blocks a user route with 503 MAINTENANCE', async () => {
  const mod = loadMaintenance({ enabled: true, message: 'Back soon', until: new Date(Date.now() + 3600e3), allowUserIds: [] });
  const { res, called } = await invoke(mod, { path: '/users', headers: {} });
  assert.equal(called, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'MAINTENANCE');
});

test('/api/admin/v2 requests pass through', async () => {
  const mod = loadMaintenance({ enabled: true, message: 'x', allowUserIds: [] });
  const { called } = await invoke(mod, { path: '/admin/v2/users', headers: {} });
  assert.equal(called, true);
});

test('/api/health passes through', async () => {
  const mod = loadMaintenance({ enabled: true, allowUserIds: [] });
  const { called } = await invoke(mod, { path: '/health', headers: {} });
  assert.equal(called, true);
});

test('allowlisted userId passes', async () => {
  const mod = loadMaintenance({ enabled: true, allowUserIds: ['vip-1'] });
  const { called } = await invoke(mod, { path: '/users', headers: { authorization: `Bearer ${userToken('vip-1')}` } });
  assert.equal(called, true);
});

test('disabled maintenance passes everything', async () => {
  const mod = loadMaintenance({ enabled: false });
  const { called } = await invoke(mod, { path: '/users', headers: {} });
  assert.equal(called, true);
});

test('expired `until` maintenance passes everything', async () => {
  const mod = loadMaintenance({ enabled: true, until: new Date(Date.now() - 60000), allowUserIds: [] });
  const { called } = await invoke(mod, { path: '/users', headers: {} });
  assert.equal(called, true);
});
