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
        const endTime = new Date(schedule.endTime);
        
        // Check if recurrence has ended
        if (schedule.recurrenceConfig?.endDate) {
          const recurrenceEndDate = new Date(schedule.recurrenceConfig.endDate);
          if (currentTime > recurrenceEndDate) {
            return false; // Recurrence has ended
          }
        }
        
        // Handle different repeat patterns
        switch (schedule.repeat) {
          case 'none':
            // One-time schedule - check if it's time to apply and hasn't ended
            return this.isTimeToApply(currentTime, startTime) && currentTime <= endTime;
          
          case 'daily':
            // Daily schedule - check if the hour and minute match
            return this.shouldApplyRecurringSchedule(schedule, currentTime, 'daily');
          
          case 'weekdays':
            // Weekday schedule (Monday-Friday)
            return dayOfWeek >= 1 && dayOfWeek <= 5 && 
                   this.shouldApplyRecurringSchedule(schedule, currentTime, 'weekdays');
          
          case 'weekends':
            // Weekend schedule (Saturday-Sunday)
            return (dayOfWeek === 0 || dayOfWeek === 6) && 
                   this.shouldApplyRecurringSchedule(schedule, currentTime, 'weekends');
          
          case 'weekly':
            // Weekly schedule - check if day of week and time match
            return dayOfWeek === startTime.getDay() && 
                   this.shouldApplyRecurringSchedule(schedule, currentTime, 'weekly');
          
          case 'biweekly':
            // Bi-weekly schedule
            return this.shouldApplyRecurringSchedule(schedule, currentTime, 'biweekly');
          
          case 'monthly':
            // Monthly schedule - check if day of month and time match
            return currentTime.getDate() === startTime.getDate() && 
                   this.shouldApplyRecurringSchedule(schedule, currentTime, 'monthly');
          
          case 'custom_days':
            // Custom days schedule
            const daysOfWeek = schedule.recurrenceConfig?.daysOfWeek || [];
            return daysOfWeek.includes(dayOfWeek) && 
                   this.shouldApplyRecurringSchedule(schedule, currentTime, 'custom_days');
          
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
  
  /**
   * Check if a recurring schedule should be applied at the current time
   * @param {Object} schedule - The schedule object
   * @param {Date} currentTime - Current time
   * @param {string} repeatType - Type of recurrence
   * @returns {boolean} - Whether the schedule should be applied
   */
  shouldApplyRecurringSchedule(schedule, currentTime, repeatType) {
    const startTime = new Date(schedule.startTime);
    const endTime = new Date(schedule.endTime);
    const currentHour = currentTime.getHours();
    const currentMinute = currentTime.getMinutes();
    
    // Check if current time matches the scheduled time
    const timeMatches = startTime.getHours() === currentHour && 
                       startTime.getMinutes() === currentMinute;
    
    if (!timeMatches) return false;
    
    // Check interval for types that support it
    const interval = schedule.recurrenceConfig?.interval || 1;
    
    switch (repeatType) {
      case 'daily':
        if (interval === 1) return true;
        // For daily with interval > 1, check if current date is correct interval from start
        const daysDiff = Math.floor((currentTime - startTime) / (1000 * 60 * 60 * 24));
        return daysDiff >= 0 && daysDiff % interval === 0;
      
      case 'weekly':
      case 'weekdays':
      case 'weekends':
        if (interval === 1) return true;
        // For weekly intervals, check weeks difference
        const weeksDiff = Math.floor((currentTime - startTime) / (1000 * 60 * 60 * 24 * 7));
        return weeksDiff >= 0 && weeksDiff % interval === 0;
      
      case 'biweekly':
        const biweeklyDiff = Math.floor((currentTime - startTime) / (1000 * 60 * 60 * 24 * 7));
        return biweeklyDiff >= 0 && biweeklyDiff % 2 === 0;
      
      case 'monthly':
        if (interval === 1) return true;
        // For monthly intervals, check months difference
        const monthsDiff = (currentTime.getFullYear() - startTime.getFullYear()) * 12 + 
                          (currentTime.getMonth() - startTime.getMonth());
        return monthsDiff >= 0 && monthsDiff % interval === 0;
      
      case 'custom_days':
        return true; // Day matching is already done in the main filter
      
      default:
        return true;
    }
  }
  
  /**
   * Generate recurring instances for calendar display
   * @param {Object} schedule - The schedule object
   * @param {Date} startDate - Start date for generation
   * @param {Date} endDate - End date for generation
   * @returns {Array} - Array of recurring instances
   */
  generateRecurringInstances(schedule, startDate, endDate) {
    const instances = [];
    const originalStart = new Date(schedule.startTime);
    const originalEnd = new Date(schedule.endTime);
    const duration = originalEnd.getTime() - originalStart.getTime();
    
    // Safety check for invalid duration
    if (duration <= 0) {
      console.error('Invalid schedule duration:', { startTime: schedule.startTime, endTime: schedule.endTime });
      return instances;
    }
    
    // Get recurrence configuration
    const config = schedule.recurrenceConfig || {};
    const interval = Math.max(1, config.interval || 1); // Ensure interval is at least 1
    const recurrenceEndDate = config.endDate ? new Date(config.endDate) : endDate;
    const maxOccurrences = config.maxOccurrences || 1000; // Safety limit
    
    let currentDate = new Date(Math.max(originalStart.getTime(), startDate.getTime()));
    let occurrenceCount = 0;
    let iterationCount = 0; // Safety counter to prevent infinite loops
    const MAX_ITERATIONS = 10000; // Safety limit
    
    while (currentDate <= endDate && currentDate <= recurrenceEndDate && iterationCount < MAX_ITERATIONS) {
      iterationCount++;
      
      if (occurrenceCount >= maxOccurrences) break;
      
      let shouldInclude = false;
      let nextDate = new Date(currentDate); // Create copy for next iteration
      
      switch (schedule.repeat) {
        case 'daily':
          shouldInclude = true;
          nextDate.setDate(nextDate.getDate() + interval);
          break;
          
        case 'weekdays':
          const dayOfWeek = currentDate.getDay();
          shouldInclude = dayOfWeek >= 1 && dayOfWeek <= 5;
          nextDate.setDate(nextDate.getDate() + 1);
          break;
          
        case 'weekends':
          const weekendDay = currentDate.getDay();
          shouldInclude = weekendDay === 0 || weekendDay === 6;
          nextDate.setDate(nextDate.getDate() + 1);
          break;
          
        case 'weekly':
          shouldInclude = currentDate.getDay() === originalStart.getDay();
          nextDate.setDate(nextDate.getDate() + (7 * interval));
          break;
          
        case 'biweekly':
          shouldInclude = currentDate.getDay() === originalStart.getDay();
          nextDate.setDate(nextDate.getDate() + 14);
          break;
          
        case 'monthly':
          shouldInclude = currentDate.getDate() === originalStart.getDate();
          nextDate.setMonth(nextDate.getMonth() + interval);
          break;
          
        case 'custom_days':
          const customDay = currentDate.getDay();
          shouldInclude = config.daysOfWeek && config.daysOfWeek.includes(customDay);
          nextDate.setDate(nextDate.getDate() + 1);
          break;
          
        default:
          // Unknown repeat type - advance by 1 day to prevent infinite loop
          console.warn('Unknown repeat type:', schedule.repeat);
          nextDate.setDate(nextDate.getDate() + 1);
          shouldInclude = false;
          break;
      }
      
      if (shouldInclude && currentDate >= startDate) {
        const instanceStart = new Date(currentDate);
        instanceStart.setHours(originalStart.getHours(), originalStart.getMinutes(), 0, 0);
        
        const instanceEnd = new Date(instanceStart.getTime() + duration);
        
        instances.push({
          ...schedule.toObject(),
          startTime: instanceStart.toISOString(),
          endTime: instanceEnd.toISOString(),
          isRecurringInstance: true,
          originalScheduleId: schedule._id
        });
        
        occurrenceCount++;
      }
      
      // Always advance to next date to prevent infinite loop
      currentDate = nextDate;
      
      // Safety check: if date didn't advance, force advance by 1 day
      if (currentDate.getTime() === nextDate.getTime() && schedule.repeat !== 'monthly') {
        console.warn('Date not advancing properly, forcing advance');
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }
    
    if (iterationCount >= MAX_ITERATIONS) {
      console.error('Infinite loop detected in generateRecurringInstances, breaking');
    }
    
    return instances;
  }
}

module.exports = new StatusScheduler();
