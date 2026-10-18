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
    query[method] = (value) => { query[`_${method}`] = value; return query; };
  }
  query.then = (resolve, reject) => Promise.resolve(
    typeof result === 'function' ? result() : result
  ).then(resolve, reject);
  return query;
};

const loadService = ({ SpaceConnectSession = {}, SpaceConnection = {}, SpaceMessage = {}, SyncSpaceProfile = {}, PartnerApp = {}, PartnerAccount = {}, SpacePairingCode = {}, OAuthAccessToken = {}, OAuthRefreshToken = {} } = {}) =>
  loadWithMocks('../services/syncSpaceConnections', {
    '../models/SpaceConnectSession': SpaceConnectSession,
    '../models/SpaceConnection': SpaceConnection,
    '../models/SpaceMessage': SpaceMessage,
    '../models/SyncSpaceProfile': SyncSpaceProfile,
    '../models/PartnerApp': PartnerApp,
    '../models/PartnerAccount': PartnerAccount,
    '../models/SpacePairingCode': SpacePairingCode,
    '../models/OAuthAccessToken': OAuthAccessToken,
    '../models/OAuthRefreshToken': OAuthRefreshToken,
  });

const profileDoc = (overrides = {}) => ({
  userId: 'user-1',
  syncId: 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE',
  status: 'active',
  allowPromotions: false,
  ...overrides,
});

const appDoc = (overrides = {}) => ({
  appId: 'sp_' + 'ab'.repeat(16),
  partnerId: 'p-1',
  name: 'Orders',
  website: 'https://orders.example.com',
  environment: 'sandbox',
  status: 'active',
  requestedScopes: ['space.messages', 'space.codes'],
  sandboxUserIds: ['user-1'],
  ...overrides,
});

const partnerDoc = (overrides = {}) => ({
  partnerId: 'p-1',
  businessName: 'Acme Inc',
  approvalStatus: 'sandbox',
  ...overrides,
});

const sessionDoc = (token, overrides = {}) => ({
  sessionId: 'cs_' + 'cd'.repeat(16),
  tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
  appId: appDoc().appId,
  partnerId: 'p-1',
  environment: 'sandbox',
  requestedScopes: ['space.messages', 'space.codes'],
  status: 'pending',
  userId: null,
  connectionId: null,
  grantedScopes: [],
  expiresAt: new Date(Date.now() + 600000),
  ...overrides,
});

const sessionModel = (sessions, captured = {}) => {
  const byHash = new Map(sessions.map((s) => [s.tokenHash, s]));
  return {
    findOne: (query) => chain(byHash.get(query.tokenHash) || null),
    findOneAndUpdate: (query, update) => {
      captured.claim = { query, update };
      const session = sessions.find((s) => s.sessionId === query.sessionId);
      const ok = session && session.status === 'pending' && session.expiresAt > query.expiresAt.$gt;
      if (!ok) return chain(null);
      Object.assign(session, update.$set);
      return chain(session);
    },
    updateOne: async (query, update) => {
      captured.writeback = { query, update };
      return {};
    },
  };
};

test('requireActiveProfile distinguishes missing, suspended, and active profiles', async () => {
  const missing = loadService({ SyncSpaceProfile: { findOne: () => chain(null) } });
  await assert.rejects(missing.requireActiveProfile('user-1'), { statusCode: 409, code: 'SYNC_SPACE_NOT_ACTIVATED' });
  const suspended = loadService({
    SyncSpaceProfile: { findOne: () => chain(profileDoc({ status: 'suspended' })) },
  });
  await assert.rejects(suspended.requireActiveProfile('user-1'), { statusCode: 403, code: 'SYNC_SPACE_SUSPENDED' });
  const active = loadService({ SyncSpaceProfile: { findOne: () => chain(profileDoc()) } });
  assert.equal((await active.requireActiveProfile('user-1')).userId, 'user-1');
});

test('previewConnect returns app metadata, requested scopes, and any existing connection', async () => {
  const session = sessionDoc('tok-1');
  const service = loadService({
    SpaceConnectSession: sessionModel([session]),
    PartnerApp: { findOne: () => chain(appDoc()) },
    PartnerAccount: { findOne: () => chain(partnerDoc()) },
    SpaceConnection: {
      findOne: () => chain({ scopes: ['space.messages'], status: 'revoked' }),
    },
  });
  const preview = await service.previewConnect('user-1', 'tok-1');
  assert.equal(preview.sessionId, session.sessionId);
  assert.equal(preview.app.name, 'Orders');
  assert.equal(preview.app.partnerBusinessName, 'Acme Inc');
  assert.deepEqual(preview.requestedScopes, ['space.messages', 'space.codes']);
  assert.deepEqual(preview.existingConnection, { scopes: ['space.messages'], status: 'revoked' });

  for (const token of [null, '', 42, 'unknown-token']) {
    await assert.rejects(service.previewConnect('user-1', token), { statusCode: 404, code: 'CONNECT_SESSION_INVALID' });
  }
});

