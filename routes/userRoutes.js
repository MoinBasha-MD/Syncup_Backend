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
  verifyUserPassword,
  getUserByUsername
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

// OTP-related routes
router.route('/verify-email')
  .post(protect, async (req, res) => {
    try {
      const User = require('../models/userModel');
      const userId = req.user.userId;
      
      await User.findByIdAndUpdate(userId, {
        emailVerified: true
      });
      
      res.json({
        success: true,
        message: 'Email verified successfully'
      });
    } catch (error) {
      console.error('Error verifying email:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update verification status'
      });
    }
  });

router.route('/reset-password-otp')
  .post(async (req, res) => {
    try {
      const { email, newPassword } = req.body;
      
      if (!email || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'Email and new password are required'
        });
      }
      
      const User = require('../models/userModel');
      const bcrypt = require('bcryptjs');
      
      // Find user by email
      const user = await User.findOne({ email: email.toLowerCase() });
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      
      // Update password
      user.password = hashedPassword;
      await user.save();
      
      console.log(`✅ Password reset successful for user: ${email}`);
      
      res.json({
        success: true,
        message: 'Password reset successfully'
      });
    } catch (error) {
      console.error('Error resetting password:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to reset password'
      });
    }
  });

module.exports = router;
