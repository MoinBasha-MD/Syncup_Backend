/**
 * Incoming-call server helpers.
 *
 * resumeCall — validates that an incoming call is still ringing for this
 * receiver and reconstructs the authoritative call data (offer SDP is never
 * sent via FCM, so recovery fetches it here).
 *
 * deliverCallNotification — ordered receiver notification. When the receiver
 * is socket-online the caller is confirmed (call:ringing) IMMEDIATELY after
 * the socket emit; the FCM backup push is awaited afterwards so a slow FCM
 * round-trip can't delay real callId assignment.
 */

const CALL_LIFETIME_MS = 60_000;

/**
 * @param {object} deps
 * @param {object} deps.Call       - Call mongoose model (query injectable for tests)
 * @param {Map}    deps.activeCalls- live in-memory call map
 * @param {string} deps.userId     - authenticated receiver's userId
 * @param {string} deps.callId     - validated callId string
 * @param {number} [deps.now]      - injectable clock for tests
 * @returns {Promise<object|null>} data → active; null → definitively inactive
 *   (transport failures never reach here — the socket handler signals errors
 *   distinctly so the client keeps its pending record).
 */
async function resumeCall({ Call, activeCalls, userId, callId, now }) {
  if (!activeCalls.has(callId)) return null;

  // Exact receiver/status filter — do not broaden.
  const call = await Call.findOne({ callId, receiverId: userId, status: 'ringing' });

  // Re-check after the await — the call may have ended mid-query.
  if (!activeCalls.has(callId)) return null;
  if (!call) return null;

  const isLiveKit = call.transport === 'livekit';
  if (isLiveKit) {
    if (!call.callNonce || !call.e2eeEnvelope) return null;
  } else if (!call.offerSDP) {
    return null;
  }

  const at = now !== undefined ? now : Date.now();
  if (call.createdAt.getTime() + CALL_LIFETIME_MS <= at) return null;

  return {
    callId: call.callId,
    callerId: call.callerId,
    callerName: call.callerName,
    callerAvatar: call.callerAvatar,
    receiverName: call.receiverName,
    receiverAvatar: call.receiverAvatar,
    callType: call.callType,
    ...(isLiveKit
      ? {
          // No SDP on the LiveKit path — the callee unwraps the call key
          // from this envelope (same payload as the socket call:incoming).
          transport: 'livekit',
          callNonce: call.callNonce,
          e2ee: { v: 2, envelope: call.e2eeEnvelope },
        }
      : {
          offer: { type: 'offer', sdp: call.offerSDP },
        }),
    timestamp: call.createdAt.toISOString(),
    expiresAt: String(call.createdAt.getTime() + CALL_LIFETIME_MS),
  };
}

/**
 * Notify the receiver about a new call and confirm back to the caller.
 *
 * @returns {Promise<{method: 'websocket'|'fcm_push', fcm: object|null}>}
 */
async function deliverCallNotification({
  socket,
  receiverSocket,
  isReceiverOnline,
  callId,
  receiver,
  callType,
  callNotificationData,
  sendCallFcm,
}) {
  if (isReceiverOnline) {
    receiverSocket.emit('call:incoming', callNotificationData);
    console.log(`[CALL] call:incoming emitted via WebSocket`);

    // Confirm to the caller FIRST — FCM retries must not delay real callId
    // assignment (call:answered/call:connected may arrive before ringing).
    socket.emit('call:ringing', {
      callId,
      receiverId: receiver.userId,
      receiverName: receiver.name,
      callType,
      notificationMethod: 'websocket',
    });

    // FCM is also sent for socket-online receivers — a "connected" socket can
    // be a stale background connection that never renders UI. The client
    // dedupes by callId. A failure here must NOT fail/delete a valid call.
    let fcmResult = null;
    try {
      fcmResult = await sendCallFcm();
    } catch (err) {
      fcmResult = { success: false, error: err.message };
    }
    if (!fcmResult.success) {
      console.warn('[CALL] FCM backup push failed for online receiver — call remains active');
    }
    return { method: 'websocket', fcm: fcmResult };
  }

  // Offline: FCM is the only channel — a failure fails the call.
  const fcmResult = await sendCallFcm();
  if (fcmResult.success) {
    socket.emit('call:ringing', {
      callId,
      receiverId: receiver.userId,
      receiverName: receiver.name,
      callType,
      notificationMethod: 'fcm_push',
    });
  }
  return { method: 'fcm_push', fcm: fcmResult };
}

module.exports = { resumeCall, deliverCallNotification, CALL_LIFETIME_MS };
