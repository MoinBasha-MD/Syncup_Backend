const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const Message = require('../models/Message');

const messageId = '0123456789abcdef01234567';

test('registered reaction static restricts writes to message participants', async () => {
  const originalFindOne = Message.findOne;
  let query;
  let findOneCalls = 0;
  let saveCount = 0;
  const message = {
    _id: messageId,
    senderId: 'sender',
    receiverId: 'receiver',
    reactions: [],
    async save() { saveCount += 1; },
  };
  Message.findOne = async filter => {
    findOneCalls += 1;
    query = filter;
    return message;
  };

  try {
    const updated = await Message.toggleReaction(messageId, 'sender', '❤️');
    assert.equal(updated, message);
    assert.deepEqual(query, {
      _id: messageId,
      $or: [{ senderId: 'sender' }, { receiverId: 'sender' }],
    });
    assert.equal(message.reactions[0].userId, 'sender');
    assert.equal(saveCount, 1);

    await assert.rejects(
      Message.toggleReaction(messageId, 'intruder', '😡'),
      error => error.statusCode === 404
    );
    assert.equal(message.reactions.length, 1);
    assert.equal(saveCount, 1);

    const callsBeforeInvalidId = saveCount;
    const lookupsBeforeInvalidId = findOneCalls;
    await assert.rejects(
      Message.toggleReaction({ $ne: null }, 'sender', '😡'),
      error => error.statusCode === 404
    );
    assert.equal(saveCount, callsBeforeInvalidId);
    assert.equal(findOneCalls, lookupsBeforeInvalidId);
  } finally {
    Message.findOne = originalFindOne;
  }
});

const loadChatController = mocks => {
  const modulePath = require.resolve('../controllers/chatController');
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

const responseMock = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test('reaction controller returns 404 for unauthorized messages and broadcasts by userId', async () => {
  const broadcasts = [];
  const userLookups = [];
  const updatedMessage = {
    _id: messageId,
    senderId: 'sender',
    receiverId: 'receiver',
    reactions: [{ emoji: '❤️', userId: 'sender' }],
  };
  const controller = loadChatController({
    '../models/Message': {
      toggleReaction: async () => updatedMessage,
    },
    '../models/userModel': {
      findOne: async query => {
        userLookups.push(query);
        return null;
      },
    },
    '../models/blockModel': {},
    '../socketManager': {
      broadcastToUser: (...args) => broadcasts.push(args),
    },
    '../services/enhancedNotificationService': {},
    '../utils/logSanitizer': {},
  });
  const response = responseMock();

  await controller.toggleReaction({
    params: { messageId },
    body: { emoji: '❤️' },
    user: { userId: 'sender', id: 'sender-object-id' },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(broadcasts.map(([recipient]) => recipient), ['receiver']);
  assert.equal(userLookups.length, 0);

  const unauthorizedController = loadChatController({
    '../models/Message': {
      toggleReaction: async () => {
        const error = new Error('Message not found');
        error.statusCode = 404;
        throw error;
      },
    },
    '../models/userModel': {},
    '../models/blockModel': {},
    '../socketManager': { broadcastToUser: () => {} },
    '../services/enhancedNotificationService': {},
    '../utils/logSanitizer': {},
  });
  const denied = responseMock();
  await unauthorizedController.toggleReaction({
    params: { messageId },
    body: { emoji: '❤️' },
    user: { userId: 'intruder', id: 'intruder-object-id' },
  }, denied);

  assert.equal(denied.statusCode, 404);
  assert.deepEqual(denied.body, { success: false, message: 'Message not found' });
});
