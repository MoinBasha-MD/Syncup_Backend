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
  headers: {},
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
  set(name, value) {
    this.headers[String(name).toLowerCase()] = value;
    return this;
  },
  setHeader(name, value) {
    this.headers[String(name).toLowerCase()] = value;
    return this;
  },
  getHeader(name) {
    return this.headers[String(name).toLowerCase()];
  },
});

const leanResult = (doc) => ({ lean: async () => doc });
const duplicateKeyError = () => {
  const error = new Error('E11000 duplicate key error');
  error.code = 11000;
  return error;
};

const loadService = (SyncSpaceProfile) =>
  loadWithMocks('../services/syncSpaceIdentity', {
    '../models/SyncSpaceProfile': SyncSpaceProfile,
  });

const realServiceHelpers = loadService({});

const loadController = (service) =>
  loadWithMocks('../controllers/syncSpaceController', {
    '../services/syncSpaceIdentity': {
      profileDto: realServiceHelpers.profileDto,
      ...service,
    },
  });

const loadRouter = ({ protect, controller }) =>
  loadWithMocks('../routes/syncSpaceRoutes', {
    '../middleware/authMiddleware': { protect },
    '../controllers/syncSpaceController': controller,
  });

const activeProfile = (overrides = {}) => ({
  userId: 'user-1',
  syncId: 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE',
  status: 'active',
  activatedAt: new Date('2026-01-01T00:00:00.000Z'),
  allowPromotions: false,
  ...overrides,
});

const authedReq = (overrides = {}) => ({
  user: { userId: 'user-1', name: 'Jane Doe', username: 'jane' },
  headers: {},
  ...overrides,
});

const runMiddleware = async (layers, path, method, req, res) => {
  const useLayers = layers.filter(layer => !layer.route);
  const route = layers.find(layer =>
    layer.route?.path === path && layer.route.methods[method]
  )?.route;
  const chain = [...useLayers.map(layer => layer.handle), ...(route ? route.stack.map(layer => layer.handle) : [])];
  let index = 0;
  const next = (err) => {
    if (err) throw err;
    const handle = chain[index++];
    if (!handle) return undefined;
    return handle(req, res, next);
  };
  return next();
};

test('SyncSpaceProfile model enforces syncId format, status enum, and two unique indexes', () => {
  const SyncSpaceProfile = require('../models/SyncSpaceProfile');
  const valid = () => new SyncSpaceProfile({
    userId: 'user-1',
    syncId: 'SYNC-AB12-CD34-EF56-7890-ABCD',
  });
  assert.equal(valid().validateSync(), undefined);

  const badSyncId = valid();
  badSyncId.syncId = 'SYNC-NOT-VALID';
  assert.ok(badSyncId.validateSync().errors.syncId);

  const badStatus = valid();
  badStatus.status = 'banned';
  assert.match(badStatus.validateSync().errors.status.message, /enum/i);

  const missingUser = new SyncSpaceProfile({ syncId: 'SYNC-AB12-CD34-EF56-7890-ABCD' });
  assert.ok(missingUser.validateSync().errors.userId);

  const uniqueSpecs = SyncSpaceProfile.schema.indexes()
    .filter(([, options]) => options && options.unique === true)
    .map(([spec]) => spec);
  assert.equal(uniqueSpecs.length, 2);
  assert.ok(uniqueSpecs.some(spec => spec.userId === 1));
  assert.ok(uniqueSpecs.some(spec => spec.syncId === 1));
});

test('generateSyncId matches the persisted format and produces distinct IDs', () => {
  const service = loadService({});
  const ids = new Set(Array.from({ length: 50 }, () => service.generateSyncId()));
  assert.equal(ids.size, 50);
  for (const id of ids) {
    assert.match(id, /^SYNC-(?:[A-F0-9]{4}-){4}[A-F0-9]{4}$/);
  }
});

