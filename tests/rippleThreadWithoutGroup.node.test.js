const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Ripple = require('../models/Ripple');
const Rippler = require('../models/Rippler');
const RippleEvent = require('../models/RippleEvent');
const RippleSupport = require('../models/RippleSupport');
const GroupChat = require('../models/groupChatModel');
const GroupMember = require('../models/groupMemberModel');
const visibility = require('../services/openNetworkVisibility');
const interaction = require('../services/rippleInteractionService');
const notifications = require('../services/openNetworkNotify');

test('participants join and exchange Ripple replies without creating a chat group', async (t) => {
  const rippleId = new mongoose.Types.ObjectId();
  const ripple = {
    _id: rippleId, hostUserId: 'host', title: 'Movie', kind: 'ripple',
    visibility: 'public', lifecycle: 'active', joinPolicy: 'open',
    groupChatId: new mongoose.Types.ObjectId(),
    settings: { ripplersCanPostEvents: true }, counts: { ripplers: 1 },
  };
  let participant = null;
  const events = [];
  const sent = [];
  const broadcasts = [];
  const socketPath = require.resolve('../socketManager');
  const originalSocket = require.cache[socketPath];
  require.cache[socketPath] = {
    id: socketPath, filename: socketPath, loaded: true,
    exports: { broadcastToUser: (...args) => broadcasts.push(args) },
  };
  t.after(() => {
    if (originalSocket) require.cache[socketPath] = originalSocket;
    else delete require.cache[socketPath];
  });

  t.mock.method(visibility, 'getViewerContext', async () => ({
    blockedIds: new Set(), friendIds: new Set(), pageIds: new Set(),
  }));
  t.mock.method(interaction, 'recordRippleInteractor', async () => true);
  t.mock.method(notifications, 'notifyUser', async (data) => sent.push(data));
  t.mock.method(Ripple, 'findById', async () => ripple);
  t.mock.method(Ripple, 'updateOne', async () => ({ modifiedCount: 1 }));
  t.mock.method(Rippler, 'findOne', () => ({ lean: async () => participant }));
  t.mock.method(Rippler, 'findOneAndUpdate', async (_filter, update) => {
    participant = { userId: 'guest', ...update.$set };
    return participant;
  });
  t.mock.method(Rippler, 'find', () => ({
    select: () => ({ lean: async () => [{ userId: 'host' }] }),
  }));
  t.mock.method(RippleSupport, 'find', () => ({
    select: () => ({ lean: async () => [] }),
  }));
  t.mock.method(RippleEvent, 'distinct', async () => []);
  t.mock.method(RippleEvent, 'countDocuments', async () => events.length);
  t.mock.method(RippleEvent, 'create', async (data) => {
    const event = { ...data, _id: new mongoose.Types.ObjectId(), createdAt: new Date() };
    events.push(event);
    return event;
  });
  t.mock.method(RippleEvent, 'find', () => ({
    sort: () => ({ limit: () => ({ lean: async () => events }) }),
  }));
  const groupCreate = t.mock.method(GroupChat, 'create', async () => {
    throw new Error('Ripple must not create a group');
  });
  const groupMemberWrite = t.mock.method(GroupMember, 'findOneAndUpdate', async () => {
    throw new Error('Ripple must not add a group member');
  });

  const participation = require('../controllers/rippleParticipationController');
  const thread = require('../controllers/rippleEventController');
  const request = {
    params: { id: String(rippleId) }, user: { userId: 'guest', name: 'Guest' },
    body: {}, query: {}, get: () => undefined,
  };
  const invoke = async (handler) => {
    const result = {};
    const response = {
      status(code) { result.status = code; return this; },
      json(data) { result.data = data; return this; },
    };
    await handler(request, response, (error) => { throw error; });
    return result;
  };

  const joined = await invoke(participation.joinRipple);
  assert.equal(joined.status, 200);
  assert.equal(participant.status, 'approved');
  request.body = { type: 'text', body: 'See you at the cinema' };
  const posted = await invoke(thread.createEvent);
  assert.equal(posted.status, 201);
  assert.equal(posted.data.event.body, request.body.body);
  const listed = await invoke(thread.listEvents);
  assert.equal(listed.data.events[0].body, request.body.body);
  assert.ok(sent.some((item) => item.toUserId === 'host' && item.type === 'ripple_reply'));
  assert.ok(broadcasts.some(([id, name]) => id === 'host' && name === 'ripple:event:new'));
  assert.equal(groupCreate.mock.callCount(), 0);
  assert.equal(groupMemberWrite.mock.callCount(), 0);
});

test('Ripple routes retain the thread but do not create Syncup group chats', () => {
  const routes = require('../routes/rippleRoutes').stack
    .filter((layer) => layer.route)
    .map((layer) => ({ path: layer.route.path, methods: layer.route.methods }));
  assert.ok(routes.some((route) => route.path === '/:id/events' && route.methods.post));
  assert.ok(routes.some((route) => route.path === '/:id/events' && route.methods.get));
  assert.ok(!routes.some((route) => route.path === '/:id/chat' && route.methods.post));
});
