const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  saveDailySchedule,
  getDailySchedule,
  deleteDailySchedule,
  validateTimeSlots
} = require('../controllers/dailyScheduleController');

/**
 * Daily Schedule Routes
 * Manage user's full day schedule with multiple time slots
 */

// @route   POST /api/daily-schedule
// @desc    Save user's daily schedule
// @access  Private
router.post('/', protect, saveDailySchedule);

// @route   GET /api/daily-schedule
// @desc    Get user's daily schedule
// @access  Private
router.get('/', protect, getDailySchedule);

// @route   DELETE /api/daily-schedule
// @desc    Delete user's daily schedule
// @access  Private
router.delete('/', protect, deleteDailySchedule);

// @route   POST /api/daily-schedule/validate
// @desc    Validate time slots without saving
// @access  Private
router.post('/validate', protect, validateTimeSlots);

module.exports = router;