test('previewConnect enforces app/partner health and sandbox testers', async () => {
  const build = ({ app = appDoc(), partner = partnerDoc() }) => loadService({
    SpaceConnectSession: sessionModel([sessionDoc('tok-1')]),
    PartnerApp: { findOne: () => chain(app) },
    PartnerAccount: { findOne: () => chain(partner) },
    SpaceConnection: { findOne: () => chain(null) },
  });
  for (const [app, partner] of [
    [appDoc({ status: 'disabled' }), partnerDoc()],
    [appDoc(), partnerDoc({ approvalStatus: 'suspended' })],
    [appDoc({ environment: 'live' }), partnerDoc({ approvalStatus: 'sandbox' })],
    [null, partnerDoc()],
    [appDoc(), null],
  ]) {
    await assert.rejects(
      build({ app, partner }).previewConnect('user-1', 'tok-1'),
      { statusCode: 404, code: 'CONNECT_SESSION_INVALID' }
    );
  }
  const liveOk = build({ app: appDoc({ environment: 'live' }), partner: partnerDoc({ approvalStatus: 'approved' }) });
  assert.equal((await liveOk.previewConnect('user-1', 'tok-1')).app.environment, 'live');

  const outsider = build({ app: appDoc({ sandboxUserIds: ['user-2'] }) });
  await assert.rejects(outsider.previewConnect('user-9', 'tok-1'), { statusCode: 403, code: 'SANDBOX_TESTER_REQUIRED' });
});

test('approveConnect claims atomically, subsets scopes, and writes the connection back', async () => {
  const session = sessionDoc('tok-1');
  const captured = {};
  const connStore = { doc: null, calls: [] };
  const service = loadService({
    SpaceConnectSession: sessionModel([session], captured),
    SpaceConnection: {
      findOneAndUpdate: (query, update) => {
        connStore.calls.push(update);
        if (!connStore.doc) return chain(null);
        Object.assign(connStore.doc, update.$set);
        connStore.doc.consentVersion += 1;
        return chain({ ...connStore.doc });
      },
      create: async (doc) => { connStore.doc = { ...doc }; return connStore.doc; },
    },
    PartnerApp: { findOne: () => chain(appDoc()) },
    PartnerAccount: { findOne: () => chain(partnerDoc()) },
  });
  const connection = await service.approveConnect('user-1', 'tok-1', ['space.messages']);
  assert.equal(session.status, 'approved');
  assert.equal(session.userId, 'user-1');
  assert.equal(connection.status, 'active');
  assert.equal(connStore.doc.consentVersion, 1);
  assert.equal(Object.hasOwn(connection, 'consentVersion'), false);
  assert.equal(connection.scopes[0], 'space.messages');
  const { pairwiseSubject } = require('../utils/syncSpaceCrypto');
  assert.equal(connection.app.appId, appDoc().appId);
  assert.equal(captured.writeback.update.$set.connectionId, connStore.doc.connectionId);
  assert.deepEqual(captured.writeback.update.$set.grantedScopes, ['space.messages']);
  assert.equal(Object.hasOwn(connection, 'subject'), false);
  assert.equal(Object.hasOwn(connection, 'userId'), false);
  assert.equal(connStore.doc.subject, pairwiseSubject(appDoc().appId, 'user-1'));

  await assert.rejects(
    service.approveConnect('user-1', 'tok-1', ['space.messages']),
    { statusCode: 404, code: 'CONNECT_SESSION_INVALID' }
  );

  for (const scopes of [['space.receipts'], ['space.messages', 'space.receipts'], 'space.messages', [], ['space.messages', 'space.messages', 'space.codes', 'bogus']]) {
    const s = sessionDoc('tok-2', { sessionId: 'cs_' + 'ef'.repeat(16) });
    const svc = loadService({
      SpaceConnectSession: sessionModel([s]),
      SpaceConnection: { findOneAndUpdate: () => chain(null), create: async (d) => d },
      PartnerApp: { findOne: () => chain(appDoc()) },
      PartnerAccount: { findOne: () => chain(partnerDoc()) },
    });
    await assert.rejects(svc.approveConnect('user-1', 'tok-2', scopes), { statusCode: 400 }, JSON.stringify(scopes));
  }
});

