const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { updateUserStatus, getNearbyUsers } = require('../controllers/statusController'); // Use statusController instead of userController
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
  autoGenerateTemplates,
} = require('../controllers/statusTemplateController');
const {
  getStatusSchedules,
  createStatusSchedule,
  updateStatusSchedule,
  deleteStatusSchedule,
  getUpcomingStatusSchedules,
  getExpandedSchedules,
  createScheduleFromTemplate,
  createRecurringSchedule,
  getStatusAnalytics: getScheduleAnalytics,
} = require('../controllers/statusScheduleController');
// Status schedule controllers removed - now using user-specific endpoints only

// Current status routes
router.route('/')
  .put(protect, updateUserStatus);

// Nearby users route
router.route('/nearby')
  .get(protect, getNearbyUsers);

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

// NEW: AI Auto-generate templates
router.route('/templates/auto-generate')
  .post(protect, autoGenerateTemplates);

router.route('/templates/:id')
  .put(protect, updateStatusTemplate)
  .delete(protect, deleteStatusTemplate);

// 🆕 Enhanced Status Schedule Routes
router.route('/schedules')
  .get(protect, getStatusSchedules)
  .post(protect, createStatusSchedule);

router.route('/schedules/upcoming')
  .get(protect, getUpcomingStatusSchedules);

router.route('/schedules/expanded')
  .get(protect, getExpandedSchedules);

router.route('/schedules/recurring')
  .post(protect, createRecurringSchedule);

router.route('/schedules/from-template')
  .post(protect, createScheduleFromTemplate);

router.route('/schedules/:id')
  .put(protect, updateStatusSchedule)
  .delete(protect, deleteStatusSchedule);

// 🆕 Enhanced Analytics Route
router.route('/analytics')
  .get(protect, getScheduleAnalytics);

// Status schedules routes have been moved to userDataRoutes.js for security purposes
// Now using /api/users/:userId/schedules endpoints instead
// This ensures proper user-specific access control

module.exports = router;
