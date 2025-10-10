const express = require('express');
const router = express.Router();
const { 
  registerUser, 
  loginUser, 
  getUserProfile,
  updateUserProfile,
  updateUserStatus,
  getRegisteredUsers,
  getUserByUserId,
  getUserContacts,
  getUserByPhone,
  updateUserProfileWithDiscovery,
  adminResetPassword,
  getAllUsersForAdmin,
  setUserPublic,
  setupEncryptionPin,
  verifyEncryptionPin,
  updateEncryptionSettings,
  getEncryptionSettings,
  verifyUserPassword
} = require('../controllers/userController');
const {
  getConnectionStats,
  getRecentConnections,
  getMutualConnections
} = require('../controllers/connectionStatsController');
const { protect } = require('../middleware/authMiddleware');

// Connection statistics routes (must be before generic routes)
router.route('/connection-stats')
  .get(protect, getConnectionStats);

// Phone lookup route
router.route('/phone/:phoneNumber')
  .get(protect, getUserByPhone);

// Protected routes
router.route('/profile')
  .get(protect, getUserProfile)
  .put(protect, updateUserProfileWithDiscovery);

// Status routes - DEPRECATED: Use /api/status-management instead
// router.route('/status')
//   .put(protect, updateUserStatus);

// Contacts routes
router.route('/contacts')
  .get(protect, getUserContacts);

// Public routes
router.post('/', registerUser);
router.post('/login', loginUser);
router.get('/registered', getRegisteredUsers);

// Get user by userId (UUID) via query parameter - must be LAST
router.get('/', protect, getUserByUserId);

router.route('/recent-connections')
  .get(protect, getRecentConnections);

router.route('/mutual-connections/:phoneNumber')
  .get(protect, getMutualConnections);

// Test route to set user as public (for debugging isPublic issues)
router.route('/set-public')
  .post(protect, setUserPublic);

// Admin routes for password reset
router.route('/admin/all')
  .get(getAllUsersForAdmin);

router.route('/admin/reset-password')
  .post(adminResetPassword);

// Chat encryption routes
router.route('/encryption-pin')
  .post(protect, setupEncryptionPin);

router.route('/encryption-verify')
  .post(protect, verifyEncryptionPin);

router.route('/encryption-settings')
  .get(protect, getEncryptionSettings)
  .post(protect, updateEncryptionSettings);

router.route('/verify-password')
  .post(protect, verifyUserPassword);

module.exports = router;
