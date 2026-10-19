/**
 * Admin Cleanup Routes - For maintenance operations
 * Protected by the admin JWT verifier (owner / super_admin only).
 * The shared logic lives in services/fcmCleanup.js, also used by /api/admin/v2.
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('./adminAuthRoutes');
const { recordAdminAction } = require('../services/adminAudit');
const fcmCleanup = require('../services/fcmCleanup');

// Destructive maintenance — owner / super_admin only
const requireElevatedAdmin = (req, res, next) => {
  if (!req.admin || !['owner', 'super_admin'].includes(req.admin.role)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Owner or super admin only.'
    });
  }
  next();
};

const auditCleanup = (req, action, extra = {}) => {
  recordAdminAction({
    adminId: req.admin._id,
    adminUsername: req.admin.username,
    adminRole: req.admin.role,
    ip: req.ip,
    action,
    result: 'success',
    ...extra
  }).catch(error => console.error(`❌ [AUDIT] Failed to record ${action}:`, error.message));
};

/**
 * ADMIN: Clean all FCM tokens from all users
 * POST /api/admin/cleanup/fcm-tokens-all
 * Use this to force all users to re-register tokens
 */
router.post('/cleanup/fcm-tokens-all', verifyToken, requireElevatedAdmin, async (req, res) => {
  try {
    console.log('🧹 [ADMIN CLEANUP] Starting FCM token cleanup for ALL users...');

    const { usersAffected } = await fcmCleanup.cleanAllTokens();

    console.log(`✅ [ADMIN CLEANUP] Cleaned FCM tokens from ${usersAffected} users`);

    auditCleanup(req, 'cleanup.fcm_tokens_all', { meta: { usersAffected } });

    res.json({
      success: true,
      message: 'All FCM tokens cleaned successfully',
      usersAffected,
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
router.post('/cleanup/fcm-tokens-invalid', verifyToken, requireElevatedAdmin, async (req, res) => {
  try {
    console.log('🧹 [ADMIN CLEANUP] Removing invalid FCM tokens...');

    const { usersAffected } = await fcmCleanup.cleanInvalidTokens();

    console.log(`✅ [ADMIN CLEANUP] Removed invalid tokens from ${usersAffected} users`);

    auditCleanup(req, 'cleanup.fcm_tokens_invalid', { meta: { usersAffected } });

    res.json({
      success: true,
      message: 'Invalid FCM tokens removed successfully',
      usersAffected,
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
router.get('/cleanup/fcm-stats', verifyToken, requireElevatedAdmin, async (req, res) => {
  try {
    const stats = await fcmCleanup.getTokenStats();

    res.json({
      success: true,
      stats,
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
router.post('/cleanup/fcm-tokens-user/:userId', verifyToken, requireElevatedAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    console.log(`🧹 [ADMIN CLEANUP] Cleaning FCM tokens for user: ${userId}`);

    const { matched } = await fcmCleanup.cleanUserTokens(userId);

    if (!matched) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log(`✅ [ADMIN CLEANUP] Cleaned FCM tokens for user: ${userId}`);

    auditCleanup(req, 'cleanup.fcm_tokens_user', { targetType: 'user', targetId: userId });

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
