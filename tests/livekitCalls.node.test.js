const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

// ── Stubbed controller loading (same Module._load pattern as e2ee tests) ────
const loadCallController = (mocks) => {
  const modulePath = require.resolve('../controllers/callController');
  const originalLoad = Module._load;
  const cachedModule = require.cache[modulePath];
  delete require.cache[modulePath];
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
    if (cachedModule) require.cache[modulePath] = cachedModule;
    else delete require.cache[modulePath];
  }
};

const makeRes = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const run = async (handler, req) => {
  const response = makeRes();
  let thrown = null;
  await handler(req, response, (e) => { thrown = e; });
  return { response, thrown };
};

const LIVEKIT_CALL = {
  callId: 'call_lk',
  callerId: 'u_caller',
  receiverId: 'u_recv',
  callType: 'video',
  status: 'ringing',
  transport: 'livekit',
  roomName: 'call_call_lk',
  callNonce: 'a'.repeat(32),
  e2eeEnvelope: { ct: 'x' },
};

const load = ({ call = LIVEKIT_CALL, liveKit = {}, tokenResult = 'tok123' } = {}) =>
  loadCallController({
    '../models/callModel': {},
    '../models/userModel': {
      findOne: () => ({ select: () => ({ lean: async () => ({ name: 'Asha' }) }) }),
    },
    '../services/socketAuthorization': {
      findAuthorizedCall: async () => call,
    },
    '../services/liveKitService': {
      isConfigured: () => liveKit.configured !== false,
      createToken: async (opts) => {
        load.lastTokenOpts = opts;
        return tokenResult;
      },
    },
    '@livekit/protocol': { TrackSource: { CAMERA: 1, MICROPHONE: 2, SCREEN_SHARE: 3 } },
  });

test('livekit-token returns url/token/room for a participant on an active call', async () => {
  const controller = load();
  const { response, thrown } = await run(controller.getCallLiveKitToken, {
    params: { callId: 'call_lk' },
    user: { userId: 'u_recv' },
  });
  assert.equal(thrown, null);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.token, 'tok123');
  assert.equal(response.body.data.room, 'call_call_lk');
  // camera+mic only — never screenshare, 2h ttl for calls
  assert.deepEqual(load.lastTokenOpts.publishSources, [1, 2]);
  assert.equal(load.lastTokenOpts.ttl, '2h');
  assert.equal(load.lastTokenOpts.canPublish, true);
});

test('livekit-token 404s for non-participants and ended calls', async () => {
  const controller = load({ call: null });
  const { response, thrown } = await run(controller.getCallLiveKitToken, {
    params: { callId: 'call_lk' },
    user: { userId: 'u_stranger' },
  });
  assert.equal(response.statusCode, 404);
  assert.match(String(thrown?.message), /not found|no longer active/i);
});

test('livekit-token rejects p2p calls', async () => {
  const controller = load({ call: { ...LIVEKIT_CALL, transport: 'p2p' } });
  const { response, thrown } = await run(controller.getCallLiveKitToken, {
    params: { callId: 'call_lk' },
    user: { userId: 'u_recv' },
  });
  assert.equal(response.statusCode, 400);
  assert.match(String(thrown?.message), /not a LiveKit call/);
});

test('livekit-token 503s when LiveKit is not configured', async () => {
  const controller = load({ liveKit: { configured: false } });
  const { response, thrown } = await run(controller.getCallLiveKitToken, {
    params: { callId: 'call_lk' },
    user: { userId: 'u_recv' },
  });
  assert.equal(response.statusCode, 503);
  assert.match(String(thrown?.message), /LIVEKIT_NOT_CONFIGURED/);
});
