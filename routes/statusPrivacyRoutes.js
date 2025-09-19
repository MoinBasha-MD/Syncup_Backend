const express = require('express');
const router = express.Router();
const {
  getPrivacyInfo,
  getDefaultPrivacySettings,
  updateDefaultPrivacySettings,
  setStatusPrivacySettings,
  getStatusPrivacySettings,
  canSeeUserStatus,
  getStatusViewers,
  getUserGroups,
} = require('../controllers/statusPrivacyController');
const { protect } = require('../middleware/authMiddleware');

// Apply authentication middleware to all routes
router.use(protect);

// Root endpoint - get privacy API info and user's current settings, or update them
router.route('/')
  .get(getPrivacyInfo)
  .put(updateDefaultPrivacySettings);

// Default privacy settings routes
router.route('/default')
  .get(getDefaultPrivacySettings)
  .put(updateDefaultPrivacySettings);

// Status-specific privacy settings routes
router.route('/status/:statusId')
  .get(getStatusPrivacySettings)
  .post(setStatusPrivacySettings);

// Visibility check routes
router.get('/can-see/:userId/:statusId', canSeeUserStatus);
router.get('/can-see/:userId', canSeeUserStatus);
router.get('/viewers/:statusId', getStatusViewers);
router.get('/viewers', getStatusViewers);

// Helper routes
router.get('/groups', getUserGroups);

module.exports = router;
