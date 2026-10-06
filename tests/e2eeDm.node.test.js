const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const res = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const loadChatController = (mocks) => {
  const modulePath = require.resolve('../controllers/chatController');
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

const validEnvelope = () => ({
  v: 2,
  alg: 'x25519-hkdf-sha256-aes256gcm+ed25519',
  sender: { userId: alice, deviceId: 'a'.repeat(32) },
  ctx: 'dm:user-alice:user-bob',
  msgId: 'AAAAAAAAAAAAAAAAAAAAAA==',
  ts: 1700000000000,
  iv: 'AAAAAAAAAAAAAAAA',
  ct: 'BBBBBBBB',
  keys: [{ userId: bob, deviceId: 'b'.repeat(32), spkId: 1, epk: 'C', iv: 'D', wk: 'E' }],
  sig: 'FFFF',
});

const makeMocks = (captured) => {
  const MessageMock = function (data) {
    Object.assign(this, data);
    this._id = 'msg-1';
    captured.messageData = data;
    this.save = async () => this;
    this.populate = async () => this;
  };
  const doc = { _id: 'u1', userId: bob, name: 'Bob' };
  return {
    '../models/Message': MessageMock,
    '../models/userModel': {
      findOne: () => ({ ...doc, select: () => ({ ...doc, lean: async () => doc }) }),
    },
    '../models/blockModel': { isMutuallyBlocked: async () => ({ anyBlocked: false }) },
    '../socketManager': { broadcastToUser: () => true },
    '../services/enhancedNotificationService': {
      sendChatMessageNotification: async () => true,
    },
  };
};

test('sendMessage stores v2 envelope with empty message and drops plaintext fields', async () => {
  const captured = {};
  const controller = loadChatController(makeMocks(captured));
  const response = res();
  await controller.sendMessage(
    {
      body: {
        receiverId: bob,
        message: '',
        messageType: 'image',
        imageUrl: 'https://leak.example/secret.jpg',
        fileMetadata: { name: 'secret.jpg' },
        sharedPost: { postId: 'x' },
        e2ee: { v: 2, envelope: validEnvelope() },
      },
      user: { userId: alice },
    },
    response
  );
  assert.equal(response.statusCode, 201);
  assert.equal(captured.messageData.message, '');
  assert.deepEqual(captured.messageData.e2ee, { v: 2, envelope: validEnvelope() });
  assert.equal(captured.messageData.imageUrl, undefined);
  assert.equal(captured.messageData.fileMetadata, undefined);
  assert.equal(captured.messageData.sharedPost, undefined);
});

test('sendMessage rejects an invalid v2 envelope', async () => {
  const captured = {};
  const controller = loadChatController(makeMocks(captured));
  const env = validEnvelope();
  env.ctx = 'dm:user-alice:user-carol'; // replayed into another conversation
  const response = res();
  await controller.sendMessage(
    { body: { receiverId: bob, message: '', e2ee: { v: 2, envelope: env } }, user: { userId: alice } },
    response
  );
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 'CTX_MISMATCH');
});

test('sendMessage accepts plaintext when E2EE_ENFORCE_DM is off', async () => {
  const captured = {};
  const controller = loadChatController(makeMocks(captured));
  const response = res();
  await controller.sendMessage(
    { body: { receiverId: bob, message: 'hello', messageType: 'text' }, user: { userId: alice } },
    response
  );
  assert.equal(response.statusCode, 201);
  assert.equal(captured.messageData.message, 'hello');
});

test('sendMessage rejects plaintext DMs when E2EE_ENFORCE_DM=true', async () => {
  const captured = {};
  const controller = loadChatController(makeMocks(captured));
  const prev = process.env.E2EE_ENFORCE_DM;
  process.env.E2EE_ENFORCE_DM = 'true';
  try {
    const response = res();
    await controller.sendMessage(
      { body: { receiverId: bob, message: 'hello', messageType: 'text' }, user: { userId: alice } },
      response
    );
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, 'E2EE_REQUIRED');

    // v2 bodies still pass under enforcement
    const ok = res();
    await controller.sendMessage(
      { body: { receiverId: bob, message: '', e2ee: { v: 2, envelope: validEnvelope() } }, user: { userId: alice } },
      ok
    );
    assert.equal(ok.statusCode, 201);
  } finally {
    if (prev === undefined) delete process.env.E2EE_ENFORCE_DM;
    else process.env.E2EE_ENFORCE_DM = prev;
  }
});
