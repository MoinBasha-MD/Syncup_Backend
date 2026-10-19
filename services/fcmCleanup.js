const User = require('../models/userModel');

/** Wipe every FCM token — forces all users to re-register. */
const cleanAllTokens = async () => {
  const result = await User.updateMany({}, { $set: { fcmTokens: [] } });
  return { usersAffected: result.modifiedCount };
};

/** Remove only stale tokens (entries without lastUsed). */
const cleanInvalidTokens = async () => {
  const result = await User.updateMany(
    { 'fcmTokens.lastUsed': { $exists: false } },
    { $pull: { fcmTokens: { lastUsed: { $exists: false } } } }
  );
  return { usersAffected: result.modifiedCount };
};

/** Wipe tokens for one user (UUID userId). */
const cleanUserTokens = async (userId) => {
  const result = await User.updateOne({ userId }, { $set: { fcmTokens: [] } });
  return { matched: result.matchedCount > 0 };
};

const getTokenStats = async () => {
  const stats = await User.aggregate([
    {
      $project: {
        userId: 1,
        name: 1,
        tokenCount: { $size: { $ifNull: ['$fcmTokens', []] } },
        hasOldTokens: {
          $anyElementTrue: {
            $map: {
              input: { $ifNull: ['$fcmTokens', []] },
              as: 'token',
              in: { $not: { $ifNull: ['$$token.lastUsed', false] } }
            }
          }
        }
      }
    },
    {
      $group: {
        _id: null,
        totalUsers: { $sum: 1 },
        usersWithTokens: { $sum: { $cond: [{ $gt: ['$tokenCount', 0] }, 1, 0] } },
        usersWithMultipleTokens: { $sum: { $cond: [{ $gt: ['$tokenCount', 1] }, 1, 0] } },
        usersWithOldTokens: { $sum: { $cond: ['$hasOldTokens', 1, 0] } },
        totalTokens: { $sum: '$tokenCount' },
        avgTokensPerUser: { $avg: '$tokenCount' }
      }
    }
  ]);

  return stats[0] || {
    totalUsers: 0,
    usersWithTokens: 0,
    usersWithMultipleTokens: 0,
    usersWithOldTokens: 0,
    totalTokens: 0,
    avgTokensPerUser: 0
  };
};

module.exports = { cleanAllTokens, cleanInvalidTokens, cleanUserTokens, getTokenStats };
