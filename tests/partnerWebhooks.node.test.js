const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const test = require('node:test');
const EventEmitter = require('node:events');

process.env.SYNC_SPACE_DATA_KEY = 'ef'.repeat(32);
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

const loadWebhooks = ({ PartnerApp = {}, PartnerWebhookDelivery = {} } = {}) =>
  loadWithMocks('../services/partnerWebhooks', {
    '../models/PartnerApp': PartnerApp,
    '../models/PartnerWebhookDelivery': PartnerWebhookDelivery,
  });

const loadWorker = ({ PartnerWebhookDelivery = {}, PartnerApp = {}, webhooks = {} } = {}) =>
  loadWithMocks('../services/partnerWebhookWorker', {
    '../models/PartnerWebhookDelivery': PartnerWebhookDelivery,
    './partnerWebhooks': webhooks,
  });

const {
  validateWebhookUrl,
  isPrivateAddress,
  generateWebhookSecret,
  signWebhook,
} = loadWebhooks();

// ---------- URL validation ----------

test('validateWebhookUrl accepts only public https urls on 443', () => {
  assert.equal(validateWebhookUrl('https://hooks.example.com/wh').hostname, 'hooks.example.com');
  assert.equal(validateWebhookUrl('https://hooks.example.com:443/wh').hostname, 'hooks.example.com');

  for (const bad of [
    'http://hooks.example.com/wh',
    'https://hooks.example.com:8443/wh',
    'https://user:pass@hooks.example.com/wh',
    'https://127.0.0.1/wh',
    'https://[::1]/wh',
    'https://localhost/wh',
    'https://x.localhost/wh',
    'https://printer.local/wh',
    'https://db.internal/wh',
    'not a url',
    'ftp://hooks.example.com/wh',
  ]) {
    assert.throws(() => validateWebhookUrl(bad), { statusCode: 400 }, bad);
  }
});

