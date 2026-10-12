const test = require('node:test');
const assert = require('node:assert');
const {
  GROUP_CALL_MAX_VIDEO,
  GROUP_CALL_MAX_VOICE,
  capFor,
  validateGroupCreate,
  canJoinGroupCall,
  validateGroupInvite,
  rosterTransition,
  canEscalate,
} = require('../services/groupCallService');

const NONCE = 'a'.repeat(32);
const envFor = (id) => ({ to: id });
// Fake envelope validator that returns a ctx error like the real one.
const validateEnv = (env, { expectedCtx, senderId, allowedUserIds }) => {
  if (!env) return 'MISSING';
  if (env.badCtx) return `context mismatch`;
  if (!allowedUserIds.has(env.to)) return 'not allowed';
  return null;
};

const baseCreate = (over = {}) => ({
  callerId: 'me',
  callType: 'video',
  inviteeIds: ['u1', 'u2'],
  callNonce: NONCE,
  envelopes: { u1: envFor('u1'), u2: envFor('u2') },
  ...over,
});

test('create: rejects self, dupes dedupe, cap enforced, bad ctx rejected', () => {
  assert.equal(
    validateGroupCreate(baseCreate({ inviteeIds: ['me'] }), { validateEnv }).reason,
    'SELF_CALL');
  // Duplicates collapse — u1 twice counts once.
  const dup = validateGroupCreate(baseCreate({ inviteeIds: ['u1', 'u1'] }), { validateEnv });
  assert.ok(dup.ok);
  assert.deepEqual(dup.inviteeIds, ['u1']);
  // Video cap is 8 including the host → 8 invitees exceed.
  const over = baseCreate({
    inviteeIds: Array.from({ length: GROUP_CALL_MAX_VIDEO }, (_, i) => `u${i}`),
    envelopes: Object.fromEntries(
      Array.from({ length: GROUP_CALL_MAX_VIDEO }, (_, i) => [`u${i}`, envFor(`u${i}`)])),
  });
  assert.match(validateGroupCreate(over, { validateEnv }).reason, /GROUP_CALL_LIMIT:8/);
  // 7 invitees + host = 8 — allowed.
  const atCap = baseCreate({
    inviteeIds: Array.from({ length: 7 }, (_, i) => `u${i}`),
    envelopes: Object.fromEntries(
      Array.from({ length: 7 }, (_, i) => [`u${i}`, envFor(`u${i}`)])),
  });
  assert.ok(validateGroupCreate(atCap, { validateEnv }).ok);
  // Voice cap is 32.
  const voiceOver = baseCreate({
    callType: 'voice',
    inviteeIds: Array.from({ length: GROUP_CALL_MAX_VOICE }, (_, i) => `u${i}`),
  });
  assert.match(validateGroupCreate(voiceOver, { validateEnv }).reason, /GROUP_CALL_LIMIT:32/);
  // Bad envelope ctx fails closed.
  const bad = baseCreate({ envelopes: { u1: { badCtx: true }, u2: envFor('u2') } });
  assert.match(validateGroupCreate(bad, { validateEnv }).reason, /Invalid e2ee envelope/);
  // Missing envelope for one invitee.
  const missing = baseCreate({ envelopes: { u1: envFor('u1') } });
  assert.match(validateGroupCreate(missing, { validateEnv }).reason, /envelope/);
  // Bad nonce.
  assert.equal(validateGroupCreate(baseCreate({ callNonce: 'x' }), { validateEnv }).reason,
    'Invalid call nonce');
  assert.equal(validateGroupCreate(baseCreate({ callType: 'fax' }), { validateEnv }).reason,
    'Invalid call type');
});

