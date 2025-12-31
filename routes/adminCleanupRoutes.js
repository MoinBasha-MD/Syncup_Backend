/**
 * Admin Cleanup Routes - For maintenance operations
 * These endpoints should be protected and only accessible by admins
 */

const express = require('express');
const router = express.Router();
const User = require('../models/userModel');
const { protect } = require('../middleware/authMiddleware');

/**
 * ADMIN: Clean all FCM tokens from all users
 * POST /api/admin/cleanup/fcm-tokens-all
 * Use this to force all users to re-register tokens
 */
router.post('/cleanup/fcm-tokens-all', protect, async (req, res) => {
  try {
    // Optional: Add admin check here
    // if (req.user.role !== 'admin') {
    //   return res.status(403).json({ success: false, message: 'Admin access required' });
    // }

    console.log('🧹 [ADMIN CLEANUP] Starting FCM token cleanup for ALL users...');

    const result = await User.updateMany(
      {},
      { $set: { fcmTokens: [] } }
    );

    console.log(`✅ [ADMIN CLEANUP] Cleaned FCM tokens from ${result.modifiedCount} users`);

    res.json({
      success: true,
      message: 'All FCM tokens cleaned successfully',
      usersAffected: result.modifiedCount,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [ADMIN CLEANUP] Error cleaning FCM tokens:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clean FCM tokens',
      error: error.message
    });
  }
});

/**
 * ADMIN: Clean invalid/old FCM tokens (tokens without lastUsed field)
 * POST /api/admin/cleanup/fcm-tokens-invalid
 * Use this to remove only old tokens, keeping new ones
 */
router.post('/cleanup/fcm-tokens-invalid', protect, async (req, res) => {
  try {
    console.log('🧹 [ADMIN CLEANUP] Removing invalid FCM tokens...');

    // Remove tokens without lastUsed field (old tokens)
    const result = await User.updateMany(
      { 'fcmTokens.lastUsed': { $exists: false } },
      { $pull: { fcmTokens: { lastUsed: { $exists: false } } } }
    );

    console.log(`✅ [ADMIN CLEANUP] Removed invalid tokens from ${result.modifiedCount} users`);

    res.json({
      success: true,
      message: 'Invalid FCM tokens removed successfully',
      usersAffected: result.modifiedCount,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [ADMIN CLEANUP] Error removing invalid tokens:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove invalid tokens',
      error: error.message
    });
  }
});

/**
 * ADMIN: Get FCM token statistics
 * GET /api/admin/cleanup/fcm-stats
 */
router.get('/cleanup/fcm-stats', protect, async (req, res) => {
  try {
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

    res.json({
      success: true,
      stats: stats[0] || {
        totalUsers: 0,
        usersWithTokens: 0,
        usersWithMultipleTokens: 0,
        usersWithOldTokens: 0,
        totalTokens: 0,
        avgTokensPerUser: 0
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [ADMIN CLEANUP] Error getting FCM stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get FCM stats',
      error: error.message
    });
  }
});

/**
 * ADMIN: Clean tokens for specific user
 * POST /api/admin/cleanup/fcm-tokens-user/:userId
 */
router.post('/cleanup/fcm-tokens-user/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;

    console.log(`🧹 [ADMIN CLEANUP] Cleaning FCM tokens for user: ${userId}`);

    const result = await User.updateOne(
      { userId },
      { $set: { fcmTokens: [] } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log(`✅ [ADMIN CLEANUP] Cleaned FCM tokens for user: ${userId}`);

    res.json({
      success: true,
      message: 'User FCM tokens cleaned successfully',
      userId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [ADMIN CLEANUP] Error cleaning user tokens:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clean user tokens',
      error: error.message
    });
  }
});

module.exports = router;