test('isPrivateAddress blocks private, loopback, link-local, CGNAT, multicast, mapped', () => {
  for (const ip of [
    '0.0.0.0', '10.0.0.1', '10.255.255.255', '127.0.0.1', '127.42.0.1',
    '169.254.1.1', '172.16.0.1', '172.31.255.1', '192.168.1.1',
    '100.64.0.1', '100.127.255.1', '224.0.0.1', '239.255.1.1', '255.255.255.255',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:192.168.0.1',
    '::ffff:7f00:1', // hex-mapped 127.0.0.1
  ]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.113.9', '2606:4700:4700::1111', '100.63.255.1', '172.15.0.1', '172.32.0.1']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('webhook secret + signature format', () => {
  const secret = generateWebhookSecret();
  assert.match(secret, /^whsec_[A-Za-z0-9_-]{43}$/);
  const t = 1700000000;
  const sig = signWebhook(secret, '{"a":1}', t);
  assert.equal(sig, crypto.createHmac('sha256', secret).update('1700000000.{"a":1}').digest('hex'));
});

// ---------- enqueue ----------

test('enqueueConnectionEvent skips apps without url or secret', async () => {
  const creates = [];
  const service = loadWebhooks({
    PartnerApp: { findOne: () => chain({ webhookUrl: '', webhookSecretEncrypted: 'x' }) },
    PartnerWebhookDelivery: { create: async (d) => { creates.push(d); return d; } },
  });
  const conn = { subject: 'sub_x', scopes: ['space.messages'], status: 'active', environment: 'sandbox' };
  assert.equal(await service.enqueueConnectionEvent({ appId: 'sp_1', connection: conn, event: 'connection.created' }), null);
  assert.equal(creates.length, 0);

  const noSecret = loadWebhooks({
    PartnerApp: { findOne: () => chain({ webhookUrl: 'https://h.example.com/wh', webhookSecretEncrypted: null }) },
    PartnerWebhookDelivery: { create: async (d) => { creates.push(d); return d; } },
  });
  assert.equal(await noSecret.enqueueConnectionEvent({ appId: 'sp_1', connection: conn, event: 'connection.created' }), null);
  assert.equal(creates.length, 0);
});

test('enqueueConnectionEvent stores the signed-event payload', async () => {
  const creates = [];
  const { encryptSecret } = require('../utils/syncSpaceCrypto');
  const service = loadWebhooks({
    PartnerApp: {
      findOne: () => chain({
        webhookUrl: 'https://h.example.com/wh',
        webhookSecretEncrypted: encryptSecret('whsec_test', 'webhook:sp_1'),
      }),
    },
    PartnerWebhookDelivery: { create: async (d) => { creates.push(d); return d; } },
  });
  const conn = { subject: 'sub_abc', scopes: ['space.messages'], status: 'active', environment: 'sandbox' };
  const delivery = await service.enqueueConnectionEvent({
    appId: 'sp_1', connection: conn, event: 'connection.created',
  });
  assert.match(delivery.deliveryId, /^whd_[a-f0-9]{32}$/);
  assert.equal(creates[0].payload.id, delivery.deliveryId);
  assert.equal(creates[0].payload.type, 'connection.created');
  assert.equal(creates[0].payload.data.subject, 'sub_abc');
  assert.equal(creates[0].payload.data.userId, undefined);
});

// ---------- deliver ----------

const fakeResponse = (statusCode) => {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.resume = () => setImmediate(() => res.emit('end'));
  return res;
};

const fakeRequest = (res, captured) => (opts, cb) => {
  captured.opts = opts;
  const req = new EventEmitter();
  req.setTimeout = () => {};
  req.destroy = () => {};
  req.end = (body) => {
    captured.body = body;
    setImmediate(() => cb(res));
  };
  req.write = () => {};
  return req;
};

test('deliverWebhook pins DNS, signs the body, and rejects private targets', async () => {
  const webhooks = loadWebhooks();
  const delivery = {
    deliveryId: 'whd_1',
    event: 'connection.created',
    payload: { id: 'whd_1', type: 'connection.created', data: {} },
  };

  // success path
  let captured = {};
  let res = fakeResponse(200);
  const ok = await webhooks.deliverWebhook(delivery, 'https://hooks.example.com/wh', 'whsec_s', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: fakeRequest(res, captured),
  });
  assert.equal(ok.delivered, true);
  // pinned lookup returns only the resolved address
  const pinned = await new Promise((resolve) => captured.opts.lookup('hooks.example.com', {}, (e, a, f) => resolve([a, f])));
  assert.equal(pinned[0], '93.184.216.34');
  assert.equal(captured.opts.servername, 'hooks.example.com');
  assert.match(captured.opts.headers['Syncup-Signature'], /^t=\d+,v1=[0-9a-f]{64}$/);
  assert.equal(captured.opts.headers['Syncup-Event'], 'connection.created');
  assert.equal(captured.opts.headers['Syncup-Delivery'], 'whd_1');
  assert.equal(captured.opts.headers['Content-Type'], 'application/json');

  // non-2xx (redirects count — never followed)
  captured = {};
  res = fakeResponse(301);
  const redirect = await webhooks.deliverWebhook(delivery, 'https://hooks.example.com/wh', 'whsec_s', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: fakeRequest(res, captured),
  });
  assert.equal(redirect.delivered, false);
  assert.equal(redirect.error, 'http_301');

  // private resolution → refused before any request is made
  let requested = false;
  const blocked = await webhooks.deliverWebhook(delivery, 'https://hooks.example.com/wh', 'whsec_s', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }],
    request: () => { requested = true; return new EventEmitter(); },
  });
  assert.equal(blocked.delivered, false);
  assert.equal(blocked.error, 'blocked_address');
  assert.equal(requested, false);
});

test('pinned lookup answers both single and all:true call shapes (autoSelectFamily)', async () => {
  const webhooks = loadWebhooks();
  const delivery = { deliveryId: 'whd_1', event: 'connection.created', payload: {} };
  let captured = {};
  const res = fakeResponse(200);
  await webhooks.deliverWebhook(delivery, 'https://hooks.example.com/wh', 'whsec_s', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: fakeRequest(res, captured),
  });
  const single = await new Promise((r) => captured.opts.lookup('h', {}, (e, a, f) => r([a, f])));
  assert.deepEqual(single, ['93.184.216.34', 4]);
  const all = await new Promise((r) => captured.opts.lookup('h', { all: true }, (e, addrs) => r(addrs)));
  assert.deepEqual(all, [{ address: '93.184.216.34', family: 4 }]);
});

test('deliverWebhook resolves on an oversize response body and on socket close', async () => {
  const webhooks = loadWebhooks();
  const delivery = { deliveryId: 'whd_1', event: 'connection.created', payload: {} };

  // oversize body: emits data > 1KB and never emits 'end' — must still resolve
  let captured = {};
  const res = new EventEmitter();
  res.statusCode = 200;
  res.resume = () => setImmediate(() => res.emit('data', Buffer.alloc(2048)));
  const oversize = await webhooks.deliverWebhook(delivery, 'https://hooks.example.com/wh', 'whsec_s', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: fakeRequest(res, captured),
  });
  assert.equal(oversize.delivered, true);

  // socket closes with no response/end — 'close' handler settles the promise
  captured = {};
  const hung = await Promise.race([
    webhooks.deliverWebhook(delivery, 'https://hooks.example.com/wh', 'whsec_s', {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      request: (opts, cb) => {
        const req = new EventEmitter();
        req.destroy = () => {};
        req.end = () => setImmediate(() => req.emit('close'));
        return req;
      },
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('hung')), 2000)),
  ]);
  assert.equal(hung.delivered, false);
  assert.equal(hung.error, 'request_failed');
});