test('join authorization: participant states, ended, rejoin allowed', () => {
  const call = {
    status: 'active',
    participants: [
      { userId: 'host', status: 'joined' },
      { userId: 'ringing', status: 'invited' },
      { userId: 'left1', status: 'left' },
      { userId: 'decl', status: 'declined' },
      { userId: 'gone', status: 'missed' },
    ],
  };
  assert.equal(canJoinGroupCall(call, 'ringing'), 'ok');
  assert.equal(canJoinGroupCall(call, 'left1'), 'ok');   // rejoin allowed while active
  assert.equal(canJoinGroupCall(call, 'host'), 'ok');   // already joined, rejoin ok
  assert.equal(canJoinGroupCall(call, 'decl'), 'not-participant');
  assert.equal(canJoinGroupCall(call, 'gone'), 'not-participant');
  assert.equal(canJoinGroupCall(call, 'stranger'), 'not-participant');
  assert.equal(canJoinGroupCall({ ...call, status: 'ended' }, 'host'), 'ended');
  assert.equal(canJoinGroupCall(null, 'host'), 'missing');
});

test('invite: only joined may invite; cap counts live roster', () => {
  const call = {
    status: 'active',
    callType: 'video',
    participants: [
      { userId: 'host', status: 'joined' },
      { userId: 'r1', status: 'invited' },
      { userId: 'd1', status: 'declined' },
    ],
  };
  // Non-joined participant refused.
  assert.equal(validateGroupInvite(
    { call, inviterId: 'r1', inviteeIds: ['n1'], callNonce: NONCE, envelopes: {} },
    { validateEnv }).reason, 'not-participant');
  // Unknown user refused.
  assert.equal(validateGroupInvite(
    { call, inviterId: 'ghost', inviteeIds: ['n1'], callNonce: NONCE, envelopes: {} },
    { validateEnv }).reason, 'not-participant');
  // Happy path.
  const ok = validateGroupInvite(
    { call, inviterId: 'host', inviteeIds: ['n1', 'n2'], callNonce: NONCE,
      envelopes: { n1: envFor('n1'), n2: envFor('n2') } },
    { validateEnv });
  assert.ok(ok.ok);
  // Inviting an existing participant is a no-op skip.
  const dup = validateGroupInvite(
    { call, inviterId: 'host', inviteeIds: ['r1', 'n1'], callNonce: NONCE,
      envelopes: { n1: envFor('n1') } },
    { validateEnv });
  assert.deepEqual(dup.inviteeIds, ['n1']);
  // Cap: live (host+r1)=2 + 7 new > 8 → refuse.
  const over = validateGroupInvite(
    { call, inviterId: 'host',
      inviteeIds: Array.from({ length: 7 }, (_, i) => `n${i}`),
      callNonce: NONCE,
      envelopes: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`n${i}`, envFor(`n${i}`)])) },
    { validateEnv });
  assert.match(over.reason, /GROUP_CALL_LIMIT/);
});

test('leave: last leaver ends the call', () => {
  const call = {
    status: 'active',
    participants: [
      { userId: 'a', status: 'joined' },
      { userId: 'b', status: 'joined' },
      { userId: 'c', status: 'invited' },
    ],
  };
  assert.deepEqual(rosterTransition(call, 'a', 'left'), { ended: false });
  assert.equal(call.participants[0].status, 'left');
  assert.ok(call.participants[0].leftAt);
  assert.deepEqual(rosterTransition(call, 'b', 'left'), { ended: true });
  assert.equal(rosterTransition(call, 'nobody', 'left'), null);
});

test('escalate: only answered livekit 1:1 participants', () => {
  const call = {
    callId: 'c1', callerId: 'a', receiverId: 'b',
    status: 'connected', transport: 'livekit',
  };
  const activeCall = { callerId: 'a', receiverId: 'b' };
  assert.equal(canEscalate({ call, activeCall, userId: 'a' }), true);
  assert.equal(canEscalate({ call, activeCall, userId: 'b' }), true);
  assert.equal(canEscalate({ call, activeCall, userId: 'mallory' }), false);
  assert.equal(canEscalate({ call, activeCall: null, userId: 'a' }), false);
  assert.equal(
    canEscalate({ call: { ...call, status: 'ringing' }, activeCall, userId: 'a' }),
    false);
  assert.equal(
    canEscalate({ call: { ...call, transport: 'p2p' }, activeCall, userId: 'a' }),
    false);
});

test('capFor', () => {
  assert.equal(capFor('video'), 8);
  assert.equal(capFor('voice'), 32);
});
