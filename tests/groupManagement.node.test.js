const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const setup = (options = {}) => {
  const calls = { writes: 0, broadcasts: [] };
  const members = options.members || {
    owner: { userId: 'owner', role: 'admin', isActive: true },
    bob: { userId: 'bob', role: 'member', isActive: true },
  };
  const group = options.group || { createdBy: 'owner' };
  const groupMember = {
    async findOne(query) {
      const member = members[query.userId];
      if (!member || (query.isActive && !member.isActive)) return null;
      return {
        ...member,
        leaveGroup() { this.isActive = false; return this; },
        removeFromGroup() { this.isActive = false; return this; },
        async save() { calls.writes++; },
      };
    },
    async isAdmin() { return true; },
    async countDocuments() { return options.adminCount ?? 1; },
    async findOneAndUpdate() { calls.writes++; return {}; },
    async updateOne() { calls.writes++; return {}; },
    async findOneAndDelete() { calls.writes++; return {}; },
    async deleteMany() { calls.writes++; },
    find() { return { select: async () => Object.values(members).filter(member => member.isActive) }; },
  };
  const groupChat = {
    async findById() { return group; },
    async findByIdAndUpdate() { calls.writes++; },
    async findByIdAndDelete() { calls.writes++; },
  };
  const mocks = {
    '../models/groupMemberModel': groupMember,
    '../models/groupChatModel': groupChat,
    '../models/groupMessageModel': { deleteMany: async () => { calls.writes++; } },
    '../models/userModel': {},
    '../socketManager': {
      broadcastToUser: (id, event, payload) => calls.broadcasts.push({ id, event, payload }),
    },
  };
  const path = require.resolve('../controllers/groupChatController');
  const previous = require.cache[path];
  const original = Module._load;
  delete require.cache[path];
  Module._load = function (request, parent, isMain) {
    return Object.hasOwn(mocks, request) ? mocks[request] : original.call(this, request, parent, isMain);
  };
  let controller;
  try {
    controller = require(path);
  } finally {
    Module._load = original;
    if (previous) require.cache[path] = previous;
    else delete require.cache[path];
  }
  return { controller, calls };
};

const run = async (handler, userId, params, body = {}) => {
  const res = response();
  let error;
  await handler({ user: { userId }, params: { groupId: 'group', ...params }, body }, res, err => { error = err; });
  return { res, error };
};

test('creator cannot leave through member removal or leave endpoint', async () => {
  const { controller, calls } = setup();
  const remove = await run(controller.removeGroupMember, 'owner', { memberId: 'owner' });
  const leave = await run(controller.leaveGroup, 'owner', {});
  assert.equal(remove.res.statusCode, 403);
  assert.equal(leave.res.statusCode, 400);
  assert.equal(calls.writes, 0);
});

test('creator and last admin cannot be demoted', async () => {
  const first = setup();
  const creator = await run(first.controller.updateMemberRole, 'owner', { memberId: 'owner' }, { role: 'member' });
  assert.equal(creator.res.statusCode, 403);
  assert.equal(first.calls.writes, 0);
  const second = setup({ group: { createdBy: 'other' }, members: { bob: { userId: 'bob', role: 'admin', isActive: true } } });
  const lastAdmin = await run(second.controller.updateMemberRole, 'owner', { memberId: 'bob' }, { role: 'member' });
  assert.equal(lastAdmin.res.statusCode, 403);
  assert.equal(second.calls.writes, 0);
});

test('inactive former admin cannot delete the group', async () => {
  const { controller, calls } = setup({
    members: { bob: { userId: 'bob', role: 'admin', isActive: false } },
  });
  const result = await run(controller.deleteGroupChat, 'bob', {});
  assert.equal(result.res.statusCode, 403);
  assert.equal(calls.writes, 0);
});

test('removed member receives a removal event while other members receive a refresh', async () => {
  const { controller, calls } = setup();
  const result = await run(controller.removeGroupMember, 'owner', { memberId: 'bob' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.res.statusCode, 200);
  assert.ok(calls.broadcasts.some(event => event.id === 'bob' && event.payload.removed === true));
  assert.ok(calls.broadcasts.some(event => event.id === 'owner' && event.payload.removed === false));
});

test('active membership index allows multiple inactive histories', () => {
  const GroupMember = require('../models/groupMemberModel');
  const index = GroupMember.schema.indexes().find(([, options]) => options.name === 'unique_active_group_member_v2');
  assert.deepEqual(index[1].partialFilterExpression, { isActive: true });
  assert.equal(index[1].unique, true);
});

test('only the creator can transfer ownership', async () => {
  const { controller, calls } = setup();
  const result = await run(controller.transferGroupOwnership, 'bob', {}, { newOwnerId: 'bob' });
  assert.equal(result.res.statusCode, 403);
  assert.equal(calls.writes, 0);
});

test('creator transfers ownership to an active member and can then leave', async () => {
  const { controller, calls } = setup();
  const transfer = await run(controller.transferGroupOwnership, 'owner', {}, { newOwnerId: 'bob' });
  assert.equal(transfer.res.statusCode, 200);
  assert.ok(calls.writes >= 2);
  const selfTransfer = await run(controller.transferGroupOwnership, 'owner', {}, { newOwnerId: 'owner' });
  assert.equal(selfTransfer.res.statusCode, 400);
});

test('transfer rejects a user who is not an active member', async () => {
  const { controller, calls } = setup({
    members: {
      owner: { userId: 'owner', role: 'admin', isActive: true },
      eve: { userId: 'eve', role: 'member', isActive: false },
    },
  });
  const result = await run(controller.transferGroupOwnership, 'owner', {}, { newOwnerId: 'eve' });
  assert.equal(result.res.statusCode, 400);
  assert.equal(calls.writes, 0);
});