// ---------- worker ----------

test('runWebhookDeliveries claims with a lease, retries with backoff, then fails', async () => {
  const updates = [];
  let claims = 0;
  const doc = {
    _id: 'd1', deliveryId: 'whd_1', appId: 'sp_1', event: 'connection.created',
    status: 'pending', attempts: 0, payload: {},
  };
  const deliveryCalls = [];
  const worker = loadWorker({
    PartnerWebhookDelivery: {
      findOneAndUpdate: (q, u) => {
        claims += 1;
        return chain(claims === 1 ? doc : null); // single winner
      },
      updateOne: async (q, u) => { updates.push(u.$set); return {}; },
    },
    webhooks: {
      loadWebhookSecret: async () => ({ url: 'https://h.example.com', secret: 'whsec_s' }),
      deliverWebhook: async () => { deliveryCalls.push(1); return { delivered: false, error: 'http_500' }; },
    },
  });
  const result = await worker.runWebhookDeliveries({ limit: 5 });
  assert.equal(result.processed, 1);
  assert.equal(result.retried, 1);
  assert.equal(updates[0].attempts, 1);
  assert.equal(updates[0].status, 'pending');
  assert.equal(updates[0].lastError, 'http_500');
  // first retry is scheduled ~1 minute out
  assert.ok(updates[0].nextAttemptAt.getTime() > Date.now());
  assert.ok(updates[0].nextAttemptAt.getTime() - Date.now() <= 60 * 1000 + 1000);
});

test('runWebhookDeliveries marks blocked_address failed permanently', async () => {
  const updates = [];
  const worker = loadWorker({
    PartnerWebhookDelivery: {
      findOneAndUpdate: () => chain({ _id: 'd1', deliveryId: 'whd_1', appId: 'sp_1', event: 'connection.revoked', status: 'pending', attempts: 0, payload: {} }),
      updateOne: async (q, u) => { updates.push(u.$set); throw new Error('stop'); },
    },
    webhooks: {
      loadWebhookSecret: async () => ({ url: 'https://h.example.com', secret: 's' }),
      deliverWebhook: async () => ({ delivered: false, error: 'blocked_address' }),
    },
  });
  await assert.rejects(worker.runWebhookDeliveries(), /stop/);
  assert.equal(updates[0].status, 'failed');
  assert.equal(updates[0].lastError, 'blocked_address');
});

test('runWebhookDeliveries fails permanently after the 7th attempt', async () => {
  const updates = [];
  const worker = loadWorker({
    PartnerWebhookDelivery: {
      findOneAndUpdate: () => chain({ _id: 'd1', deliveryId: 'whd_1', appId: 'sp_1', event: 'connection.created', status: 'pending', attempts: 6, payload: {} }),
      updateOne: async (q, u) => { updates.push(u.$set); throw new Error('stop'); },
    },
    webhooks: {
      loadWebhookSecret: async () => ({ url: 'https://h.example.com', secret: 's' }),
      deliverWebhook: async () => ({ delivered: false, error: 'timeout' }),
    },
  });
  await assert.rejects(worker.runWebhookDeliveries(), /stop/);
  assert.equal(updates[0].attempts, 7);
  assert.equal(updates[0].status, 'failed');
});

test('runWebhookDeliveries marks delivered on 2xx', async () => {
  const updates = [];
  const worker = loadWorker({
    PartnerWebhookDelivery: {
      findOneAndUpdate: () => chain({ _id: 'd1', deliveryId: 'whd_1', appId: 'sp_1', event: 'connection.created', status: 'pending', attempts: 0, payload: {} }),
      updateOne: async (q, u) => { updates.push(u.$set); throw new Error('stop'); },
    },
    webhooks: {
      loadWebhookSecret: async () => ({ url: 'https://h.example.com', secret: 's' }),
      deliverWebhook: async () => ({ delivered: true, error: '' }),
    },
  });
  await assert.rejects(worker.runWebhookDeliveries(), /stop/);
  assert.equal(updates[0].status, 'delivered');
  assert.equal(updates[0].lastError, '');
});

// ---------- enqueue hooks + TTL + purge ----------

