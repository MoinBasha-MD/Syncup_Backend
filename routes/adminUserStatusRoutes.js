const express = require('express');
const router = express.Router();
const {
  getAllUsersWithStatus,
  updateUserStatus,
  getUserStatusHistory,
  getStatusStatistics,
  bulkUpdateUserStatus,
  searchUsersByStatus
} = require('../controllers/adminUserStatusController');

// Use JWT authentication middleware from adminAuthRoutes
const { verifyToken } = require('./adminAuthRoutes');

// Apply JWT authentication to all routes
router.use(verifyToken);

/**
 * @route   GET /admin/api/users/all-with-status
 * @desc    Get all users with their current status
 * @access  Admin
 */
router.get('/all-with-status', getAllUsersWithStatus);

/**
 * @route   POST /admin/api/users/update-status
 * @desc    Update a user's status (admin override)
 * @access  Admin
 */
router.post('/update-status', updateUserStatus);

/**
 * @route   GET /admin/api/users/:userId/status-history
 * @desc    Get status history for a specific user
 * @access  Admin
 */
router.get('/:userId/status-history', getUserStatusHistory);

/**
 * @route   GET /admin/api/users/status-stats
 * @desc    Get real-time status statistics
 * @access  Admin
 */
router.get('/status-stats', getStatusStatistics);

/**
 * @route   POST /admin/api/users/bulk-update-status
 * @desc    Bulk update multiple users' statuses
 * @access  Admin
 */
router.post('/bulk-update-status', bulkUpdateUserStatus);

/**
 * @route   GET /admin/api/users/search-by-status
 * @desc    Search users by status criteria
 * @access  Admin
 */
router.get('/search-by-status', searchUsersByStatus);

module.exports = router;
