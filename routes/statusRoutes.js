const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { updateUserStatus } = require('../controllers/userController');
const {
  getStatusHistory,
  createStatusHistory,
  deleteStatusHistory,
  getStatusAnalytics,
} = require('../controllers/statusHistoryController');
const {
  getStatusTemplates,
  createStatusTemplate,
  updateStatusTemplate,
  deleteStatusTemplate,
} = require('../controllers/statusTemplateController');
// Status schedule controllers removed - now using user-specific endpoints only

// Current status routes
router.route('/')
  .put(protect, updateUserStatus);

// Status history routes
router.route('/history')
  .get(protect, getStatusHistory)
  .post(protect, createStatusHistory);

router.route('/history/:id')
  .delete(protect, deleteStatusHistory);

router.route('/history/analytics')
  .get(protect, getStatusAnalytics);

// Status templates routes
router.route('/templates')
  .get(protect, getStatusTemplates)
  .post(protect, createStatusTemplate);

router.route('/templates/:id')
  .put(protect, updateStatusTemplate)
  .delete(protect, deleteStatusTemplate);

// Status schedules routes have been moved to userDataRoutes.js for security purposes
// Now using /api/users/:userId/schedules endpoints instead
// This ensures proper user-specific access control

module.exports = router;
