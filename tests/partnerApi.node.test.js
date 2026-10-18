const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const test = require('node:test');

process.env.SYNC_SPACE_DATA_KEY = 'ab'.repeat(32);
process.env.SYNC_SPACE_SUBJECT_KEY = 'subject-key-0123456789abcdef-32chars!!';

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

const chain = (result) => {
  const query = {};
  for (const method of ['select', 'lean', 'sort', 'skip', 'limit']) {
    query[method] = () => query;
  }
  query.then = (resolve, reject) => Promise.resolve(
    typeof result === 'function' ? result() : result
  ).then(resolve, reject);
  return query;
};

const loadService = ({ SpaceConnectSession = {}, SpaceConnection = {}, SpaceMessage = {}, SyncSpaceProfile = {}, notifications } = {}) =>
  loadWithMocks('../services/partnerSpaceService', {
    '../models/SpaceConnectSession': SpaceConnectSession,
    '../models/SpaceConnection': SpaceConnection,
    '../models/SpaceMessage': SpaceMessage,
    '../models/SyncSpaceProfile': SyncSpaceProfile,
    './notificationDispatcher': notifications || { dispatchNotification: async () => ({}) },
  });

const appDoc = (overrides = {}) => ({
  appId: 'sp_' + 'ab'.repeat(16),
  partnerId: 'p-1',
  name: 'Orders',
  environment: 'sandbox',
  requestedScopes: ['space.messages', 'space.codes', 'space.receipts', 'space.promotions'],
  status: 'active',
  sandboxUserIds: ['user-1'],
  ...overrides,
});

const keyDoc = (overrides = {}) => ({
  keyId: 'sk_test_abcdef123456',
  scopes: ['space.messages', 'space.codes', 'space.receipts', 'space.promotions'],
  ...overrides,
});

const creds = (app = appDoc(), key = keyDoc()) => ({ app, key });

test('createConnectSession validates scopes strictly and returns a one-time token', async () => {
  let created;
  const service = loadService({
    SpaceConnectSession: {
      create: async (doc) => {
        created = doc;
        return { ...doc, sessionId: 'cs_' + 'cd'.repeat(16) };
      },
    },
  });
  const result = await service.createConnectSession(creds(), { scopes: ['space.messages'] });
  assert.match(result.sessionId, /^cs_[a-f0-9]{32}$/);
  assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.token.length, 43);
  assert.ok(result.connectUrl.includes(encodeURIComponent(result.token)));
  assert.equal(created.tokenHash, crypto.createHash('sha256').update(result.token).digest('hex'));
  assert.notEqual(created.tokenHash, result.token);
  assert.equal(created.environment, 'sandbox');
  assert.deepEqual(created.requestedScopes, ['space.messages']);
  assert.ok(created.expiresAt.getTime() > Date.now() + 9 * 60 * 1000);

  for (const body of [
    {},
    { scopes: [] },
    { scopes: 'space.messages' },
    { scopes: ['openid'] },
    { scopes: ['space.messages', 'space.messages'] },
    { scopes: ['space.messages'], extra: true },
    ['space.messages'],
    null,
  ]) {
    await assert.rejects(service.createConnectSession(creds(), body), { statusCode: 400 }, JSON.stringify(body));
  }
  await assert.rejects(
    service.createConnectSession(creds(appDoc({ requestedScopes: ['space.codes'] })), { scopes: ['space.messages'] }),
    { statusCode: 400 }
  );
  await assert.rejects(
    service.createConnectSession(creds(appDoc(), keyDoc({ scopes: ['openid'] })), { scopes: ['space.messages'] }),
    { statusCode: 403, code: 'INSUFFICIENT_SCOPE' }
  );
});

