const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const {
  findAuthorizedCall,
  findAuthorizedReceipt,
  getOtherCallParticipant,
} = require('../services/socketAuthorization');

const callRecord = (overrides = {}) => ({
  callId: 'call-1',
  callerId: 'caller',
  receiverId: 'receiver',
  status: 'connected',
  ...overrides,
});

test('call authorization queries only participants and rechecks returned records', async () => {
  const queries = [];
  const Call = {
    findOne: async query => {
      queries.push(query);
      return callRecord({ status: query.status?.$in?.[0] || 'connected' });
    },
  };

  assert.equal((await findAuthorizedCall(Call, 'caller', 'call-1')).callId, 'call-1');
  assert.deepEqual(queries[0], {
    callId: 'call-1',
    $or: [{ callerId: 'caller' }, { receiverId: 'caller' }],
  });
  assert.equal(await findAuthorizedCall(Call, 'intruder', 'call-1'), null);

  const incoming = await findAuthorizedCall(Call, 'receiver', ' call-1 ', {
    receiverOnly: true,
    statuses: ['ringing'],
  });
  assert.equal(incoming.status, 'ringing');
  assert.deepEqual(queries[2], {
    callId: 'call-1',
    receiverId: 'receiver',
    status: { $in: ['ringing'] },
  });
  assert.equal(getOtherCallParticipant(callRecord(), 'caller'), 'receiver');
  assert.equal(getOtherCallParticipant(callRecord(), 'intruder'), null);
});

test('call authorization rejects malformed identifiers before database lookup', async () => {
  let lookups = 0;
  const Call = { findOne: async () => { lookups += 1; return callRecord(); } };

  for (const callId of ['', '   ', {}, [], 'x'.repeat(201)]) {
    assert.equal(await findAuthorizedCall(Call, 'caller', callId), null);
  }
  assert.equal(await findAuthorizedCall(Call, '', 'call-1'), null);
  assert.equal(lookups, 0);
});

test('receipt authorization is bound to the connected receiver and valid message ids', async () => {
  const queries = [];
  const message = { _id: '0123456789abcdef01234567', senderId: 'sender', receiverId: 'receiver' };
  const Message = {
    findOne: async query => {
      queries.push(query);
      return message;
    },
  };

  assert.equal(await findAuthorizedReceipt(Message, 'receiver', message._id), message);
  assert.deepEqual(queries[0], {
    _id: message._id,
    receiverId: 'receiver',
  });
  assert.equal(await findAuthorizedReceipt(Message, 'intruder', message._id), null);
  assert.equal(await findAuthorizedReceipt(Message, 'receiver', { $ne: null }), null);
  assert.equal(queries.length, 2);
});

