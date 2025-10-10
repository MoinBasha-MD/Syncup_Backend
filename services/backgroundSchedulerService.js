const cron = require('node-cron');
const StatusSchedule = require('../models/statusScheduleModel');
const StatusTemplate = require('../models/statusTemplateModel');
const calendarIntegrationService = require('./calendarIntegrationService');
const socketManager = require('../socketManager');
const { addDays, isAfter, isBefore, isWithinInterval } = require('date-fns');

/**
 * 🆕 Background Scheduler Service
 * Handles automated status scheduling, calendar integration, and cleanup tasks
 */
class BackgroundSchedulerService {
  constructor() {
    this.isRunning = false;
    this.jobs = new Map();
  }

  /**
   * Start all background services
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ Background scheduler is already running');
      return;
    }

    console.log('🚀 Starting Background Scheduler Service...');
    this.isRunning = true;

    // Schedule status activation/deactivation (every minute)
    this.jobs.set('statusActivation', cron.schedule('* * * * *', () => {
      this.processScheduledStatuses();
    }, { scheduled: false }));

    // Calendar sync (every 15 minutes)
    this.jobs.set('calendarSync', cron.schedule('*/15 * * * *', () => {
      this.syncCalendarEvents();
    }, { scheduled: false }));

    // Cleanup expired schedules (daily at 2 AM)
    this.jobs.set('cleanup', cron.schedule('0 2 * * *', () => {
      this.cleanupExpiredSchedules();
    }, { scheduled: false }));

    // Update analytics (every hour)
    this.jobs.set('analytics', cron.schedule('0 * * * *', () => {
      this.updateAnalytics();
    }, { scheduled: false }));

    // Start all jobs
    this.jobs.forEach((job, name) => {
      job.start();
      console.log(`✅ Started ${name} job`);
    });

    console.log('🎯 Background Scheduler Service started successfully');
  }

  /**
   * Stop all background services
   */
  stop() {
    if (!this.isRunning) {
      console.log('⚠️ Background scheduler is not running');
      return;
    }

    console.log('🛑 Stopping Background Scheduler Service...');
    
    this.jobs.forEach((job, name) => {
      job.stop();
      console.log(`⏹️ Stopped ${name} job`);
    });

    this.jobs.clear();
    this.isRunning = false;
    console.log('✅ Background Scheduler Service stopped');
  }

  /**
   * Process scheduled statuses that need to be activated or deactivated
   */
  async processScheduledStatuses() {
    try {
      const now = new Date();
      
      // Find schedules that should be activated
      const schedulesToActivate = await StatusSchedule.find({
        active: true,
        startTime: { $lte: now },
        endTime: { $gt: now },
        actualStartTime: { $exists: false } // Not yet activated
      });

      // Find schedules that should be deactivated
      const schedulesToDeactivate = await StatusSchedule.find({
        active: true,
        endTime: { $lte: now },
        actualStartTime: { $exists: true }, // Already activated
        actualEndTime: { $exists: false } // Not yet deactivated
      });

      // Activate schedules
      for (const schedule of schedulesToActivate) {
        await this.activateSchedule(schedule);
      }

      // Deactivate schedules
      for (const schedule of schedulesToDeactivate) {
        await this.deactivateSchedule(schedule);
      }

      if (schedulesToActivate.length > 0 || schedulesToDeactivate.length > 0) {
        console.log(`📅 Processed ${schedulesToActivate.length} activations and ${schedulesToDeactivate.length} deactivations`);
      }

    } catch (error) {
      console.error('❌ Error processing scheduled statuses:', error);
    }
  }

  /**
   * Activate a scheduled status
   */
  async activateSchedule(schedule) {
    try {
      // Update the schedule with actual start time
      await StatusSchedule.findByIdAndUpdate(schedule._id, {
        actualStartTime: new Date(),
        wasAutoApplied: true
      });

      // Broadcast status update via WebSocket
      const statusUpdate = {
        userId: schedule.userId,
        status: schedule.status,
        customStatus: schedule.customStatus,
        statusUntil: schedule.endTime.toISOString(),
        scheduleId: schedule._id,
        appliedBy: schedule.appliedBy || 'schedule'
      };

      // Emit to user's connections
      socketManager.emitToUser(schedule.userId, 'status_activated', statusUpdate);
      
      console.log(`✅ Activated schedule: ${schedule.status} for user ${schedule.userId}`);

    } catch (error) {
      console.error(`❌ Error activating schedule ${schedule._id}:`, error);
    }
  }

  /**
   * Deactivate a scheduled status
   */
  async deactivateSchedule(schedule) {
    try {
      // Update the schedule with actual end time
      await StatusSchedule.findByIdAndUpdate(schedule._id, {
        actualEndTime: new Date()
      });

      // Broadcast status deactivation via WebSocket
      const statusUpdate = {
        userId: schedule.userId,
        status: 'Available', // Default status after deactivation
        customStatus: null,
        statusUntil: null,
        scheduleId: schedule._id,
        appliedBy: 'schedule_end'
      };

      // Emit to user's connections
      socketManager.emitToUser(schedule.userId, 'status_deactivated', statusUpdate);
      
      console.log(`⏹️ Deactivated schedule: ${schedule.status} for user ${schedule.userId}`);

    } catch (error) {
      console.error(`❌ Error deactivating schedule ${schedule._id}:`, error);
    }
  }

  /**
   * Sync calendar events and create automatic status schedules
   */
  async syncCalendarEvents() {
    try {
      console.log('📅 Starting calendar sync...');
      
      // Get all users who have calendar integration enabled
      // This would typically come from a user settings collection
      const usersWithCalendar = await this.getUsersWithCalendarIntegration();
      
      let totalSynced = 0;
      
      for (const user of usersWithCalendar) {
        try {
          // Get calendar events for the user (next 7 days)
          const calendarEvents = await this.getCalendarEventsForUser(user.userId);
          
          // Process events with calendar integration service
          const results = await calendarIntegrationService.syncCalendarWithStatus(
            user.userId, 
            calendarEvents
          );
          
          totalSynced += results.created + results.updated;
          
        } catch (error) {
          console.error(`❌ Error syncing calendar for user ${user.userId}:`, error);
        }
      }
      
      if (totalSynced > 0) {
        console.log(`✅ Calendar sync completed: ${totalSynced} schedules processed`);
      }

    } catch (error) {
      console.error('❌ Error in calendar sync:', error);
    }
  }

  /**
   * Clean up expired schedules and update statistics
   */
  async cleanupExpiredSchedules() {
    try {
      console.log('🧹 Starting cleanup of expired schedules...');
      
      const thirtyDaysAgo = addDays(new Date(), -30);
      
      // Find expired schedules
      const expiredSchedules = await StatusSchedule.find({
        endTime: { $lt: thirtyDaysAgo },
        actualEndTime: { $exists: true }
      });

      // Update template usage statistics before deletion
      const templateUpdates = new Map();
      
      expiredSchedules.forEach(schedule => {
        if (schedule.templateId) {
          const current = templateUpdates.get(schedule.templateId) || { count: 0, totalDuration: 0 };
          const duration = schedule.actualEndTime && schedule.actualStartTime 
            ? (new Date(schedule.actualEndTime) - new Date(schedule.actualStartTime)) / (1000 * 60)
            : 0;
          
          templateUpdates.set(schedule.templateId, {
            count: current.count + 1,
            totalDuration: current.totalDuration + duration
          });
        }
      });

      // Update template statistics
      for (const [templateId, stats] of templateUpdates) {
        await StatusTemplate.findByIdAndUpdate(templateId, {
          $inc: { usageCount: stats.count },
          averageDuration: stats.totalDuration / stats.count
        });
      }

      // Archive old schedules instead of deleting them
      const archivedCount = await StatusSchedule.updateMany(
        { _id: { $in: expiredSchedules.map(s => s._id) } },
        { 
          active: false,
          archived: true,
          archivedAt: new Date()
        }
      );

      console.log(`✅ Cleanup completed: ${archivedCount.modifiedCount} schedules archived`);

    } catch (error) {
      console.error('❌ Error in cleanup:', error);
    }
  }

  /**
   * Update analytics and statistics
   */
  async updateAnalytics() {
    try {
      console.log('📊 Updating analytics...');
      
      // This could include:
      // - Calculating usage patterns
      // - Updating popular templates
      // - Generating insights
      // - Preparing dashboard data
      
      // For now, just update template usage counts
      const templates = await StatusTemplate.find({ usageCount: { $gt: 0 } });
      
      for (const template of templates) {
        const recentUsage = await StatusSchedule.countDocuments({
          templateId: template._id,
          createdAt: { $gte: addDays(new Date(), -7) }
        });
        
        if (recentUsage > 0) {
          await StatusTemplate.findByIdAndUpdate(template._id, {
            lastUsed: new Date()
          });
        }
      }
      
      console.log(`✅ Analytics updated for ${templates.length} templates`);

    } catch (error) {
      console.error('❌ Error updating analytics:', error);
    }
  }

  /**
   * Get users who have calendar integration enabled
   * This is a placeholder - implement based on your user settings structure
   */
  async getUsersWithCalendarIntegration() {
    // Placeholder implementation
    // In a real app, this would query user settings or preferences
    return [];
  }

  /**
   * Get calendar events for a specific user
   * This is a placeholder - implement based on your calendar integration
   */
  async getCalendarEventsForUser(userId) {
    // Placeholder implementation
    // In a real app, this would fetch from Google Calendar, Outlook, etc.
    return [];
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeJobs: Array.from(this.jobs.keys()),
      uptime: this.isRunning ? process.uptime() : 0
    };
  }
}

// Create singleton instance
const backgroundSchedulerService = new BackgroundSchedulerService();

module.exports = backgroundSchedulerService;