test('getConnectSession is app-scoped and reports expired pending sessions', async () => {
  const base = {
    sessionId: 'cs_' + 'cd'.repeat(16),
    appId: appDoc().appId,
    status: 'pending',
    expiresAt: new Date(Date.now() + 600000),
    connectionId: null,
    grantedScopes: [],
  };
  const service = loadService({
    SpaceConnectSession: {
      findOne: (query) => chain(query.appId === appDoc().appId && query.sessionId === base.sessionId ? base : null),
    },
  });
  assert.deepEqual(await service.getConnectSession(appDoc().appId, base.sessionId), {
    status: 'pending',
    expiresAt: base.expiresAt,
  });
  await assert.rejects(service.getConnectSession('sp_other', base.sessionId), { statusCode: 404 });
  await assert.rejects(service.getConnectSession(appDoc().appId, 'not-a-session'), { statusCode: 404 });

  const expired = loadService({
    SpaceConnectSession: {
      findOne: () => chain({ ...base, expiresAt: new Date(Date.now() - 1000) }),
    },
  });
  assert.equal((await expired.getConnectSession(appDoc().appId, base.sessionId)).status, 'expired');

  const approved = loadService({
    SpaceConnectSession: {
      findOne: () => chain({ ...base, status: 'approved', connectionId: 'conn_1', grantedScopes: ['space.messages'] }),
    },
    SpaceConnection: {
      findOne: () => chain({ connectionId: 'conn_1', subject: 'sub_x'.padEnd(37, 'y') }),
    },
  });
  const poll = await approved.getConnectSession(appDoc().appId, base.sessionId);
  assert.equal(poll.status, 'approved');
  assert.equal(poll.subject, 'sub_x'.padEnd(37, 'y'));
  assert.deepEqual(poll.grantedScopes, ['space.messages']);
});

test('getConnectionBySubject enforces app ownership and hides internals', async () => {
  const connection = {
    connectionId: 'conn_1',
    appId: appDoc().appId,
    subject: 'sub_' + 'x'.repeat(32),
    scopes: ['space.messages'],
    status: 'active',
    connectedAt: new Date(),
    revokedAt: null,
    userId: 'user-1',
  };
  const service = loadService({
    SpaceConnection: {
      findOne: (query) => chain(query.appId === appDoc().appId ? connection : null),
    },
  });
  const result = await service.getConnectionBySubject(appDoc().appId, connection.subject);
  assert.deepEqual(result, {
    subject: connection.subject,
    status: 'active',
    scopes: ['space.messages'],
    connectedAt: connection.connectedAt,
    revokedAt: null,
  });
  assert.equal(Object.hasOwn(result, 'userId'), false);
  await assert.rejects(service.getConnectionBySubject('sp_other', connection.subject), { statusCode: 404 });
  await assert.rejects(service.getConnectionBySubject(appDoc().appId, 'sub_bad'), { statusCode: 404 });
});

const connectionDoc = (overrides = {}) => ({
  connectionId: 'conn_1',
  userId: 'user-1',
  appId: appDoc().appId,
  subject: 'sub_' + 's'.repeat(32),
  scopes: ['space.messages', 'space.codes', 'space.receipts', 'space.promotions'],
  status: 'active',
  environment: 'sandbox',
  ...overrides,
});

test('sendMessage validates the strict body shape and per-type rules', async () => {
  const service = loadService({
    SpaceConnection: { findOne: async () => connectionDoc() },
    SpaceMessage: { create: async (doc) => ({ ...doc, createdAt: new Date() }) },
  });
  const send = (body, idem) => service.sendMessage(creds(), body, idem);
  const base = { subject: connectionDoc().subject, type: 'message', title: 'Hi' };

  for (const body of [
    {},
    { ...base, extra: 1 },
    { ...base, subject: 'not-a-sub' },
    { ...base, type: 'video' },
    { ...base, title: '' },
    { ...base, title: 'x'.repeat(121) },
    { ...base, body: 'x'.repeat(2001) },
    { ...base, code: '1234' },
    { ...base, expiresInSeconds: 300 },
    { ...base, type: 'code', code: 'ab!' },
    { ...base, type: 'code', code: 'abc' },
    { ...base, type: 'code', code: 'AB12', expiresInSeconds: 59 },
    { ...base, type: 'code', code: 'AB12', expiresInSeconds: 901 },
    { ...base, type: 'receipt' },
    { ...base, receipt: { amount: 1, currency: 'USD' } },
    { ...base, type: 'receipt', receipt: { amount: -1, currency: 'USD' } },
    { ...base, type: 'receipt', receipt: { amount: 1, currency: 'usd' } },
    { ...base, type: 'receipt', receipt: { amount: 1, currency: 'USD', extra: 1 } },
    { ...base, type: 'receipt', receipt: { amount: 1, currency: 'USD', items: [{ name: 'x', quantity: 0, amount: 1 }] } },
  ]) {
    await assert.rejects(send(body), { statusCode: 400 }, JSON.stringify(body).slice(0, 120));
  }
  await assert.rejects(send(base, 'bad key!'), { statusCode: 400 });
  await assert.rejects(send(base, 'short'), { statusCode: 400 });
  await assert.rejects(
    service.sendMessage(creds(appDoc(), keyDoc({ scopes: ['space.codes'] })), base),
    { statusCode: 403, code: 'INSUFFICIENT_SCOPE' }
  );
});

