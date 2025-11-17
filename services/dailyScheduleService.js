const StatusSchedule = require('../models/statusScheduleModel');
const User = require('../models/userModel');

/**
 * Daily Schedule Service
 * Manages user's full day schedule with 24-hour validation
 */
class DailyScheduleService {
  
  /**
   * Convert time string to minutes since midnight
   * @param {string} time - "07:00"
   * @param {string} period - "AM" or "PM"
   * @returns {number} - Minutes since midnight
   */
  timeToMinutes(time, period) {
    const [hours, minutes] = time.split(':').map(Number);
    let totalHours = hours;
    
    if (period === 'PM' && hours !== 12) {
      totalHours += 12;
    } else if (period === 'AM' && hours === 12) {
      totalHours = 0;
    }
    
    return totalHours * 60 + minutes;
  }
  
  /**
   * Convert minutes to time string
   * @param {number} minutes - Minutes since midnight
   * @returns {object} - {time: "07:00", period: "AM"}
   */
  minutesToTime(minutes) {
    let hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const period = hours >= 12 ? 'PM' : 'AM';
    
    if (hours > 12) hours -= 12;
    if (hours === 0) hours = 12;
    
    return {
      time: `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`,
      period
    };
  }
  
  /**
   * Validate time slots for 24-hour coverage and overlaps
   * @param {Array} timeSlots - Array of time slot objects
   * @returns {object} - {valid: boolean, errors: [], warnings: []}
   */
  validateTimeSlots(timeSlots) {
    const errors = [];
    const warnings = [];
    
    if (!timeSlots || timeSlots.length === 0) {
      return {
        valid: false,
        errors: ['At least one time slot is required'],
        warnings: []
      };
    }
    
    // Convert all time slots to minutes and sort
    const slots = timeSlots.map((slot, index) => {
      const startMinutes = this.timeToMinutes(slot.startTime, slot.startPeriod);
      let endMinutes = this.timeToMinutes(slot.endTime, slot.endPeriod);
      
      // Handle cross-midnight (e.g., 10:30 PM to 6:30 AM)
      if (endMinutes <= startMinutes) {
        endMinutes += 24 * 60; // Add 24 hours
      }
      
      return {
        ...slot,
        index,
        startMinutes,
        endMinutes,
        duration: endMinutes - startMinutes
      };
    }).sort((a, b) => a.startMinutes - b.startMinutes);
    
    // Check for overlaps
    for (let i = 0; i < slots.length - 1; i++) {
      const current = slots[i];
      const next = slots[i + 1];
      
      // Normalize current end time for comparison
      let currentEnd = current.endMinutes;
      
      // If current slot crosses midnight, normalize it
      if (currentEnd > 24 * 60) {
        currentEnd = currentEnd % (24 * 60);
      }
      
      // Check if current slot overlaps with next
      // Only check overlap if both are in the same day cycle
      if (current.endMinutes <= 24 * 60 && next.startMinutes < 24 * 60) {
        if (currentEnd > next.startMinutes) {
          errors.push(
            `Time slot ${i + 1} (${current.activity}) overlaps with slot ${i + 2} (${next.activity}). ` +
            `Slot ${i + 1} ends at ${this.minutesToTime(current.endMinutes).time} ${this.minutesToTime(current.endMinutes).period}, ` +
            `but slot ${i + 2} starts at ${next.startTime} ${next.startPeriod}`
          );
        }
      }
      
      // Check for gaps (only for same-day slots)
      if (current.endMinutes <= 24 * 60 && next.startMinutes < 24 * 60) {
        if (currentEnd < next.startMinutes) {
          const gapMinutes = next.startMinutes - currentEnd;
          const gapHours = Math.floor(gapMinutes / 60);
          const gapMins = gapMinutes % 60;
          warnings.push(
            `Gap of ${gapHours}h ${gapMins}m between slot ${i + 1} and ${i + 2}`
          );
        }
      }
    }
    
    // Check total coverage
    const totalCovered = slots.reduce((sum, slot) => sum + slot.duration, 0);
    const totalMinutes = 24 * 60;
    
    if (totalCovered < totalMinutes) {
      const uncovered = totalMinutes - totalCovered;
      const hours = Math.floor(uncovered / 60);
      const mins = uncovered % 60;
      warnings.push(`${hours}h ${mins}m of the day is not scheduled`);
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      slots
    };
  }
  
  /**
   * Save user's daily schedule
   * @param {string} userId - User ID (UUID)
   * @param {object} scheduleData - {timeSlots: [], applyToDays: [], weekdaysEnabled: bool, weekendsEnabled: bool}
   * @returns {Promise<object>} - Created schedules and validation results
   */
  async saveDailySchedule(userId, scheduleData) {
    const { timeSlots, applyToDays, weekdaysEnabled, weekendsEnabled } = scheduleData;
    
    // Validate time slots
    const validation = this.validateTimeSlots(timeSlots);
    
    if (!validation.valid) {
      const error = new Error('Invalid time slots');
      error.statusCode = 400;
      error.details = {
        errors: validation.errors,
        warnings: validation.warnings
      };
      throw error;
    }
    
    // Get user
    const user = await User.findOne({ userId });
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }
    
