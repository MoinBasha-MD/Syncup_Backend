const cron = require('node-cron');
const { purgeUnverifiedPartners } = require('../services/partnerService');
const { recordJobRun } = require('../services/jobRun');

/**
 * Cron job to remove partner accounts that never verified their email.
 * Unverified sandbox accounts are almost always form spam; legitimate users
 * have 48 hours to complete verification before the record is removed.
 * Runs every hour.
 */
function initializePartnerAccountCleanup() {
  // Run hourly at minute 23
  cron.schedule('23 * * * *', async () => {
    const started = Date.now();
    try {
      const { deleted } = await purgeUnverifiedPartners({ olderThanHours: 48 });
      if (deleted > 0) {
        console.log(`✅ [CRON] Purged ${deleted} unverified partner account(s)`);
      }
      await recordJobRun('partner-account-cleanup', 'success', Date.now() - started);
    } catch (error) {
      await recordJobRun('partner-account-cleanup', 'failure', Date.now() - started, error.message);
      console.error('❌ [CRON] Error purging unverified partner accounts:', error);
    }
  });

  console.log('✅ [CRON] Partner account cleanup initialized (runs hourly)');
}

module.exports = { initializePartnerAccountCleanup };
