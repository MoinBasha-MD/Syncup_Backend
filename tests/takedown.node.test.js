process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-user-jwt-secret';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

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

const responseMock = () => ({
  statusCode: 200,
  body: undefined,
  locals: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const req = (params, body = { reason: 'policy violation' }) => ({
  params, body, query: {},
  admin: { _id: 'a1' }, adminDevice: {}, ip: '1.2.3.4',
});

// A query-like thenable that also supports .lean()
const queryResult = (value) =>
  Object.assign(Promise.resolve(value), { lean: async () => value });

const makeModeratedMock = (state) => ({
  findOne: () => queryResult(state.record || null),
  create: async (doc) => { state.order.push('quarantine'); state.record = { ...doc, async save() { Object.assign(state.record, this); return this; } }; return state.record; },
});

const baseMocks = (over = {}) => ({
  '../../models/Ripple': {},
  '../../models/RippleReport': {},
  '../../models/RippleEvent': {},
  '../../models/FeedPost': {},
  '../../models/Comment': {},
  '../../models/storyModel': {},
  '../../models/ModeratedContent': {},
  ...over,
});

test('FeedPost takedown: ModeratedContent insert happens BEFORE delete', async () => {
  const state = { order: [], record: null };
  const post = { _id: '507f1f77bcf86cd799439011', userId: 'u-1', caption: 'hi' };
  const ctl = loadWithMocks('../controllers/adminV2/moderationController', baseMocks({
    '../../models/FeedPost': {
      collection: { name: 'feedposts' },
      findById: () => ({ lean: () => post }),
      deleteOne: async () => { state.order.push('delete'); },
    },
    '../../models/ModeratedContent': makeModeratedMock(state),
  }));
  const res = responseMock();
  await ctl.takedown(req({ type: 'posts', id: '507f1f77bcf86cd799439011' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(state.order, ['quarantine', 'delete']);
  assert.deepEqual(state.record.doc, post);
});

test('restore re-inserts the original doc with the same _id', async () => {
  const post = { _id: '507f1f77bcf86cd799439011', userId: 'u-1', caption: 'hi' };
  let inserted;
  const record = {
    contentType: 'posts', originalId: post._id, doc: post, restoredAt: null,
    async save() { return this; },
  };
  const ctl = loadWithMocks('../controllers/adminV2/moderationController', baseMocks({
    '../../models/FeedPost': {
      collection: { name: 'feedposts', insertOne: async (doc) => { inserted = doc; } },
    },
    '../../models/ModeratedContent': {
      findOne: () => queryResult(record),
    },
  }));
  const res = responseMock();
  await ctl.restore(req({ type: 'posts', id: '507f1f77bcf86cd799439011' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(inserted._id, post._id);
  assert.ok(record.restoredAt);
});

test('ripple takedown flips lifecycle to removed; restore reverts it', async () => {
  const updates = [];
  const ripple = {
    _id: '507f1f77bcf86cd799439011', hostUserId: 'u-9',
    lifecycle: 'active', moderation: { reviewStatus: 'clear' },
  };
  const state = { record: null };
  const ctl = loadWithMocks('../controllers/adminV2/moderationController', baseMocks({
    '../../models/Ripple': {
      collection: { name: 'ripples' },
      findById: async () => ripple,
      updateOne: async (q, u) => { updates.push(u); },
    },
    '../../models/ModeratedContent': {
      findOne: () => queryResult(state.record || null),
      create: async (doc) => {
        state.record = { ...doc, async save() { Object.assign(state.record, this); return this; } };
        return state.record;
      },
    },
  }));

  const res = responseMock();
  await ctl.takedown(req({ type: 'ripples', id: '507f1f77bcf86cd799439011' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(updates[0].$set.lifecycle, 'removed');
  assert.equal(updates[0].$set['moderation.reviewStatus'], 'actioned');
  // original doc is NOT moved/deleted — quarantine stores only prior fields
  assert.equal(state.record.doc.lifecycle, 'active');

  const res2 = responseMock();
  await ctl.restore(req({ type: 'ripples', id: '507f1f77bcf86cd799439011' }), res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(updates[1].$set.lifecycle, 'active');
  assert.equal(updates[1].$set['moderation.reviewStatus'], 'clear');
});