test('re-approval of an existing connection bumps consentVersion and clears revocation', async () => {
  const session = sessionDoc('tok-1');
  const captured = {};
  const existing = {
    connectionId: 'conn_old',
    userId: 'user-1',
    appId: appDoc().appId,
    status: 'revoked',
    scopes: ['space.messages'],
    consentVersion: 3,
    revokedAt: new Date(),
  };
  const service = loadService({
    SpaceConnectSession: sessionModel([session], captured),
    SpaceConnection: {
      findOneAndUpdate: (query, update) => {
        Object.assign(existing, update.$set);
        existing.consentVersion += update.$inc.consentVersion;
        return chain({ ...existing });
      },
      create: async () => { throw new Error('must not create'); },
    },
    PartnerApp: { findOne: () => chain(appDoc()) },
    PartnerAccount: { findOne: () => chain(partnerDoc()) },
  });
  const connection = await service.approveConnect('user-1', 'tok-1', ['space.codes']);
  assert.equal(existing.consentVersion, 4);
  assert.equal(Object.hasOwn(connection, 'consentVersion'), false);
  assert.equal(connection.status, 'active');
  assert.equal(connection.revokedAt, null);
  assert.deepEqual(connection.scopes, ['space.codes']);
});

test('concurrent approvals permit exactly one claim', async () => {
  const session = sessionDoc('tok-1');
  const service = loadService({
    SpaceConnectSession: sessionModel([session]),
    SpaceConnection: {
      findOneAndUpdate: () => chain(null),
      create: async (doc) => doc,
    },
    PartnerApp: { findOne: () => chain(appDoc({ sandboxUserIds: ['user-1', 'user-2'] })) },
    PartnerAccount: { findOne: () => chain(partnerDoc()) },
  });
  const results = await Promise.allSettled([
    service.approveConnect('user-1', 'tok-1', ['space.messages']),
    service.approveConnect('user-2', 'tok-1', ['space.messages']),
  ]);
  const winners = results.filter((r) => r.status === 'fulfilled');
  const losers = results.filter((r) => r.status === 'rejected');
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].reason.statusCode, 404);
});

test('approveConnect blocks non-testers and unusable integrations before claiming', async () => {
  const outsiderSession = sessionDoc('tok-1');
  const captured = {};
  const outsider = loadService({
    SpaceConnectSession: sessionModel([outsiderSession], captured),
    PartnerApp: { findOne: () => chain(appDoc({ sandboxUserIds: ['user-2'] })) },
    PartnerAccount: { findOne: () => chain(partnerDoc()) },
    SpaceConnection: { findOneAndUpdate: () => chain(null), create: async (d) => d },
  });
  await assert.rejects(
    outsider.approveConnect('user-9', 'tok-1', ['space.messages']),
    { statusCode: 403, code: 'SANDBOX_TESTER_REQUIRED' }
  );
  assert.equal(outsiderSession.status, 'pending');
  assert.equal(captured.claim, undefined);

  const disabledSession = sessionDoc('tok-1');
  const disabled = loadService({
    SpaceConnectSession: sessionModel([disabledSession], captured),
    PartnerApp: { findOne: () => chain(appDoc({ status: 'disabled' })) },
    PartnerAccount: { findOne: () => chain(partnerDoc()) },
    SpaceConnection: { findOneAndUpdate: () => chain(null), create: async (d) => d },
  });
  await assert.rejects(
    disabled.approveConnect('user-1', 'tok-1', ['space.messages']),
    { statusCode: 404, code: 'CONNECT_SESSION_INVALID' }
  );
  assert.equal(disabledSession.status, 'pending');

  const livePending = loadService({
    SpaceConnectSession: sessionModel([sessionDoc('tok-1', { environment: 'live' })]),
    PartnerApp: { findOne: () => chain(appDoc({ environment: 'live' })) },
    PartnerAccount: { findOne: () => chain(partnerDoc({ approvalStatus: 'sandbox' })) },
  });
  await assert.rejects(
    livePending.approveConnect('user-1', 'tok-1', ['space.messages']),
    { statusCode: 404, code: 'CONNECT_SESSION_INVALID' }
  );
});

test('declineConnect flips pending sessions to declined once', async () => {
  const session = sessionDoc('tok-1');
  const service = loadService({ SpaceConnectSession: sessionModel([session]) });
  assert.deepEqual(await service.declineConnect('user-1', 'tok-1'), { status: 'declined' });
  assert.equal(session.userId, 'user-1');
  await assert.rejects(service.declineConnect('user-1', 'tok-1'), { statusCode: 404, code: 'CONNECT_SESSION_INVALID' });
});

