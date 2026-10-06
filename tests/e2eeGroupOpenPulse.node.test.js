const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const { validateEnvelope, ENVELOPE_ALG } = require('../utils/e2eeEnvelope');

const res = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

/** Load a controller with dependency modules stubbed (same pattern as e2eeDm tests). */
const loadWithMocks = (modulePath, mocks) => {
  const originalLoad = Module._load;
  const cached = require.cache[modulePath];
  delete require.cache[modulePath];
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
    if (cached) require.cache[modulePath] = cached;
    else delete require.cache[modulePath];
  }
};

const alice = 'user-alice';
const bob = 'user-bob';
const carol = 'user-carol';
const GROUP_ID = '507f1f77bcf86cd799439011';

const envelopeFor = (ctx, keys, sender = alice) => ({
  v: 2,
  alg: ENVELOPE_ALG,
  sender: { userId: sender, deviceId: 'a'.repeat(32) },
  ctx,
  msgId: 'AAAAAAAAAAAAAAAAAAAAAA==',
  ts: 1700000000000,
  iv: 'AAAAAAAAAAAAAAAA',
  ct: 'BBBBBBBB',
  keys,
  sig: 'FFFF',
});

// ---------------------------------------------------------------------------
// validateEnvelope — generic shape
// ---------------------------------------------------------------------------

test('validateEnvelope accepts a valid group envelope', () => {
  const env = envelopeFor(`group:${GROUP_ID}`, [
    { userId: alice, deviceId: 'd1', spkId: 1, epk: 'C', iv: 'D', wk: 'E' },
    { userId: bob, deviceId: 'd2', spkId: 1, epk: 'C', iv: 'D', wk: 'E' },
    { userId: carol, deviceId: 'd3', spkId: 1, epk: 'C', iv: 'D', wk: 'E' },
  ]);
  assert.equal(
    validateEnvelope({ v: 2, envelope: env }, {
      senderId: alice,
      expectedCtx: `group:${GROUP_ID}`,
      allowedUserIds: new Set([alice, bob, carol]),
      maxKeys: 1000,
      maxBytes: 1024 * 1024,
    }),
    null,
  );
});

test('validateEnvelope rejects a key entry for a non-member', () => {
  const env = envelopeFor(`group:${GROUP_ID}`, [
    { userId: 'user-eve', deviceId: 'd9', spkId: 1, epk: 'C', iv: 'D', wk: 'E' },
  ]);
  assert.equal(
    validateEnvelope({ v: 2, envelope: env }, {
      senderId: alice,
      expectedCtx: `group:${GROUP_ID}`,
      allowedUserIds: new Set([alice, bob]),
      maxKeys: 1000,
      maxBytes: 1024 * 1024,
    }),
    'INVALID_KEYS',
  );
});

test('validateEnvelope enforces maxKeys and maxBytes', () => {
  const manyKeys = Array.from({ length: 30 }, (_, i) => ({
    userId: bob, deviceId: `d${i}`, spkId: 1, epk: 'C', iv: 'D', wk: 'E',
  }));
  const env = envelopeFor(`group:${GROUP_ID}`, manyKeys);
  assert.equal(
    validateEnvelope({ v: 2, envelope: env }, {
      senderId: alice,
      expectedCtx: `group:${GROUP_ID}`,
      allowedUserIds: new Set([alice, bob]),
      maxKeys: 20,
    }),
    'INVALID_KEYS',
  );
  const fat = envelopeFor(`group:${GROUP_ID}`, manyKeys);
  fat.ct = 'x'.repeat(4096);
  assert.equal(
    validateEnvelope({ v: 2, envelope: fat }, {
      senderId: alice,
      expectedCtx: `group:${GROUP_ID}`,
      allowedUserIds: new Set([alice, bob]),
      maxBytes: 1024,
    }),
    'ENVELOPE_TOO_LARGE',
  );
});

