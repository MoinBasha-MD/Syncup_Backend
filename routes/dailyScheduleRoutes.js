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

// @route   POST /api/daily-schedule/trigger-auto-status
// @desc    Manually trigger auto-status check (for testing)
// @access  Private
router.post('/trigger-auto-status', protect, async (req, res) => {
  try {
    const autoStatusService = require('../services/autoStatusService');
    console.log('🔄 [MANUAL TRIGGER] Auto-status check requested by', req.user.userId);
    
    // Check just this user
    const result = await autoStatusService.checkAndUpdateUserStatus(req.user.userId);
    
    if (result) {
      res.json({
        success: true,
        message: 'Status updated successfully',
        result
      });
    } else {
      res.json({
        success: true,
        message: 'No status update needed (already correct or no matching schedule)',
        result: null
      });
    }
  } catch (error) {
    console.error('❌ [MANUAL TRIGGER] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
