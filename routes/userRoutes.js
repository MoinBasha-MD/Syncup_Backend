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
  setUserPublic,
  setupEncryptionPin,
  verifyEncryptionPin,
  updateEncryptionSettings,
  getEncryptionSettings,
  verifyUserPassword,
  getUserByUsername
} = require('../controllers/userController');
const {
  getConnectionStats,
  getRecentConnections,
  getMutualConnections
} = require('../controllers/connectionStatsController');
const {
  syncAllProfileImages,
  getSyncStatus
} = require('../controllers/syncProfileImagesController');
const { protect } = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/securityMiddleware');
const { sensitiveVerifyLimiter } = require('../middleware/rateLimiter');
const { resetPasswordOTP } = require('../controllers/passwordResetController');

// Connection statistics routes (must be before generic routes)
router.route('/connection-stats')
  .get(protect, getConnectionStats);

// Phone lookup route
router.route('/phone/:phoneNumber')
  .get(protect, getUserByPhone);

// Username lookup route (for QR code scanning) - Public access
router.route('/profile/:username')
  .get(getUserByUsername);

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
router.post('/login', authLimiter, loginUser);
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

const legacyEndpointDisabled = (req, res) =>
  res.status(410).json({ success: false, message: 'Legacy endpoint disabled' });

router.get('/admin/all', legacyEndpointDisabled);
router.post('/admin/reset-password', legacyEndpointDisabled);
router.post('/admin/force-reset-password', legacyEndpointDisabled);

// Chat encryption routes
router.route('/encryption-pin')
  .post(protect, setupEncryptionPin);

router.route('/encryption-verify')
  .post(protect, sensitiveVerifyLimiter, verifyEncryptionPin);

router.route('/encryption-settings')
  .get(protect, getEncryptionSettings)
  .post(protect, updateEncryptionSettings);

router.route('/verify-password')
  .post(protect, sensitiveVerifyLimiter, verifyUserPassword);

// OTP-related routes
router.route('/verify-email')
  .post(protect, async (req, res) => {
    try {
      const User = require('../models/userModel');
      const userId = req.user.userId;
      
      console.log(`✅ [VERIFY EMAIL] Updating verification status for userId: ${userId}`);
      
      // Use userId field (UUID) instead of _id (ObjectId)
      const result = await User.findOneAndUpdate(
        { userId: userId },
        { emailVerified: true },
        { new: true }
      );
      
      if (!result) {
        console.error(`❌ [VERIFY EMAIL] User not found: ${userId}`);
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      console.log(`✅ [VERIFY EMAIL] Email verified for user: ${result.email}`);
      res.json({
        success: true,
        message: 'Email verified successfully'
      });
    } catch (error) {
      console.error('❌ [VERIFY EMAIL] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update verification status'
      });
    }
  });

router.post('/reset-password-otp', authLimiter, resetPasswordOTP);

// Profile image sync routes
router.post('/sync-profile-images', protect, syncAllProfileImages);
router.get('/sync-status', protect, getSyncStatus);

module.exports = router;