test('profileDto exposes only public identity fields, never internals', () => {
  const service = loadService({});
  assert.equal(service.profileDto(null), null);
  const dto = service.profileDto({
    _id: 'mongo-object-id',
    userId: 'user-1',
    syncId: 'SYNC-AB12-CD34-EF56-7890-ABCD',
    status: 'suspended',
    activatedAt: new Date('2026-01-02T03:04:05.000Z'),
    allowPromotions: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    __v: 3,
  });
  assert.deepEqual(dto, {
    syncId: 'SYNC-AB12-CD34-EF56-7890-ABCD',
    status: 'suspended',
    activatedAt: '2026-01-02T03:04:05.000Z',
    allowPromotions: true,
    sharingPolicy: {
      phone: 'ask',
      sync_id: 'ask',
      picture: 'allow',
      birthdate: 'ask',
      gender: 'ask',
    },
  });
});

test('service entry points reject missing or invalid user ids without touching storage', async () => {
  let calls = 0;
  const service = loadService({
    findOne: () => { calls += 1; return leanResult(null); },
    findOneAndUpdate: () => { calls += 1; return leanResult(null); },
  });
  for (const bad of [undefined, null, '', '   ', 42, {}, []]) {
    await assert.rejects(service.getProfile(bad), { statusCode: 400 });
    await assert.rejects(service.activateProfile(bad), { statusCode: 400 });
    await assert.rejects(service.updateSettings(bad, { allowPromotions: true }), { statusCode: 400 });
  }
  assert.equal(calls, 0);
});

test('getProfile is read-only and scoped to the authenticated user', async () => {
  const doc = activeProfile();
  const queries = [];
  let writes = 0;
  const service = loadService({
    findOne: (query) => { queries.push(query); return leanResult(doc); },
    findOneAndUpdate: () => { writes += 1; return leanResult(null); },
  });
  assert.equal(await service.getProfile('user-1'), doc);
  assert.deepEqual(queries, [{ userId: 'user-1' }]);
  assert.equal(writes, 0);

  const empty = loadService({ findOne: () => leanResult(null) });
  assert.equal(await empty.getProfile('user-2'), null);
});

test('first activation upserts a profile for the authenticated user only', async () => {
  const created = activeProfile();
  const captured = [];
  const service = loadService({
    findOne: () => leanResult(null),
    findOneAndUpdate: (query, update, options) => {
      captured.push({ query, update, options });
      return leanResult(created);
    },
  });
  assert.equal(await service.activateProfile('user-1'), created);
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].query, { userId: 'user-1' });
  const inserted = captured[0].update.$setOnInsert;
  assert.equal(inserted.userId, 'user-1');
  assert.match(inserted.syncId, /^SYNC-(?:[A-F0-9]{4}-){4}[A-F0-9]{4}$/);
  assert.equal(inserted.status, 'active');
  assert.equal(inserted.allowPromotions, false);
  assert.ok(inserted.activatedAt instanceof Date);
  assert.equal(captured[0].options.upsert, true);
  assert.equal(captured[0].options.new, true);
  assert.equal(Object.hasOwn(captured[0].update, '$set'), false);
});

test('repeat activation returns the existing profile without writing', async () => {
  const existing = activeProfile();
  let writes = 0;
  const service = loadService({
    findOne: () => leanResult(existing),
    findOneAndUpdate: () => { writes += 1; return leanResult(null); },
  });
  assert.equal(await service.activateProfile('user-1'), existing);
  assert.equal(writes, 0);
});

test('an activation race resolves to the winning profile document', async () => {
  const winner = activeProfile();
  let findCalls = 0;
  let upserts = 0;
  const service = loadService({
    findOne: () => { findCalls += 1; return leanResult(findCalls === 1 ? null : winner); },
    findOneAndUpdate: () => {
      upserts += 1;
      return { lean: async () => { throw duplicateKeyError(); } };
    },
  });
  assert.equal(await service.activateProfile('user-1'), winner);
  assert.equal(upserts, 1);
  assert.equal(findCalls, 2);
});

