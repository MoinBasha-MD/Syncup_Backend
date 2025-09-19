const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

const {
  updateUserStatus,
  getUserStatus,
  getSpecificUserStatus,
  getUserStatusByPhone,
  forceSyncStatus
} = require('../controllers/statusController');

// Status management routes
router.route('/')
  .get(protect, getUserStatus)
  .put(protect, updateUserStatus);

// Get user status by phone number
router.get('/phone/:phoneNumber', protect, getUserStatusByPhone);

// Get user status by userId
router.get('/:userId', protect, getSpecificUserStatus);

// Force sync status from app to database
router.post('/sync', protect, forceSyncStatus);

module.exports = router;
