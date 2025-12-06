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

// ✅ FIX BUG #7: Pause/Resume Daily Schedule Routes
// @route   POST /api/daily-schedule/pause
// @desc    Pause daily schedule for specified duration
// @access  Private
router.post('/pause', protect, async (req, res) => {
  try {
    const StatusSchedule = require('../models/statusScheduleModel');
    const { duration, reason } = req.body; // duration in hours
    
    console.log(`⏸️ [PAUSE] User ${req.user.userId} pausing schedule for ${duration} hours`);
    
    const pauseUntil = new Date();
    pauseUntil.setHours(pauseUntil.getHours() + (duration || 24)); // Default 24 hours
    
    // Update all active daily schedules for this user
    const result = await StatusSchedule.updateMany(
      { 
        userId: req.user.userId,
        tags: 'daily_schedule',
        active: true
      },
      {
        $set: {
          pausedUntil: pauseUntil,
          pauseReason: reason || 'manual'
        }
      }
    );
    
    console.log(`✅ [PAUSE] Paused ${result.modifiedCount} schedule(s) until ${pauseUntil.toLocaleString()}`);
    
    res.json({
      success: true,
      message: `Daily schedule paused until ${pauseUntil.toLocaleString()}`,
      pausedUntil: pauseUntil,
      schedulesAffected: result.modifiedCount
    });
  } catch (error) {
    console.error('❌ [PAUSE] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/daily-schedule/resume
// @desc    Resume paused daily schedule
// @access  Private
router.post('/resume', protect, async (req, res) => {
  try {
    const StatusSchedule = require('../models/statusScheduleModel');
    
    console.log(`▶️ [RESUME] User ${req.user.userId} resuming schedule`);
    
    // Clear pausedUntil for all schedules
    const result = await StatusSchedule.updateMany(
      { 
        userId: req.user.userId,
        tags: 'daily_schedule',
        active: true
      },
      {
        $set: {
          pausedUntil: null,
          pauseReason: null
        }
      }
    );
    
    console.log(`✅ [RESUME] Resumed ${result.modifiedCount} schedule(s)`);
    
    // Trigger immediate auto-status check
    const autoStatusService = require('../services/autoStatusService');
    await autoStatusService.checkAndUpdateUserStatus(req.user.userId);
    
    res.json({
      success: true,
      message: 'Daily schedule resumed successfully',
      schedulesAffected: result.modifiedCount
    });
  } catch (error) {
    console.error('❌ [RESUME] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/daily-schedule/status
// @desc    Get pause status of daily schedule
// @access  Private
router.get('/status', protect, async (req, res) => {
  try {
    const StatusSchedule = require('../models/statusScheduleModel');
    
    const schedule = await StatusSchedule.findOne({
      userId: req.user.userId,
      tags: 'daily_schedule',
      active: true
    });
    
    if (!schedule) {
      return res.json({
        success: true,
        hasSchedule: false,
        isPaused: false
      });
    }
    
    const now = new Date();
    const isPaused = schedule.pausedUntil && new Date(schedule.pausedUntil) > now;
    
    res.json({
      success: true,
      hasSchedule: true,
      isPaused: isPaused,
      pausedUntil: isPaused ? schedule.pausedUntil : null,
      pauseReason: isPaused ? schedule.pauseReason : null,
      hoursRemaining: isPaused ? Math.round((new Date(schedule.pausedUntil).getTime() - now.getTime()) / (1000 * 60 * 60)) : 0
    });
  } catch (error) {
    console.error('❌ [STATUS] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