test('upsertConnection and revokeConnection enqueue webhook events', async () => {
  const enqueues = [];
  const connections = [];
  const loadConnections = (PairingExtra = {}) =>
    loadWithMocks('../services/syncSpaceConnections', {
      '../models/SpaceConnectSession': {},
      '../models/SpaceConnection': {
        findOneAndUpdate: async () => null,
        findOne: () => chain({ connectionId: 'conn_1', userId: 'u1', appId: 'sp_1', status: 'active', subject: 'sub_x', environment: 'sandbox' }),
        findOneAndUpdateWithDoc: null,
        create: async (d) => { connections.push(d); return { ...d }; },
        find: () => chain([]),
        updateMany: async () => ({}),
      },
      '../models/SpaceMessage': {},
      '../models/SpacePairingCode': {},
      '../models/SyncSpaceProfile': {},
      '../models/PartnerApp': { findOne: () => chain(null) },
      '../models/PartnerAccount': {},
      './partnerWebhooks': {
        enqueueConnectionEvent: async (a) => { enqueues.push(a); },
      },
      ...PairingExtra,
    });

  const svc = loadConnections();
  await svc.upsertConnection({ userId: 'u1', app: { appId: 'sp_1', partnerId: 'p1', environment: 'sandbox' }, scopes: ['space.messages'] });
  assert.equal(enqueues.length, 1);
  assert.equal(enqueues[0].event, 'connection.created');
  assert.equal(enqueues[0].appId, 'sp_1');

  // revoke — need findOneAndUpdate to succeed this time
  enqueues.length = 0;
  const svc2 = loadWithMocks('../services/syncSpaceConnections', {
    '../models/SpaceConnectSession': {},
    '../models/SpaceConnection': {
      findOne: () => chain({ connectionId: 'conn_1', userId: 'u1', appId: 'sp_1', status: 'active' }),
      findOneAndUpdate: async () => ({ connectionId: 'conn_1', userId: 'u1', appId: 'sp_1', status: 'revoked', subject: 'sub_x', environment: 'sandbox' }),
      create: async () => ({}),
      find: () => chain([]),
      updateMany: async () => ({}),
    },
    '../models/SpaceMessage': {},
    '../models/SpacePairingCode': {},
    '../models/SyncSpaceProfile': {},
    '../models/PartnerApp': { findOne: () => chain({ name: 'Orders' }) },
    '../models/PartnerAccount': { findOne: () => chain(null) },
    './partnerWebhooks': { enqueueConnectionEvent: async (a) => { enqueues.push(a); } },
  });
  await svc2.revokeConnection('u1', 'conn_1');
  assert.equal(enqueues.length, 1);
  assert.equal(enqueues[0].event, 'connection.revoked');
});

test('sendMessage sets expireAt = codeExpiresAt+24h for codes, +365d otherwise', async () => {
  const created = [];
  const service = loadWithMocks('../services/partnerSpaceService', {
    '../models/SpaceConnectSession': {},
    '../models/SpaceConnection': {
      findOne: () => chain({
        connectionId: 'conn_1', userId: 'u1', appId: 'sp_1', partnerId: 'p1',
        subject: 'sub_' + 'a'.repeat(32), scopes: ['space.messages', 'space.codes'],
        status: 'active', environment: 'sandbox',
      }),
    },
    '../models/SpaceMessage': {
      findOne: () => chain(null),
      create: async (d) => { created.push(d); return { ...d }; },
    },
    '../models/SpacePairingCode': {},
    '../models/SyncSpaceProfile': { findOne: () => chain({ userId: 'u1', status: 'active', allowPromotions: true }) },
    '../models/userModel': {},
    '../models/PartnerApp': {},
    '../models/PartnerAccount': {},
    './syncSpaceConnections': { upsertConnection: async () => ({}) },
    './notificationDispatcher': { dispatchNotification: async () => ({}) },
  });
  const app = {
    appId: 'sp_1', partnerId: 'p1', name: 'Orders', environment: 'sandbox',
    requestedScopes: ['space.messages', 'space.codes'], sandboxUserIds: ['u1'], status: 'active',
  };
  const key = { keyId: 'sk_test_x', scopes: ['space.messages', 'space.codes'] };

  const subject = 'sub_' + 'a'.repeat(32);
  await service.sendMessage({ app, key }, { subject, type: 'code', title: 'Code', code: '4829', expiresInSeconds: 300 });
  assert.equal(created[0].expireAt.getTime() - created[0].codeExpiresAt.getTime(), 24 * 60 * 60 * 1000);

  created.length = 0;
  const before = Date.now();
  await service.sendMessage({ app, key }, { subject, type: 'message', title: 'Hi' });
  const delta = created[0].expireAt.getTime() - before;
  assert.ok(delta >= 365 * 24 * 60 * 60 * 1000 - 1000 && delta <= 365 * 24 * 60 * 60 * 1000 + 1000);

  const model = require('../models/SpaceMessage');
  const ttl = model.schema.indexes().find(([spec]) => spec.expireAt === 1);
  assert.ok(ttl, 'expireAt TTL index exists');
  assert.equal(ttl[1].expireAfterSeconds, 0);
});