test('listConnections batches app metadata and never exposes subjects', async () => {
  const service = loadService({
    SpaceConnection: {
      find: () => chain([
        { connectionId: 'conn_1', userId: 'user-1', appId: 'sp_a', subject: 'sub_x', scopes: ['space.messages'], status: 'active', connectedAt: new Date('2026-02-01'), revokedAt: null, environment: 'sandbox', partnerId: 'p-1' },
        { connectionId: 'conn_2', userId: 'user-1', appId: 'sp_b', subject: 'sub_y', scopes: [], status: 'revoked', connectedAt: new Date('2026-01-01'), revokedAt: new Date('2026-02-01'), environment: 'sandbox', partnerId: 'p-2' },
      ]),
    },
    PartnerApp: {
      find: (query) => chain([
        { appId: 'sp_a', name: 'Orders', website: 'https://o.co', status: 'active', environment: 'sandbox' },
        { appId: 'sp_b', name: 'Billing', website: 'https://b.co', status: 'active', environment: 'sandbox' },
      ]),
    },
    PartnerAccount: {
      find: () => chain([
        { partnerId: 'p-1', approvalStatus: 'sandbox' },
        { partnerId: 'p-2', approvalStatus: 'suspended' },
      ]),
    },
  });
  const list = await service.listConnections('user-1');
  assert.equal(list.length, 2);
  assert.equal(list[0].app.name, 'Orders');
  assert.equal(list[1].app.name, 'Billing');
  // appState: active when app+partner are fine, paused when partner suspended
  assert.equal(list[0].appState, 'active');
  assert.equal(list[1].appState, 'paused');
  for (const connection of list) {
    assert.equal(Object.hasOwn(connection, 'subject'), false);
    assert.equal(Object.hasOwn(connection, 'userId'), false);
    assert.equal(Object.hasOwn(connection, 'partnerId'), false);
  }
});

test('revokeConnection is owner-scoped and idempotent', async () => {
  const queries = [];
  const doc = { connectionId: 'conn_1', userId: 'user-1', appId: 'sp_a', scopes: [], status: 'active', connectedAt: new Date(), revokedAt: null, environment: 'sandbox', partnerId: 'p-1' };
  const service = loadService({
    SpaceConnection: {
      findOne: (query) => {
        queries.push(query);
        return chain(query.connectionId === 'conn_1' && query.userId === 'user-1' ? doc : null);
      },
      findOneAndUpdate: (query, update) => {
        Object.assign(doc, update.$set);
        return chain({ ...doc });
      },
    },
    PartnerApp: { findOne: () => chain({ appId: 'sp_a', name: 'Orders', website: '' }) },
    PartnerAccount: { findOne: () => chain(partnerDoc()) },
  });
  const first = await service.revokeConnection('user-1', 'conn_1');
  assert.equal(first.status, 'revoked');
  assert.ok(first.revokedAt instanceof Date);
  const second = await service.revokeConnection('user-1', 'conn_1');
  assert.equal(second.status, 'revoked');
  await assert.rejects(service.revokeConnection('user-2', 'conn_1'), { statusCode: 404 });
  assert.deepEqual(queries[0], { connectionId: 'conn_1', userId: 'user-1' });
});

const messageDoc = (overrides = {}) => ({
  _id: crypto.randomBytes(12).toString('hex'),
  messageId: `msg_${crypto.randomBytes(16).toString('hex')}`,
  userId: 'user-1',
  appId: 'sp_a',
  partnerId: 'p-1',
  connectionId: 'conn_1',
  environment: 'sandbox',
  type: 'message',
  title: 'Hello',
  body: 'Hi',
  receipt: undefined,
  codeExpiresAt: null,
  readAt: null,
  createdAt: new Date(),
  ...overrides,
});

test('listMessages paginates by cursor, filters by type, and never exposes codes', async () => {
  const old = messageDoc({ createdAt: new Date('2026-01-01T00:00:00Z'), type: 'code', codeExpiresAt: new Date('2026-01-01T00:05:00Z') });
  const fresh = messageDoc({ createdAt: new Date('2026-02-01T00:00:00Z'), type: 'receipt', receipt: { amount: 5, currency: 'USD', reference: 'r1', items: [] } });
  const queries = [];
  const service = loadService({
    SpaceMessage: {
      find: (query) => {
        queries.push(query);
        return chain([fresh, old]);
      },
    },
    PartnerApp: { find: () => chain([{ appId: 'sp_a', name: 'Orders' }]) },
  });
  const page = await service.listMessages('user-1', {});
  assert.equal(page.messages.length, 2);
  assert.equal(page.messages[0].app.name, 'Orders');
  assert.equal(page.messages[0].receipt.amount, 5);
  assert.equal(page.messages[1].codeAvailable, false);
  for (const message of page.messages) {
    assert.equal(Object.hasOwn(message, 'code'), false);
    assert.equal(Object.hasOwn(message, 'codeEncrypted'), false);
    assert.equal(Object.hasOwn(message, 'idempotencyKey'), false);
  }

  await service.listMessages('user-1', { type: 'code', limit: '5' });
  assert.equal(queries.at(-1).type, 'code');

  for (const args of [
    { limit: '0' }, { limit: '51' }, { limit: 'abc' }, { limit: '5.5' },
    { type: 'video' }, { cursor: '%%%bad%%%' }, { cursor: Buffer.from('{}').toString('base64url') },
    { cursor: Buffer.from(JSON.stringify({ createdAt: 'x', _id: 'y' })).toString('base64url') },
  ]) {
    await assert.rejects(service.listMessages('user-1', args), { statusCode: 400 }, JSON.stringify(args));
  }

  const cursor = Buffer.from(JSON.stringify({
    createdAt: '2026-01-15T00:00:00Z',
    _id: 'a'.repeat(24),
  })).toString('base64url');
  await service.listMessages('user-1', { cursor });
  assert.ok(Array.isArray(queries.at(-1).$or));
});