test('a syncId collision retries with a freshly generated ID', async () => {
  const created = activeProfile();
  const attemptedIds = [];
  const service = loadService({
    findOne: () => leanResult(null),
    findOneAndUpdate: (query, update) => {
      attemptedIds.push(update.$setOnInsert.syncId);
      if (attemptedIds.length === 1) {
        return { lean: async () => { throw duplicateKeyError(); } };
      }
      return leanResult(created);
    },
  });
  assert.equal(await service.activateProfile('user-1'), created);
  assert.equal(attemptedIds.length, 2);
  for (const id of attemptedIds) {
    assert.match(id, /^SYNC-(?:[A-F0-9]{4}-){4}[A-F0-9]{4}$/);
  }
  assert.notEqual(attemptedIds[0], attemptedIds[1]);
});

test('non-duplicate storage errors propagate without retrying', async () => {
  const failure = new Error('connection closed');
  let upserts = 0;
  const service = loadService({
    findOne: () => leanResult(null),
    findOneAndUpdate: () => {
      upserts += 1;
      return { lean: async () => { throw failure; } };
    },
  });
  await assert.rejects(service.activateProfile('user-1'), error => error === failure);
  assert.equal(upserts, 1);
});

test('persistent duplicate-key failures are bounded and surface as 503', async () => {
  let upserts = 0;
  const service = loadService({
    findOne: () => leanResult(null),
    findOneAndUpdate: () => {
      upserts += 1;
      return { lean: async () => { throw duplicateKeyError(); } };
    },
  });
  await assert.rejects(
    service.activateProfile('user-1'),
    { statusCode: 503, code: 'SYNC_ID_UNAVAILABLE' }
  );
  assert.equal(upserts, 5);
});

test('a suspended profile cannot reactivate or update settings', async () => {
  const suspended = activeProfile({ status: 'suspended' });
  let upserts = 0;
  const service = loadService({
    findOne: () => leanResult(suspended),
    findOneAndUpdate: () => { upserts += 1; return leanResult(null); },
  });
  await assert.rejects(
    service.activateProfile('user-1'),
    { statusCode: 403, code: 'SYNC_SPACE_SUSPENDED' }
  );
  assert.equal(upserts, 0);
  await assert.rejects(
    service.updateSettings('user-1', { allowPromotions: true }),
    { statusCode: 403, code: 'SYNC_SPACE_SUSPENDED' }
  );
});

test('a suspended profile materialized via a matched upsert is still rejected', async () => {
  const suspended = activeProfile({ status: 'suspended' });
  const service = loadService({
    findOne: () => leanResult(null),
    findOneAndUpdate: () => leanResult(suspended),
  });
  await assert.rejects(
    service.activateProfile('user-1'),
    { statusCode: 403, code: 'SYNC_SPACE_SUSPENDED' }
  );
});

test('a suspended race winner stays suspended', async () => {
  const suspended = activeProfile({ status: 'suspended' });
  let findCalls = 0;
  const service = loadService({
    findOne: () => { findCalls += 1; return leanResult(findCalls === 1 ? null : suspended); },
    findOneAndUpdate: () => ({ lean: async () => { throw duplicateKeyError(); } }),
  });
  await assert.rejects(
    service.activateProfile('user-1'),
    { statusCode: 403, code: 'SYNC_SPACE_SUSPENDED' }
  );
});

test('updateSettings validates allowPromotions and sharingPolicy strictly', async () => {
  let queries = 0;
  const service = loadService({
    findOne: () => leanResult(null),
    findOneAndUpdate: () => { queries += 1; return leanResult(null); },
  });
  for (const body of [
    null,
    undefined,
    {},
    [],
    'yes',
    42,
    { allowPromotions: 'true' },
    { allowPromotions: 1 },
    { allowPromotions: true, extra: 1 },
    { allowPromotions: true, userId: 'attacker' },
    { allowPromotions: true, status: 'suspended' },
    { allowPromotions: true, syncId: 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE' },
    { other: true },
    { sharingPolicy: 'allow' },
    { sharingPolicy: [] },
    { sharingPolicy: { name: 'allow' } },
    { sharingPolicy: { email: 'never' } },
    { sharingPolicy: { phone: 'sometimes' } },
    { sharingPolicy: { phone: 'allow' }, hacked: true },
  ]) {
    await assert.rejects(
      service.updateSettings('user-1', body),
      { statusCode: 400 },
      JSON.stringify(body)
    );
  }
  assert.equal(queries, 0);
});

test('updateSettings accepts partial sharingPolicy and writes dotted $set paths', async () => {
  const captured = [];
  const service = loadService({
    findOne: () => leanResult(null),
    findOneAndUpdate: (query, update, options) => {
      captured.push({ query, update, options });
      return leanResult(activeProfile({ sharingPolicy: { phone: 'never' } }));
    },
  });
  await service.updateSettings('user-1', { sharingPolicy: { phone: 'never' } });
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].update, { $set: { 'sharingPolicy.phone': 'never' } });
  // both fields in one call
  await service.updateSettings('user-1', {
    allowPromotions: true,
    sharingPolicy: { picture: 'never', gender: 'allow' },
  });
  assert.deepEqual(captured[1].update, {
    $set: {
      allowPromotions: true,
      'sharingPolicy.picture': 'never',
      'sharingPolicy.gender': 'allow',
    },
  });
});

