const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { statusUpdateLimiter } = require('../middleware/securityMiddleware');

const {
  updateUserStatus,
  getUserStatus,
  getSpecificUserStatus,
  getUserStatusByPhone,
  forceSyncStatus
} = require('../controllers/statusController');

// Status management routes
// GET requests don't need additional rate limiting (handled by general statusLimiter in server.js)
// PUT/POST requests get additional rate limiting for updates
router.route('/')
  .get(protect, getUserStatus)
  .put(protect, statusUpdateLimiter, updateUserStatus); // Add specific update limiter

// Get user status by phone number (no additional limiting for reads)
router.get('/phone/:phoneNumber', protect, getUserStatusByPhone);

// Get user status by userId (no additional limiting for reads)
router.get('/:userId', protect, getSpecificUserStatus);

// Force sync status from app to database (add update limiter)
router.post('/sync', protect, statusUpdateLimiter, forceSyncStatus);

module.exports = router;
