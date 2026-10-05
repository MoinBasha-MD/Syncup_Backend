/**
 * call:resume helper — validates that an incoming call is still ringing for
 * this receiver and reconstructs the authoritative call data (offer SDP is
 * never sent via FCM, so recovery fetches it here).
 *
 * Return values:
 *   data  → call is active; hydrate the client with this
 *   null  → definitively inactive (not found / not ringing / expired)
 * Transport failures never reach here — the socket handler's try/catch
 * signals an error distinctly so the client keeps the pending record.
 */

const CALL_LIFETIME_MS = 60_000;

/**
 * @param {object} deps
 * @param {object} deps.Call       - Call mongoose model (query injectable for tests)
 * @param {Map}    deps.activeCalls- live in-memory call map
 * @param {string} deps.userId     - authenticated receiver's userId
 * @param {string} deps.callId     - validated callId string
 * @param {number} [deps.now]      - injectable clock for tests
 * @returns {Promise<object|null>}
 */
async function resumeCall({ Call, activeCalls, userId, callId, now = Date.now() }) {
  if (!activeCalls.has(callId)) return null;

  // Exact receiver/status filter — do not broaden.
  const call = await Call.findOne({ callId, receiverId: userId, status: 'ringing' });
  if (!call) return null;
  if (!call.offerSDP) return null;
  if (call.createdAt.getTime() + CALL_LIFETIME_MS <= now) return null;

  return {
    callId: call.callId,
    callerId: call.callerId,
    callerName: call.callerName,
    callerAvatar: call.callerAvatar,
    callType: call.callType,
    offer: { type: 'offer', sdp: call.offerSDP },
    timestamp: call.createdAt.toISOString(),
    expiresAt: String(call.createdAt.getTime() + CALL_LIFETIME_MS),
  };
}

module.exports = { resumeCall, CALL_LIFETIME_MS };
