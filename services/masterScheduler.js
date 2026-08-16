/**
 * Master Scheduler Service
 * Consolidates all background schedulers into optimized intervals
 * Reduces overhead from 8 separate cron jobs to 2 master schedulers
 */

const cron = require('node-cron');

class MasterScheduler {
  constructor() {
    this.oneMinuteJob = null;
    this.oneHourJob = null;
    this.isRunning = false;
  }

  /**
   * Start all schedulers
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ Master scheduler already running');
      return;
    }

    console.log('🚀 Starting Master Scheduler...');

    // ⚡ PERFORMANCE OPTIMIZATION: Consolidate 1-minute tasks
    this.oneMinuteJob = cron.schedule('*/1 * * * *', async () => {
      const startTime = Date.now();
      
      try {
        // Run all 1-minute tasks in parallel
        await Promise.allSettled([
          this.runPrimaryTimeScheduler(),
          this.runLocationSharingCleanup(),
          this.runStatusExpiration()
        ]);
        
        const duration = Date.now() - startTime;
        if (process.env.NODE_ENV !== 'production') {
          console.log(`⏱️ [MASTER SCHEDULER] 1-minute tasks completed in ${duration}ms`);
        }
      } catch (error) {
        console.error('❌ [MASTER SCHEDULER] Error in 1-minute tasks:', error);
      }
    });

    // ⚡ PERFORMANCE OPTIMIZATION: Consolidate 1-hour tasks
    this.oneHourJob = cron.schedule('0 * * * *', async () => {
      const startTime = Date.now();
      
      try {
        // Run all 1-hour tasks in parallel
        await Promise.allSettled([
          this.runStoryCleanup(),
          this.runOTPCleanup(),
          this.runMessageCleanup()
        ]);
        
        const duration = Date.now() - startTime;
        if (process.env.NODE_ENV !== 'production') {
          console.log(`⏱️ [MASTER SCHEDULER] 1-hour tasks completed in ${duration}ms`);
        }
      } catch (error) {
        console.error('❌ [MASTER SCHEDULER] Error in 1-hour tasks:', error);
      }
    });

    this.isRunning = true;
    console.log('✅ Master Scheduler started');
    console.log('   📅 1-minute tasks: Primary Time, Location Cleanup, Status Expiration');
    console.log('   📅 1-hour tasks: Story Cleanup, OTP Cleanup, Message Cleanup');

    // Run initial cleanup on startup (non-blocking)
    this.runInitialCleanup();
  }

  /**
   * Stop all schedulers
   */
  stop() {
    if (this.oneMinuteJob) {
      this.oneMinuteJob.stop();
      this.oneMinuteJob = null;
    }
    
    if (this.oneHourJob) {
      this.oneHourJob.stop();
      this.oneHourJob = null;
    }
    
    this.isRunning = false;
    console.log('✅ Master Scheduler stopped');
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      oneMinuteJobActive: !!this.oneMinuteJob,
      oneHourJobActive: !!this.oneHourJob
    };
  }

  // ========================================
  // 1-MINUTE TASKS
  // ========================================

  async runPrimaryTimeScheduler() {
    try {
      const primaryTimeScheduler = require('./primaryTimeScheduler');
      await primaryTimeScheduler.checkAllUsers();
    } catch (error) {
      console.error('❌ [PRIMARY TIME] Error:', error.message);
    }
  }

  async runLocationSharingCleanup() {
    try {
      const locationSharingCleanupScheduler = require('./locationSharingCleanupScheduler');
      await locationSharingCleanupScheduler.cleanup();
    } catch (error) {
      console.error('❌ [LOCATION CLEANUP] Error:', error.message);
    }
  }

  async runStatusExpiration() {
    try {
      const statusExpirationService = require('./statusExpirationService');
      await statusExpirationService.checkExpiredStatuses();
    } catch (error) {
      console.error('❌ [STATUS EXPIRATION] Error:', error.message);
    }
  }

  // ========================================
  // 1-HOUR TASKS
  // ========================================

  async runStoryCleanup() {
    try {
      const storyService = require('./storyService');
      const result = await storyService.cleanupExpiredStories();
      if (process.env.NODE_ENV !== 'production') {
        console.log('✅ [STORY CLEANUP] Completed:', result);
      }
    } catch (error) {
      console.error('❌ [STORY CLEANUP] Error:', error.message);
    }
  }

  async runOTPCleanup() {
    try {
      const otpService = require('./otpService');
      await otpService.cleanExpiredOTPs();
      if (process.env.NODE_ENV !== 'production') {
        console.log('✅ [OTP CLEANUP] Completed');
      }
    } catch (error) {
      console.error('❌ [OTP CLEANUP] Error:', error.message);
    }
  }

  async runMessageCleanup() {
    try {
      const messageCleanupScheduler = require('./messageCleanupScheduler');
      // ✅ FIX: messageCleanupScheduler has no `cleanup()` method — the real
      // method that deletes expired timer-mode messages is
      // `cleanupExpiredMessages()`. Calling the wrong name threw
      // "cleanup is not a function" on every scheduled run.
      await messageCleanupScheduler.cleanupExpiredMessages();
      if (process.env.NODE_ENV !== 'production') {
        console.log('✅ [MESSAGE CLEANUP] Completed');
      }
    } catch (error) {
      console.error('❌ [MESSAGE CLEANUP] Error:', error.message);
    }
  }

  // ========================================
  // INITIAL CLEANUP (ON STARTUP)
  // ========================================

  async runInitialCleanup() {
    console.log('🧹 Running initial cleanup tasks...');
    
    try {
      // Run all cleanup tasks in parallel (non-blocking)
      await Promise.allSettled([
        this.runStoryCleanup(),
        this.runOTPCleanup(),
        this.runMessageCleanup(),
        this.runLocationSharingCleanup(),
        this.runStatusExpiration()
      ]);
      
      console.log('✅ Initial cleanup completed');
    } catch (error) {
      console.error('❌ Initial cleanup error:', error);
    }
  }
}

module.exports = new MasterScheduler();
