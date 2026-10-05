const test = require('node:test');
const assert = require('node:assert');

const { resumeCall, deliverCallNotification } = require('../services/callResumeService');

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

test('call removed from activeCalls during the awaited find resolves null', async () => {
  const activeCalls = new Map([[ACTIVE_CALL_ID, { callerId: 'u_caller' }]]);
  const deps = makeDeps({ activeCalls });
  deps.Call.findOne = async () => {
    activeCalls.delete(ACTIVE_CALL_ID); // ended mid-query
    return makeCall();
  };
  assert.equal(await resumeCall(deps), null);
});

test('time is evaluated after the query when now is not injected', async () => {
  const deps = makeDeps();
  delete deps.now;
  const call = makeCall({ createdAt: new Date(Date.now()) });
  deps.Call.findOne = async () => call;
  assert.ok(await resumeCall(deps), 'fresh call resolves data');
  const old = makeCall({ createdAt: new Date(Date.now() - 120_000) });
  deps.Call.findOne = async () => old;
  assert.equal(await resumeCall(deps), null, 'stale call resolves null');
});

test('deliverCallNotification: online confirms call:ringing BEFORE awaiting FCM', async () => {
  const order = [];
  const callerSocket = { emit: (ev, d) => order.push(['caller', ev, d]) };
  const receiverSocket = { id: 'rsock', emit: (ev, d) => order.push(['receiver', ev, d]), connected: true };

  let resolveFcm;
  const sendCallFcm = () => new Promise((res) => {
    order.push(['fcm', 'called']);
    resolveFcm = res;
  });

  const promise = deliverCallNotification({
    socket: callerSocket,
    receiverSocket,
    isReceiverOnline: true,
    callId: 'call_x',
    receiver: { userId: 'u_recv', name: 'Asha' },
    callType: 'voice',
    callNotificationData: { callId: 'call_x' },
    sendCallFcm,
  });

  // ringing must be emitted before the FCM promise resolves.
  const events = order.map(([t, ev]) => `${t}:${ev}`);
  assert.deepEqual(events.slice(0, 3), [
    'receiver:call:incoming',
    'caller:call:ringing',
    'fcm:called',
  ]);

  resolveFcm({ success: false, reason: 'offline test' });
  const result = await promise;
  // Online FCM failure does NOT fail the call.
  assert.equal(result.method, 'websocket');
  assert.equal(result.fcm.success, false);
  assert.ok(order.every(([t, ev]) => ev !== 'call:failed'));
});

test('deliverCallNotification: offline confirms ringing after FCM, failure fails caller', async () => {
  const emitted = [];
  const callerSocket = { emit: (ev, d) => emitted.push([ev, d]) };
  const receiverSocket = { emit: () => emitted.push(['receiverEmit']) };

  const ok = await deliverCallNotification({
    socket: callerSocket,
    receiverSocket,
    isReceiverOnline: false,
    callId: 'call_y',
    receiver: { userId: 'u_recv', name: 'Asha' },
    callType: 'voice',
    callNotificationData: { callId: 'call_y' },
    sendCallFcm: async () => ({ success: true }),
  });
  assert.equal(ok.method, 'fcm_push');
  assert.deepEqual(emitted[0][0], 'call:ringing');
  assert.equal(emitted[0][1].notificationMethod, 'fcm_push');

  const fail = await deliverCallNotification({
    socket: callerSocket,
    receiverSocket,
    isReceiverOnline: false,
    callId: 'call_z',
    receiver: { userId: 'u_recv', name: 'Asha' },
    callType: 'voice',
    callNotificationData: { callId: 'call_z' },
    sendCallFcm: async () => ({ success: false }),
  });
  assert.equal(fail.fcm.success, false);
  // Caller is NOT confirmed on offline-FCM failure (caller cleanup happens
  // in the socket handler) — total call:ringing emits stays at 1.
  assert.equal(emitted.filter(([ev]) => ev === 'call:ringing').length, 1);
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
