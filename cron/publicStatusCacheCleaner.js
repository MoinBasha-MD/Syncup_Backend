const cron = require('node-cron');
const PublicStatusCache = require('../models/PublicStatusCache');

/**
 * Cron job to clean up expired public status cache entries
 * Runs every 10 minutes
 */
function initializePublicStatusCacheCleaner() {
  // Run every 10 minutes: */10 * * * *
  cron.schedule('*/10 * * * *', async () => {
    try {
      console.log('🧹 [CRON] Running PublicStatusCache cleanup...');
      const deletedCount = await PublicStatusCache.cleanupExpired();
      
      if (deletedCount > 0) {
        console.log(`✅ [CRON] Cleaned up ${deletedCount} expired public status entries`);
      } else {
        console.log('✅ [CRON] No expired entries to clean up');
      }
    } catch (error) {
      console.error('❌ [CRON] Error cleaning up public status cache:', error);
    }
  });

  console.log('✅ [CRON] PublicStatusCache cleaner initialized (runs every 10 minutes)');
}

module.exports = { initializePublicStatusCacheCleaner };