test('updateSettings writes atomically and never upserts', async () => {
  const updated = activeProfile({ allowPromotions: true });
  const captured = [];
  const service = loadService({
    findOne: () => leanResult(null),
    findOneAndUpdate: (query, update, options) => {
      captured.push({ query, update, options });
      return leanResult(updated);
    },
  });
  assert.equal(await service.updateSettings('user-1', { allowPromotions: true }), updated);
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].query, { userId: 'user-1', status: 'active' });
  assert.deepEqual(captured[0].update, { $set: { allowPromotions: true } });
  assert.equal(captured[0].options.new, true);
  assert.notEqual(captured[0].options.upsert, true);
});

test('updateSettings distinguishes a missing profile from a suspended one', async () => {
  const service = loadService({
    findOne: () => leanResult(null),
    findOneAndUpdate: () => leanResult(null),
  });
  await assert.rejects(
    service.updateSettings('user-1', { allowPromotions: true }),
    { statusCode: 403, code: 'SYNC_SPACE_NOT_ACTIVATED' }
  );
});

test('GET /me reports only the authenticated identity and a null profile pre-activation', async () => {
  let lookedUp;
  const controller = loadController({
    getProfile: async (userId) => { lookedUp = userId; return null; },
  });
  const res = responseMock();
  await controller.getMe(authedReq({
    body: { userId: 'attacker' },
    params: { userId: 'attacker' },
    query: { userId: 'attacker' },
  }), res);
  assert.equal(lookedUp, 'user-1');
  assert.deepEqual(res.body, {
    success: true,
    user: { userId: 'user-1', name: 'Jane Doe', username: 'jane' },
    profile: null,
  });
});

test('GET /me shows suspended status without leaking internal fields', async () => {
  const controller = loadController({
    getProfile: async () => activeProfile({
      _id: 'mongo-object-id',
      status: 'suspended',
      __v: 0,
    }),
  });
  const res = responseMock();
  await controller.getMe(authedReq({ user: { userId: 'user-9' } }), res);
  assert.equal(res.body.user.userId, 'user-9');
  assert.equal(res.body.user.name, 'User');
  assert.equal(res.body.user.username, '');
  assert.deepEqual(Object.keys(res.body.profile).sort(), [
    'activatedAt',
    'allowPromotions',
    'sharingPolicy',
    'status',
    'syncId',
  ]);
  assert.equal(res.body.profile.status, 'suspended');
});