const loadSocketManager = mocks => {
  const modulePath = require.resolve('../socketManager');
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

const emptyQuery = result => ({
  select() { return this; },
  sort() { return this; },
  limit() { return this; },
  lean: async () => result,
});

test('initializeSocketIO wires participant-checked call and receipt events', async () => {
  const ioHandlers = new Map();
  let options;
  const fakeIO = {
    use() {},
    on(event, handler) { ioHandlers.set(event, handler); },
  };
  const socketIO = (_server, socketOptions) => {
    options = socketOptions;
    return fakeIO;
  };
  const callQueries = [];
  let callSaves = 0;
  const Call = {
    findOne: async query => {
      callQueries.push(query);
      return {
        ...callRecord({ status: query.status?.$in?.[0] || 'connected' }),
        async save() { callSaves += 1; },
        calculateDuration() {},
      };
    },
  };
  const receiptQueries = [];
  const Message = {
    findOne: async query => {
      receiptQueries.push(query);
      return {
        _id: query._id,
        senderId: 'victim',
        receiverId: 'victim',
      };
    },
  };
  const User = {
    findByIdAndUpdate: async () => null,
    findById: () => emptyQuery({ contacts: [] }),
  };
  const Friend = { find: () => emptyQuery([]) };
  const Notification = {
    find: () => ({
      sort() { return this; },
      limit() { return this; },
      lean: async () => [],
    }),
  };
  const socketManager = loadSocketManager({
    'socket.io': socketIO,
    './models/userModel': User,
    './models/Friend': Friend,
    './models/statusPrivacyModel': { projectStatusForViewer: async value => value },
    './models/callModel': Call,
    './models/Message': Message,
    './services/aiMessageService': { setAIOnline: async () => {} },
    './services/aiSocketService': class { initialize() {} },
    './utils/loggerSetup': { connectionLogger: { info() {}, error() {} } },
    './services/fcmNotificationService': {},
    './services/callResumeService': {
      resumeCall: async () => null,
      deliverCallNotification: async () => ({}),
    },
    './models/Notification': Notification,
  });
  const originalSetInterval = global.setInterval;
  global.setInterval = () => 0;

  const connect = async userId => {
    const handlers = new Map();
    const emitted = [];
    const socket = {
      id: `socket-${userId}`,
      connected: true,
      handshake: { address: '127.0.0.1', headers: { 'user-agent': 'offline-test' } },
      conn: { on() {}, transport: { name: 'websocket' } },
      user: { id: { toString: () => `mongo-${userId}` }, userId, name: userId },
      on(event, handler) { handlers.set(event, handler); },
      emit(event, payload) { emitted.push({ event, payload }); },
      disconnect() {},
    };
    await ioHandlers.get('connection')(socket);
    return { socket, handlers, emitted };
  };

  try {
    socketManager.initializeSocketIO({});
    assert.equal(options.connectionStateRecovery.skipMiddlewares, false);

    const intruder = await connect('intruder');
    const caller = await connect('caller');
    const receiver = await connect('receiver');
    const victim = await connect('victim');
    const thirdParty = await connect('third-party');
    const callerBefore = caller.emitted.length;
    const receiverBefore = receiver.emitted.length;
    const victimBefore = victim.emitted.length;

    await intruder.handlers.get('call:answer')({
      callId: 'call-1',
      answer: { type: 'answer', sdp: 'offline-sdp' },
    });
    await intruder.handlers.get('call:reject')({ callId: 'call-1' });
    await intruder.handlers.get('call:end')({ callId: 'call-1' });
    await intruder.handlers.get('call:quality-update')({
      callId: 'call-1',
      quality: 'good',
    });
    await intruder.handlers.get('call:ice-candidate')({
      callId: 'call-1',
      candidate: { candidate: 'candidate' },
      targetUserId: 'victim',
    });
    await intruder.handlers.get('call:ice-restart')({ callId: 'call-1', offer: {} });
    await intruder.handlers.get('call:ice-restart-answer')({ callId: 'call-1', answer: {} });
    await intruder.handlers.get('message:delivered')({
      messageId: '0123456789abcdef01234567',
      senderId: 'victim',
    });
    await intruder.handlers.get('message:read')({
      messageId: '0123456789abcdef01234567',
      senderId: 'victim',
    });

    assert.equal(callSaves, 0);
    assert.equal(caller.emitted.length, callerBefore);
    assert.equal(receiver.emitted.length, receiverBefore);
    assert.equal(victim.emitted.length, victimBefore);
    assert.ok(callQueries.every(query =>
      query.$or?.some(participant =>
        participant.callerId === 'intruder' || participant.receiverId === 'intruder'
      ) || query.receiverId === 'intruder'
    ));
    assert.ok(receiptQueries.every(query => query.receiverId === 'intruder'));

    await caller.handlers.get('call:ice-candidate')({
      callId: 'call-1',
      candidate: { candidate: 'candidate' },
      targetUserId: 'third-party',
    });
    assert.equal(
      thirdParty.emitted.some(item => item.event === 'call:ice-candidate'),
      false
    );
    assert.equal(callSaves, 0);
  } finally {
    global.setInterval = originalSetInterval;
  }
});