test('validateEnvelope rejects ctx mismatch and sender spoof', () => {
  const opts = {
    senderId: alice,
    expectedCtx: `open:chat-1`,
    allowedUserIds: new Set([alice, bob]),
  };
  const wrongCtx = envelopeFor('open:chat-2', [
    { userId: bob, deviceId: 'd', spkId: 1, epk: 'C', iv: 'D', wk: 'E' },
  ]);
  assert.equal(validateEnvelope({ v: 2, envelope: wrongCtx }, opts), 'CTX_MISMATCH');
  const wrongSender = envelopeFor('open:chat-1', [
    { userId: bob, deviceId: 'd', spkId: 1, epk: 'C', iv: 'D', wk: 'E' },
  ], bob);
  assert.equal(validateEnvelope({ v: 2, envelope: wrongSender }, opts), 'SENDER_MISMATCH');
});

// ---------------------------------------------------------------------------
// Group send — v2
// ---------------------------------------------------------------------------

const loadGroupController = (captured) => {
  const chatDoc = {
    _id: GROUP_ID,
    groupName: 'Crew',
    settings: { onlyAdminsCanMessage: false },
    members: [alice, bob, carol],
    updateLastMessage(m) { captured.lastMessage = m; this.lastMessage = m; },
    async save() { return this; },
  };
  const membership = { userId: alice, isActive: true, role: 'member', permissions: { canSendMessages: true } };
  return loadWithMocks(require.resolve('../controllers/groupChatController'), {
    '../models/groupChatModel': { findById: async () => chatDoc },
    '../models/groupMemberModel': {
      findOne: async () => membership,
      find: async (q) => {
        if (q.userId && q.userId.$ne) {
          return [bob, carol].filter((id) => id !== q.userId.$ne).map((userId) => ({ userId }));
        }
        return [alice, bob, carol].map((userId) => ({ userId }));
      },
      findOneAndUpdate: async () => null,
    },
    '../models/groupMessageModel': {
      create: async (data) => {
        captured.messageData = data;
        return {
          ...data,
          _id: 'gm-1',
          createdAt: new Date(),
          markAsDelivered: async () => {},
          save: async () => {},
        };
      },
    },
    '../models/userModel': {
      findOne: () => ({ select: async () => ({ userId: alice, name: 'Alice' }) }),
    },
    '../socketManager': {
      broadcastToUser: (userId, event, data) => {
        (captured.broadcasts ||= []).push({ userId, event, data });
        return true;
      },
    },
  });
};

test('sendGroupMessage stores v2 envelope, drops plaintext fields, neutral notification', async () => {
  const captured = {};
  const controller = loadGroupController(captured);
  const response = res();
  const next = (e) => { captured.err = e; };
  await controller.sendGroupMessage(
    {
      params: { groupId: GROUP_ID },
      body: {
        message: 'should not be stored',
        messageType: 'image',
        imageUrl: 'https://leak.example/secret.jpg',
        replyTo: { messageId: 'orig-1', message: 'original secret text', senderName: 'Bob' },
        e2ee: {
          v: 2,
          envelope: envelopeFor(`group:${GROUP_ID}`, [
            { userId: bob, deviceId: 'd2', spkId: 1, epk: 'C', iv: 'D', wk: 'E' },
            { userId: carol, deviceId: 'd3', spkId: 1, epk: 'C', iv: 'D', wk: 'E' },
          ]),
        },
      },
      user: { userId: alice },
    },
    response,
    next,
  );
  assert.equal(captured.err, undefined);
  assert.equal(response.statusCode, 201);
  assert.equal(captured.messageData.message, '');
  assert.equal(captured.messageData.imageUrl, undefined);
  assert.equal(captured.messageData.e2ee.v, 2);
  // Reply snippet must NOT copy the replied-to plaintext — only the id
  assert.deepEqual(captured.messageData.replyTo, { messageId: 'orig-1' });
  // Broadcast carries the envelope
  const broadcast = captured.broadcasts.find((b) => b.event === 'message:new');
  assert.ok(broadcast);
  assert.equal(broadcast.data.e2ee.v, 2);
  // Notification body is neutral
  const notif = captured.broadcasts.find((b) => b.event === 'notification:new');
  assert.ok(notif);
  assert.equal(notif.data.body, 'New message');
});