test('markMessageRead sets readAt once and is idempotent', async () => {
  const doc = messageDoc();
  const service = loadService({
    SpaceMessage: {
      findOneAndUpdate: (query, update) => {
        const ok = query.messageId === doc.messageId && query.userId === 'user-1' && doc.readAt === null;
        if (!ok) return chain(null);
        doc.readAt = update.$set.readAt;
        return chain({ ...doc });
      },
      findOne: (query) => chain(query.userId === 'user-1' && query.messageId === doc.messageId ? doc : null),
    },
    PartnerApp: { findOne: () => chain(null) },
  });
  const first = await service.markMessageRead('user-1', doc.messageId);
  assert.ok(first.readAt instanceof Date);
  const again = await service.markMessageRead('user-1', doc.messageId);
  assert.deepEqual(again.readAt, first.readAt);
  await assert.rejects(service.markMessageRead('user-2', doc.messageId), { statusCode: 404 });
});

test('revealMessageCode decrypts own unexpired codes only', async () => {
  const { encryptSecret } = require('../utils/syncSpaceCrypto');
  const messageId = 'msg_' + 'aa'.repeat(16);
  const valid = messageDoc({
    messageId,
    type: 'code',
    codeEncrypted: encryptSecret('482913', `code:${messageId}`),
    codeExpiresAt: new Date(Date.now() + 60000),
  });
  const expired = messageDoc({
    messageId,
    type: 'code',
    codeEncrypted: encryptSecret('482913', `code:${messageId}`),
    codeExpiresAt: new Date(Date.now() - 1000),
  });
  const build = (doc) => loadService({
    SpaceMessage: {
      findOne: (query) => {
        const q = { select: () => chain(query.userId === 'user-1' && query.messageId === messageId ? doc : null) };
        return q;
      },
    },
  });
  const result = await build(valid).revealMessageCode('user-1', messageId);
  assert.equal(result.code, '482913');
  assert.deepEqual(result.expiresAt, valid.codeExpiresAt);
  await assert.rejects(build(valid).revealMessageCode('user-2', messageId), { statusCode: 404 });
  await assert.rejects(build(expired).revealMessageCode('user-1', messageId), { statusCode: 410, code: 'CODE_EXPIRED' });
  await assert.rejects(build(messageDoc({ messageId, type: 'message' })).revealMessageCode('user-1', messageId), { statusCode: 404 });
});

