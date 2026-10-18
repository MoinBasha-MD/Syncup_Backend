const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const test = require('node:test');

process.env.SYNC_SPACE_DATA_KEY = 'ef'.repeat(32);
process.env.SYNC_SPACE_SUBJECT_KEY = 'subject-key-0123456789abcdef-32chars!!';

const { digestSecret, decryptSecret } = require('../utils/syncSpaceCrypto');

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

const activeProfile = { userId: 'user-1', status: 'active', allowPromotions: true };

const connectionStore = () => {
  const store = { doc: null };
  return {
    store,
    model: {
      findOneAndUpdate: async (query, update) => {
        if (!store.doc) return null;
        Object.assign(store.doc, update.$set || {});
        if (update.$inc && update.$inc.consentVersion) store.doc.consentVersion += 1;
        return { ...store.doc };
      },
      create: async (doc) => { store.doc = { ...doc }; return { ...doc }; },
    },
  };
};

const { pairwiseSubject } = require('../utils/syncSpaceCrypto');

// Stub the inner upsert with the test's SpaceConnection mock — the real module is
// verified directly by syncSpaceConnections tests (approveConnect uses it).
const upsertUsing = (connModel) => ({
  upsertConnection: async ({ userId, app, scopes }) => {
    const now = new Date();
    const subject = pairwiseSubject(app.appId, userId);
    const existing = await connModel.findOneAndUpdate(
      { userId, appId: app.appId },
      {
        $set: { status: 'active', scopes, subject, connectedAt: now, revokedAt: null },
        $inc: { consentVersion: 1 },
      },
      { new: true }
    );
    if (existing) return existing;
    return connModel.create({
      connectionId: `conn_${crypto.randomBytes(16).toString('hex')}`,
      userId,
      appId: app.appId,
      partnerId: app.partnerId,
      environment: app.environment,
      subject,
      scopes,
      status: 'active',
      consentVersion: 1,
      connectedAt: now,
    });
  },
});

const loadPartnerService = ({ SpacePairingCode = {}, SpaceConnection, SyncSpaceProfile, User, notifications } = {}) => {
  const connModel = SpaceConnection || connectionStore().model;
  return loadWithMocks('../services/partnerSpaceService', {
    '../models/SpaceConnectSession': {},
    '../models/SpaceConnection': connModel,
    '../models/SpaceMessage': {},
    '../models/SpacePairingCode': SpacePairingCode,
    '../models/SyncSpaceProfile': SyncSpaceProfile || { findOne: () => chain(activeProfile) },
    '../models/userModel': User || { findOne: () => chain(null) },
    '../models/PartnerApp': {},
    '../models/PartnerAccount': {},
    './syncSpaceConnections': upsertUsing(connModel),
    './notificationDispatcher': notifications || { dispatchNotification: async () => ({}) },
  });
};

const loadUserService = ({ SpacePairingCode = {}, PartnerApp = {}, SpaceConnection = {} } = {}) =>
  loadWithMocks('../services/syncSpaceConnections', {
    '../models/SpaceConnectSession': {},
    '../models/SpaceConnection': SpaceConnection,
    '../models/SpaceMessage': {},
    '../models/SpacePairingCode': SpacePairingCode,
    '../models/SyncSpaceProfile': {},
    '../models/PartnerApp': PartnerApp,
    '../models/PartnerAccount': {},
  });

// ---------- QR pairing ----------

