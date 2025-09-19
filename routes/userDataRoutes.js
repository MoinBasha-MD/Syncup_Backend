const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getUserData,
  getUserHistory,
  getUserTemplates,
  getUserSchedules,
  getContactSchedules,
  getUserAnalytics,
  getUserProfile,
  createUserSchedule,
  updateUserSchedule,
  deleteUserSchedule
} = require('../controllers/userDataController');

// User data routes - all protected
router.get('/:userId/data', protect, getUserData);
router.get('/:userId/history', protect, getUserHistory);
router.get('/:userId/templates', protect, getUserTemplates);
// User schedule routes
router.route('/:userId/schedules')
  .get(protect, getUserSchedules)
  .post(protect, createUserSchedule);

// Contact schedule routes - accessible to any authenticated user
router.get('/:userId/contact-schedules', protect, getContactSchedules);

router.route('/:userId/schedules/:id')
  .put(protect, updateUserSchedule)
  .delete(protect, deleteUserSchedule);
router.get('/:userId/analytics', protect, getUserAnalytics);
router.get('/:userId/profile', protect, getUserProfile);

module.exports = router;
