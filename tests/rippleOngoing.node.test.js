const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const Ripple = require('../models/Ripple');
const { toRippleSummary } = require('../utils/rippleDto');
const { runRippleLifecycle } = require('../services/rippleLifecycleService');
const { buildVisibilityFilter } = require('../services/openNetworkVisibility');

test('Ripple duration defaults to timed and is exposed in summaries', () => {
  const timed = new Ripple({ hostUserId: 'host', title: 'A Ripple', type: 'interest' });
  const ongoing = new Ripple({ hostUserId: 'host', title: 'Fun', type: 'interest', durationMode: 'ongoing' });
  assert.equal(timed.durationMode, 'timed');
  assert.equal(toRippleSummary(timed).durationMode, 'timed');
  assert.equal(toRippleSummary(ongoing).durationMode, 'ongoing');
  assert.ok(new Ripple({ hostUserId: 'host', title: 'Bad', type: 'interest', durationMode: 'invalid' }).validateSync());
});

test('personal discovery includes approved ongoing memberships without bypassing blocks or moderation', () => {
  const ctx = { friendIds: new Set(), blockedIds: new Set(['blocked']), pageIds: new Set() };
  const filter = buildVisibilityFilter('viewer', ctx, ['ripple-id']);
  assert.deepEqual(filter.$and[0].$or.at(-1), {
    _id: { $in: ['ripple-id'] },
    durationMode: 'ongoing',
    hostPageId: null,
  });
  assert.deepEqual(filter.$and[1], { hostUserId: { $nin: ['blocked'] } });
  assert.ok(filter.$and[2].$or.some((entry) => entry['moderation.reviewStatus']));
});

test('unlisted public and friend Ripples are eligible only in local discovery', () => {
  const ctx = { friendIds: new Set(['friend']), blockedIds: new Set(['blocked']), pageIds: new Set() };
  const global = buildVisibilityFilter('viewer', ctx);
  const local = buildVisibilityFilter('viewer', ctx, [], true);
  assert.ok(!global.$and[0].$or.some((entry) => entry.visibility === 'public' && entry.discoverability === 'unlisted'));
  assert.ok(local.$and[0].$or.some((entry) => entry.visibility === 'public' && entry.discoverability === 'unlisted'));
  assert.ok(local.$and[0].$or.some((entry) => entry.visibility === 'friends' && entry.discoverability === 'unlisted'));
  assert.deepEqual(local.$and[1], { hostUserId: { $nin: ['blocked'] } });
});

test('lifecycle backfill excludes ongoing Ripples while retaining legacy timed Ripples', async () => {
  const originalUpdateMany = Ripple.updateMany;
  const originalFind = Ripple.find;
  let filter;
  Ripple.updateMany = async (query) => { filter = query; };
  Ripple.find = () => ({ select: () => ({ lean: async () => [] }) });
  try {
    await runRippleLifecycle();
    assert.deepEqual(filter.durationMode, { $ne: 'ongoing' });
    assert.equal(filter.kind.$ne, 'short');
  } finally {
    Ripple.updateMany = originalUpdateMany;
    Ripple.find = originalFind;
  }
});

test('following an ongoing Ripple uses the approval-based join flow', async () => {
  const id = '507f1f77bcf86cd799439011';
  const ripple = {
    _id: id, hostUserId: 'host', kind: 'ripple', durationMode: 'ongoing',
    lifecycle: 'active', visibility: 'public', joinPolicy: 'approval', counts: {},
  };
  const calls = [];
  const Rippler = {
    VIEWING_STATUSES: ['approved', 'requested', 'invited'],
    findOne: () => ({ lean: async () => null }),
    findOneAndUpdate: async (filter, update) => {
      calls.push(update.$set);
      return { ...update.$set, userId: filter.userId };
    },
  };
  const mocks = {
    '../models/Ripple': {
      findById: async () => ripple,
      updateOne: async () => ({ modifiedCount: 1 }),
    },
    '../models/Rippler': Rippler,
    '../services/openNetworkVisibility': {
      getViewerContext: async () => ({ friendIds: new Set(), blockedIds: new Set(), pageIds: new Set() }),
    },
    '../services/openNetworkNotify': { notifyUser: async () => {} },
    '../services/rippleInteractionService': { recordRippleInteractor: async () => {} },
  };
  const modulePath = require.resolve('../controllers/rippleParticipationController');
  const originalLoad = Module._load;
  const cached = require.cache[modulePath];
  delete require.cache[modulePath];
  Module._load = function (name, parent, isMain) {
    return Object.hasOwn(mocks, name) ? mocks[name] : originalLoad.call(this, name, parent, isMain);
  };
  let controller;
  try {
    controller = require(modulePath);
  } finally {
    Module._load = originalLoad;
    if (cached) require.cache[modulePath] = cached;
    else delete require.cache[modulePath];
  }
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await controller.followRipple(
    { params: { id }, user: { userId: 'viewer' }, body: {} },
    res,
    (error) => { throw error; },
  );
  assert.equal(res.statusCode, 202);
  assert.equal(calls[0].role, 'rippler');
  assert.equal(calls[0].status, 'requested');
});

