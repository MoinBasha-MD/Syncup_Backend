const winston = require('winston');
const cron = require('node-cron');
const User = require('../../models/userModel');
const StatusSchedule = require('../../models/statusScheduleModel');
const { scheduleStatusUpdate } = require('../../services/statusService');

// Configure logger for Scheduling Agent
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/scheduling-agent.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
});

class SchedulingAgent {
  constructor() {
    this.agentId = null;
    this.isActive = false;
    this.scheduledTasks = new Map(); // taskId -> cron job
    this.metrics = {
      tasksScheduled: 0,
      tasksExecuted: 0,
      tasksFailed: 0,
      averageExecutionTime: 0
    };
  }

  /**
   * Initialize the scheduling agent
   */
  async initialize(agentId) {
    this.agentId = agentId;
    this.isActive = true;
    
    logger.info(`🕒 Scheduling Agent ${agentId} initialized`);
    
    // Load existing scheduled tasks
    await this.loadExistingSchedules();
    
    // Start periodic cleanup
    this.startPeriodicCleanup();
  }

  /**
   * Process a scheduling task
   */
  async processTask(payload, context) {
    const startTime = Date.now();
    
    try {
      const { action, data } = payload;
      let result;
      
      switch (action) {
        case 'schedule_status_update':
          result = await this.scheduleStatusUpdate(data, context);
          break;
        case 'schedule_recurring_task':
          result = await this.scheduleRecurringTask(data, context);
          break;
        case 'cancel_scheduled_task':
          result = await this.cancelScheduledTask(data, context);
          break;
        case 'get_user_schedules':
          result = await this.getUserSchedules(data, context);
          break;
        case 'optimize_schedules':
          result = await this.optimizeSchedules(data, context);
          break;
        default:
          throw new Error(`Unknown scheduling action: ${action}`);
      }
      
      const executionTime = Date.now() - startTime;
      this.updateMetrics(executionTime, true);
      
      return result;
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.updateMetrics(executionTime, false);
      
      logger.error(`❌ Scheduling task failed:`, error);
      throw error;
    }
  }

