const test = require('node:test');
const assert = require('node:assert');

const { canWatchLive } = require('../services/openNetworkVisibility');
const { chatPreviewOf } = require('../utils/openNetworkPeopleDto');
const { defaultExpiresAt, DEFAULT_RIPPLE_DURATION_MS } = require('../services/rippleLifecycleService');
const { normalizeBbox } = require('../services/openNetworkGeo');

test('defaultExpiresAt: a Ripple without an end time ends a week after its start', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  assert.equal(defaultExpiresAt(start).getTime(), start.getTime() + DEFAULT_RIPPLE_DURATION_MS);
  const now = new Date('2026-02-01T00:00:00Z');
  assert.equal(defaultExpiresAt(null, now).getTime(), now.getTime() + DEFAULT_RIPPLE_DURATION_MS);
});

test('normalizeBbox clamps longitude into [-180, 180]', () => {
  const [box] = normalizeBbox({ swLng: -200, swLat: 0, neLng: 170, neLat: 10 });
  assert.equal(box.swLng, -180);
  assert.equal(box.neLng, 170);
});

const ctx = (friends = [], blocked = []) => ({
  friendIds: new Set(friends),
  blockedIds: new Set(blocked),
  pageIds: new Set(),
});

test('canWatchLive: host always may watch their own broadcast', () => {
  const s = { hostUserId: 'h1', visibility: 'friends' };
  assert.equal(canWatchLive(s, 'h1', ctx([], ['h1'])), true);
});

test('canWatchLive: a blocked viewer is refused on public broadcasts', () => {
  const s = { hostUserId: 'h1', visibility: 'public' };
  assert.equal(canWatchLive(s, 'v1', ctx([], ['h1'])), false);
});

test('canWatchLive: friends-only broadcasts need friendship', () => {
  const s = { hostUserId: 'h1', visibility: 'friends' };
  assert.equal(canWatchLive(s, 'v1', ctx([])), false);
  assert.equal(canWatchLive(s, 'v1', ctx(['h1'])), true);
});

test('canWatchLive: public broadcasts are open to non-blocked viewers', () => {
  const s = { hostUserId: 'h1', visibility: 'public' };
  assert.equal(canWatchLive(s, 'v1', ctx()), true);
});

test('chatPreviewOf: plaintext text message uses its body', () => {
  const p = chatPreviewOf({ type: 'text', body: 'hi', senderId: 'a', createdAt: new Date(0) });
  assert.equal(p.body, 'hi');
  assert.equal(p.type, 'text');
  assert.equal(p.senderId, 'a');
  assert.equal(p.lastE2ee, undefined);
});

test('chatPreviewOf: e2ee message carries the envelope and no plaintext body', () => {
  const env = { ct: 'x' };
  const p = chatPreviewOf({ type: 'text', body: '', e2ee: { v: 2, envelope: env }, senderId: 'a', createdAt: new Date(0) });
  assert.equal(p.body, '');
  assert.deepEqual(p.lastE2ee, { v: 2, envelope: env });
});

test('chatPreviewOf: deleted or missing message yields an empty preview', () => {
  const p = chatPreviewOf(null);
  assert.deepEqual(p, { body: '', type: null, senderId: null, at: null });
});