test('personal feed queries approved ongoing memberships with visibility filters', async () => {
  const id = '507f1f77bcf86cd799439011';
  let membershipQuery;
  let feedQuery;
  const ctx = { friendIds: new Set(), blockedIds: new Set(['blocked']), pageIds: new Set() };
  const mocks = {
    '../models/Rippler': {
      find: (query) => {
        membershipQuery = query;
        return { select: () => ({ lean: async () => [{ rippleId: id }] }) };
      },
    },
    '../models/Ripple': {
      find: (query) => {
        feedQuery = query;
        return { sort: () => ({ limit: () => ({ lean: async () => [] }) }) };
      },
    },
    '../services/openNetworkVisibility': {
      getViewerContext: async () => ctx,
      buildVisibilityFilter,
    },
  };
  const modulePath = require.resolve('../controllers/openNetworkController');
  const originalLoad = Module._load;
  const cached = require.cache[modulePath];
  delete require.cache[modulePath];
  Module._load = function (name, parent, isMain) {
    return Object.hasOwn(mocks, name) ? mocks[name] : originalLoad.call(this, name, parent, isMain);
  };
  let controller;
  try {
    controller = require(modulePath);
  } finally {
    Module._load = originalLoad;
    if (cached) require.cache[modulePath] = cached;
    else delete require.cache[modulePath];
  }
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await controller.getFeed(
    { query: { section: 'forYou', excludePageHosted: '1' }, user: { userId: 'viewer' } },
    res,
    (error) => { throw error; },
  );
  assert.deepEqual(membershipQuery, { userId: 'viewer', status: 'approved', role: { $ne: 'follower' } });
  assert.deepEqual(feedQuery.$and[0], { hostPageId: null, hostIsPage: { $ne: true } });
  assert.ok(feedQuery.$and[1].$and[0].$or.some((entry) => entry.durationMode === 'ongoing' && entry._id.$in[0] === id));
  assert.ok(feedQuery.$and[2].$or.some((entry) => entry.durationMode === 'ongoing' && entry._id.$in[0] === id));
  assert.equal(res.statusCode, 200);
});

test('nearby discovery applies the Ripple reach before limiting results', async () => {
  let pipeline;
  const ctx = { friendIds: new Set(['friend']), blockedIds: new Set(['blocked']), pageIds: new Set() };
  const mocks = {
    '../models/Ripple': { aggregate: async (query) => { pipeline = query; return []; } },
    '../services/openNetworkVisibility': { getViewerContext: async () => ctx, buildVisibilityFilter },
  };
  const modulePath = require.resolve('../controllers/openNetworkController');
  const originalLoad = Module._load;
  const cached = require.cache[modulePath];
  delete require.cache[modulePath];
  Module._load = function (name, parent, isMain) {
    return Object.hasOwn(mocks, name) ? mocks[name] : originalLoad.call(this, name, parent, isMain);
  };
  let controller;
  try {
    controller = require(modulePath);
  } finally {
    Module._load = originalLoad;
    if (cached) require.cache[modulePath] = cached;
    else delete require.cache[modulePath];
  }
  const res = { status() { return this; }, json(body) { this.body = body; return this; } };
  await controller.getNearby(
    { query: { lng: '0', lat: '0' }, user: { userId: 'viewer' } },
    res,
    (error) => { throw error; },
  );
  const visibility = pipeline[0].$geoNear.query.$and[0];
  assert.ok(visibility.$and[0].$or.some((entry) => entry.visibility === 'public' && entry.discoverability === 'unlisted'));
  assert.equal(pipeline[1].$match.$or[1].$expr.$lte[0], '$distMeters');
  assert.deepEqual(pipeline[2], { $limit: 100 });
});

test('creation keeps ongoing Ripples open and timed Ripples retain a default end', async () => {
  const id = '507f1f77bcf86cd799439011';
  let created;
  const mocks = {
    '../models/Ripple': {
      countDocuments: async () => 0,
      create: async (data) => { created = { ...data, _id: id }; return created; },
    },
    '../models/Rippler': {
      create: async () => {},
      findOne: () => ({ lean: async () => ({ role: 'host', status: 'approved' }) }),
    },
    '../models/OpenNetworkProfile': { updateOne: async () => {} },
    '../services/openNetworkNotify': { notifyRippleNearby: () => {} },
  };
  const modulePath = require.resolve('../controllers/rippleController');
  const originalLoad = Module._load;
  const cached = require.cache[modulePath];
  delete require.cache[modulePath];
  Module._load = function (name, parent, isMain) {
    return Object.hasOwn(mocks, name) ? mocks[name] : originalLoad.call(this, name, parent, isMain);
  };
  let controller;
  try {
    controller = require(modulePath);
  } finally {
    Module._load = originalLoad;
    if (cached) require.cache[modulePath] = cached;
    else delete require.cache[modulePath];
  }
  const req = {
    body: { title: 'A topic', type: 'interest', reach: 'online', publish: true, durationMode: 'ongoing' },
    user: { userId: 'host', name: 'Host' },
    get: () => null,
  };
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await controller.createRipple(req, res, (error) => { throw error; });
  assert.equal(created.durationMode, 'ongoing');
  assert.equal(created.expiresAt, null);
  assert.equal(res.body.ripple.durationMode, 'ongoing');
  req.body.durationMode = 'timed';
  await controller.createRipple(req, res, (error) => { throw error; });
  assert.ok(created.expiresAt instanceof Date);
});