test('purgeSyncSpaceUser deletes profile, messages, pairings and revokes connections', async () => {
  const enqueues = [];
  const deleted = {};
  const svc = loadWithMocks('../services/syncSpaceConnections', {
    '../models/SpaceConnectSession': {},
    '../models/SpaceConnection': {
      find: () => chain([
        { connectionId: 'conn_1', userId: 'u1', appId: 'sp_1', status: 'active', subject: 'sub_x', environment: 'sandbox' },
        { connectionId: 'conn_2', userId: 'u1', appId: 'sp_2', status: 'revoked', subject: 'sub_y', environment: 'sandbox' },
      ]),
      updateMany: async () => ({}),
      findOne: () => chain(null),
      findOneAndUpdate: async () => null,
      create: async () => ({}),
    },
    '../models/SpaceMessage': { deleteMany: async () => ({ deletedCount: 4 }) },
    '../models/SpacePairingCode': { deleteMany: async () => ({ deletedCount: 2 }) },
    '../models/SyncSpaceProfile': { deleteMany: async () => ({ deletedCount: 1 }) },
    '../models/PartnerApp': { findOne: () => chain(null) },
    '../models/PartnerAccount': {},
    './partnerWebhooks': { enqueueConnectionEvent: async (a) => { enqueues.push(a); } },
  });
  const result = await svc.purgeSyncSpaceUser('u1');
  assert.equal(result.connections, 2);
  assert.equal(result.revoked, 1); // only the active one gets a revoke event
  assert.equal(result.deletedProfiles, 1);
  assert.equal(result.deletedMessages, 4);
  assert.equal(result.deletedPairings, 2);
  assert.equal(enqueues.length, 1);
  assert.equal(enqueues[0].event, 'connection.revoked');
});

test('partner flows send partner-specific email template types', async () => {
  const sent = [];
  const partner = {
    partnerId: 'p-1',
    email: 'p@x.co',
    emailVerifiedAt: new Date(),
    approvalStatus: 'sandbox',
    sessionVersion: 0,
    save: async () => partner,
  };
  const service = loadWithMocks('../services/partnerService', {
    '../models/PartnerAccount': {
      findOne: () => chain(partner),
    },
    '../models/PartnerApp': {},
    '../models/PartnerApiKey': {},
    '../models/PartnerEmailChallenge': {
      create: async () => ({ challengeId: 'x'.repeat(64) }),
      find: () => chain([]),
      findOne: () => chain(null),
      updateMany: async () => ({}),
      countDocuments: async () => 0,
    },
    '../models/PartnerWebhookDelivery': {},
    '../models/SpaceConnection': {},
    '../models/SyncSpaceProfile': {},
    './partnerWebhooks': { validateWebhookUrl: () => ({}), generateWebhookSecret: () => 'whsec_x' },
    './emailService': {
      sendOTP: async (email, otp, type) => { sent.push(type); return { success: true }; },
    },
  });
  await service.requestPasswordReset('p@x.co');
  assert.deepEqual(sent, ['partner_password_reset']);
});

test('emailService renders Syncup Partners branding for partner template types', async () => {
  const emailService = require('../services/emailService');
  const calls = [];
  const previousTransport = emailService.transporter;
  const previousInitialized = emailService.initialized;
  emailService.transporter = { sendMail: async (opts) => { calls.push(opts); return { messageId: 'x' }; } };
  emailService.initialized = true;
  try {
    await emailService.sendOTP('t@t.co', '123456', 'partner_verification');
    await emailService.sendOTP('t@t.co', '123456', 'partner_password_reset');
  } finally {
    emailService.transporter = previousTransport;
    emailService.initialized = previousInitialized;
  }
  assert.equal(calls.length, 2);
  assert.match(calls[0].subject, /Partner/);
  assert.match(calls[0].html, /Syncup Partners/);
  assert.match(calls[0].html, /123456/);
  assert.match(calls[1].subject, /Reset/);
  assert.match(calls[1].html, /Syncup Partners/);
});