test('tester add/remove resolves Sync IDs to private userIds only', async () => {
  const { pairwiseSubject } = require('../utils/syncSpaceCrypto');
  const app = appDoc({ sandboxUserIds: [] });
  const captured = [];
  const service = loadWithMocks('../services/partnerService', {
    '../models/PartnerAccount': { findOne: () => chain({ partnerId: 'p-1', emailVerifiedAt: new Date(), approvalStatus: 'sandbox', passwordHash: 'x' }) },
    '../models/PartnerApp': {
      findOne: (query) => chain(query.partnerId === 'p-1' && query.appId === app.appId ? app : null),
      findOneAndUpdate: (query, update) => {
        captured.push({ query, update });
        if (update.$addToSet) {
          app.sandboxUserIds.push(update.$addToSet.sandboxUserIds);
        }
        return chain({ ...app });
      },
      updateOne: async (query, update) => {
        app.sandboxUserIds = app.sandboxUserIds.filter((id) => id !== update.$pull.sandboxUserIds);
        return {};
      },
    },
    '../models/PartnerApiKey': {},
    '../models/PartnerEmailChallenge': {},
    '../models/SyncSpaceProfile': {
      findOne: (query) => chain(query.syncId === 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE' ? { userId: 'user-42', syncId: query.syncId, status: 'active' } : null),
      find: (query) => chain(
        query.userId.$in.filter((id) => id === 'user-42').map((id) => ({ userId: id, syncId: 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE' }))
      ),
    },
    './emailService': { sendOTP: async () => ({ success: true }) },
    bcryptjs: { hash: async () => 'h', compare: async () => false },
  });

  const testers = await service.addSandboxTester('p-1', app.appId, 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE');
  assert.deepEqual(app.sandboxUserIds, ['user-42']);
  assert.deepEqual(testers, ['SYNC-AAAA-BBBB-CCCC-DDDD-EEEE']);
  for (const bad of ['SYNC-bad', 'user-42', null, 42]) {
    await assert.rejects(service.addSandboxTester('p-1', app.appId, bad), { statusCode: 400 });
  }
  await assert.rejects(service.addSandboxTester('p-1', app.appId, 'SYNC-1111-2222-3333-4444-5555'), { statusCode: 404 });

  await service.removeSandboxTester('p-1', app.appId, 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE');
  assert.deepEqual(app.sandboxUserIds, []);

  const liveApp = appDoc({ environment: 'live', sandboxUserIds: [] });
  const liveService = loadWithMocks('../services/partnerService', {
    '../models/PartnerAccount': { findOne: () => chain({ partnerId: 'p-1', emailVerifiedAt: new Date(), approvalStatus: 'approved' }) },
    '../models/PartnerApp': { findOne: () => chain(liveApp) },
    '../models/PartnerApiKey': {},
    '../models/PartnerEmailChallenge': {},
    '../models/SyncSpaceProfile': {},
    './emailService': {},
    bcryptjs: { hash: async () => 'h', compare: async () => false },
  });
  await assert.rejects(
    liveService.addSandboxTester('p-1', liveApp.appId, 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE'),
    { statusCode: 403 }
  );
});

test('listEverspace aggregates receipts per connection with multi-currency totals', async () => {
  const appA = 'sp_' + 'aa'.repeat(16);
  const appB = 'sp_' + 'bb'.repeat(16);
  const conns = [
    { connectionId: 'conn_a', userId: 'user-1', appId: appA, partnerId: 'p-1', environment: 'sandbox', status: 'active', connectedAt: new Date('2026-01-01'), subject: 'sub_a' },
    { connectionId: 'conn_b', userId: 'user-1', appId: appB, partnerId: 'p-2', environment: 'live', status: 'revoked', connectedAt: new Date('2026-01-02'), subject: 'sub_b' },
  ];
  const aggRows = [
    { _id: { appId: appA, currency: 'USD' }, count: 2, total: 30.5, last: new Date('2026-02-01') },
    { _id: { appId: appA, currency: 'INR' }, count: 1, total: 500, last: new Date('2026-02-02') },
    { _id: { appId: appB, currency: 'USD' }, count: 1, total: 12, last: new Date('2026-01-15') },
  ];
  const service = loadService({
    SpaceConnection: { find: () => chain(conns) },
    SpaceMessage: { aggregate: async () => aggRows },
    PartnerApp: { find: () => chain([
      { appId: appA, name: 'Orders', website: 'https://orders.example.com', status: 'active' },
      { appId: appB, name: 'Cafe', website: '', status: 'active' },
    ]) },
    PartnerAccount: { find: () => chain([
      { partnerId: 'p-1', approvalStatus: 'sandbox' },
      { partnerId: 'p-2', approvalStatus: 'approved' },
    ]) },
  });
  const { partners } = await service.listEverspace('user-1');
  assert.equal(partners.length, 2);
  // latest activity first — appA's newest receipt beats appB
  assert.equal(partners[0].app.appId, appA);
  assert.equal(partners[0].app.name, 'Orders');
  assert.equal(partners[0].stats.receiptCount, 3);
  assert.equal(new Date(partners[0].stats.lastActivityAt).getTime(), new Date('2026-02-02').getTime());
  assert.deepEqual(partners[0].stats.totals, [
    { currency: 'USD', amount: 30.5 },
    { currency: 'INR', amount: 500 },
  ]);
  assert.equal(partners[1].status, 'revoked');
  assert.equal(partners[1].stats.receiptCount, 1);
  // never leaks userId/syncId
  assert.equal(JSON.stringify(partners).includes('user-1'), false);
});

test('listEverspace sorts connections without receipts by connectedAt', async () => {
  const conns = [
    { connectionId: 'c1', userId: 'u', appId: 'sp_a', partnerId: 'p-1', environment: 'sandbox', status: 'active', connectedAt: new Date('2026-01-01'), subject: 's1' },
    { connectionId: 'c2', userId: 'u', appId: 'sp_b', partnerId: 'p-1', environment: 'sandbox', status: 'active', connectedAt: new Date('2026-01-05'), subject: 's2' },
  ];
  const service = loadService({
    SpaceConnection: { find: () => chain(conns) },
    SpaceMessage: { aggregate: async () => [] },
    PartnerApp: { find: () => chain([{ appId: 'sp_a', name: 'A', status: 'active' }, { appId: 'sp_b', name: 'B', status: 'active' }]) },
    PartnerAccount: { find: () => chain([partnerDoc()]) },
  });
  const { partners } = await service.listEverspace('u');
  assert.equal(partners[0].app.appId, 'sp_b');
  assert.deepEqual(partners[0].stats, { receiptCount: 0, lastActivityAt: null, totals: [] });
});

test('listEverspaceReceipts returns own-connection receipts with cursor pagination', async () => {
  const app = appDoc();
  const conn = { connectionId: 'conn_1', userId: 'user-1', appId: app.appId, environment: 'sandbox', status: 'active' };
  const msgs = [
    { _id: '6'.repeat(24), messageId: 'm1', userId: 'user-1', appId: app.appId, type: 'receipt', title: 'Order', receipt: { amount: 5, currency: 'USD', total: 6, storeName: 'Cafe' }, environment: 'sandbox', createdAt: new Date('2026-02-01'), readAt: null },
    { _id: '5'.repeat(24), messageId: 'm2', userId: 'user-1', appId: app.appId, type: 'receipt', title: 'Order', receipt: { amount: 5, currency: 'USD' }, environment: 'sandbox', createdAt: new Date('2026-01-01'), readAt: null },
  ];
  const queries = [];
  const service = loadService({
    SpaceConnection: { findOne: (q) => chain(q.userId === 'user-1' ? conn : null) },
    SpaceMessage: { find: (q) => { queries.push(q); return chain(msgs); } },
    PartnerApp: { findOne: () => chain(app) },
  });
  const page = await service.listEverspaceReceipts('user-1', 'conn_1', { limit: '10' });
  assert.equal(page.receipts.length, 2);
  assert.equal(page.receipts[0].receipt.total, 6);
  assert.equal(page.receipts[0].receipt.storeName, 'Cafe');
  assert.equal(queries[0].type, 'receipt');
  assert.equal(queries[0].appId, app.appId);

  // someone else's connection → 404
  await assert.rejects(service.listEverspaceReceipts('other', 'conn_1', {}), { statusCode: 404 });
  await assert.rejects(service.listEverspaceReceipts('user-1', 'conn_1', { limit: 'abc' }), { statusCode: 400 });
});

// --- QR pairing status + unread inbox controls -----------------------------

test('createPairingQr returns a pairingId and status is pending until consumed', async () => {
  const docs = [];
  const service = loadService({
    SpacePairingCode: {
      countDocuments: async () => 0,
      updateMany: async () => ({ modifiedCount: 0 }),
      create: async (doc) => {
        const stored = { pairingId: 'pr_1234', ...doc };
        docs.push(stored);
        return stored;
      },
      findOne: (q) => chain(docs.find((d) => d.pairingId === q.pairingId && d.userId === q.userId) || null),
    },
  });
  const created = await service.createPairingQr('user-1');
  assert.equal(created.pairingId, 'pr_1234');
  assert.match(created.qrPayload, /^syncspace:pair:/);

  const status = await service.getPairingQrStatus('user-1', 'pr_1234');
  assert.equal(status.status, 'pending');
  assert.equal(Object.hasOwn(status, 'app'), false);
});

test('getPairingQrStatus reports expired and consumed (with app) correctly', async () => {
  const pairing = {
    pairingId: 'pr_9', kind: 'qr', userId: 'user-1', status: 'pending',
    expiresAt: new Date(Date.now() - 1000),
  };
  const app = appDoc({ environment: 'sandbox' });
  const mkService = (doc) => loadService({
    SpacePairingCode: {
      findOne: (q) => chain(doc && doc.pairingId === q.pairingId && doc.userId === q.userId ? doc : null),
    },
    PartnerApp: { findOne: () => chain(app) },
  });
  const expired = await mkService(pairing).getPairingQrStatus('user-1', 'pr_9');
  assert.equal(expired.status, 'expired');

  const consumedDoc = { ...pairing, status: 'consumed', appId: app.appId, expiresAt: new Date(Date.now() + 60_000) };
  const consumed = await mkService(consumedDoc).getPairingQrStatus('user-1', 'pr_9');
  assert.equal(consumed.status, 'consumed');
  assert.equal(consumed.app.name, 'Orders');
  assert.equal(consumed.app.environment, 'sandbox');

  // own-only: other user's pairingId → 404
  await assert.rejects(mkService(consumedDoc).getPairingQrStatus('user-2', 'pr_9'), { statusCode: 404 });
});

test('unreadCount and markAllRead respect ownership and the type filter', async () => {
  const queries = [];
  const service = loadService({
    SpaceMessage: {
      countDocuments: async (q) => { queries.push(q); return 3; },
      updateMany: async (q, update) => { queries.push(q); return { modifiedCount: 5 }; },
    },
  });
  assert.deepEqual(await service.unreadCount('user-1'), { unread: 3 });
  assert.deepEqual(queries[0], { userId: 'user-1', readAt: null });

  const all = await service.markAllRead('user-1', {});
  assert.equal(all.unread, 0);
  assert.equal(all.marked, 5);
  assert.deepEqual(queries[1], { userId: 'user-1', readAt: null });

  await service.markAllRead('user-1', { type: 'code' });
  assert.deepEqual(queries[2], { userId: 'user-1', readAt: null, type: 'code' });
  await assert.rejects(service.markAllRead('user-1', { type: 'bogus' }), { statusCode: 400 });
});

// ---------- per-app scope narrowing (field-level sharing) ----------

const connScopeService = (conn) => {
  const docs = [conn];
  const access = [{ tokenId: 't1', userId: 'user-1', appId: conn.appId, revokedAt: null }];
  const refresh = [{ tokenId: 'r1', userId: 'user-1', appId: conn.appId, revokedAt: null }];
  const service = loadService({
    SpaceConnection: {
      findOne: (q) => chain(docs.find((d) => d.connectionId === q.connectionId && d.userId === q.userId) || null),
      findOneAndUpdate: (q, update) => {
        const d = docs.find((x) => x.connectionId === q.connectionId && x.userId === q.userId && x.status === 'active');
        if (!d) return chain(null);
        Object.assign(d, update.$set);
        d.consentVersion += update.$inc.consentVersion;
        return chain(d);
      },
    },
    PartnerApp: { findOne: () => chain(appDoc()) },
    PartnerAccount: { findOne: () => chain(partnerDoc()) },
    OAuthAccessToken: {
      updateMany: async (q, u) => access.forEach((t) => {
        if (t.userId === q.userId && t.appId === q.appId && t.revokedAt === null) t.revokedAt = u.$set.revokedAt;
      }),
    },
    OAuthRefreshToken: {
      updateMany: async (q, u) => refresh.forEach((t) => {
        if (t.userId === q.userId && t.appId === q.appId && t.revokedAt === null) t.revokedAt = u.$set.revokedAt;
      }),
    },
  });
  return { service, conn, access, refresh };
};

const connWithScopes = (overrides = {}) => ({
  connectionId: 'conn_1', userId: 'user-1', appId: 'sp_1', partnerId: 'p-1',
  scopes: ['openid', 'profile', 'email', 'phone', 'picture'],
  requiredScopes: ['openid', 'profile', 'email', 'phone'],
  status: 'active', consentVersion: 2, environment: 'sandbox', subject: 's',
  connectedAt: new Date(), revokedAt: null,
  ...overrides,
});

test('updateConnectionScopes removes an optional extra and revokes OAuth tokens', async () => {
  const { service, conn, access, refresh } = connScopeService(connWithScopes());
  const dto = await service.updateConnectionScopes('user-1', 'conn_1',
    ['openid', 'profile', 'email', 'phone']);
  assert.deepEqual(dto.scopes.sort(), ['email', 'openid', 'phone', 'profile'].sort());
  assert.equal(dto.requiredScopes.length, 4);
  assert.equal(conn.consentVersion, 3);
  assert.ok(access[0].revokedAt && refresh[0].revokedAt);
});

test('updateConnectionScopes rejects removing required/mandatory or adding scopes', async () => {
  const { service } = connScopeService(connWithScopes());
  await assert.rejects(
    service.updateConnectionScopes('user-1', 'conn_1', ['openid', 'profile', 'email', 'picture']),
    { statusCode: 400 }); // phone is required
  await assert.rejects(
    service.updateConnectionScopes('user-1', 'conn_1', ['openid', 'profile', 'phone', 'picture']),
    { statusCode: 400 }); // email is mandatory
  await assert.rejects(
    service.updateConnectionScopes('user-1', 'conn_1',
      ['openid', 'profile', 'email', 'phone', 'picture', 'gender']),
    { statusCode: 400 }); // cannot add
  await assert.rejects(
    service.updateConnectionScopes('user-1', 'conn_1', 'nope'),
    { statusCode: 400 });
  await assert.rejects(
    service.updateConnectionScopes('user-1', 'conn_missing', ['openid']),
    { statusCode: 404 });
});