test('sendGroupMessage rejects a v2 envelope with a non-member key entry', async () => {
  const captured = {};
  const controller = loadGroupController(captured);
  const response = res();
  let err = null;
  await controller.sendGroupMessage(
    {
      params: { groupId: GROUP_ID },
      body: {
        message: '',
        e2ee: {
          v: 2,
          envelope: envelopeFor(`group:${GROUP_ID}`, [
            { userId: 'user-eve', deviceId: 'de', spkId: 1, epk: 'C', iv: 'D', wk: 'E' },
          ]),
        },
      },
      user: { userId: alice },
    },
    response,
    (e) => { err = e; },
  );
  assert.equal(err, null);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 'E2EE_STALE_MEMBERS');
});

// ---------------------------------------------------------------------------
// Open Network send — v2
// ---------------------------------------------------------------------------

const loadOpenController = (captured) => {
  const chatId = '507f1f77bcf86cd799439022';
  const chat = {
    _id: chatId,
    participants: [alice, bob],
    pairKey: `${alice}|${bob}`,
    mutedBy: [],
  };
  const lean = (v) => ({ lean: async () => v });
  return loadWithMocks(require.resolve('../controllers/openNetworkSocialController'), {
    '../models/OpenChat': {
      findById: async () => chat,
      updateOne: async (_q, update) => { captured.chatUpdate = update; },
    },
    '../models/OpenConnection': { findOne: () => lean({ pairKey: chat.pairKey, status: 'accepted' }) },
    '../models/OpenNetworkProfile': {
      find: () => ({ select: () => lean([{ userId: alice }, { userId: bob }]) }),
    },
    '../models/OpenMessage': {
      countDocuments: async () => 0,
      findOne: () => lean(null),
      create: async (data) => {
        captured.messageData = data;
        return { ...data, _id: 'om-1', chatId: chat._id, createdAt: new Date() };
      },
    },
    '../models/Ripple': { findById: () => lean(null) },
    '../models/Rippler': { findOne: () => lean(null) },
    '../models/userModel': {
      findOne: () => ({ select: () => lean({ userId: alice, name: 'Alice', profileImage: '' }) }),
    },
    '../models/blockModel': {},
    '../services/openNetworkVisibility': {
      getViewerContext: async () => ({ friendIds: new Set(), blockedIds: new Set() }),
    },
    '../services/openNetworkNotify': {
      notifyUser: async (n) => { captured.push = n; },
    },
    '../socketManager': {
      broadcastToUser: (userId, event, data) => {
        (captured.broadcasts ||= []).push({ userId, event, data });
        return true;
      },
    },
    '../utils/rippleAccess': { canView: () => false },
    '../utils/rippleDto': { toRippleSummary: (x) => x },
    './openNetworkController': { profileView: (x) => x, hydrateSummaryExtras: async () => {} },
    '../services/openNetworkGeo': {
      coarsenPoint: (x) => x,
      normalizeBbox: (x) => x,
      resolvePlace: (x) => x,
    },
  });
};

test('open-network sendMessage stores v2 envelope, empty body, no imageUrl, lastE2ee preview', async () => {
  const captured = {};
  const controller = loadOpenController(captured);
  const chatId = '507f1f77bcf86cd799439022';
  const response = res();
  let err = null;
  await controller.sendMessage(
    {
      params: { id: chatId },
      body: {
        type: 'text',
        body: 'leaked plaintext',
        imageUrl: 'https://leak.example/x.jpg',
        e2ee: {
          v: 2,
          envelope: envelopeFor(`open:${chatId}`, [
            { userId: bob, deviceId: 'd2', spkId: 1, epk: 'C', iv: 'D', wk: 'E' },
          ]),
        },
      },
      user: { userId: alice, _id: 'u1' },
    },
    response,
    (e) => { err = e; },
  );
  assert.equal(err, null);
  assert.equal(response.statusCode, 201);
  assert.equal(captured.messageData.body, '');
  assert.equal(captured.messageData.imageUrl, null);
  assert.equal(captured.messageData.e2ee.v, 2);
  // Chat-list preview stores the envelope, not plaintext
  const lastMessage = captured.chatUpdate.$set.lastMessage;
  assert.equal(lastMessage.body, '');
  assert.equal(lastMessage.lastE2ee.v, 2);
  // Push notification is neutral
  assert.equal(captured.push.message, 'New message');
});

