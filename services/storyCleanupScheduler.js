const cron = require('node-cron');
const storyService = require('./storyService');

class StoryCleanupScheduler {
  constructor() {
    this.isRunning = false;
    this.cronJob = null;
  }

  // Start scheduled cleanup - runs every hour
  start() {
    if (this.isRunning) {
      console.log('⚠️ Story cleanup scheduler already running');
      return;
    }

    console.log('🧹 Starting story cleanup scheduler...');
    
    // Run cleanup every hour
    // Cron format: minute hour day month dayOfWeek
    // '0 * * * *' = At minute 0 of every hour
    this.cronJob = cron.schedule('0 * * * *', async () => {
      console.log('⏰ [CRON] Running scheduled story cleanup...');
      try {
        const result = await storyService.cleanupExpiredStories();
        console.log('✅ [CRON] Story cleanup completed:', result);
      } catch (error) {
        console.error('❌ [CRON] Story cleanup failed:', error);
      }
    });

    this.isRunning = true;
    console.log('✅ Story cleanup scheduler started (runs every hour)');

    // Run initial cleanup on startup
    this.runCleanupNow();
  }

  // Stop scheduled cleanup
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      this.isRunning = false;
      console.log('✅ Story cleanup scheduler stopped');
    }
  }

  // Manually trigger cleanup
  async runCleanupNow() {
    console.log('🧹 [MANUAL] Running story cleanup now...');
    try {
      const result = await storyService.cleanupExpiredStories();
      console.log('✅ [MANUAL] Story cleanup completed:', result);
      return result;
    } catch (error) {
      console.error('❌ [MANUAL] Story cleanup failed:', error);
      throw error;
    }
  }

  // Get scheduler status
  getStatus() {
    return {
      isRunning: this.isRunning,
      nextRun: this.cronJob ? 'Next hour at :00' : 'Not scheduled'
    };
  }
}

module.exports = new StoryCleanupScheduler();
