const test = require('node:test');
const assert = require('node:assert');

const { resumeCall } = require('../services/callResumeService');

const ACTIVE_CALL_ID = 'call_1';
const RECEIVER = 'u_receiver';

const makeCall = (over = {}) => ({
  callId: ACTIVE_CALL_ID,
  callerId: 'u_caller',
  callerName: 'Asha',
  callerAvatar: 'avatar.png',
  receiverId: RECEIVER,
  callType: 'video',
  status: 'ringing',
  offerSDP: 'v=0 offer-sdp',
  createdAt: new Date(1_000_000),
  ...over,
});

const makeDeps = ({ call = makeCall(), captured = {}, activeCalls, now = 1_000_000 } = {}) => ({
  Call: {
    findOne: async (filter) => {
      captured.filter = filter;
      return call;
    },
  },
  activeCalls: activeCalls || new Map([[ACTIVE_CALL_ID, { callerId: 'u_caller' }]]),
  userId: RECEIVER,
  callId: ACTIVE_CALL_ID,
  now,
});

test('resume validates receiver + ringing status with the exact query filter', async () => {
  const captured = {};
  const result = await resumeCall(makeDeps({ captured }));
  assert.deepEqual(captured.filter, {
    callId: ACTIVE_CALL_ID,
    receiverId: RECEIVER,
    status: 'ringing',
  });
  assert.ok(result, 'active call should return data');
});

test('reconstructs offer + server timestamps', async () => {
  const result = await resumeCall(makeDeps());
  assert.equal(result.callId, ACTIVE_CALL_ID);
  assert.equal(result.callerId, 'u_caller');
  assert.equal(result.callerName, 'Asha');
  assert.equal(result.callType, 'video');
  assert.deepEqual(result.offer, { type: 'offer', sdp: 'v=0 offer-sdp' });
  assert.equal(result.timestamp, new Date(1_000_000).toISOString());
  assert.equal(result.expiresAt, String(1_000_000 + 60_000));
});

test('returns null when not in activeCalls, absent, ended, missing SDP, or expired', async () => {
  // Not in activeCalls map
  assert.equal(await resumeCall(makeDeps({ activeCalls: new Map() })), null);
  // No call record
  assert.equal(await resumeCall(makeDeps({ call: null })), null);
  // Missing offerSDP
  assert.equal(await resumeCall(makeDeps({ call: makeCall({ offerSDP: null }) })), null);
  // Expired (createdAt + 60s <= now)
  assert.equal(
    await resumeCall(makeDeps({ now: 1_000_000 + 60_000 })),
    null);
  assert.equal(
    await resumeCall(makeDeps({ now: 1_000_000 + 61_000 })),
    null);
});

test('still active one ms before expiry', async () => {
  const result = await resumeCall(makeDeps({ now: 1_000_000 + 59_999 }));
  assert.ok(result);
});

// ── sendCallNotification shape ──────────────────────────────────────────────
test('sendCallNotification sends Android data-only high-priority, no SDP, retains APNs alert', async () => {
  const fcm = require('../services/fcmNotificationService');
  const User = require('../models/userModel');

  const origFindOne = User.findOne;
  const origUpdate = User.updateOne;
  const origSend = fcm._sendWithRetry;
  const origEnabled = fcm.fcmEnabled;

  let captured = null;
  try {
    fcm.fcmEnabled = true;
    User.findOne = () => ({
      select: async () => ({ fcmTokens: [{ token: 'tok1' }] }),
    });
    User.updateOne = async () => {};
    fcm._sendWithRetry = async (message) => {
      captured = message;
      return {
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true }],
      };
    };

    const res = await fcm.sendCallNotification('u_receiver', {
      callId: 'call_9',
      callerId: 'u_caller',
      callerName: 'Asha',
      callerAvatar: '',
      callType: 'voice',
      offer: { type: 'offer', sdp: 'huge-sdp-'.repeat(500) },
      timestamp: '2026-01-01T00:00:00.000Z',
      expiresAt: '1767225660000',
    });

    assert.equal(res.success, true);
    assert.ok(captured, 'message should have been sent');

    // Android data-only: no top-level notification, no android.notification
    assert.equal(captured.notification, undefined);
    assert.equal(captured.android.notification, undefined);
    assert.equal(captured.android.priority, 'high');
    assert.equal(captured.android.ttl, 30000);

    // Data carries call metadata + server timestamps but NO offer SDP
    const d = captured.data;
    assert.equal(d.type, 'incoming_call');
    assert.equal(d.callId, 'call_9');
    assert.equal(d.callerName, 'Asha');
    assert.equal(d.timestamp, '2026-01-01T00:00:00.000Z');
    assert.equal(d.expiresAt, '1767225660000');
    assert.equal(d.offer, undefined);
    assert.ok(JSON.stringify(d).length < 4000, 'data payload must stay under FCM limit');

    // iOS keeps a visible APNs alert + ring sound + call category
    const aps = captured.apns.payload.aps;
    assert.equal(aps.alert.title, 'Asha');
    assert.match(aps.alert.body, /voice/);
    assert.equal(aps.sound, 'ring_tone.aiff');
    assert.equal(aps.category, 'CALL_INVITATION');
  } finally {
    User.findOne = origFindOne;
    User.updateOne = origUpdate;
    fcm._sendWithRetry = origSend;
    fcm.fcmEnabled = origEnabled;
  }
});
