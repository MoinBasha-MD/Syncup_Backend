const StatusTemplate = require('../models/statusTemplateModel');
const StatusSchedule = require('../models/statusScheduleModel');
const StatusHistory = require('../models/statusHistoryModel');
const User = require('../models/userModel');

/**
 * Status service - handles business logic for status operations
 */
class StatusService {
  /**
   * Get status templates for a user
   * @param {string} userId - User ID (UUID)
   * @param {Object} options - Pagination options
   * @returns {Promise<Object>} - Status templates with pagination
   */
  async getStatusTemplates(userId, options = { page: 1, limit: 10 }) {
    const templates = await StatusTemplate.find({ userId })
      .sort({ createdAt: -1 })
      .skip((options.page - 1) * options.limit)
      .limit(options.limit);
    
    const total = await StatusTemplate.countDocuments({ userId });
    
    return {
      templates,
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        pages: Math.ceil(total / options.limit)
      }
    };
  }

  /**
   * Create a status template
   * @param {string} userId - User ID (UUID)
   * @param {Object} templateData - Template data
   * @returns {Promise<Object>} - Created template
   */
  async createStatusTemplate(userId, templateData) {
    const { name, status, customStatus, duration } = templateData;

    if (!name || !status || !duration) {
      const error = new Error('Please provide all required fields');
      error.statusCode = 400;
      throw error;
    }

    // Get the user to get MongoDB ObjectId
    const user = await User.findOne({ userId });
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    const statusTemplate = await StatusTemplate.create({
      user: user._id,
      userId,
      name,
      status,
      customStatus,
      duration,
    });

    return statusTemplate;
  }

  /**
   * Update a status template
   * @param {string} templateId - Template ID
   * @param {string} userId - User ID (UUID)
   * @param {Object} templateData - Template data to update
   * @returns {Promise<Object>} - Updated template
   */
  async updateStatusTemplate(templateId, userId, templateData) {
    const statusTemplate = await StatusTemplate.findById(templateId);

    if (!statusTemplate) {
      const error = new Error('Status template not found');
      error.statusCode = 404;
      throw error;
    }

    // Check if the status template belongs to the user using UUID
    if (statusTemplate.userId !== userId) {
      const error = new Error('Not authorized to update this status template');
      error.statusCode = 401;
      throw error;
    }

    const { name, status, customStatus, duration } = templateData;

    statusTemplate.name = name || statusTemplate.name;
    statusTemplate.status = status || statusTemplate.status;
    statusTemplate.customStatus = customStatus || statusTemplate.customStatus;
    statusTemplate.duration = duration || statusTemplate.duration;

    const updatedStatusTemplate = await statusTemplate.save();
    return updatedStatusTemplate;
  }

  /**
   * Delete a status template
   * @param {string} templateId - Template ID
   * @param {string} userId - User ID (UUID)
   * @returns {Promise<boolean>} - Success indicator
   */
  async deleteStatusTemplate(templateId, userId) {
    const statusTemplate = await StatusTemplate.findById(templateId);

    if (!statusTemplate) {
      const error = new Error('Status template not found');
      error.statusCode = 404;
      throw error;
    }

    // Check if the status template belongs to the user using UUID
    if (statusTemplate.userId !== userId) {
      const error = new Error('Not authorized to delete this status template');
      error.statusCode = 401;
      throw error;
    }

    await StatusTemplate.deleteOne({ _id: templateId });
    return true;
  }

  /**
   * Bulk create status templates
   * @param {string} userId - User ID (UUID)
   * @param {Array} templates - Array of template data
   * @returns {Promise<Array>} - Created templates
   */
  async bulkCreateTemplates(userId, templates) {
    if (!Array.isArray(templates) || templates.length === 0) {
      const error = new Error('Please provide an array of templates');
      error.statusCode = 400;
      throw error;
    }

    // Get the user to get MongoDB ObjectId
    const user = await User.findOne({ userId });
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    const templatesWithUser = templates.map(template => ({
      ...template,
      user: user._id,
      userId
    }));

    const createdTemplates = await StatusTemplate.insertMany(templatesWithUser);
    return createdTemplates;
  }

  /**
   * Get status schedules for a user
   * @param {string} userId - User ID (UUID)
   * @param {Object} options - Pagination options
   * @returns {Promise<Object>} - Status schedules with pagination
   */
  async getStatusSchedules(userId, options = { page: 1, limit: 10 }) {
    const schedules = await StatusSchedule.find({ 
      userId,
      active: true
    })
      .sort({ startTime: 1 })
      .skip((options.page - 1) * options.limit)
      .limit(options.limit);
    
    const total = await StatusSchedule.countDocuments({ 
      userId,
      active: true
    });
    
    return {
      schedules,
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        pages: Math.ceil(total / options.limit)
      }
    };
  }

  /**
   * Create a status schedule
   * @param {string} userId - User ID (UUID)
   * @param {Object} scheduleData - Schedule data
   * @returns {Promise<Object>} - Created schedule
   */
  async createStatusSchedule(userId, scheduleData) {
    const { status, customStatus, startTime, endTime, repeat } = scheduleData;

    if (!status || !startTime || !endTime) {
      const error = new Error('Please provide all required fields');
      error.statusCode = 400;
      throw error;
    }

    // Get the user to get MongoDB ObjectId
    const user = await User.findOne({ userId });
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    const statusSchedule = await StatusSchedule.create({
      user: user._id,
      userId,
      status,
      customStatus,
      startTime,
      endTime,
      repeat: repeat || 'none',
      active: true,
    });

    return statusSchedule;
  }

  /**
   * Update a status schedule
   * @param {string} scheduleId - Schedule ID
   * @param {string} userId - User ID (UUID)
   * @param {Object} scheduleData - Schedule data to update
   * @returns {Promise<Object>} - Updated schedule
   */
  async updateStatusSchedule(scheduleId, userId, scheduleData) {
    const statusSchedule = await StatusSchedule.findById(scheduleId);

    if (!statusSchedule) {
      const error = new Error('Status schedule not found');
      error.statusCode = 404;
      throw error;
    }

    // Check if the status schedule belongs to the user using UUID
    if (statusSchedule.userId !== userId) {
      const error = new Error('Not authorized to update this status schedule');
      error.statusCode = 401;
      throw error;
    }

    const { status, customStatus, startTime, endTime, repeat, active } = scheduleData;

    statusSchedule.status = status || statusSchedule.status;
    statusSchedule.customStatus = customStatus || statusSchedule.customStatus;
    statusSchedule.startTime = startTime || statusSchedule.startTime;
    statusSchedule.endTime = endTime || statusSchedule.endTime;
    statusSchedule.repeat = repeat || statusSchedule.repeat;
    
    // Only update active status if explicitly provided
    if (active !== undefined) {
      statusSchedule.active = active;
    }

    const updatedStatusSchedule = await statusSchedule.save();
    return updatedStatusSchedule;
  }

  /**
   * Delete a status schedule
   * @param {string} scheduleId - Schedule ID
   * @param {string} userId - User ID (UUID)
   * @returns {Promise<boolean>} - Success indicator
   */
  async deleteStatusSchedule(scheduleId, userId) {
    const statusSchedule = await StatusSchedule.findById(scheduleId);

    if (!statusSchedule) {
      const error = new Error('Status schedule not found');
      error.statusCode = 404;
      throw error;
    }

    // Check if the status schedule belongs to the user using UUID
    if (statusSchedule.userId !== userId) {
      const error = new Error('Not authorized to delete this status schedule');
      error.statusCode = 401;
      throw error;
    }

    await StatusSchedule.deleteOne({ _id: scheduleId });
    return true;
  }

  /**
   * Bulk create status schedules
   * @param {string} userId - User ID (UUID)
   * @param {Array} schedules - Array of schedule data
   * @returns {Promise<Array>} - Created schedules
   */
  async bulkCreateSchedules(userId, schedules) {
    if (!Array.isArray(schedules) || schedules.length === 0) {
      const error = new Error('Please provide an array of schedules');
      error.statusCode = 400;
      throw error;
    }

    // Get the user to get MongoDB ObjectId
    const user = await User.findOne({ userId });
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    const schedulesWithUser = schedules.map(schedule => ({
      ...schedule,
      user: user._id,
      userId,
      active: true
    }));

    const createdSchedules = await StatusSchedule.insertMany(schedulesWithUser);
    return createdSchedules;
  }

  /**
   * Get upcoming status schedules
   * @param {string} userId - User ID (UUID)
   * @returns {Promise<Array>} - Upcoming schedules
   */
  async getUpcomingStatusSchedules(userId) {
    const now = new Date();
    
    // Get all active schedules that start in the future or are recurring
    const statusSchedules = await StatusSchedule.find({
      userId,
      active: true,
      $or: [
        { startTime: { $gte: now } },
        { repeat: { $ne: 'none' } }
      ]
    }).sort({ startTime: 1 }).limit(5);
    
    return statusSchedules;
  }

  /**
   * Get status history for a user
   * @param {string} userId - User ID (UUID)
   * @param {Object} options - Pagination and filter options
   * @returns {Promise<Object>} - Status history with pagination
   */
  async getStatusHistory(userId, options = { page: 1, limit: 10, startDate: null, endDate: null }) {
    const query = { userId };
    
    // Add date range filter if provided
    if (options.startDate && options.endDate) {
      query.startTime = { 
        $gte: new Date(options.startDate),
        $lte: new Date(options.endDate)
      };
    } else if (options.startDate) {
      query.startTime = { $gte: new Date(options.startDate) };
    } else if (options.endDate) {
      query.startTime = { $lte: new Date(options.endDate) };
    }
    
    const history = await StatusHistory.find(query)
      .sort({ startTime: -1 })
      .skip((options.page - 1) * options.limit)
      .limit(options.limit);
    
    const total = await StatusHistory.countDocuments(query);
    
    return {
      history,
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        pages: Math.ceil(total / options.limit)
      }
    };
  }

  /**
   * Create a status history entry
   * @param {string} userId - User ID (UUID)
   * @param {Object} historyData - History data
   * @returns {Promise<Object>} - Created history entry
   */
  async createStatusHistory(userId, historyData) {
    const { status, customStatus, startTime, endTime } = historyData;

    if (!status || !startTime || !endTime) {
      const error = new Error('Please provide all required fields');
      error.statusCode = 400;
      throw error;
    }

    // Get the user to get MongoDB ObjectId
    const user = await User.findOne({ userId });
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    // Calculate duration in minutes
    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationMs = end - start;
    const durationMinutes = Math.round(durationMs / (1000 * 60));

    const statusHistory = await StatusHistory.create({
      user: user._id,
      userId,
      status,
      customStatus,
      startTime,
      endTime,
      duration: durationMinutes,
    });

    return statusHistory;
  }

  /**
   * Delete a status history entry
   * @param {string} historyId - History ID
   * @param {string} userId - User ID (UUID)
   * @returns {Promise<boolean>} - Success indicator
   */
  async deleteStatusHistory(historyId, userId) {
    const statusHistory = await StatusHistory.findById(historyId);

    if (!statusHistory) {
      const error = new Error('Status history not found');
      error.statusCode = 404;
      throw error;
    }

    // Check if the status history belongs to the user using UUID
    if (statusHistory.userId !== userId) {
      const error = new Error('Not authorized to delete this status history');
      error.statusCode = 401;
      throw error;
    }

    await StatusHistory.deleteOne({ _id: historyId });
    return true;
  }

  /**
   * Get status analytics for a user
   * @param {string} userId - User ID (UUID)
   * @param {Object} options - Filter options
   * @returns {Promise<Object>} - Status analytics
   */
  async getStatusAnalytics(userId, options = { startDate: null, endDate: null }) {
    const query = { userId };
    
    // Add date range filter if provided
    if (options.startDate && options.endDate) {
      query.startTime = { 
        $gte: new Date(options.startDate),
        $lte: new Date(options.endDate)
      };
    } else if (options.startDate) {
      query.startTime = { $gte: new Date(options.startDate) };
    } else if (options.endDate) {
      query.startTime = { $lte: new Date(options.endDate) };
    }
    
    // Get all status history entries for the user within the date range
    const statusHistory = await StatusHistory.find(query);
    
    // Calculate total time spent in each status
    const statusDurations = {};
    let totalDuration = 0;
    
    statusHistory.forEach(entry => {
      if (!statusDurations[entry.status]) {
        statusDurations[entry.status] = 0;
      }
      statusDurations[entry.status] += entry.duration;
      totalDuration += entry.duration;
    });
    
    // Calculate percentage for each status
    const statusPercentages = {};
    Object.keys(statusDurations).forEach(status => {
      statusPercentages[status] = totalDuration > 0 
        ? Math.round((statusDurations[status] / totalDuration) * 100) 
        : 0;
    });
    
    // Get most frequent status
    let mostFrequentStatus = null;
    let maxDuration = 0;
    Object.keys(statusDurations).forEach(status => {
      if (statusDurations[status] > maxDuration) {
        maxDuration = statusDurations[status];
        mostFrequentStatus = status;
      }
    });
    
    // Get status pattern suggestions based on time of day
    const morningStatuses = {};
    const afternoonStatuses = {};
    const eveningStatuses = {};
    
    statusHistory.forEach(entry => {
      const hour = new Date(entry.startTime).getHours();
      
      if (hour >= 5 && hour < 12) {
        // Morning (5 AM - 12 PM)
        if (!morningStatuses[entry.status]) {
          morningStatuses[entry.status] = 0;
        }
        morningStatuses[entry.status]++;
      } else if (hour >= 12 && hour < 18) {
        // Afternoon (12 PM - 6 PM)
        if (!afternoonStatuses[entry.status]) {
          afternoonStatuses[entry.status] = 0;
        }
        afternoonStatuses[entry.status]++;
      } else {
        // Evening/Night (6 PM - 5 AM)
        if (!eveningStatuses[entry.status]) {
          eveningStatuses[entry.status] = 0;
        }
        eveningStatuses[entry.status]++;
      }
    });
    
    // Find most common status for each time period
    const getMostCommonStatus = (statusCounts) => {
      let mostCommon = null;
      let maxCount = 0;
      Object.keys(statusCounts).forEach(status => {
        if (statusCounts[status] > maxCount) {
          maxCount = statusCounts[status];
          mostCommon = status;
        }
      });
      return mostCommon;
    };
    
    const suggestions = {
      morning: getMostCommonStatus(morningStatuses),
      afternoon: getMostCommonStatus(afternoonStatuses),
      evening: getMostCommonStatus(eveningStatuses)
    };
    
    return {
      totalEntries: statusHistory.length,
      totalDuration,
      statusDurations,
      statusPercentages,
      mostFrequentStatus,
      suggestions
    };
  }

  /**
   * Sync user status with calendar events
   * @param {string} userId - User ID (UUID)
   * @param {Array} calendarEvents - Calendar events
   * @returns {Promise<Array>} - Created schedules
   */
  async syncStatusWithCalendar(userId, calendarEvents) {
    if (!Array.isArray(calendarEvents) || calendarEvents.length === 0) {
      return [];
    }
    
    // Get the user to get MongoDB ObjectId
    const user = await User.findOne({ userId });
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }
    
    // Map calendar events to status schedules
    const schedules = calendarEvents.map(event => {
      // Determine appropriate status based on event type/title
      let status = 'busy'; // Default status
      let customStatus = '';
      
      const title = event.title.toLowerCase();
      
      // Simple rule-based mapping
      if (title.includes('meeting') || title.includes('call')) {
        status = 'meeting';
      } else if (title.includes('lunch') || title.includes('dinner') || title.includes('breakfast')) {
        status = 'eating';
      } else if (title.includes('commute') || title.includes('travel')) {
        status = 'commuting';
      } else if (title.includes('work')) {
        status = 'at_work';
      } else if (title.includes('gym') || title.includes('workout') || title.includes('exercise')) {
        status = 'working_out';
      } else if (title.includes('study')) {
        status = 'studying';
      } else if (title.includes('sleep')) {
        status = 'sleeping';
      } else if (title.includes('do not disturb') || title.includes('dnd')) {
        status = 'dnd';
      } else {
        // For other events, use custom status with event title
        status = 'custom';
        customStatus = event.title;
      }
      
      return {
        user: user._id,
        userId,
        status,
        customStatus,
        startTime: new Date(event.start),
        endTime: new Date(event.end),
        repeat: event.recurring ? 'weekly' : 'none',
        active: true
      };
    });
    
    // Create the schedules
    const createdSchedules = await StatusSchedule.insertMany(schedules);
    
    // Notify user of status changes
    this.notifyUpcomingStatusChanges(userId);
    
    return createdSchedules;
  }

  /**
   * Notify user of upcoming status changes
   * @param {string} userId - User ID (UUID)
   * @returns {Promise<Array>} - Upcoming status changes
   */
  async notifyUpcomingStatusChanges(userId) {
    const now = new Date();
    const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60000);
    
    // Find schedules starting in the next 30 minutes
    const upcomingSchedules = await StatusSchedule.find({
      userId,
      active: true,
      startTime: {
        $gte: now,
        $lte: thirtyMinutesFromNow
      }
    }).sort({ startTime: 1 });
    
    // Here you would integrate with a notification system
    // For now, we'll just return the upcoming schedules
    return upcomingSchedules;
  }
}

module.exports = new StatusService();
