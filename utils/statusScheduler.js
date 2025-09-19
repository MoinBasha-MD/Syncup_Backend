const User = require('../models/userModel');
const StatusSchedule = require('../models/statusScheduleModel');
const StatusHistory = require('../models/statusHistoryModel');

/**
 * Status Scheduler - Handles automatic application of scheduled statuses
 */
class StatusScheduler {
  /**
   * Process scheduled statuses that need to be applied
   * @returns {Promise<Array>} - Array of processed status schedules
   */
  async processScheduledStatuses() {
    try {
      const now = new Date();
      const processedSchedules = [];
      
      // Find all active schedules that should be applied now
      const schedulesToApply = await this.findSchedulesToApply(now);
      
      if (schedulesToApply.length === 0) {
        console.log('No scheduled statuses to apply at this time');
        return [];
      }
      
      console.log(`Found ${schedulesToApply.length} scheduled statuses to apply`);
      
      // Process each schedule
      for (const schedule of schedulesToApply) {
        try {
          const result = await this.applyScheduledStatus(schedule);
          if (result) {
            processedSchedules.push(result);
          }
        } catch (error) {
          console.error(`Error applying scheduled status ${schedule._id}:`, error);
        }
      }
      
      return processedSchedules;
    } catch (error) {
      console.error('Error processing scheduled statuses:', error);
      return [];
    }
  }
  
  /**
   * Find schedules that need to be applied at the current time
   * @param {Date} currentTime - Current time
   * @returns {Promise<Array>} - Schedules to apply
   */
  async findSchedulesToApply(currentTime) {
    try {
      // Get the day of week (0-6, where 0 is Sunday)
      const dayOfWeek = currentTime.getDay();
      const currentHour = currentTime.getHours();
      const currentMinute = currentTime.getMinutes();
      
      // Find all active schedules
      const activeSchedules = await StatusSchedule.find({ active: true });
      
      // Filter schedules that should be applied now
      return activeSchedules.filter(schedule => {
        const startTime = new Date(schedule.startTime);
        
        // Handle different repeat patterns
        switch (schedule.repeat) {
          case 'none':
            // One-time schedule - check if it's time to apply
            return this.isTimeToApply(currentTime, startTime);
          
          case 'daily':
            // Daily schedule - check if the hour and minute match
            return startTime.getHours() === currentHour && 
                   startTime.getMinutes() === currentMinute;
          
          case 'weekdays':
            // Weekday schedule (Monday-Friday) - check if it's a weekday and time matches
            return dayOfWeek >= 1 && dayOfWeek <= 5 && 
                   startTime.getHours() === currentHour && 
                   startTime.getMinutes() === currentMinute;
          
          case 'weekly':
            // Weekly schedule - check if day of week and time match
            return dayOfWeek === startTime.getDay() && 
                   startTime.getHours() === currentHour && 
                   startTime.getMinutes() === currentMinute;
          
          case 'monthly':
            // Monthly schedule - check if day of month and time match
            return currentTime.getDate() === startTime.getDate() && 
                   startTime.getHours() === currentHour && 
                   startTime.getMinutes() === currentMinute;
          
          default:
            return false;
        }
      });
    } catch (error) {
      console.error('Error finding schedules to apply:', error);
      return [];
    }
  }
  
  /**
   * Check if it's time to apply a one-time schedule
   * @param {Date} currentTime - Current time
   * @param {Date} scheduleTime - Scheduled time
   * @returns {boolean} - Whether it's time to apply
   */
  isTimeToApply(currentTime, scheduleTime) {
    // For one-time schedules, check if the current time is within 1 minute of the scheduled time
    // and the schedule hasn't been applied yet (scheduled time is in the past or present)
    const timeDiff = Math.abs(currentTime - scheduleTime);
    return timeDiff <= 60000 && currentTime >= scheduleTime;
  }
  
  /**
   * Apply a scheduled status to a user
   * @param {Object} schedule - Status schedule to apply
   * @returns {Promise<Object>} - Updated user or null if failed
   */
  async applyScheduledStatus(schedule) {
    try {
      // Find the user
      const user = await User.findById(schedule.user);
      
      if (!user) {
        console.error(`User not found for schedule ${schedule._id}`);
        return null;
      }
      
      console.log(`Applying scheduled status for user ${user.userId}:`, {
        scheduleId: schedule._id,
        status: schedule.status,
        customStatus: schedule.customStatus,
        startTime: schedule.startTime,
        endTime: schedule.endTime
      });
      
      // Validate status
      const validStatuses = [
        // Basic statuses
        'available', 'busy', 'away', 'dnd',
        // Location-based statuses
        'at_work', 'at_home', 'at_school', 'at_college', 'at_hospital', 'at_mosque', 'at_temple', 'at_theatre', 'at_emergency',
        // Activity-based statuses
        'meeting', 'driving', 'commuting', 'working_out', 'eating', 'sleeping', 'studying', 'in_a_meeting',
        // Custom status
        'custom', 'extended', 'pause'
      ];
      
      if (!validStatuses.includes(schedule.status)) {
        console.error(`Invalid status type in schedule ${schedule._id}: ${schedule.status}`);
        return null;
      }
      
      // Store previous status for history tracking
      const previousStatus = user.status;
      const previousCustomStatus = user.customStatus || '';
      const statusChangeTime = new Date();
      
      // Calculate duration in minutes
      const duration = Math.round((new Date(schedule.endTime) - statusChangeTime) / (1000 * 60));
      
      // Update user status
      user.status = schedule.status;
      
      // Update custom status if provided and status is custom
      if (schedule.status === 'custom' && schedule.customStatus) {
        user.customStatus = schedule.customStatus;
      } else if (schedule.status !== 'custom') {
        user.customStatus = '';
      }
      
      // Set status expiration to the end time of the schedule
      user.statusUntil = schedule.endTime;
      
      // Save the updated user
      const updatedUser = await user.save();
      
      // Create status history entry if status has changed
      if (previousStatus !== schedule.status || 
          (schedule.status === 'custom' && previousCustomStatus !== user.customStatus)) {
        
        // Create a new status history entry
        await StatusHistory.create({
          user: user._id,
          userId: user.userId,
          status: schedule.status,
          customStatus: schedule.status === 'custom' ? user.customStatus : '',
          startTime: statusChangeTime,
          endTime: schedule.endTime,
          duration: duration > 0 ? duration : 60, // Default to 60 minutes if calculation is negative
        });
      }
      
      console.log(`Applied scheduled status for user ${user.userId}: ${schedule.status}`);
      
      // For one-time schedules, mark as inactive after applying
      if (schedule.repeat === 'none') {
        schedule.active = false;
        await schedule.save();
      }
      
      return {
        userId: updatedUser.userId,
        status: updatedUser.status,
        customStatus: updatedUser.customStatus,
        statusUntil: updatedUser.statusUntil,
        scheduleId: schedule._id
      };
    } catch (error) {
      console.error(`Error applying scheduled status ${schedule._id}:`, error);
      return null;
    }
  }
}

module.exports = new StatusScheduler();