test('sendMessage requires an active scoped connection in the matching environment', async () => {
  const build = (connection) => loadService({
    SpaceConnection: {
      findOne: async (query) => {
        const match =
          connection &&
          query.appId === appDoc().appId &&
          query.subject === connectionDoc().subject &&
          query.status === connection.status &&
          query.environment === connection.environment;
        return match ? connection : null;
      },
    },
    SpaceMessage: { create: async (doc) => ({ ...doc, createdAt: new Date() }) },
  });
  const base = { subject: connectionDoc().subject, type: 'message', title: 'Hi' };
  for (const connection of [null, connectionDoc({ status: 'revoked' }), connectionDoc({ environment: 'live' }), connectionDoc({ scopes: ['space.codes'] })]) {
    await assert.rejects(build(connection).sendMessage(creds(), base), { statusCode: 404, code: 'CONNECTION_NOT_FOUND' });
  }
  await assert.rejects(
    build(connectionDoc()).sendMessage(creds(), { ...base, subject: 'sub_' + 'z'.repeat(32) }),
    { statusCode: 404, code: 'CONNECTION_NOT_FOUND' }
  );
});

test('sendMessage requires an active recipient profile and current sandbox tester status', async () => {
  const build = ({ profile, app = appDoc() }) => loadService({
    SpaceConnection: { findOne: async () => connectionDoc() },
    SpaceMessage: { create: async (doc) => ({ ...doc, createdAt: new Date() }) },
    SyncSpaceProfile: { findOne: (query) => chain(profile) },
  });
  const base = { subject: connectionDoc().subject, type: 'message', title: 'Hi' };

  for (const profile of [null, profileDocOff(), profileDocOff({ status: 'suspended' })]) {
    await assert.rejects(build({ profile }).sendMessage(creds(), base), { statusCode: 404, code: 'CONNECTION_NOT_FOUND' });
  }
  const active = build({ profile: { status: 'active', allowPromotions: false } });
  assert.equal((await active.sendMessage(creds(), base)).duplicated, false);

  const removedTester = loadService({
    SpaceConnection: { findOne: async () => connectionDoc() },
    SpaceMessage: { create: async (doc) => ({ ...doc, createdAt: new Date() }) },
    SyncSpaceProfile: { findOne: () => chain({ status: 'active', allowPromotions: true }) },
  });
  await assert.rejects(
    removedTester.sendMessage(creds(appDoc({ sandboxUserIds: ['user-9'] })), base),
    { statusCode: 404, code: 'CONNECTION_NOT_FOUND' }
  );
  const stillTester = await removedTester.sendMessage(creds(appDoc({ sandboxUserIds: ['user-1'] })), base);
  assert.equal(stillTester.duplicated, false);
});

const profileDocOff = (overrides) => ({ status: undefined, allowPromotions: false, ...overrides });

test('promotions require an active profile with allowPromotions', async () => {
  const build = (profile) => loadService({
    SpaceConnection: { findOne: async () => connectionDoc() },
    SpaceMessage: { create: async (doc) => ({ ...doc, createdAt: new Date() }) },
    SyncSpaceProfile: { findOne: (query) => chain(profile) },
  });
  const promo = { subject: connectionDoc().subject, type: 'promotion', title: 'Sale' };
  await assert.rejects(build(null).sendMessage(creds(), promo), { statusCode: 404, code: 'CONNECTION_NOT_FOUND' });
  const ok = build({ status: 'active', allowPromotions: true });
  assert.equal((await ok.sendMessage(creds(), promo)).duplicated, false);
});

