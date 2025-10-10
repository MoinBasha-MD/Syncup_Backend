const StatusSchedule = require('../models/statusScheduleModel');
const StatusTemplate = require('../models/statusTemplateModel');
const { addMinutes, isWithinInterval, format } = require('date-fns');

/**
 * 🆕 Enhanced Calendar Integration Service
 * Automatically creates status schedules based on calendar events
 */
class CalendarIntegrationService {
  
  /**
   * Process calendar events and create automatic status schedules
   */
  async processCalendarEvents(userId, calendarEvents) {
    console.log(`📅 Processing ${calendarEvents.length} calendar events for user ${userId}`);
    
    const createdSchedules = [];
    
    for (const event of calendarEvents) {
      try {
        const statusSchedule = await this.createStatusFromCalendarEvent(userId, event);
        if (statusSchedule) {
          createdSchedules.push(statusSchedule);
        }
      } catch (error) {
        console.error(`❌ Error processing calendar event ${event.id}:`, error);
      }
    }
    
    console.log(`✅ Created ${createdSchedules.length} status schedules from calendar events`);
    return createdSchedules;
  }
  
  /**
   * Create status schedule from calendar event
   */
  async createStatusFromCalendarEvent(userId, calendarEvent) {
    // Check if we already have a schedule for this calendar event
    const existingSchedule = await StatusSchedule.findOne({
      userId,
      calendarEventId: calendarEvent.id,
      active: true
    });
    
    if (existingSchedule) {
      console.log(`📅 Schedule already exists for calendar event ${calendarEvent.id}`);
      return null;
    }
    
    // Determine appropriate status based on event details
    const statusInfo = this.determineStatusFromEvent(calendarEvent);
    
    if (!statusInfo) {
      console.log(`📅 No suitable status found for event: ${calendarEvent.title}`);
      return null;
    }
    
    // Create the schedule
    const scheduleData = {
      userId,
      status: statusInfo.status,
      customStatus: statusInfo.customStatus || calendarEvent.title,
      startTime: new Date(calendarEvent.start),
      endTime: new Date(calendarEvent.end),
      calendarEventId: calendarEvent.id,
      calendarSource: calendarEvent.source || 'system',
      autoCreatedFromCalendar: true,
      appliedBy: 'calendar',
      active: true,
      notes: `Auto-created from calendar event: ${calendarEvent.title}`
    };
    
    const schedule = await StatusSchedule.create(scheduleData);
    console.log(`✅ Created status schedule from calendar event: ${calendarEvent.title}`);
    
    return schedule;
  }
  
  /**
   * Determine appropriate status based on calendar event
   */
  determineStatusFromEvent(event) {
    const title = event.title.toLowerCase();
    const description = (event.description || '').toLowerCase();
    const location = (event.location || '').toLowerCase();
    
    // Meeting patterns
    if (this.containsKeywords(title, ['meeting', 'call', 'conference', 'standup', 'sync', 'review'])) {
      return {
        status: 'In a meeting',
        customStatus: event.title
      };
    }
    
    // Travel patterns
    if (this.containsKeywords(title, ['flight', 'travel', 'trip', 'commute']) ||
        this.containsKeywords(location, ['airport', 'station', 'terminal'])) {
      return {
        status: 'Traveling',
        customStatus: `Traveling - ${event.title}`
      };
    }
    
    // Health appointments
    if (this.containsKeywords(title, ['doctor', 'appointment', 'medical', 'dentist', 'clinic', 'hospital'])) {
      return {
        status: 'Doctor appointment',
        customStatus: 'Medical appointment'
      };
    }
    
    // Personal time
    if (this.containsKeywords(title, ['lunch', 'break', 'personal', 'gym', 'workout'])) {
      return {
        status: 'On a break',
        customStatus: event.title
      };
    }
    
    // Work focus time
    if (this.containsKeywords(title, ['focus', 'deep work', 'coding', 'development', 'writing'])) {
      return {
        status: 'Do not disturb',
        customStatus: 'Focus time'
      };
    }
    
    // Training/Learning
    if (this.containsKeywords(title, ['training', 'workshop', 'seminar', 'course', 'learning'])) {
      return {
        status: 'In training',
        customStatus: event.title
      };
    }
    
    // Default for other calendar events
    if (event.title && event.title.trim()) {
      return {
        status: 'Busy',
        customStatus: event.title
      };
    }
    
    return null;
  }
  