// ---------------------------------------------------------------------------
// Pulse send — v2
// ---------------------------------------------------------------------------

const loadPulseController = (captured) => {
  const lean = (v) => ({ lean: async () => v });
  return loadWithMocks(require.resolve('../controllers/pulseController'), {
    '../models/Pulse': {
      create: async (data) => {
        captured.pulseData = data;
        return { ...data, _id: 'pulse-1', createdAt: new Date() };
      },
    },
    '../models/PulseChain': {
      findOneAndUpdate: (_q, update) => {
        captured.chainUpdate = update;
        return { lean: async () => ({ chainId: 'chain', ...update.$set }) };
      },
      updateOne: async () => {},
    },
    '../models/userModel': {
      findOne: ({ userId }) => ({ select: () => lean({ userId, name: userId, profileImage: '' }) }),
    },
    '../models/Friend': { areFriends: async () => true },
    '../services/friendService': {},
    '../socketManager': {
      broadcastToUser: (userId, event, data) => {
        (captured.broadcasts ||= []).push({ userId, event, data });
        return true;
      },
    },
    '../services/fcmNotificationService': {
      sendVisibleNotification: (toUserId, n) => {
        captured.fcm = { toUserId, ...n };
        return Promise.resolve();
      },
    },
  });
};

test('sendPulse stores v2 envelope — content/caption/moodTag sealed, lastPulse caption empty', async () => {
  const captured = {};
  const controller = loadPulseController(captured);
  // chainId = sorted join of the two ids — mirror of buildChainId
  const chainId = [alice, bob].sort().join('_');
  const response = res();
  let err = null;
  await controller.sendPulse(
    {
      body: {
        receiverId: bob,
        type: 'photo',
        // Genuinely invalid plaintext content — proves validatePulseContent is bypassed for v2
        content: {},
        caption: 'secret caption',
        moodTag: 'secret mood',
        e2ee: {
          v: 2,
          envelope: envelopeFor(`pulse:${chainId}`, [
            { userId: bob, deviceId: 'd2', spkId: 1, epk: 'C', iv: 'D', wk: 'E' },
          ]),
        },
      },
      user: { userId: alice },
    },
    response,
    (e) => { err = e; },
  );
  assert.equal(err, null);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(captured.pulseData.content, {});
  assert.equal(captured.pulseData.caption, '');
  assert.equal(captured.pulseData.moodTag, '');
  assert.equal(captured.pulseData.e2ee.v, 2);
  assert.equal(captured.chainUpdate.$set.lastPulse.caption, '');
  assert.equal(captured.chainUpdate.$set.lastPulse.e2ee.v, 2);
  // Socket + push stay neutral
  const pulseEvent = captured.broadcasts.find((b) => b.event === 'pulse:new');
  assert.ok(pulseEvent);
  assert.equal(pulseEvent.data.pulse.caption, '');
  assert.deepEqual(pulseEvent.data.pulse.content, {});
  assert.equal(captured.fcm.body, 'Sent you a photo Pulse');
});

test('sendPulse still validates plaintext content when no v2 envelope', async () => {
  const captured = {};
  const controller = loadPulseController(captured);
  const response = res();
  let err = null;
  await controller.sendPulse(
    {
      body: { receiverId: bob, type: 'photo', content: {} }, // missing mediaUrl
      user: { userId: alice },
    },
    response,
    (e) => { err = e; },
  );
  assert.equal(response.statusCode, 400);
  assert.ok(/mediaUrl/.test(response.body.message));
});
