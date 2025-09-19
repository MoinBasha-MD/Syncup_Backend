const statusScheduler = require('./statusScheduler');
const { broadcastStatusUpdate } = require('../socketManager');

/**
 * Scheduler Runner - Runs scheduled tasks at regular intervals
 */
class SchedulerRunner {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    this.checkInterval = 60000; // Check every minute (60000 ms)
  }

  /**
   * Start the scheduler
   */
  start() {
    if (this.isRunning) {
      console.log('Scheduler is already running');
      return;
    }

    console.log(`Starting scheduler with check interval of ${this.checkInterval}ms`);
    
    // Run immediately on start
    this.runScheduledTasks();
    
    // Then set up interval
    this.intervalId = setInterval(() => {
      this.runScheduledTasks();
    }, this.checkInterval);
    
    this.isRunning = true;
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (!this.isRunning) {
      console.log('Scheduler is not running');
      return;
    }

    console.log('Stopping scheduler');
    clearInterval(this.intervalId);
    this.intervalId = null;
    this.isRunning = false;
  }

  /**
   * Run all scheduled tasks
   */
  async runScheduledTasks() {
    try {
      console.log(`Running scheduled tasks at ${new Date().toISOString()}`);
      
      // Process scheduled statuses
      const processedStatuses = await statusScheduler.processScheduledStatuses();
      
      // Broadcast status updates via Socket.IO
      let broadcastCount = 0;
      for (const statusUpdate of processedStatuses) {
        if (statusUpdate) {
          try {
            await broadcastStatusUpdate(statusUpdate.userId, {
              status: statusUpdate.status,
              customStatus: statusUpdate.customStatus,
              statusUntil: statusUpdate.statusUntil
            });
            broadcastCount++;
          } catch (broadcastError) {
            console.error(`Error broadcasting status update for user ${statusUpdate.userId}:`, broadcastError);
          }
        }
      }
      
      console.log(`Completed scheduled tasks: processed ${processedStatuses.length} status updates, broadcast ${broadcastCount} updates`);
    } catch (error) {
      console.error('Error running scheduled tasks:', error);
      console.error('Stack trace:', error.stack);
    }
  }
}

module.exports = new SchedulerRunner();