test('pairByQr consumes a valid user QR and creates a connection', async () => {
  const notifications = [];
  const pairing = {
    _id: 'pc1', kind: 'qr', userId: 'user-1', status: 'pending',
    codeHash: digestSecret('raw-qr-token'),
    expiresAt: new Date(Date.now() + 300000),
  };
  const conn = connectionStore();
  const claims = [];
  const service = loadPartnerService({
    SpacePairingCode: {
      findOne: (q) => chain(q.codeHash === pairing.codeHash ? pairing : null),
      findOneAndUpdate: (q, u) => { claims.push(u); return chain({ ...pairing, status: 'consumed' }); },
    },
    SpaceConnection: conn.model,
    notifications: { dispatchNotification: async (a) => { notifications.push(a); return {}; } },
  });
  const result = await service.pairByQr(
    { app: appDoc(), key: keyDoc() },
    'syncspace:pair:raw-qr-token'
  );
  assert.match(result.subject, /^sub_[A-Za-z0-9_-]{32}$/);
  assert.equal(result.scopes.includes('space.messages'), true);
  assert.equal(conn.store.doc.status, 'active');
  assert.equal(conn.store.doc.userId, 'user-1');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].toUserId, 'user-1');
  assert.equal(notifications[0].type, 'sync_space_connected');
  assert.equal(notifications[0].data.kind, 'sync_space_connected');
  assert.match(notifications[0].body, /You're now connected to Orders/);
});

test('pairByQr rejects invalid, expired, used, and raced codes with 404', async () => {
  const pairing = {
    _id: 'pc1', kind: 'qr', userId: 'user-1', status: 'pending',
    codeHash: digestSecret('raw-qr-token'),
    expiresAt: new Date(Date.now() + 300000),
  };
  const mk = (findResult, claimResult) => loadPartnerService({
    SpacePairingCode: {
      findOne: (q) => chain(q.codeHash === pairing.codeHash ? findResult : null),
      findOneAndUpdate: () => chain(claimResult),
    },
  });

  await assert.rejects(mk(pairing, null).pairByQr({ app: appDoc(), key: keyDoc() }, 'nope-qr'), { statusCode: 404, code: 'PAIRING_INVALID' });
  await assert.rejects(mk(null, null).pairByQr({ app: appDoc(), key: keyDoc() }, 'syncspace:pair:raw-qr-token'), { statusCode: 404, code: 'PAIRING_INVALID' });
  await assert.rejects(
    mk({ ...pairing, expiresAt: new Date(Date.now() - 1000) }, null)
      .pairByQr({ app: appDoc(), key: keyDoc() }, 'syncspace:pair:raw-qr-token'),
    { statusCode: 404, code: 'PAIRING_INVALID' }
  );
  await assert.rejects(
    mk({ ...pairing, status: 'consumed' }, null)
      .pairByQr({ app: appDoc(), key: keyDoc() }, 'syncspace:pair:raw-qr-token'),
    { statusCode: 404, code: 'PAIRING_INVALID' }
  );
  // claim race: still pending at read, lost at claim
  await assert.rejects(
    mk(pairing, null).pairByQr({ app: appDoc(), key: keyDoc() }, 'syncspace:pair:raw-qr-token'),
    { statusCode: 404, code: 'PAIRING_INVALID' }
  );
});

test('pairByQr does not burn the code when the tester/profile rules fail', async () => {
  const pairing = {
    _id: 'pc1', kind: 'qr', userId: 'user-9', status: 'pending',
    codeHash: digestSecret('raw-qr-token'),
    expiresAt: new Date(Date.now() + 300000),
  };
  let claimed = false;
  const service = loadPartnerService({
    SpacePairingCode: {
      findOne: () => chain(pairing),
      findOneAndUpdate: () => { claimed = true; return chain(null); },
    },
  });
  // user-9 is not in app.sandboxUserIds
  await assert.rejects(
    service.pairByQr({ app: appDoc(), key: keyDoc() }, 'syncspace:pair:raw-qr-token'),
    { statusCode: 404, code: 'PAIRING_INVALID' }
  );
  assert.equal(claimed, false);

  const noProfile = loadPartnerService({
    SpacePairingCode: {
      findOne: () => chain({ ...pairing, userId: 'user-1' }),
      findOneAndUpdate: () => { claimed = true; return chain(null); },
    },
    SyncSpaceProfile: { findOne: () => chain(null) },
  });
  await assert.rejects(
    noProfile.pairByQr({ app: appDoc(), key: keyDoc() }, 'syncspace:pair:raw-qr-token'),
    { statusCode: 404, code: 'PAIRING_INVALID' }
  );
  assert.equal(claimed, false);
});

