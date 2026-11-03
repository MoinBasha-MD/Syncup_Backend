const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const loadWithMocks = (path, mocks) => {
  const original = Module._load;
  const cached = require.cache[path];
  delete require.cache[path];
  Module._load = function (request, parent, isMain) {
    return Object.prototype.hasOwnProperty.call(mocks, request)
      ? mocks[request] : original.call(this, request, parent, isMain);
  };
  try {
    return require(path);
  } finally {
    Module._load = original;
    if (cached) require.cache[path] = cached;
    else delete require.cache[path];
  }
};

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const setup = (blocks, { noBobChain = false } = {}) => {
  const captured = { reads: 0, writes: 0 };
  const users = ['alice', 'bob', 'carol'];
  const chains = (noBobChain ? ['carol'] : ['bob', 'carol']).map(peer => ({
    chainId: `alice_${peer}`,
    participants: [{ userId: 'alice' }, { userId: peer }],
  }));
  const blockModel = {
    find(query) {
      const matches = blocks.filter(block =>
        query.$or ? query.$or.some(clause =>
          Object.entries(clause).every(([key, value]) => block[key] === value))
          : Object.entries(query).every(([key, value]) => block[key] === value));
      return { select: () => ({ lean: async () => matches }) };
    },
    async isMutuallyBlocked(a, b) {
      return { anyBlocked: blocks.some(block =>
        (block.blockerId === a && block.blockedUserId === b) ||
        (block.blockerId === b && block.blockedUserId === a)) };
    },
  };
  const controller = loadWithMocks(require.resolve('../controllers/pulseController'), {
    '../models/Pulse': {
      find: () => {
        captured.reads += 1;
        return { sort: () => ({ limit: () => ({ lean: async () => [] }) }) };
      },
      create: async data => { captured.writes += 1; return data; },
      updateMany: async () => {},
    },
    '../models/PulseChain': {
      find(query) {
        const excluded = query.$and?.find(clause => clause['participants.userId']?.$nin)
          ?.['participants.userId'];
        const denied = excluded?.$nin || [];
        return { sort: () => ({ limit: () => ({ lean: async () =>
          chains.filter(chain => !chain.participants.some(p => denied.includes(p.userId))) }) }) };
      },
      findOne: ({ chainId }) => ({ lean: async () => chains.find(chain => chain.chainId === chainId) || null }),
      findOneAndUpdate: () => ({ lean: async () => ({}) }),
      updateOne: async () => {},
    },
    '../models/userModel': {
      findOne: ({ userId }) => ({ select: () => ({ lean: async () =>
        users.includes(userId) ? { userId, name: userId } : null }) }),
    },
    '../models/Friend': { areFriends: async () => true },
    '../models/blockModel': blockModel,
    '../services/friendService': {},
    '../socketManager': { broadcastToUser() {} },
    '../services/fcmNotificationService': { sendVisibleNotification: async () => {} },
  });
  return { controller, captured, blockModel };
};

for (const block of [
  { blockerId: 'alice', blockedUserId: 'bob' },
  { blockerId: 'bob', blockedUserId: 'alice' },
]) {
  test(`Pulse rejects both directions of block: ${block.blockerId}`, async () => {
    const { controller, captured } = setup([block]);
    const send = response();
    await controller.sendPulse({
      user: { userId: 'alice' },
      body: { receiverId: 'bob', type: 'text', caption: 'hello' },
    }, send, () => {});
    assert.equal(send.statusCode, 403);
    assert.equal(captured.writes, 0);

    const moments = response();
    await controller.getChainMoments({
      user: { userId: 'alice' },
      params: { chainId: 'alice_bob' },
      query: {},
    }, moments, () => {});
    assert.equal(moments.statusCode, 403);
    assert.equal(captured.reads, 0);

    const list = response();
    await controller.getChains({ user: { userId: 'alice' } }, list, () => {});
    assert.deepEqual(list.body.data.map(chain => chain.chainId), ['alice_carol']);
  });

  test(`Pulse rejects a blocked empty chain: ${block.blockerId}`, async () => {
    const { controller } = setup([block], { noBobChain: true });
    const moments = response();
    await controller.getChainMoments({
      user: { userId: 'alice' },
      params: { chainId: 'alice_bob' },
      query: {},
    }, moments, () => {});
    assert.equal(moments.statusCode, 403);
  });
}

test('Pulse permits an unblocked empty chain and lists unblocked chains', async () => {
  const { controller } = setup([], { noBobChain: true });
  const moments = response();
  await controller.getChainMoments({
    user: { userId: 'alice' },
    params: { chainId: 'alice_bob' },
    query: {},
  }, moments, () => {});
  assert.equal(moments.statusCode, 200);
  assert.deepEqual(moments.body.data, []);
  const list = response();
  await controller.getChains({ user: { userId: 'alice' } }, list, () => {});
  assert.deepEqual(list.body.data.map(chain => chain.chainId), ['alice_carol']);
});

test('friend list excludes accounts that blocked the viewer', async () => {
  const { blockModel } = setup([{ blockerId: 'bob', blockedUserId: 'alice' }]);
  const friend = id => ({
    friendUserId: id,
    cachedData: { name: id },
    status: 'accepted',
  });
  const service = loadWithMocks(require.resolve('../services/friendService'), {
    '../models/Friend': { getFriends: async () => [friend('bob'), friend('carol')] },
    '../models/userModel': {
      findOne: () => ({ select: async () => ({ _id: 'viewer' }) }),
      find: () => ({ select: () => ({ lean: async () => [] }) }),
    },
    '../models/blockModel': blockModel,
    '../models/statusPrivacyModel': { projectStatusForViewer: async value => value },
    './friendWebSocketService': {},
    '../utils/phoneNormalization': {},
  });
  const friends = await service.getFriends('alice');
  assert.deepEqual(friends.map(value => value.friendUserId), ['carol']);
});
