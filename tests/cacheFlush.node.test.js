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

test('cache flush scans & deletes matching keys only — never flushdb/flushall', async () => {
  const deleted = [];
  const calls = [];
  const redisClient = {
    isOpen: true,
    scanIterator: async function* ({ MATCH }) {
      calls.push(`scan:${MATCH}`);
      yield 'u1:GET:/api/feed';
      yield 'u2:POST:/api/messages';
    },
    del: async (key) => { deleted.push(key); calls.push(`del:${key}`); return 1; },
    flushDb: async () => { calls.push('flushDb'); },
    flushAll: async () => { calls.push('flushAll'); },
  };
  const ctl = loadWithMocks('../controllers/adminV2/systemController', {
    '../../config/redis': { client: redisClient },
    '../../models/SystemSetting': { getValue: async () => null, setValue: async () => ({}) },
    '../../services/fcmCleanup': {},
    '../../middleware/maintenanceMode': { bustMaintenanceCache: () => {} },
    '../../socketManager': { getUserSockets: () => new Map() },
  });
  const res = responseMock();
  await ctl.cacheFlush(
    { body: { scope: 'response-cache', reason: 'debug' }, admin: { _id: 'a1' }, adminDevice: {} },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.deleted, 4); // 2 keys × 2 patterns
  assert.ok(deleted.includes('u1:GET:/api/feed'));
  assert.ok(deleted.includes('u2:POST:/api/messages'));
  assert.ok(calls.some(c => c === 'scan:*:GET:/*'));
  assert.ok(calls.some(c => c === 'scan:*:POST:/*'));
  assert.equal(calls.includes('flushDb'), false);
  assert.equal(calls.includes('flushAll'), false);
});

test('ripple-feed scope only deletes ripple feed keys', async () => {
  const calls = [];
  const redisClient = {
    isOpen: true,
    scanIterator: async function* ({ MATCH }) {
      calls.push(`scan:${MATCH}`);
      yield 'u1:GET:/api/ripples/nearby';
    },
    del: async () => 1,
    flushDb: async () => { calls.push('flushDb'); },
    flushAll: async () => { calls.push('flushAll'); },
  };
  const ctl = loadWithMocks('../controllers/adminV2/systemController', {
    '../../config/redis': { client: redisClient },
    '../../models/SystemSetting': {},
    '../../services/fcmCleanup': {},
    '../../middleware/maintenanceMode': {},
    '../../socketManager': { getUserSockets: () => new Map() },
  });
  const res = responseMock();
  await ctl.cacheFlush(
    { body: { scope: 'ripple-feed', reason: 'debug' }, admin: { _id: 'a1' }, adminDevice: {} },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.deleted, 1);
  assert.ok(calls.includes('scan:*:GET:/api/ripples*'));
  assert.equal(calls.includes('flushDb'), false);
});

test('invalid scope rejected', async () => {
  const ctl = loadWithMocks('../controllers/adminV2/systemController', {
    '../../config/redis': { client: { isOpen: false } },
    '../../models/SystemSetting': {},
    '../../services/fcmCleanup': {},
    '../../middleware/maintenanceMode': {},
  });
  const res = responseMock();
  await ctl.cacheFlush({ body: { scope: 'nope', reason: 'x' }, admin: { _id: 'a1' }, adminDevice: {} }, res);
  assert.equal(res.statusCode, 400);
});
