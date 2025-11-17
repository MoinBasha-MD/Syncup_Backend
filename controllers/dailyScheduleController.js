const dailyScheduleService = require('../services/dailyScheduleService');

/**
 * @desc    Save user's daily schedule
 * @route   POST /api/daily-schedule
 * @access  Private
 */
exports.saveDailySchedule = async (req, res) => {
  try {
    const userId = req.user.userId;
    const scheduleData = req.body;
    
    console.log('📅 [DAILY SCHEDULE] Saving schedule for user:', userId);
    console.log('📅 [DAILY SCHEDULE] Time slots:', scheduleData.timeSlots?.length);
    
    const result = await dailyScheduleService.saveDailySchedule(userId, scheduleData);
    
    res.status(201).json(result);
  } catch (error) {
    console.error('❌ [DAILY SCHEDULE] Error saving schedule:', error);
    
    if (error.statusCode === 400 && error.details) {
      // Validation error with details
      return res.status(400).json({
        success: false,
        message: error.message,
        errors: error.details.errors,
        warnings: error.details.warnings
      });
    }
    
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Error saving daily schedule'
    });
  }
};

/**
 * @desc    Get user's daily schedule
 * @route   GET /api/daily-schedule
 * @access  Private
 */
exports.getDailySchedule = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    console.log('📅 [DAILY SCHEDULE] Getting schedule for user:', userId);
    
    const schedule = await dailyScheduleService.getDailySchedule(userId);
    
    res.json({
      success: true,
      data: schedule
    });
  } catch (error) {
    console.error('❌ [DAILY SCHEDULE] Error getting schedule:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error getting daily schedule'
    });
  }
};

/**
 * @desc    Delete user's daily schedule
 * @route   DELETE /api/daily-schedule
 * @access  Private
 */
exports.deleteDailySchedule = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    console.log('📅 [DAILY SCHEDULE] Deleting schedule for user:', userId);
    
    await dailyScheduleService.deleteDailySchedule(userId);
    
    res.json({
      success: true,
      message: 'Daily schedule deleted successfully'
    });
  } catch (error) {
    console.error('❌ [DAILY SCHEDULE] Error deleting schedule:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error deleting daily schedule'
    });
  }
};

/**
 * @desc    Validate time slots without saving
 * @route   POST /api/daily-schedule/validate
 * @access  Private
 */
exports.validateTimeSlots = async (req, res) => {
  try {
    const { timeSlots } = req.body;
    
    console.log('📅 [DAILY SCHEDULE] Validating time slots:', timeSlots?.length);
    
    const validation = dailyScheduleService.validateTimeSlots(timeSlots);
    
    res.json({
      success: true,
      validation
    });
  } catch (error) {
    console.error('❌ [DAILY SCHEDULE] Error validating time slots:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error validating time slots'
    });
  }
};
