/**
 * Phase-1 permission/flag regressions — pure functions only, no Mongo.
 * Run: node --test tests/openNetworkPhase1.node.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { toRippleSummary } = require('../utils/rippleDto');
const { _internal } = require('../controllers/rippleController');
const { buildViewerBlock, canView } = _internal;

const emptyCtx = () => ({
  friendIds: new Set(),
  blockedIds: new Set(),
  pageIds: new Set(),
});

const baseRipple = (over = {}) => ({
  _id: 'r1',
  title: 'Test',
  type: 'activity',
  kind: 'ripple',
  reach: 'city',
  visibility: 'invite',
  discoverability: 'listed',
  joinPolicy: 'open',
  lifecycle: 'active',
  hostUserId: 'host1',
  hostPageId: null,
  hostIsPage: false,
  hostName: 'Host',
  counts: { ripplers: 0, followers: 0, events: 0, pendingRequests: 0, supports: 0, interactors: 0 },
  capacity: null,
  settings: { ripplersCanPostEvents: true },
  moderation: { reviewStatus: 'clear' },
  media: [],
  ...over,
});

test('wrapping Ripple is not joinable (canJoin/canFollow false)', () => {
  const viewer = buildViewerBlock(baseRipple({ lifecycle: 'wrapping' }), null, 'u2');
  assert.equal(viewer.canJoin, false);
  assert.equal(viewer.canFollow, false);
});

test('active + scheduled Ripples remain joinable', () => {
  for (const lifecycle of ['active', 'scheduled']) {
    const viewer = buildViewerBlock(baseRipple({ lifecycle }), null, 'u2');
    assert.equal(viewer.canJoin, true, `expected canJoin for ${lifecycle}`);
  }
});

test('manager may post during wrapping; rippler may not', () => {
  const ripple = baseRipple({ lifecycle: 'wrapping' });
  const manager = buildViewerBlock(ripple, { role: 'host', status: 'approved' }, 'host1');
  const cohost = buildViewerBlock(ripple, { role: 'cohost', status: 'approved' }, 'u9');
  const rippler = buildViewerBlock(ripple, { role: 'rippler', status: 'approved' }, 'u2');
  assert.equal(manager.canPostEvent, true);
  assert.equal(cohost.canPostEvent, true);
  assert.equal(rippler.canPostEvent, false);
});

test('invite-only Ripple: stale member rows do not grant view', () => {
  const ripple = baseRipple({ visibility: 'invite' });
  const ctx = emptyCtx();
  assert.equal(canView(ripple, { status: 'left' }, ctx, 'u2'), false);
  assert.equal(canView(ripple, { status: 'removed' }, ctx, 'u2'), false);
  assert.equal(canView(ripple, { status: 'banned' }, ctx, 'u2'), false);
  assert.equal(canView(ripple, { status: 'approved' }, ctx, 'u2'), true);
  assert.equal(canView(ripple, { status: 'requested' }, ctx, 'u2'), true);
  // Host always views their own.
  assert.equal(canView(ripple, null, ctx, 'host1'), true);
});

test('active Short never carries the Live badge', () => {
  const short = toRippleSummary(baseRipple({ kind: 'short', lifecycle: 'active', visibility: 'public' }));
  assert.equal(short.state, 'live');
  assert.ok(!short.badges.includes('Live'));

  const ripple = toRippleSummary(baseRipple({ lifecycle: 'active', visibility: 'public' }));
  assert.ok(ripple.badges.includes('Live'));
});