  /**
   * Check if text contains any of the keywords
   */
  containsKeywords(text, keywords) {
    return keywords.some(keyword => text.includes(keyword));
  }
  
  /**
   * Sync calendar events with status schedules
   */
  async syncCalendarWithStatus(userId, calendarEvents) {
    console.log(`🔄 Syncing calendar with status for user ${userId}`);
    
    // Get existing calendar-based schedules
    const existingSchedules = await StatusSchedule.find({
      userId,
      autoCreatedFromCalendar: true,
      active: true
    });
    
    // Create map of existing schedules by calendar event ID
    const existingMap = new Map();
    existingSchedules.forEach(schedule => {
      if (schedule.calendarEventId) {
        existingMap.set(schedule.calendarEventId, schedule);
      }
    });
    
    // Process new/updated events
    const processedEventIds = new Set();
    const results = {
      created: 0,
      updated: 0,
      skipped: 0
    };
    
    for (const event of calendarEvents) {
      processedEventIds.add(event.id);
      
      const existingSchedule = existingMap.get(event.id);
      
      if (existingSchedule) {
        // Update existing schedule if event changed
        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);
        
        if (existingSchedule.startTime.getTime() !== eventStart.getTime() ||
            existingSchedule.endTime.getTime() !== eventEnd.getTime()) {
          
          await StatusSchedule.findByIdAndUpdate(existingSchedule._id, {
            startTime: eventStart,
            endTime: eventEnd,
            customStatus: event.title
          });
          
          results.updated++;
          console.log(`📅 Updated schedule for calendar event: ${event.title}`);
        } else {
          results.skipped++;
        }
      } else {
        // Create new schedule
        const newSchedule = await this.createStatusFromCalendarEvent(userId, event);
        if (newSchedule) {
          results.created++;
        } else {
          results.skipped++;
        }
      }
    }
    
    // Deactivate schedules for events that no longer exist
    const deletedEventSchedules = existingSchedules.filter(schedule => 
      !processedEventIds.has(schedule.calendarEventId)
    );
    
    for (const schedule of deletedEventSchedules) {
      await StatusSchedule.findByIdAndUpdate(schedule._id, { active: false });
      console.log(`📅 Deactivated schedule for deleted calendar event: ${schedule.customStatus}`);
    }
    
    console.log(`✅ Calendar sync completed:`, results);
    return results;
  }
  
  /**
   * Get calendar-based status suggestions
   */
  async getCalendarStatusSuggestions(userId, timeWindow = 60) {
    const now = new Date();
    const windowEnd = addMinutes(now, timeWindow);
    
    // Get upcoming calendar events
    const upcomingSchedules = await StatusSchedule.find({
      userId,
      autoCreatedFromCalendar: true,
      active: true,
      startTime: {
        $gte: now,
        $lte: windowEnd
      }
    }).sort({ startTime: 1 });
    
    const suggestions = upcomingSchedules.map(schedule => ({
      id: schedule._id,
      suggestedStatus: schedule.status,
      customMessage: schedule.customStatus,
      confidence: 0.9, // High confidence for calendar events
      reason: `Calendar event: ${schedule.customStatus}`,
      suggestedTime: {
        start: schedule.startTime,
        end: schedule.endTime
      },
      basedOn: 'calendar'
    }));
    
    return suggestions;
  }
}

module.exports = new CalendarIntegrationService();