    // Determine which days to apply
    let daysOfWeek = [];
    if (weekdaysEnabled) {
      daysOfWeek = [1, 2, 3, 4, 5]; // Mon-Fri
    }
    if (weekendsEnabled) {
      daysOfWeek = [...daysOfWeek, 0, 6]; // Sun, Sat
    }
    if (applyToDays && applyToDays.length > 0) {
      // Custom days selected
      const dayMap = {
        'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
        'thursday': 4, 'friday': 5, 'saturday': 6
      };
      daysOfWeek = applyToDays.map(day => dayMap[day.toLowerCase()]);
    }
    
    if (daysOfWeek.length === 0) {
      const error = new Error('Please select at least one day');
      error.statusCode = 400;
      throw error;
    }
    
    // Delete existing daily schedules for this user
    await StatusSchedule.deleteMany({
      userId,
      tags: 'daily_schedule'
    });
    
    // Create new schedules for each time slot
    const schedulesToCreate = timeSlots.map((slot, index) => {
      // Create Date objects for today with the specified times
      const now = new Date();
      const startDate = new Date(now);
      const endDate = new Date(now);
      
      // Set start time
      const startMinutes = this.timeToMinutes(slot.startTime, slot.startPeriod);
      startDate.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
      
      // Set end time
      let endMinutes = this.timeToMinutes(slot.endTime, slot.endPeriod);
      
      // Handle cross-midnight properly
      if (endMinutes <= startMinutes) {
        // Cross-midnight - end time is next day
        endDate.setDate(endDate.getDate() + 1);
        endDate.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
      } else {
        // Same day
        endDate.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
      }
      
      return {
        user: user._id,
        userId,
        status: slot.activity,
        customStatus: slot.customStatus || '',
        startTime: startDate,
        endTime: endDate,
        repeat: 'custom_days',
        recurrenceConfig: {
          daysOfWeek,
          interval: 1
        },
        tags: ['daily_schedule', `slot_${index + 1}`],
        priority: index + 1,
        active: true,
        wasAutoApplied: false,
        appliedBy: 'user'
      };
    });
    
    // Bulk create schedules
    const createdSchedules = await StatusSchedule.insertMany(schedulesToCreate);
    
    return {
      success: true,
      message: 'Daily schedule saved successfully',
      schedules: createdSchedules,
      validation: {
        errors: validation.errors,
        warnings: validation.warnings
      },
      appliedToDays: daysOfWeek,
      totalSlots: timeSlots.length
    };
  }
  
  /**
   * Get user's daily schedule
   * @param {string} userId - User ID (UUID)
   * @returns {Promise<object>} - User's daily schedule
   */
  async getDailySchedule(userId) {
    const schedules = await StatusSchedule.find({
      userId,
      tags: 'daily_schedule',
      active: true
    }).sort({ priority: 1 });
    
    if (schedules.length === 0) {
      return {
        hasSchedule: false,
        timeSlots: [],
        applyToDays: []
      };
    }
    
    // Convert schedules back to time slots
    const timeSlots = schedules.map(schedule => {
      const startDate = new Date(schedule.startTime);
      const endDate = new Date(schedule.endTime);
      
      let startHours = startDate.getHours();
      const startMinutes = startDate.getMinutes();
      let endHours = endDate.getHours();
      const endMinutes = endDate.getMinutes();
      
      // Convert to 12-hour format
      const startPeriod = startHours >= 12 ? 'PM' : 'AM';
      const endPeriod = endHours >= 12 ? 'PM' : 'AM';
      
      // Convert hours to 12-hour format
      if (startHours === 0) {
        startHours = 12; // Midnight
      } else if (startHours > 12) {
        startHours = startHours - 12;
      }
      
      if (endHours === 0) {
        endHours = 12; // Midnight
      } else if (endHours > 12) {
        endHours = endHours - 12;
      }
      
      return {
        activity: schedule.status,
        customStatus: schedule.customStatus,
        startTime: `${startHours.toString().padStart(2, '0')}:${startMinutes.toString().padStart(2, '0')}`,
        startPeriod,
        endTime: `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`,
        endPeriod,
        scheduleId: schedule._id
      };
    });
    
    // Get days from first schedule
    const daysOfWeek = schedules[0].recurrenceConfig?.daysOfWeek || [];
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const applyToDays = daysOfWeek.map(day => dayNames[day]);
    
    return {
      hasSchedule: true,
      timeSlots,
      applyToDays,
      weekdaysEnabled: daysOfWeek.includes(1) && daysOfWeek.includes(5),
      weekendsEnabled: daysOfWeek.includes(0) || daysOfWeek.includes(6)
    };
  }
  
  /**
   * Delete user's daily schedule
   * @param {string} userId - User ID (UUID)
   * @returns {Promise<boolean>} - Success indicator
   */
  async deleteDailySchedule(userId) {
    await StatusSchedule.deleteMany({
      userId,
      tags: 'daily_schedule'
    });
    
    return true;
  }
}

module.exports = new DailyScheduleService();
