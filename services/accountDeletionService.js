/**
 * Permanently delete a user's account and every per-user record that must not
 * outlive it. Each collection step is wrapped so a single failure logs and
 * continues — the User document is deleted last regardless.
 *
 * Messages the user sent are deliberately kept so recipients' histories stay
 * intact; chat-list and Open-Network chat DTOs render them as 'Deleted user'.
 */
const User = require('../models/userModel');
const socketManager = require('../socketManager');

const runStep = async (label, fn) => {
  try {
    const result = await fn();
    const count = result?.deletedCount ?? result?.modifiedCount ?? result ?? '';
    console.log(`🗑️ [ACCOUNT DELETE] ${label}: done (${JSON.stringify(count)})`);
  } catch (error) {
    console.error(`❌ [ACCOUNT DELETE] ${label} failed (continuing):`, error.message);
  }
};

const deleteUserAccount = async (user) => {
  const userId = user.userId;         // UUID string used by most collections
  const objectId = user._id;          // Mongo ObjectId used by ref:'User' fields

  console.log(`🗑️ [ACCOUNT DELETE] Starting deletion for ${userId}`);

  // Cancel every Ripple this user still owns that hasn't ended.
  await runStep('cancel ripples', () =>
    require('../models/Ripple').updateMany(
      { hostUserId: userId, lifecycle: { $in: ['draft', 'scheduled', 'active'] } },
      { $set: { lifecycle: 'cancelled' } }
    ));

  await runStep('friends', () =>
    require('../models/Friend').deleteMany({ $or: [{ userId }, { friendUserId: userId }] }));

  await runStep('blocks', () =>
    require('../models/blockModel').deleteMany({ $or: [{ blockerId: userId }, { blockedUserId: userId }] }));

  await runStep('open network profile', () =>
    require('../models/OpenNetworkProfile').deleteMany({ userId }));

  await runStep('open connections', () =>
    require('../models/OpenConnection').deleteMany({ $or: [{ requesterId: userId }, { recipientId: userId }] }));

  await runStep('status privacy', () =>
    require('../models/statusPrivacyModel').deleteMany({ userId: objectId }));

  await runStep('status history', () =>
    require('../models/statusHistoryModel').deleteMany({ userId }));

  await runStep('primary time profile', () =>
    require('../models/PrimaryTimeProfile').deleteMany({ userId: objectId }));

  await runStep('status schedules', () =>
    require('../models/statusScheduleModel').deleteMany({ userId }));

  await runStep('stories', () =>
    require('../models/storyModel').deleteMany({ userId }));

  await runStep('pulses', () =>
    require('../models/Pulse').deleteMany({ $or: [{ senderId: userId }, { receiverId: userId }] }));

  await runStep('pulse chains', () =>
    require('../models/PulseChain').deleteMany({ $or: [{ userId }, { 'participants.userId': userId }] }));

  await runStep('e2ee devices', () =>
    require('../models/E2EEDevice').deleteMany({ userId }));

  await runStep('e2ee backups', () =>
    require('../models/E2EEBackup').deleteMany({ userId }));

  await runStep('device sessions', () =>
    require('../models/DeviceSession').deleteMany({ userId }));

  await runStep('public status cache', () =>
    require('../models/PublicStatusCache').deleteMany(
      { $or: [{ userId: objectId }, { phoneNumber: user.phoneNumber }] }
    ));

  await runStep('intent notifications', () =>
    require('../models/IntentNotification').deleteMany(
      { $or: [{ fromUserId: userId }, { toUserId: userId }] }
    ));

  await runStep('saved vibes', () =>
    require('../models/SavedVibe').deleteMany({ userId: objectId }));

  // Drop every live socket before the doc disappears.
  await runStep('disconnect sockets', async () => socketManager.disconnectUser(userId));

  // The User document goes last so the steps above can still resolve it.
  await User.deleteOne({ _id: objectId });
  console.log(`🗑️ [ACCOUNT DELETE] User document deleted for ${userId}`);
};

module.exports = { deleteUserAccount };