test('code messages are encrypted at rest, never in DTOs, and notifications never carry the code', async () => {
  let created;
  const notifyArgs = [];
  const service = loadService({
    SpaceConnection: { findOne: async () => connectionDoc() },
    SpaceMessage: {
      create: async (doc) => { created = doc; return { ...doc, createdAt: new Date('2026-02-01T00:00:00Z') }; },
    },
    SyncSpaceProfile: { findOne: () => chain({ status: 'active', allowPromotions: true }) },
    notifications: { dispatchNotification: async (args) => { notifyArgs.push(args); return {}; } },
  });
  const result = await service.sendMessage(creds(), {
    subject: connectionDoc().subject, type: 'code', title: 'Verify', code: '482913', expiresInSeconds: 120,
  }, 'order-42-key');
  assert.equal(result.duplicated, false);
  assert.match(result.messageId, /^msg_[a-f0-9]{32}$/);
  assert.notEqual(created.codeEncrypted, '482913');
  assert.equal(created.idempotencyKey, 'order-42-key');
  assert.ok(created.codeExpiresAt.getTime() <= Date.now() + 120000 + 1000);
  const { decryptSecret } = require('../utils/syncSpaceCrypto');
  assert.equal(decryptSecret(created.codeEncrypted, `code:${created.messageId}`), '482913');
  assert.equal(notifyArgs.length, 1);
  assert.equal(notifyArgs[0].body, 'You received a verification code');
  assert.ok(JSON.stringify(notifyArgs[0]).indexOf('482913') === -1);
  assert.equal(notifyArgs[0].toUserId, 'user-1');
  assert.equal(notifyArgs[0].type, 'sync_space_message');
  // taps must route through the nested Home → SocialSpace navigator path
  assert.deepEqual(notifyArgs[0].action, { screen: 'Home', params: { screen: 'SocialSpace' } });
  assert.equal(Object.hasOwn(result, 'code'), false);
});

test('notification failures never fail message delivery', async () => {
  const service = loadService({
    SpaceConnection: { findOne: async () => connectionDoc() },
    SpaceMessage: { create: async (doc) => ({ ...doc, createdAt: new Date() }) },
    SyncSpaceProfile: { findOne: () => chain({ status: 'active', allowPromotions: true }) },
    notifications: { dispatchNotification: async () => { throw new Error('fcm down'); } },
  });
  const result = await service.sendMessage(creds(), {
    subject: connectionDoc().subject, type: 'message', title: 'Hi',
  });
  assert.equal(result.duplicated, false);
});

test('idempotent duplicates return the original message, including the E11000 race', async () => {
  const existing = { messageId: 'msg_first', createdAt: new Date('2026-01-01T00:00:00Z') };
  let creates = 0;
  const raced = loadService({
    SpaceConnection: { findOne: async () => connectionDoc() },
    SpaceMessage: {
      create: async () => {
        creates += 1;
        const err = new Error('dup');
        err.code = 11000;
        throw err;
      },
      findOne: (query) => chain(query.idempotencyKey === 'idem-12345' ? existing : null),
    },
    SyncSpaceProfile: { findOne: () => chain({ status: 'active', allowPromotions: true }) },
  });
  const result = await raced.sendMessage(creds(), {
    subject: connectionDoc().subject, type: 'message', title: 'Hi',
  }, 'idem-12345');
  assert.equal(result.duplicated, true);
  assert.equal(result.messageId, 'msg_first');
  assert.equal(creates, 1);
});

const responseMock = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const loadAuth = (authenticateApiKey) =>
  loadWithMocks('../middleware/partnerApiAuth', {
    '../services/partnerService': { authenticateApiKey },
  });

