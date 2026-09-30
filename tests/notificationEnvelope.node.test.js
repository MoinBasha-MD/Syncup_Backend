const test = require('node:test');
const assert = require('node:assert');

const {
  buildEnvelope,
  openNetworkEnvelopeSpec,
  CATEGORY_COLORS,
} = require('../services/notificationDispatcher');
const { toPushData } = require('../services/openNetworkNotify');

test('buildEnvelope produces a v2 self-describing envelope', () => {
  const env = buildEnvelope({
    type: 'on_message',
    category: 'message',
    title: 'Asha',
    body: 'New message',
    avatar: 'https://x/y.png',
    groupKey: 'onchat:123',
    action: { screen: 'OpenChat', params: { chatId: '123' } },
    cta: 'Reply',
  });
  assert.equal(env.v, '2');
  assert.ok(env.id, 'id');
  assert.equal(env.category, 'message');
  assert.equal(env.inApp, 'banner');
  assert.deepEqual(env.action, { screen: 'OpenChat', params: { chatId: '123' } });
  assert.ok(env.ts);
});

test('buildEnvelope defaults + drops empty optionals', () => {
  const env = buildEnvelope({ type: 'custom_ping', category: 'unknown_cat', title: 't', body: 'b' });
  assert.equal(env.category, 'system', 'unknown category falls back to system');
  assert.equal(env.inApp, 'banner');
  assert.ok(!('avatar' in env) && !('action' in env) && !('cta' in env));

  const quiet = buildEnvelope({ type: 'x', category: 'system', title: 't', body: 'b', inApp: 'none' });
  assert.equal(quiet.inApp, 'none');
});

test('toPushData flattens the envelope for FCM (action JSON-stringified)', () => {
  const env = buildEnvelope({
    type: 'live_started',
    category: 'live',
    title: 'Sam is live',
    body: 'Tap to watch',
    action: { kind: 'live_join', sessionId: 'abc' },
  });
  const flat = toPushData(env);
  for (const [k, v] of Object.entries(flat)) {
    assert.equal(typeof v, 'string', `${k} must be a string for FCM`);
  }
  assert.deepEqual(JSON.parse(flat.action), { kind: 'live_join', sessionId: 'abc' });
  assert.equal(flat.v, '2');
});

test('category colour map covers the envelope categories', () => {
  assert.equal(CATEGORY_COLORS.message, '#06B6D4');
  assert.equal(CATEGORY_COLORS.social, '#8B5CF6');
  assert.equal(CATEGORY_COLORS.ripple, '#8B5CF6');
  assert.equal(CATEGORY_COLORS.live, '#EF4444');
  assert.equal(CATEGORY_COLORS.system, '#F59E0B');
});

test('openNetworkEnvelopeSpec maps ON types to category + action', () => {
  assert.deepEqual(
    openNetworkEnvelopeSpec({ type: 'on_message', fromUserId: 'u1', data: { chatId: 'c1' } }),
    { category: 'message', groupKey: 'onchat:c1', action: { screen: 'OpenChat', params: { chatId: 'c1' } } },
  );
  assert.deepEqual(
    openNetworkEnvelopeSpec({ type: 'on_connect_request', fromUserId: 'u1' }),
    { category: 'social', action: { screen: 'OpenNetworkInbox', params: { tab: 'requests' } } },
  );
  assert.deepEqual(
    openNetworkEnvelopeSpec({ type: 'on_connect_accepted', fromUserId: 'u9' }),
    { category: 'social', action: { screen: 'OpenNetworkProfile', params: { userId: 'u9' } } },
  );
  assert.deepEqual(
    openNetworkEnvelopeSpec({ type: 'ripple_join_request', data: { rippleId: 'r1' } }),
    { category: 'ripple', groupKey: 'ripple:r1', action: { screen: 'RippleDetail', params: { rippleId: 'r1' } } },
  );
  // ripple_removed: no action
  const removed = openNetworkEnvelopeSpec({ type: 'ripple_removed', data: { rippleId: 'r1' } });
  assert.equal(removed.category, 'ripple');
  assert.equal(removed.action, undefined);
  // live_started → live_join action + Watch CTA
  const live = openNetworkEnvelopeSpec({ type: 'live_started', data: { sessionId: 's1' } });
  assert.equal(live.category, 'live');
  assert.deepEqual(live.action, { kind: 'live_join', sessionId: 's1' });
  assert.equal(live.cta, 'Watch');
  // unknown type → system, no action
  assert.deepEqual(openNetworkEnvelopeSpec({ type: 'made_up' }), { category: 'system' });
});
