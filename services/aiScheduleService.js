const { aiLogger } = require('../utils/loggerSetup');

class AIScheduleService {
  constructor() {
    this.userSchedules = new Map(); // userId -> schedule data
  }

  /**
   * Check user availability for a given time range
   * @param {string} userId - User identifier
   * @param {Object} timeRange - Time range to check
   * @returns {Promise<Object>} Availability information
   */
  async checkUserAvailability(userId, timeRange = {}) {
    try {
      aiLogger.info('Checking user availability', { 
        userId, 
        timeRange,
        event: 'availability_check'
      });

      // For Phase 2, we'll return a basic availability response
      // In Phase 4, this will integrate with actual calendar systems
      
      const now = new Date();
      const currentHour = now.getHours();
      
      // Basic availability logic based on time of day
      let availability = {
        isAvailable: true,
        status: 'Available',
        nextAvailableSlot: null,
        busyUntil: null,
        confidence: 0.8
      };

      // Business hours logic (9 AM - 6 PM)
      if (currentHour < 9 || currentHour > 18) {
        availability = {
          isAvailable: false,
          status: 'Outside business hours',
          nextAvailableSlot: this.getNextBusinessHour(),
          busyUntil: null,
          confidence: 0.9
        };
      }

      // Weekend logic
      const dayOfWeek = now.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        availability = {
          isAvailable: false,
          status: 'Weekend',
          nextAvailableSlot: this.getNextWeekday(),
          busyUntil: null,
          confidence: 0.7
        };
      }

      // Check if user has any stored schedule preferences
      const userSchedule = this.userSchedules.get(userId);
      if (userSchedule) {
        availability = this.applyUserSchedulePreferences(availability, userSchedule);
      }

      aiLogger.info('Availability check completed', {
        userId,
        isAvailable: availability.isAvailable,
        status: availability.status,
        event: 'availability_check_completed'
      });

      return {
        success: true,
        availability,
        checkedAt: new Date(),
        timeRange
      };

    } catch (error) {
      aiLogger.error('Failed to check user availability', {
        userId,
        error: error.message,
        event: 'availability_check_failed'
      });

      return {
        success: false,
        error: error.message,
        availability: {
          isAvailable: false,
          status: 'Unable to check availability',
          confidence: 0
        }
      };
    }
  }

  /**
   * Get available time slots for a user
   * @param {string} userId - User identifier
   * @param {number} duration - Duration in minutes
   * @param {Object} preferences - Scheduling preferences
   * @returns {Promise<Array>} Available time slots
   */
  async getAvailableSlots(userId, duration = 30, preferences = {}) {
    try {
      aiLogger.info('Getting available slots', {
        userId,
        duration,
        preferences,
        event: 'get_available_slots'
      });

      const slots = [];
      const now = new Date();
      
      // Generate slots for the next 7 days
      for (let day = 0; day < 7; day++) {
        const date = new Date(now);
        date.setDate(date.getDate() + day);
        
        // Skip weekends unless specified
        if (!preferences.includeWeekends && (date.getDay() === 0 || date.getDay() === 6)) {
          continue;
        }

        // Generate slots for business hours (9 AM - 6 PM)
        for (let hour = 9; hour < 18; hour++) {
          const slotTime = new Date(date);
          slotTime.setHours(hour, 0, 0, 0);
          
          // Skip past times
          if (slotTime <= now) continue;

          slots.push({
            startTime: slotTime,
            endTime: new Date(slotTime.getTime() + duration * 60000),
            duration,
            confidence: 0.8,
            type: 'available'
          });
        }
      }

      return {
        success: true,
        slots: slots.slice(0, 20), // Return first 20 slots
        totalFound: slots.length,
        duration,
        generatedAt: new Date()
      };

    } catch (error) {
      aiLogger.error('Failed to get available slots', {
        userId,
        error: error.message,
        event: 'get_available_slots_failed'
      });

      return {
        success: false,
        error: error.message,
        slots: []
      };
    }
  }

  /**
   * Find common availability between multiple users
   * @param {Array} userIds - Array of user identifiers
   * @param {Object} timeRange - Time range to check
   * @returns {Promise<Object>} Common availability
   */
  async findCommonAvailability(userIds, timeRange = {}) {
    try {
      aiLogger.info('Finding common availability', {
        userIds,
        userCount: userIds.length,
        timeRange,
        event: 'find_common_availability'
      });

      const availabilityChecks = await Promise.all(
        userIds.map(userId => this.checkUserAvailability(userId, timeRange))
      );

      const availableUsers = availabilityChecks.filter(check => 
        check.success && check.availability.isAvailable
      );

      const unavailableUsers = availabilityChecks.filter(check => 
        !check.success || !check.availability.isAvailable
      );

      // Find common time slots
      const commonSlots = await this.calculateCommonSlots(userIds, timeRange);

      const result = {
        success: true,
        totalUsers: userIds.length,
        availableUsers: availableUsers.length,
        unavailableUsers: unavailableUsers.length,
        availabilityRate: availableUsers.length / userIds.length,
        commonSlots,
        individualAvailability: availabilityChecks,
        checkedAt: new Date()
      };

      aiLogger.info('Common availability check completed', {
        totalUsers: result.totalUsers,
        availableUsers: result.availableUsers,
        availabilityRate: result.availabilityRate,
        commonSlotsCount: commonSlots.length,
        event: 'common_availability_completed'
      });

      return result;

    } catch (error) {
      aiLogger.error('Failed to find common availability', {
        userIds,
        error: error.message,
        event: 'find_common_availability_failed'
      });

      return {
        success: false,
        error: error.message,
        totalUsers: userIds.length,
        availableUsers: 0,
        commonSlots: []
      };
    }
  }

  /**
   * Create a schedule proposal for multiple users
   * @param {Array} userIds - Array of user identifiers
   * @param {Object} requirements - Meeting requirements
   * @returns {Promise<Object>} Schedule proposal
   */
  async createScheduleProposal(userIds, requirements = {}) {
    try {
      const {
        duration = 30,
        activity = 'meeting',
        urgency = 'medium',
        preferredTimes = [],
        excludeWeekends = true
      } = requirements;

      aiLogger.info('Creating schedule proposal', {
        userIds,
        userCount: userIds.length,
        duration,
        activity,
        urgency,
        event: 'create_schedule_proposal'
      });

      // Find common availability
      const commonAvailability = await this.findCommonAvailability(userIds);
      
      if (!commonAvailability.success) {
        throw new Error('Failed to find common availability');
      }

      // Generate proposal based on availability
      const proposal = {
        proposalId: `proposal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userIds,
        activity,
        duration,
        urgency,
        status: 'pending',
        createdAt: new Date(),
        
        // Recommended time slots
        recommendedSlots: commonAvailability.commonSlots.slice(0, 3),
        
        // Alternative options
        alternativeSlots: commonAvailability.commonSlots.slice(3, 8),
        
        // Availability summary
        availabilitySummary: {
          totalUsers: commonAvailability.totalUsers,
          availableUsers: commonAvailability.availableUsers,
          availabilityRate: commonAvailability.availabilityRate
        },
        
        // Next steps
        nextSteps: this.generateNextSteps(commonAvailability, requirements)
      };

      aiLogger.info('Schedule proposal created', {
        proposalId: proposal.proposalId,
        recommendedSlotsCount: proposal.recommendedSlots.length,
        alternativeSlotsCount: proposal.alternativeSlots.length,
        event: 'schedule_proposal_created'
      });

      return {
        success: true,
        proposal
      };

    } catch (error) {
      aiLogger.error('Failed to create schedule proposal', {
        userIds,
        error: error.message,
        event: 'create_schedule_proposal_failed'
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Validate a schedule request
   * @param {Object} request - Schedule request
   * @returns {Object} Validation result
   */
  validateScheduleRequest(request) {
    const errors = [];
    
    if (!request.userIds || !Array.isArray(request.userIds) || request.userIds.length === 0) {
      errors.push('User IDs are required');
    }

    if (request.duration && (request.duration < 5 || request.duration > 480)) {
      errors.push('Duration must be between 5 minutes and 8 hours');
    }

    if (request.urgency && !['low', 'medium', 'high', 'urgent'].includes(request.urgency)) {
      errors.push('Invalid urgency level');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Private helper methods

  /**
   * Get next business hour
   * @returns {Date} Next business hour
   */
  getNextBusinessHour() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return tomorrow;
  }

  /**
   * Get next weekday
   * @returns {Date} Next weekday
   */
  getNextWeekday() {
    const date = new Date();
    const daysUntilMonday = (8 - date.getDay()) % 7 || 7;
    date.setDate(date.getDate() + daysUntilMonday);
    date.setHours(9, 0, 0, 0);
    return date;
  }

  /**
   * Apply user schedule preferences
   * @param {Object} availability - Current availability
   * @param {Object} userSchedule - User schedule preferences
   * @returns {Object} Updated availability
   */
  applyUserSchedulePreferences(availability, userSchedule) {
    // Apply user-specific preferences
    if (userSchedule.workingHours) {
      const now = new Date();
      const currentHour = now.getHours();
      
      if (currentHour < userSchedule.workingHours.start || 
          currentHour > userSchedule.workingHours.end) {
        availability.isAvailable = false;
        availability.status = 'Outside preferred working hours';
      }
    }

    return availability;
  }

  /**
   * Calculate common time slots for multiple users
   * @param {Array} userIds - User identifiers
   * @param {Object} timeRange - Time range
   * @returns {Promise<Array>} Common time slots
   */
  async calculateCommonSlots(userIds, timeRange) {
    // For Phase 2, return basic common slots
    // In Phase 4, this will do complex calendar intersection
    
    const slots = [];
    const now = new Date();
    
    // Generate some common slots for the next few days
    for (let day = 1; day <= 3; day++) {
      for (let hour = 10; hour <= 16; hour += 2) {
        const slotTime = new Date(now);
        slotTime.setDate(slotTime.getDate() + day);
        slotTime.setHours(hour, 0, 0, 0);
        
        slots.push({
          startTime: slotTime,
          endTime: new Date(slotTime.getTime() + 30 * 60000),
          duration: 30,
          confidence: 0.7,
          availableUsers: userIds.length,
          type: 'common'
        });
      }
    }

    return slots;
  }

  /**
   * Generate next steps for schedule proposal
   * @param {Object} availability - Availability data
   * @param {Object} requirements - Requirements
   * @returns {Array} Next steps
   */
  generateNextSteps(availability, requirements) {
    const steps = [];

    if (availability.availabilityRate === 1) {
      steps.push('All participants are available - proceed with booking');
    } else if (availability.availabilityRate >= 0.7) {
      steps.push('Most participants are available - confirm with unavailable participants');
    } else {
      steps.push('Low availability - consider rescheduling or reducing participant count');
    }

    if (requirements.urgency === 'high' || requirements.urgency === 'urgent') {
      steps.push('High urgency - prioritize immediate time slots');
    }

    steps.push('Send calendar invites once time is confirmed');

    return steps;
  }
}

module.exports = AIScheduleService;
