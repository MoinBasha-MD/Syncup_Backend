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

// Temporary admin endpoint to manually reset password
router.route('/admin/force-reset-password')
  .post(async (req, res) => {
    console.log('🔧 [ADMIN] Force password reset endpoint hit!');
    try {
      const { phoneNumber, newPassword } = req.body;
      
      if (!phoneNumber || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'Phone number and new password required'
        });
      }
      
      const User = require('../models/userModel');
      const bcrypt = require('bcryptjs');
      
      const user = await User.findOne({ phoneNumber });
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      console.log('🔧 [ADMIN] Found user:', user.name, user.userId);
      console.log('🔧 [ADMIN] Old password hash:', user.password);
      
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      user.password = hashedPassword;
      await user.save();
      
      console.log('🔧 [ADMIN] New password hash:', hashedPassword);
      
      // Immediately verify the hash works
      const testMatch = await bcrypt.compare(newPassword, hashedPassword);
      console.log('🧪 [ADMIN] Immediate verification test:', testMatch);
      
      // Also test with the saved user
      const savedUser = await User.findOne({ phoneNumber });
      const savedMatch = await bcrypt.compare(newPassword, savedUser.password);
      console.log('🧪 [ADMIN] Saved user verification test:', savedMatch);
      console.log('✅ [ADMIN] Password reset successfully');
      
      res.json({
        success: true,
        message: 'Password reset successfully',
        userId: user.userId,
        newHash: hashedPassword,
        immediateTest: testMatch,
        savedTest: savedMatch
      });
    } catch (error) {
      console.error('❌ [ADMIN] Error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });

router.route('/reset-password-otp')
  .post(async (req, res) => {
    console.log('🔐 [RESET PASSWORD] Endpoint hit!');
    console.log('📧 [RESET PASSWORD] Request body:', JSON.stringify(req.body, null, 2));
    
    try {
      const { email, newPassword } = req.body;
      
      console.log('📧 [RESET PASSWORD] Email:', email);
      console.log('🔑 [RESET PASSWORD] New password length:', newPassword?.length);
      
      if (!email || !newPassword) {
        console.error('❌ [RESET PASSWORD] Missing email or password');
        return res.status(400).json({
          success: false,
          message: 'Email and new password are required'
        });
      }
      
      const User = require('../models/userModel');
      const bcrypt = require('bcryptjs');
      
      console.log('🔍 [RESET PASSWORD] Looking up user by email:', email);
      
      // Find user by email (case-insensitive)
      const user = await User.findOne({ 
        email: { $regex: new RegExp(`^${email}$`, 'i') } 
      });
      
      if (!user) {
        console.error('❌ [RESET PASSWORD] User not found for email:', email);
        return res.status(404).json({
          success: false,
          message: 'User not found with this email address'
        });
      }
      
      console.log('✅ [RESET PASSWORD] User found:', user.name, user.userId);
      console.log('🔐 [RESET PASSWORD] Hashing new password...');
      
      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      
      console.log('💾 [RESET PASSWORD] Updating password in database...');
      
      // Update password
      user.password = hashedPassword;
      await user.save();
      
      console.log(`✅ [RESET PASSWORD] Password reset successful for user: ${email}`);
      
      res.json({
        success: true,
        message: 'Password reset successfully. You can now login with your new password.'
      });
    } catch (error) {
      console.error('❌ [RESET PASSWORD] Error:', error);
      console.error('❌ [RESET PASSWORD] Error stack:', error.stack);
      res.status(500).json({
        success: false,
        message: 'Failed to reset password. Please try again.'
      });
    }
  });

module.exports = router;