test('partnerApiAuth returns a generic 401 for missing or invalid keys', async () => {
  const auth = loadAuth(async () => { const e = new Error('no'); e.statusCode = 401; throw e; });
  for (const req of [
    { headers: {} },
    { headers: { authorization: 'Basic abc' } },
    { headers: { authorization: 'Bearer sk_bad' } },
    { headers: { authorization: 'Bearer ' } },
  ]) {
    const res = responseMock();
    await auth.partnerApiAuth(req, res, () => { throw new Error('unreachable'); });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { success: false, code: 'INVALID_API_KEY', message: 'Invalid API key' });
  }

  const ok = loadAuth(async (token) => {
    assert.equal(token, 'sk_test_x.y');
    return { partner: { partnerId: 'p-1' }, app: appDoc(), key: keyDoc() };
  });
  const req = { headers: { authorization: 'Bearer sk_test_x.y' } };
  let called = false;
  await ok.partnerApiAuth(req, responseMock(), () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.partnerApi.app.appId, appDoc().appId);
});

test('requireScope gates on the key scopes', () => {
  const { requireScope } = loadAuth(async () => ({}));
  const mw = requireScope('space.messages');
  const res = responseMock();
  let called = false;
  mw({ partnerApi: { key: { scopes: ['space.codes'] } } }, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'INSUFFICIENT_SCOPE');
  const res2 = responseMock();
  mw({ partnerApi: { key: { scopes: ['space.messages'] } } }, res2, () => { called = true; });
  assert.equal(called, true);
});

test('pairwise subjects are deterministic per app and fail closed without a key', () => {
  const { pairwiseSubject } = require('../utils/syncSpaceCrypto');
  const a = pairwiseSubject('sp_one', 'user-1');
  const b = pairwiseSubject('sp_one', 'user-1');
  const c = pairwiseSubject('sp_two', 'user-1');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^sub_[A-Za-z0-9_-]{32}$/);
  assert.ok(!a.includes('user-1'));
  const previous = process.env.SYNC_SPACE_SUBJECT_KEY;
  try {
    delete process.env.SYNC_SPACE_SUBJECT_KEY;
    assert.throws(() => pairwiseSubject('sp_one', 'user-1'), { statusCode: 503 });
    process.env.SYNC_SPACE_SUBJECT_KEY = 'short';
    assert.throws(() => pairwiseSubject('sp_one', 'user-1'), { statusCode: 503 });
  } finally {
    process.env.SYNC_SPACE_SUBJECT_KEY = previous;
  }
});

test('receipt accepts and stores orderedAt, storeName, tax and total', async () => {
  const created = [];
  const service = loadService({
    SpaceConnection: { findOne: async () => connectionDoc() },
    SpaceMessage: { create: async (doc) => { created.push(doc); return { ...doc, createdAt: new Date() }; } },
    SyncSpaceProfile: { findOne: () => chain({ status: 'active', allowPromotions: true }) },
  });
  const ordered = new Date().toISOString();
  await service.sendMessage(creds(), {
    subject: connectionDoc().subject, type: 'receipt', title: 'Order',
    receipt: {
      amount: 10, currency: 'USD', reference: 'ORD-1', storeName: 'Cafe Aura',
      tax: 0.8, total: 10.8, orderedAt: ordered,
      items: [{ name: 'Latte', quantity: 1, amount: 10 }],
    },
  });
  assert.equal(created.length, 1);
  const r = created[0].receipt;
  assert.equal(r.total, 10.8);
  assert.equal(r.tax, 0.8);
  assert.equal(r.storeName, 'Cafe Aura');
  assert.equal(new Date(r.orderedAt).toISOString(), new Date(ordered).toISOString());

  const rejects = [
    { type: 'receipt', receipt: { amount: 1, currency: 'USD', orderedAt: 'not-a-date' } },
    { type: 'receipt', receipt: { amount: 1, currency: 'USD', orderedAt: new Date(Date.now() + 3600_000).toISOString() } },
    { type: 'receipt', receipt: { amount: 1, currency: 'USD', orderedAt: new Date(Date.now() - 3 * 365 * 24 * 3600_000).toISOString() } },
    { type: 'receipt', receipt: { amount: 1, currency: 'USD', storeName: 'x'.repeat(121) } },
    { type: 'receipt', receipt: { amount: 1, currency: 'USD', tax: -1 } },
    { type: 'receipt', receipt: { amount: 1, currency: 'USD', total: -1 } },
  ];
  for (const body of rejects) {
    await assert.rejects(
      service.sendMessage(creds(), { subject: connectionDoc().subject, title: 'x', ...body }),
      { statusCode: 400 },
      JSON.stringify(body).slice(0, 120)
    );
  }
});
