/**
 * Recommendation Background Jobs
 * Scheduled tasks for maintaining recommendation algorithm
 */

const cron = require('node-cron');
const recommendationService = require('./recommendationService');
const UserHashtagPreference = require('../models/UserHashtagPreference');

class RecommendationJobs {
  constructor() {
    this.jobs = [];
  }

  /**
   * Start all background jobs
   */
  start() {
    console.log('🔄 [RECOMMENDATION JOBS] Starting background jobs...');

    // Apply decay to user preferences - runs daily at 3 AM
    const decayJob = cron.schedule('0 3 * * *', async () => {
      console.log('🔄 [RECOMMENDATION JOBS] Running daily preference decay...');
      try {
        await recommendationService.applyDecayToAllUsers();
        console.log('✅ [RECOMMENDATION JOBS] Preference decay completed');
      } catch (error) {
        console.error('❌ [RECOMMENDATION JOBS] Error in preference decay:', error);
      }
    });

    this.jobs.push({ name: 'preference_decay', job: decayJob });

    // Clean up old interactions - runs weekly on Sunday at 2 AM
    const cleanupJob = cron.schedule('0 2 * * 0', async () => {
      console.log('🔄 [RECOMMENDATION JOBS] Running weekly interaction cleanup...');
      try {
        const UserInteraction = require('../models/UserInteraction');
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 90); // Keep 90 days of history

        const result = await UserInteraction.deleteMany({
          timestamp: { $lt: cutoffDate }
        });

        console.log(`✅ [RECOMMENDATION JOBS] Cleaned up ${result.deletedCount} old interactions`);
      } catch (error) {
        console.error('❌ [RECOMMENDATION JOBS] Error in interaction cleanup:', error);
      }
    });

    this.jobs.push({ name: 'interaction_cleanup', job: cleanupJob });

    // Update trending hashtags cache - runs every hour
    const trendingJob = cron.schedule('0 * * * *', async () => {
      console.log('🔄 [RECOMMENDATION JOBS] Updating trending hashtags cache...');
      try {
        const trending = await recommendationService.getTrendingHashtags(50, 7);
        
        // Store in cache (you can use Redis here if available)
        global.trendingHashtagsCache = {
          data: trending,
          updatedAt: new Date()
        };

        console.log(`✅ [RECOMMENDATION JOBS] Updated trending hashtags cache (${trending.length} hashtags)`);
      } catch (error) {
        console.error('❌ [RECOMMENDATION JOBS] Error updating trending hashtags:', error);
      }
    });

    this.jobs.push({ name: 'trending_hashtags', job: trendingJob });

    console.log(`✅ [RECOMMENDATION JOBS] Started ${this.jobs.length} background jobs`);
  }

  /**
   * Stop all background jobs
   */
  stop() {
    console.log('🛑 [RECOMMENDATION JOBS] Stopping background jobs...');
    
    this.jobs.forEach(({ name, job }) => {
      job.stop();
      console.log(`🛑 [RECOMMENDATION JOBS] Stopped job: ${name}`);
    });

    this.jobs = [];
    console.log('✅ [RECOMMENDATION JOBS] All jobs stopped');
  }

  /**
   * Get job status
   */
  getStatus() {
    return this.jobs.map(({ name, job }) => ({
      name,
      running: job.running || false
    }));
  }

  /**
   * Manually trigger preference decay (for testing)
   */
  async triggerDecay() {
    console.log('🔄 [RECOMMENDATION JOBS] Manually triggering preference decay...');
    await recommendationService.applyDecayToAllUsers();
    console.log('✅ [RECOMMENDATION JOBS] Manual decay completed');
  }

  /**
   * Manually trigger interaction cleanup (for testing)
   */
  async triggerCleanup() {
    console.log('🔄 [RECOMMENDATION JOBS] Manually triggering interaction cleanup...');
    const UserInteraction = require('../models/UserInteraction');
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    const result = await UserInteraction.deleteMany({
      timestamp: { $lt: cutoffDate }
    });

    console.log(`✅ [RECOMMENDATION JOBS] Manual cleanup completed (${result.deletedCount} interactions removed)`);
    return result.deletedCount;
  }

  /**
   * Manually trigger trending update (for testing)
   */
  async triggerTrendingUpdate() {
    console.log('🔄 [RECOMMENDATION JOBS] Manually triggering trending hashtags update...');
    const trending = await recommendationService.getTrendingHashtags(50, 7);
    
    global.trendingHashtagsCache = {
      data: trending,
      updatedAt: new Date()
    };

    console.log(`✅ [RECOMMENDATION JOBS] Manual trending update completed (${trending.length} hashtags)`);
    return trending;
  }
}

module.exports = new RecommendationJobs();