  /**
   * Schedule a status update
   */
  async scheduleStatusUpdate(data, context) {
    const { userId, statusText, scheduledTime, timezone, recurring } = data;
    
    try {
      // Validate user exists
      const user = await User.findOne({ userId });
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }
      
      // Create schedule entry
      const schedule = new StatusSchedule({
        userId,
        statusText,
        scheduledTime: new Date(scheduledTime),
        timezone: timezone || 'UTC',
        isRecurring: recurring?.enabled || false,
        recurringPattern: recurring?.pattern,
        isActive: true
      });
      
      await schedule.save();
      
      // Schedule the cron job
      const cronExpression = this.convertToCronExpression(scheduledTime, recurring);
      const job = cron.schedule(cronExpression, async () => {
        await this.executeStatusUpdate(schedule._id);
      }, {
        scheduled: true,
        timezone: timezone || 'UTC'
      });
      
      this.scheduledTasks.set(schedule._id.toString(), job);
      this.metrics.tasksScheduled++;
      
      logger.info(`📅 Status update scheduled for user ${userId} at ${scheduledTime}`);
      
      return {
        scheduleId: schedule._id,
        scheduledTime,
        cronExpression,
        success: true
      };
      
    } catch (error) {
      logger.error('❌ Failed to schedule status update:', error);
      throw error;
    }
  }

  /**
   * Schedule a recurring task
   */
  async scheduleRecurringTask(data, context) {
    const { taskType, payload, cronExpression, startTime, endTime } = data;
    
    try {
      const taskId = `recurring_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      
      const job = cron.schedule(cronExpression, async () => {
        await this.executeRecurringTask(taskType, payload, context);
      }, {
        scheduled: true,
        start: startTime ? new Date(startTime) : true,
        end: endTime ? new Date(endTime) : undefined
      });
      
      this.scheduledTasks.set(taskId, job);
      this.metrics.tasksScheduled++;
      
      logger.info(`🔄 Recurring task scheduled: ${taskType} with expression ${cronExpression}`);
      
      return {
        taskId,
        cronExpression,
        startTime,
        endTime,
        success: true
      };
      
    } catch (error) {
      logger.error('❌ Failed to schedule recurring task:', error);
      throw error;
    }
  }

  /**
   * Cancel a scheduled task
   */
  async cancelScheduledTask(data, context) {
    const { scheduleId } = data;
    
    try {
      // Cancel cron job
      const job = this.scheduledTasks.get(scheduleId);
      if (job) {
        job.stop();
        job.destroy();
        this.scheduledTasks.delete(scheduleId);
      }
      
      // Update database record
      await StatusSchedule.findByIdAndUpdate(scheduleId, { isActive: false });
      
      logger.info(`🚫 Scheduled task cancelled: ${scheduleId}`);
      
      return {
        scheduleId,
        cancelled: true,
        success: true
      };
      
    } catch (error) {
      logger.error('❌ Failed to cancel scheduled task:', error);
      throw error;
    }
  }

  /**
   * Get user schedules
   */
  async getUserSchedules(data, context) {
    const { userId, includeInactive = false } = data;
    
    try {
      const query = { userId };
      if (!includeInactive) {
        query.isActive = true;
      }
      
      const schedules = await StatusSchedule.find(query)
        .sort({ scheduledTime: 1 })
        .lean();
      
      return {
        userId,
        schedules: schedules.map(schedule => ({
          ...schedule,
          isScheduled: this.scheduledTasks.has(schedule._id.toString())
        })),
        count: schedules.length,
        success: true
      };
      
    } catch (error) {
      logger.error('❌ Failed to get user schedules:', error);
      throw error;
    }
  }

  /**
   * Optimize schedules for better performance
   */
  async optimizeSchedules(data, context) {
    try {
      const { timeWindow = 24 } = data; // hours
      
      // Get all active schedules within time window
      const cutoffTime = new Date(Date.now() + (timeWindow * 60 * 60 * 1000));
      const schedules = await StatusSchedule.find({
        isActive: true,
        scheduledTime: { $lte: cutoffTime }
      }).sort({ scheduledTime: 1 });
      
      let optimized = 0;
      const optimizations = [];
      
      // Group schedules by time slots to reduce system load
      const timeSlots = new Map();
      
      schedules.forEach(schedule => {
        const timeSlot = Math.floor(schedule.scheduledTime.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000); // 5-minute slots
        if (!timeSlots.has(timeSlot)) {
          timeSlots.set(timeSlot, []);
        }
        timeSlots.get(timeSlot).push(schedule);
      });
      
      // Optimize slots with multiple schedules
      for (const [timeSlot, slotSchedules] of timeSlots) {
        if (slotSchedules.length > 1) {
          // Spread schedules across the 5-minute window
          const interval = (5 * 60 * 1000) / slotSchedules.length;
          
          for (let i = 0; i < slotSchedules.length; i++) {
            const newTime = new Date(timeSlot + (i * interval));
            const schedule = slotSchedules[i];
            
            if (Math.abs(newTime.getTime() - schedule.scheduledTime.getTime()) > 30000) { // More than 30 seconds difference
              await StatusSchedule.findByIdAndUpdate(schedule._id, {
                scheduledTime: newTime
              });
              
              // Reschedule the cron job
              await this.rescheduleTask(schedule._id.toString(), newTime);
              
              optimizations.push({
                scheduleId: schedule._id,
                originalTime: schedule.scheduledTime,
                optimizedTime: newTime
              });
              
              optimized++;
            }
          }
        }
      }
      
      logger.info(`⚡ Optimized ${optimized} schedules`);
      
      return {
        optimized,
        optimizations,
        timeWindow,
        success: true
      };
      
    } catch (error) {
      logger.error('❌ Failed to optimize schedules:', error);
      throw error;
    }
  }

  /**
   * Analyze data for scheduling insights
   */
  async analyzeData(payload, context) {
    const { analysisType, data } = payload;
    
    try {
      let result;
      
      switch (analysisType) {
        case 'schedule_patterns':
          result = await this.analyzeSchedulePatterns(data);
          break;
        case 'optimal_times':
          result = await this.findOptimalScheduleTimes(data);
          break;
        case 'schedule_conflicts':
          result = await this.detectScheduleConflicts(data);
          break;
        default:
          throw new Error(`Unknown analysis type: ${analysisType}`);
      }
      
      return result;
      
    } catch (error) {
      logger.error('❌ Schedule analysis failed:', error);
      throw error;
    }
  }

  /**
   * Monitor scheduling system
   */
  async monitorSystem(payload, context) {
    try {
      const stats = {
        activeSchedules: this.scheduledTasks.size,
        metrics: this.metrics,
        systemHealth: {
          memoryUsage: process.memoryUsage(),
          uptime: process.uptime(),
          cronJobsRunning: Array.from(this.scheduledTasks.values()).filter(job => job.running).length
        }
      };
      
      // Check for overdue schedules
      const overdueSchedules = await StatusSchedule.find({
        isActive: true,
        scheduledTime: { $lt: new Date(Date.now() - 5 * 60 * 1000) } // 5 minutes overdue
      });
      
      if (overdueSchedules.length > 0) {
        stats.alerts = [{
          type: 'overdue_schedules',
          count: overdueSchedules.length,
          severity: 'warning'
        }];
      }
      
      return stats;
      
    } catch (error) {
      logger.error('❌ System monitoring failed:', error);
      throw error;
    }
  }

  /**
   * Health check for the agent
   */
  async healthCheck() {
    return {
      status: this.isActive ? 'healthy' : 'inactive',
      activeSchedules: this.scheduledTasks.size,
      metrics: this.metrics,
      lastActivity: new Date()
    };
  }

  // Helper methods

  /**
   * Execute a scheduled status update
   */
  async executeStatusUpdate(scheduleId) {
    const startTime = Date.now();
    
    try {
      const schedule = await StatusSchedule.findById(scheduleId);
      if (!schedule || !schedule.isActive) {
        return;
      }
      
      // Execute the status update
      await scheduleStatusUpdate(schedule.userId, schedule.statusText);
      
      // Update execution count
      schedule.executionCount = (schedule.executionCount || 0) + 1;
      schedule.lastExecuted = new Date();
      
      // If not recurring, deactivate
      if (!schedule.isRecurring) {
        schedule.isActive = false;
        this.scheduledTasks.delete(scheduleId);
      }
      
      await schedule.save();
      
      const executionTime = Date.now() - startTime;
      this.updateMetrics(executionTime, true);
      
      logger.info(`✅ Status update executed for schedule ${scheduleId}`);
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.updateMetrics(executionTime, false);
      
      logger.error(`❌ Failed to execute status update for schedule ${scheduleId}:`, error);
    }
  }

  /**
   * Convert timestamp to cron expression
   */
  convertToCronExpression(scheduledTime, recurring) {
    const date = new Date(scheduledTime);
    
    if (!recurring || !recurring.enabled) {
      // One-time schedule
      return `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`;
    }
    
    // Recurring schedule
    switch (recurring.pattern) {
      case 'daily':
        return `${date.getMinutes()} ${date.getHours()} * * *`;
      case 'weekly':
        return `${date.getMinutes()} ${date.getHours()} * * ${date.getDay()}`;
      case 'monthly':
        return `${date.getMinutes()} ${date.getHours()} ${date.getDate()} * *`;
      case 'hourly':
        return `${date.getMinutes()} * * * *`;
      default:
        return recurring.customCron || `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`;
    }
  }

  /**
   * Load existing schedules from database
   */
  async loadExistingSchedules() {
    try {
      const activeSchedules = await StatusSchedule.find({
        isActive: true,
        scheduledTime: { $gt: new Date() }
      });
      
      for (const schedule of activeSchedules) {
        const cronExpression = this.convertToCronExpression(
          schedule.scheduledTime,
          { enabled: schedule.isRecurring, pattern: schedule.recurringPattern }
        );
        
        const job = cron.schedule(cronExpression, async () => {
          await this.executeStatusUpdate(schedule._id);
        }, {
          scheduled: true,
          timezone: schedule.timezone || 'UTC'
        });
        
        this.scheduledTasks.set(schedule._id.toString(), job);
      }
      
      logger.info(`📋 Loaded ${activeSchedules.length} existing schedules`);
      
    } catch (error) {
      logger.error('❌ Failed to load existing schedules:', error);
    }
  }

  /**
   * Start periodic cleanup of expired schedules
   */
  startPeriodicCleanup() {
    // Run cleanup every hour
    cron.schedule('0 * * * *', async () => {
      try {
        const expiredSchedules = await StatusSchedule.find({
          isActive: true,
          scheduledTime: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // 24 hours old
          isRecurring: false
        });
        
        for (const schedule of expiredSchedules) {
          const job = this.scheduledTasks.get(schedule._id.toString());
          if (job) {
            job.stop();
            job.destroy();
            this.scheduledTasks.delete(schedule._id.toString());
          }
          
          schedule.isActive = false;
          await schedule.save();
        }
        
        if (expiredSchedules.length > 0) {
          logger.info(`🧹 Cleaned up ${expiredSchedules.length} expired schedules`);
        }
        
      } catch (error) {
        logger.error('❌ Schedule cleanup failed:', error);
      }
    });
  }

  /**
   * Update agent metrics
   */
  updateMetrics(executionTime, success) {
    if (success) {
      this.metrics.tasksExecuted++;
    } else {
      this.metrics.tasksFailed++;
    }
    
    const totalTasks = this.metrics.tasksExecuted + this.metrics.tasksFailed;
    this.metrics.averageExecutionTime = 
      ((this.metrics.averageExecutionTime * (totalTasks - 1)) + executionTime) / totalTasks;
  }

  /**
   * Reschedule a task with new time
   */
  async rescheduleTask(scheduleId, newTime) {
    const job = this.scheduledTasks.get(scheduleId);
    if (job) {
      job.stop();
      job.destroy();
    }
    
    const cronExpression = this.convertToCronExpression(newTime, { enabled: false });
    const newJob = cron.schedule(cronExpression, async () => {
      await this.executeStatusUpdate(scheduleId);
    }, { scheduled: true });
    
    this.scheduledTasks.set(scheduleId, newJob);
  }
}

module.exports = SchedulingAgent;
