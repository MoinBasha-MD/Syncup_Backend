const User = require('../models/userModel');
const DeviceSession = require('../models/DeviceSession');

/**
 * Invalidate every session a user holds:
 *  - bump tokenVersion so all existing JWTs (tv < new version) are rejected
 *  - revoke all active DeviceSession rows (linked-device refresh tokens)
 *  - emit account:force_logout to the user's live socket and disconnect it
 *
 * @param {string} userId - the user's UUID `userId` field (not the Mongo _id)
 * @param {Object} [options]
 * @param {string} [options.reason]
 * @returns {Promise<number|null>} the new tokenVersion, or null if user not found
 */
const forceLogoutUser = async (userId, { reason } = {}) => {
  const user = await User.findOneAndUpdate(
    { userId },
    { $inc: { tokenVersion: 1 } },
    { new: true }
  ).select('userId tokenVersion');

  if (!user) return null;

  await DeviceSession.updateMany(
    { userId, status: 'active' },
    { $set: { status: 'revoked', revokedAt: new Date() } }
  );

  try {
    // userSockets is keyed by the UUID `userId` field
    const { getUserSockets } = require('../socketManager');
    const socket = getUserSockets().get(String(userId));
    if (socket) {
      socket.emit('account:force_logout', {
        reason: reason || null,
        timestamp: new Date().toISOString(),
      });
      socket.disconnect(true);
    }
  } catch (error) {
    console.error('❌ [SESSION CONTROL] Failed to disconnect socket for user:', userId, error.message);
  }

  return user.tokenVersion;
};

/**
 * Set a user's admin-managed account state. Any state other than 'active'
 * also force-logs the user out.
 *
 * @param {string} userId - the user's UUID `userId` field
 * @param {Object} options
 * @param {'active'|'suspended'|'banned'|'deleted'} options.state
 * @param {string} [options.reason]
 * @param {Date} [options.until]
 * @param {string} [options.by] - admin id performing the change
 * @returns {Promise<Object|null>} the updated user, or null if not found
 */
const setAccountState = async (userId, { state, reason, until, by } = {}) => {
  const update = {
    $set: {
      'accountStatus.state': state,
      'accountStatus.reason': reason || null,
      'accountStatus.until': until || null,
      'accountStatus.by': by || null,
      'accountStatus.at': new Date(),
    },
  };

  if (state === 'deleted') {
    update.$set.deletedAt = new Date();
  } else if (state === 'active') {
    update.$unset = { deletedAt: '' };
  }

  const user = await User.findOneAndUpdate({ userId }, update, { new: true });
  if (!user) return null;

  if (state !== 'active') {
    await forceLogoutUser(userId, { reason });
  }

  try {
    require('./adminSocket').emitAdminEvent('user:state_changed', {
      userId, state, reason: reason || null, by: by || null,
    });
  } catch { /* socket layer optional */ }

  return user;
};

module.exports = { forceLogoutUser, setAccountState };