test('pairing grants promotions only when the user opted into offers', async () => {
  const pairing = {
    _id: 'pc1', kind: 'qr', userId: 'user-1', status: 'pending',
    codeHash: digestSecret('raw-qr-token'),
    expiresAt: new Date(Date.now() + 300000),
  };
  const run = async (allowPromotions) => {
    const conn = connectionStore();
    const service = loadPartnerService({
      SpacePairingCode: {
        findOne: () => chain(pairing),
        findOneAndUpdate: () => chain({ ...pairing, status: 'consumed' }),
      },
      SpaceConnection: conn.model,
      SyncSpaceProfile: { findOne: () => chain({ ...activeProfile, allowPromotions }) },
    });
    const result = await service.pairByQr({ app: appDoc(), key: keyDoc() }, 'syncspace:pair:raw-qr-token');
    return result.scopes;
  };
  assert.deepEqual(await run(true), ['space.messages', 'space.codes', 'space.receipts', 'space.promotions']);
  assert.deepEqual(await run(false), ['space.messages', 'space.codes', 'space.receipts']);

  // A key without business scopes cannot pair at all.
  const conn = connectionStore();
  const noScope = loadPartnerService({
    SpacePairingCode: {
      findOne: () => chain(pairing),
      findOneAndUpdate: () => chain({ ...pairing, status: 'consumed' }),
    },
    SpaceConnection: conn.model,
  });
  await assert.rejects(
    noScope.pairByQr({ app: appDoc(), key: keyDoc({ scopes: ['openid'] }) }, 'syncspace:pair:raw-qr-token'),
    { statusCode: 400 }
  );
});

test('createPairingQr invalidates previous pending codes and enforces hourly cap', async () => {
  const updates = [];
  const service = loadUserService({
    SpacePairingCode: {
      countDocuments: async () => 0,
      updateMany: async (q, u) => { updates.push({ q, u }); return {}; },
      create: async (doc) => doc,
    },
  });
  const result = await service.createPairingQr('user-1');
  assert.match(result.qrPayload, /^syncspace:pair:[A-Za-z0-9_-]{32}$/);
  assert.ok(result.expiresAt instanceof Date);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].q, { userId: 'user-1', kind: 'qr', status: 'pending' });
  assert.equal(updates[0].u.$set.expiresAt instanceof Date, true);

  const capped = loadUserService({
    SpacePairingCode: {
      countDocuments: async () => 20,
      updateMany: async () => ({}),
      create: async () => { throw new Error('must not create'); },
    },
  });
  await assert.rejects(capped.createPairingQr('user-1'), { statusCode: 429 });
});

// ---------- OTP pairing ----------

