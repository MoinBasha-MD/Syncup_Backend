const cron = require('node-cron');
const User = require('../models/userModel');
const socketManager = require('../socketManager');

/**
 * Service to automatically clear expired sub-statuses
 * Runs every minute to check for expired statuses
 */
class StatusExpirationService {
  constructor() {
    this.isRunning = false;
    this.cronJob = null;
  }

  /**
   * Check and clear expired main statuses AND sub-statuses for all users
   */
  async checkExpiredStatuses() {
    try {
      const now = new Date();
      console.log(`\n⏰ [STATUS EXPIRATION] ========== CHECK STARTED ==========`);
      console.log(`🕐 [STATUS EXPIRATION] Time: ${now.toLocaleString()}`);

      // CRITICAL FIX: Check for expired MAIN statuses
      const usersWithExpiredMainStatus = await User.find({
        mainStatus: { $ne: null, $ne: 'Available' },
        mainEndTime: { $lte: now }
      });

      console.log(`📊 [STATUS EXPIRATION] Found ${usersWithExpiredMainStatus.length} users with expired main statuses`);

      let mainStatusCleared = 0;

      for (const user of usersWithExpiredMainStatus) {
        const oldMainStatus = user.mainStatus;
        
        console.log(`🔍 [STATUS EXPIRATION] User ${user.name} (${user.phoneNumber}):`);
        console.log(`   - Old main status: "${oldMainStatus}"`);
        console.log(`   - Main end time: ${user.mainEndTime}`);
        console.log(`   - Current time: ${now}`);
        
        // Clear main status fields
        user.status = 'Available';
        user.customStatus = '';
        user.mainStatus = 'Available';
        user.mainDuration = 0;
        user.mainDurationLabel = '';
        user.mainStartTime = null;
        user.mainEndTime = null;

        await user.save();

        console.log(`✅ [STATUS EXPIRATION] Cleared main status for ${user.name}: "${oldMainStatus}" → "Available"`);

        // Broadcast the status update to friends
        const statusData = {
          userId: user._id.toString(),
          phoneNumber: user.phoneNumber,
          name: user.name,
          status: 'Available', // Cleared!
          customStatus: '',
          mainStatus: 'Available', // Cleared!
          mainDuration: 0,
          mainDurationLabel: '',
          mainStartTime: null,
          mainEndTime: null,
          subStatus: user.subStatus, // Keep sub-status if exists
          subDuration: user.subDuration,
          subDurationLabel: user.subDurationLabel,
          subStartTime: user.subStartTime,
          subEndTime: user.subEndTime,
          isOnline: user.isOnline,
          lastSeen: user.lastSeen,
          timestamp: now
        };

        console.log(`📡 [STATUS EXPIRATION] Broadcasting cleared main status for ${user.name}`);
        socketManager.broadcastStatusUpdate(user, statusData);

        mainStatusCleared++;
      }

      // Find users with expired sub-statuses
      const usersWithExpiredSubStatus = await User.find({
        subStatus: { $ne: null },
        subEndTime: { $lte: now }
      });

      console.log(`📊 [STATUS EXPIRATION] Found ${usersWithExpiredSubStatus.length} users with expired sub-statuses`);

      let subStatusCleared = 0;

      for (const user of usersWithExpiredSubStatus) {
        const oldSubStatus = user.subStatus;
        
        console.log(`🔍 [STATUS EXPIRATION] User ${user.name} (${user.phoneNumber}):`);
        console.log(`   - Old sub-status: "${oldSubStatus}"`);
        console.log(`   - Sub end time: ${user.subEndTime}`);
        console.log(`   - Current time: ${now}`);
        
        // Clear sub-status fields
        user.subStatus = null;
        user.subDuration = 0;
        user.subDurationLabel = '';
        user.subStartTime = null;
        user.subEndTime = null;

        await user.save();

        console.log(`✅ [STATUS EXPIRATION] Cleared sub-status for ${user.name}: "${oldSubStatus}"`);

        // Broadcast the status update to friends
        const statusData = {
          userId: user._id.toString(),
          phoneNumber: user.phoneNumber,
          name: user.name,
          status: user.status,
          customStatus: user.customStatus,
          mainStatus: user.mainStatus,
          mainDuration: user.mainDuration,
          mainDurationLabel: user.mainDurationLabel,
          mainStartTime: user.mainStartTime,
          mainEndTime: user.mainEndTime,
          subStatus: null, // Cleared!
          subDuration: 0,
          subDurationLabel: '',
          subStartTime: null,
          subEndTime: null,
          isOnline: user.isOnline,
          lastSeen: user.lastSeen,
          timestamp: now
        };

        console.log(`📡 [STATUS EXPIRATION] Broadcasting cleared sub-status for ${user.name}`);
        socketManager.broadcastStatusUpdate(user, statusData);

        subStatusCleared++;
      }

      console.log(`\n📈 [STATUS EXPIRATION] Summary:`);
      console.log(`   • Main statuses cleared: ${mainStatusCleared}`);
      console.log(`   • Sub-statuses cleared: ${subStatusCleared}`);
      console.log(`   • Total statuses cleared: ${mainStatusCleared + subStatusCleared}`);
      console.log(`⏰ [STATUS EXPIRATION] ========== CHECK COMPLETED ==========\n`);

      return mainStatusCleared + subStatusCleared;
    } catch (error) {
      console.error('❌ [STATUS EXPIRATION] Error checking expired statuses:', error);
      return 0;
    }
  }

  /**
   * Start the cron job (runs every minute)
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ [STATUS EXPIRATION] Service already running');
      return;
    }

    // Run every minute: * * * * *
    this.cronJob = cron.schedule('* * * * *', async () => {
      await this.checkExpiredStatuses();
    });

    this.isRunning = true;
    console.log('✅ [STATUS EXPIRATION] Service started (runs every minute)');
    console.log('📅 [STATUS EXPIRATION] Schedule: * * * * * (every minute)');

    // Run immediately on startup
    console.log('🚀 [STATUS EXPIRATION] Running initial check...');
    setTimeout(() => {
      this.checkExpiredStatuses();
    }, 5000); // Wait 5 seconds after server start
  }

  /**
   * Stop the cron job
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.isRunning = false;
      console.log('🛑 [STATUS EXPIRATION] Service stopped');
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      schedule: '* * * * * (every minute)'
    };
  }
}

// Export singleton instance
module.exports = new StatusExpirationService();
