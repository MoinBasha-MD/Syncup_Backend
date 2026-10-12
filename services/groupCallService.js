/**
 * Pure group-call decision logic (unit tested) — socketManager wires these
 * to sockets/DB; nothing here performs IO.
 */

const GROUP_CALL_MAX_VIDEO = 8;
const GROUP_CALL_MAX_VOICE = 32;

const capFor = (callType) =>
  callType === 'video' ? GROUP_CALL_MAX_VIDEO : GROUP_CALL_MAX_VOICE;

const NONCE_RE = /^[0-9a-f]{32}$/;

/**
 * Validate a groupcall:create payload.
 * `validateEnv(envelope, opts) -> string|null` is the same validator the 1:1
 * path uses (utils/e2eeEnvelope.validateEnvelope), injected for testability.
 * Returns { ok, inviteeIds } or { ok:false, reason }.
 */
function validateGroupCreate({ callerId, callType, inviteeIds, callNonce, envelopes }, { validateEnv } = {}) {
  if (!['voice', 'video'].includes(callType)) {
    return { ok: false, reason: 'Invalid call type' };
  }
  if (typeof callNonce !== 'string' || !NONCE_RE.test(callNonce)) {
    return { ok: false, reason: 'Invalid call nonce' };
  }
  if (!Array.isArray(inviteeIds) || !inviteeIds.length) {
    return { ok: false, reason: 'No invitees' };
  }
  const ids = [];
  for (const raw of inviteeIds) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id || id.length > 200) return { ok: false, reason: 'Invalid invitee id' };
    if (id === callerId) return { ok: false, reason: 'SELF_CALL' };
    if (!ids.includes(id)) ids.push(id);
  }
  const cap = capFor(callType);
  if (ids.length + 1 > cap) { // cap counts the host
    return { ok: false, reason: `GROUP_CALL_LIMIT:${cap}` };
  }
  const envs = envelopes && typeof envelopes === 'object' && !Array.isArray(envelopes)
    ? envelopes : null;
  if (!envs) return { ok: false, reason: 'Missing envelopes' };
  for (const id of ids) {
    const env = envs[id];
    const err = !env
      ? 'MISSING_ENVELOPE'
      : validateEnv
        ? validateEnv(env, {
            senderId: callerId,
            expectedCtx: `gcall:${callNonce}:${callerId}:${id}`,
            allowedUserIds: new Set([callerId, id]),
            maxBytes: 64 * 1024,
          })
        : null;
    if (err) return { ok: false, reason: `Invalid e2ee envelope for ${id}: ${err}` };
  }
  return { ok: true, inviteeIds: ids };
}

/**
 * Join authorization: participant of an ACTIVE call with status
 * invited/left/joined may (re)join — a 'missed' user can't self-resume the
 * invite, and a rejoin mid-call is explicitly allowed.
 */
function canJoinGroupCall(call, userId) {
  if (!call) return 'missing';
  if (call.status !== 'active') return 'ended';
  const p = (call.participants || []).find(x => x.userId === userId);
  if (!p) return 'not-participant';
  if (!['invited', 'left', 'joined'].includes(p.status)) return 'not-participant';
  return 'ok';
}

/**
 * groupcall:invite — only a JOINED participant may add people; the call must
 * be active; new invitees must not already be participants; the roster
 * (joined + invited + new) must fit the cap.
 */
function validateGroupInvite({ call, inviterId, inviteeIds, callNonce, envelopes }, { validateEnv } = {}) {
  if (!call) return { ok: false, reason: 'missing' };
  if (call.status !== 'active') return { ok: false, reason: 'ended' };
  const inviter = (call.participants || []).find(x => x.userId === inviterId);
  if (!inviter || inviter.status !== 'joined') {
    return { ok: false, reason: 'not-participant' };
  }
  if (typeof callNonce !== 'string' || !NONCE_RE.test(callNonce)) {
    return { ok: false, reason: 'Invalid call nonce' };
  }
  if (!Array.isArray(inviteeIds) || !inviteeIds.length) {
    return { ok: false, reason: 'No invitees' };
  }
  const existing = new Set((call.participants || []).map(p => p.userId));
  const ids = [];
  for (const raw of inviteeIds) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id || id.length > 200) return { ok: false, reason: 'Invalid invitee id' };
    if (existing.has(id) || ids.includes(id)) continue; // already in — skip
    ids.push(id);
  }
  if (!ids.length) return { ok: false, reason: 'No new invitees' };
  const live = (call.participants || []).filter(
    p => p.status === 'joined' || p.status === 'invited',
  ).length;
  const cap = capFor(call.callType);
  if (live + ids.length > cap) {
    return { ok: false, reason: `GROUP_CALL_LIMIT:${cap}` };
  }
  const envs = envelopes && typeof envelopes === 'object' && !Array.isArray(envelopes)
    ? envelopes : null;
  if (!envs) return { ok: false, reason: 'Missing envelopes' };
  for (const id of ids) {
    const env = envs[id];
    const err = !env
      ? 'MISSING_ENVELOPE'
      : validateEnv
        ? validateEnv(env, {
            senderId: inviterId,
            expectedCtx: `gcall:${callNonce}:${inviterId}:${id}`,
            allowedUserIds: new Set([inviterId, id]),
            maxBytes: 64 * 1024,
          })
        : null;
    if (err) return { ok: false, reason: `Invalid e2ee envelope for ${id}: ${err}` };
  }
  return { ok: true, inviteeIds: ids };
}

/**
 * Apply a leave/decline. Returns { status, ended } — the call ends when no
 * 'joined' participants remain.
 */
function rosterTransition(call, userId, target) {
  const p = (call.participants || []).find(x => x.userId === userId);
  if (!p) return null;
  p.status = target;
  if (target === 'joined') p.joinedAt = new Date();
  if (target === 'left') p.leftAt = new Date();
  const anyJoined = (call.participants || []).some(x => x.status === 'joined');
  return { ended: !anyJoined };
}

/**
 * call:escalate authorization — the sender must be a participant of an
 * ANSWERED (connected) LiveKit 1:1 call. `call` is the Call record;
 * `activeCall` the in-memory entry.
 */
function canEscalate({ call, activeCall, userId }) {
  if (!call || !activeCall) return false;
  if (call.status !== 'connected') return false;
  if (call.transport !== 'livekit') return false;
  return call.callerId === userId || call.receiverId === userId;
}

module.exports = {
  GROUP_CALL_MAX_VIDEO,
  GROUP_CALL_MAX_VOICE,
  capFor,
  validateGroupCreate,
  canJoinGroupCall,
  validateGroupInvite,
  rosterTransition,
  canEscalate,
};