test('requestOtpPairing returns identical shape for real and unknown identifiers', async () => {
  const creates = [];
  const notifications = [];
  const SpacePairingCode = {
    countDocuments: async () => 0,
    create: async (doc) => {
      const full = { ...doc, pairingId: doc.pairingId || `pr_${'dd'.repeat(8)}` };
      creates.push(full);
      return { ...full };
    },
  };
  const real = loadPartnerService({
    SpacePairingCode,
    SyncSpaceProfile: { findOne: (q) => chain(q.syncId === 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE' ? activeProfile : null) },
    notifications: { dispatchNotification: async (a) => { notifications.push(a); return {}; } },
  });
  const ok = await real.requestOtpPairing({ app: appDoc(), key: keyDoc() }, 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE');
  assert.match(ok.pairingId, /^pr_[a-f0-9]{16}$/);
  assert.equal(creates[0].userId, 'user-1');
  assert.equal(creates[0].kind, 'otp');
  // code stored hashed + encrypted, never plaintext
  assert.notEqual(String(creates[0].codeHash).length, 0);
  assert.match(decryptSecret(creates[0].codeEncrypted, `pair:${creates[0].pairingId}`), /^\d{6}$/);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'sync_space_pairing');
  assert.equal(notifications[0].data.kind, 'sync_space_pairing');
  assert.match(notifications[0].body, /wants to connect/);
  assert.doesNotMatch(notifications[0].body, /\d{6}/);
  assert.equal(creates[0].codeHash, digestSecret(`${creates[0].pairingId}:${decryptSecret(creates[0].codeEncrypted, `pair:${creates[0].pairingId}`)}`));

  creates.length = 0;
  notifications.length = 0;
  const decoy = await real.requestOtpPairing({ app: appDoc(), key: keyDoc() }, 'SYNC-0000-0000-0000-0000-0000');
  assert.match(decoy.pairingId, /^pr_[a-f0-9]{16}$/);
  assert.equal(creates[0].userId, null); // decoy
  assert.equal(notifications.length, 0);
});

test('requestOtpPairing resolves usernames and suppresses notifications over per-app cap', async () => {
  const creates = [];
  const notifications = [];
  const service = loadPartnerService({
    SpacePairingCode: {
      countDocuments: async () => 0,
      create: async (doc) => {
        const full = { ...doc, pairingId: doc.pairingId || `pr_${'dd'.repeat(8)}` };
        creates.push(full);
        return { ...full };
      },
    },
    User: { findOne: (q) => chain(q.username === 'alice' ? { userId: 'user-1' } : null) },
    SyncSpaceProfile: { findOne: (q) => chain(q.userId ? activeProfile : null) },
    notifications: { dispatchNotification: async (a) => { notifications.push(a); return {}; } },
  });
  const res = await service.requestOtpPairing({ app: appDoc(), key: keyDoc() }, 'Alice');
  assert.match(res.pairingId, /^pr_[a-f0-9]{16}$/);
  assert.equal(creates[0].userId, 'user-1');
  assert.equal(notifications.length, 1);
});

test('requestOtpPairing caps at 3 pending per app per 15min without notifying', async () => {
  const creates = [];
  const notifications = [];
  const service = loadPartnerService({
    SpacePairingCode: {
      countDocuments: async (q) => (q.appId ? 3 : 0),
      create: async (doc) => {
        const full = { ...doc, pairingId: doc.pairingId || `pr_${'dd'.repeat(8)}` };
        creates.push(full);
        return { ...full };
      },
    },
    SyncSpaceProfile: { findOne: (q) => chain(q.syncId === 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE' ? activeProfile : null) },
    notifications: { dispatchNotification: async (a) => { notifications.push(a); return {}; } },
  });
  const res = await service.requestOtpPairing({ app: appDoc(), key: keyDoc() }, 'SYNC-AAAA-BBBB-CCCC-DDDD-EEEE');
  assert.match(res.pairingId, /^pr_/);
  assert.equal(creates[0].userId, null); // capped → silent decoy
  assert.equal(notifications.length, 0);
});

test('verifyOtpPairing: generic 400 for wrong app, wrong code, locked and decoy', async () => {
  const CODE = '482913';
  const pairing = {
    _id: 'pc2', pairingId: 'pr_' + 'cd'.repeat(8), kind: 'otp', userId: 'user-1',
    appId: 'sp_' + 'ab'.repeat(16), status: 'pending', attempts: 0,
    codeHash: digestSecret(`pr_${'cd'.repeat(8)}:${CODE}`),
    expiresAt: new Date(Date.now() + 300000),
  };
  // Mock honors the claim filters (appId ownership, pending, userId non-null, attempts<5).
  const mkService = (doc, extra = {}) => {
    const updates = [];
    return {
      updates,
      service: loadPartnerService({
        SpacePairingCode: {
          findOneAndUpdate: (q, u) => {
            if (u.$inc) {
              updates.push(u);
              const ok = doc && q.appId === doc.appId && doc.status === 'pending' &&
                doc.userId !== null && doc.attempts < 5;
              return chain(ok ? { ...doc, attempts: doc.attempts + 1 } : null);
            }
            // consume step
            return chain(doc && doc.status === 'pending' ? { ...doc, status: 'consumed' } : null);
          },
          updateOne: async () => ({}),
        },
        SpaceConnection: connectionStore().model,
        ...extra,
      }),
    };
  };

  const { service } = mkService(pairing);
  await assert.rejects(service.verifyOtpPairing(
    { app: appDoc({ appId: 'sp_' + 'ff'.repeat(16) }), key: keyDoc() },
    pairing.pairingId, CODE
  ), { statusCode: 400, code: 'PAIRING_CODE_INVALID' });

  await assert.rejects(service.verifyOtpPairing(
    { app: appDoc(), key: keyDoc() }, pairing.pairingId, '000000'
  ), { statusCode: 400, code: 'PAIRING_CODE_INVALID' });

  const locked = mkService({ ...pairing, attempts: 5 });
  await assert.rejects(locked.service.verifyOtpPairing(
    { app: appDoc(), key: keyDoc() }, pairing.pairingId, CODE
  ), { statusCode: 400, code: 'PAIRING_CODE_INVALID' });

  const decoy = mkService({ ...pairing, userId: null });
  await assert.rejects(decoy.service.verifyOtpPairing(
    { app: appDoc(), key: keyDoc() }, pairing.pairingId, CODE
  ), { statusCode: 400, code: 'PAIRING_CODE_INVALID' });
});

test('verifyOtpPairing consumes a correct code and pairs the user', async () => {
  const CODE = '482913';
  const pairingId = 'pr_' + 'cd'.repeat(8);
  const doc = {
    _id: 'pc2', pairingId, kind: 'otp', userId: 'user-1',
    appId: 'sp_' + 'ab'.repeat(16), status: 'pending', attempts: 0,
    codeHash: digestSecret(`${pairingId}:${CODE}`),
    expiresAt: new Date(Date.now() + 300000),
  };
  const notifications = [];
  const conn = connectionStore();
  const service = loadPartnerService({
    SpacePairingCode: {
      findOneAndUpdate: (q, u) => {
        if (u.$inc) return chain({ ...doc, attempts: doc.attempts + 1 });
        return chain({ ...doc, status: 'consumed' });
      },
    },
    SpaceConnection: conn.model,
    notifications: { dispatchNotification: async (a) => { notifications.push(a); return {}; } },
  });
  const result = await service.verifyOtpPairing({ app: appDoc(), key: keyDoc() }, pairingId, CODE);
  assert.match(result.subject, /^sub_/);
  assert.equal(conn.store.doc.userId, 'user-1');
  assert.equal(conn.store.doc.status, 'active');
  assert.equal(notifications.length, 1);
});

test('user pairing requests list decrypts codes and decline works', async () => {
  const pairingId = 'pr_' + 'ef'.repeat(8);
  const docs = [{
    pairingId, kind: 'otp', userId: 'user-1', appId: 'sp_' + 'ab'.repeat(16),
    status: 'pending', expiresAt: new Date(Date.now() + 300000),
    codeEncrypted: require('../utils/syncSpaceCrypto').encryptSecret('654321', `pair:${pairingId}`),
  }];
  const declines = [];
  const service = loadUserService({
    SpacePairingCode: {
      find: () => chain(docs),
      findOneAndUpdate: (q, u) => { declines.push({ q, u }); return chain({ ...docs[0], status: 'declined' }); },
    },
    PartnerApp: {
      find: () => chain([{ appId: 'sp_' + 'ab'.repeat(16), name: 'Orders', website: 'https://orders.example.com', environment: 'sandbox' }]),
    },
  });
  const requests = await service.listPairingRequests('user-1');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pairingId, pairingId);
  assert.equal(requests[0].code, '654321');
  assert.equal(requests[0].app.name, 'Orders');
  assert.equal(requests[0].app.environment, 'sandbox');

  await service.declinePairingRequest('user-1', pairingId);
  assert.equal(declines[0].u.$set.status, 'declined');

  const missing = loadUserService({ SpacePairingCode: { findOneAndUpdate: () => chain(null) } });
  await assert.rejects(missing.declinePairingRequest('user-1', 'pr_nope'), { statusCode: 404 });
});
