const cron = require('node-cron');
const PublicStatusCache = require('../models/PublicStatusCache');
const { recordJobRun } = require('../services/jobRun');

/**
 * Cron job to clean up expired public status cache entries
 * Runs every 10 minutes
 */
function initializePublicStatusCacheCleaner() {
  // Run every 10 minutes: */10 * * * *
  cron.schedule('*/10 * * * *', async () => {
    const started = Date.now();
    try {
      console.log('🧹 [CRON] Running PublicStatusCache cleanup...');
      const deletedCount = await PublicStatusCache.cleanupExpired();

      if (deletedCount > 0) {
        console.log(`✅ [CRON] Cleaned up ${deletedCount} expired public status entries`);
      } else {
        console.log('✅ [CRON] No expired entries to clean up');
      }
      await recordJobRun('public-status-cleanup', 'success', Date.now() - started);
    } catch (error) {
      await recordJobRun('public-status-cleanup', 'failure', Date.now() - started, error.message);
      console.error('❌ [CRON] Error cleaning up public status cache:', error);
    }
  });

  console.log('✅ [CRON] PublicStatusCache cleaner initialized (runs every 10 minutes)');
}

module.exports = { initializePublicStatusCacheCleaner };
