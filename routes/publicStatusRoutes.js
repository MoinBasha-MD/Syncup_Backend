const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getPublicStatus,
  togglePublicStatus,
  getPublicStatusSetting,
} = require('../controllers/publicStatusController');

// Get public status by phone number (dial pad lookup)
router.get('/public-status', protect, getPublicStatus);

// Toggle public status visibility
router.put('/public-status-toggle', protect, togglePublicStatus);

// Get current user's public status setting
router.get('/public-status-setting', protect, getPublicStatusSetting);

module.exports = router;