test('POST /activate accepts an absent or empty body and uses the authenticated id', async () => {
  const activations = [];
  const controller = loadController({
    activateProfile: async (userId) => { activations.push(userId); return activeProfile({ userId }); },
  });
  const noBody = responseMock();
  await controller.activate(authedReq(), noBody);
  const emptyBody = responseMock();
  await controller.activate(authedReq({ body: {} }), emptyBody);
  assert.deepEqual(activations, ['user-1', 'user-1']);
  assert.equal(noBody.body.success, true);
  assert.equal(noBody.body.profile.syncId, 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE');
  assert.equal(emptyBody.body.success, true);
});

test('POST /activate rejects any supplied identity, owner, or verification fields', async () => {
  let serviceCalls = 0;
  const controller = loadController({
    activateProfile: async () => { serviceCalls += 1; return activeProfile(); },
  });
  for (const body of [
    { syncId: 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE' },
    { userId: 'attacker' },
    { owner: 'attacker' },
    { verified: true },
    { aadhaar: '1234' },
    ['x'],
  ]) {
    const res = responseMock();
    const errors = [];
    await controller.activate(authedReq({ body }), res, error => errors.push(error));
    assert.equal(errors.length, 1, JSON.stringify(body));
    assert.equal(errors[0].statusCode, 400);
    assert.equal(res.body, undefined);
  }
  assert.equal(serviceCalls, 0);
});

test('PATCH /settings delegates the validated body for the authenticated user', async () => {
  const calls = [];
  const controller = loadController({
    updateSettings: async (userId, body) => {
      calls.push([userId, body]);
      return activeProfile({ userId, allowPromotions: body.allowPromotions });
    },
  });
  const res = responseMock();
  await controller.updateSettings(authedReq({ body: { allowPromotions: true } }), res);
  assert.deepEqual(calls, [['user-1', { allowPromotions: true }]]);
  assert.equal(res.body.success, true);
  assert.equal(res.body.profile.allowPromotions, true);
});

test('routes run protect before every handler and respond no-store', async () => {
  const order = [];
  const protect = (req, res, next) => {
    order.push('protect');
    req.user = { userId: 'user-1' };
    return next();
  };
  const controller = {
    getMe: (req, res) => { order.push('getMe'); res.json({ success: true }); },
    activate: (req, res) => { order.push('activate'); res.json({ success: true }); },
    updateSettings: (req, res) => { order.push('updateSettings'); res.json({ success: true }); },
  };
  const router = loadRouter({ protect, controller });

  const protectIndex = router.stack.findIndex(layer => !layer.route && layer.handle === protect);
  assert.ok(protectIndex > -1);
  for (const [path, method] of [['/me', 'get'], ['/activate', 'post'], ['/settings', 'patch']]) {
    const routeIndex = router.stack.findIndex(layer =>
      layer.route?.path === path && layer.route.methods[method]
    );
    assert.ok(routeIndex > protectIndex, `${method.toUpperCase()} ${path} must come after protect`);
  }

  for (const [path, method, handler] of [
    ['/me', 'get', 'getMe'],
    ['/activate', 'post', 'activate'],
    ['/settings', 'patch', 'updateSettings'],
  ]) {
    order.length = 0;
    const res = responseMock();
    await runMiddleware(router.stack, path, method, { headers: {} }, res);
    assert.deepEqual(order, ['protect', handler]);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.body.success, true);
  }
});

test('unauthenticated requests are stopped by protect before any handler', async () => {
  const order = [];
  const protect = (req, res) => {
    order.push('protect');
    res.status(401).json({ success: false });
  };
  const controller = {
    getMe: () => order.push('getMe'),
    activate: () => order.push('activate'),
    updateSettings: () => order.push('updateSettings'),
  };
  const router = loadRouter({ protect, controller });
  const res = responseMock();
  await runMiddleware(router.stack, '/activate', 'post', { headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(order, ['protect']);
});

test('SYNC_SPACE_ENABLED=false short-circuits with 503 before protect', async () => {
  const order = [];
  const protect = (req, res, next) => { order.push('protect'); return next(); };
  const controller = {
    getMe: () => order.push('getMe'),
    activate: () => order.push('activate'),
    updateSettings: () => order.push('updateSettings'),
  };
  const router = loadRouter({ protect, controller });
  const previous = process.env.SYNC_SPACE_ENABLED;
  process.env.SYNC_SPACE_ENABLED = 'false';
  try {
    const res = responseMock();
    await runMiddleware(router.stack, '/me', 'get', { headers: {} }, res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, {
      success: false,
      code: 'SYNC_SPACE_DISABLED',
      message: 'Sync Space is currently unavailable',
    });
    assert.deepEqual(order, []);
  } finally {
    if (previous === undefined) delete process.env.SYNC_SPACE_ENABLED;
    else process.env.SYNC_SPACE_ENABLED = previous;
  }
});
