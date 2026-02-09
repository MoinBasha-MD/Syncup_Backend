const PrimaryTimeProfile = require('../models/PrimaryTimeProfile');
const User = require('../models/userModel');
const StatusHistory = require('../models/statusHistoryModel');
const cron = require('node-cron');

/**
 * Primary Time Scheduler Service
 * Automatically activates/deactivates Primary Time profiles based on schedule
 * Integrates with existing status system and broadcasts via WebSocket
 */
class PrimaryTimeSchedulerService {
  constructor() {
    this.cronJob = null;
    this.isRunning = false;
    this.initialCheckTimeout = null;
  }

  /**
   * Check if a profile should be active at the given time
   */
  shouldProfileBeActive(profile, now = new Date()) {
    // Convert UTC server time to user's local time using profile's timezoneOffset
    // timezoneOffset is from JS getTimezoneOffset(): negative means ahead of UTC
    // e.g., IST (UTC+05:30) → offset = -330
    // To get local time: UTC - offset (since offset is negative for ahead)
    const offsetMs = (profile.timezoneOffset || 0) * 60 * 1000;
    const localNow = new Date(now.getTime() - offsetMs);

    const currentDay = localNow.getDay(); // 0-6 (Sun-Sat)
    const currentTime = `${String(localNow.getHours()).padStart(2, '0')}:${String(localNow.getMinutes()).padStart(2, '0')}`;

    console.log(`   🕐 [TIME CHECK] Profile "${profile.name}": serverUTC=${now.toISOString()}, offset=${profile.timezoneOffset || 0}min, localTime=${currentTime}, window=${profile.startTime}-${profile.endTime}, day=${currentDay}, days=${profile.days}`);

    // Check if today is in the days array
    if (!profile.days.includes(currentDay)) {
      console.log(`   ❌ [TIME CHECK] Day ${currentDay} not in profile days [${profile.days}]`);
      return false;
    }

    // Check date range if applicable
    if (profile.recurrence.type === 'date_range') {
      if (profile.recurrence.startDate && localNow < new Date(profile.recurrence.startDate)) {
        return false;
      }
      if (profile.recurrence.endDate && localNow > new Date(profile.recurrence.endDate)) {
        return false;
      }
    }

    // Check time range
    const isInWindow = currentTime >= profile.startTime && currentTime < profile.endTime;
    console.log(`   ${isInWindow ? '✅' : '❌'} [TIME CHECK] ${currentTime} >= ${profile.startTime} && ${currentTime} < ${profile.endTime} → ${isInWindow}`);
    return isInWindow;
  }

  /**
   * Check and update Primary Time status for a single user
   * Only processes profiles where isEnabled=true.
   * isEnabled = user wants this schedule to run
   * isActive  = the schedule is currently within its time window and status is applied
   */
  async checkAndUpdateUserPrimaryTime(userId) {
    try {
      const now = new Date();

      // Only get ENABLED profiles (user has turned on the schedule)
      const enabledProfiles = await PrimaryTimeProfile.find({ userId, isEnabled: true }).sort({ priority: -1 });

      if (enabledProfiles.length === 0) {
        return null;
      }

      console.log(`🔍 [PRIMARY TIME SCHEDULER] Checking user ${userId}`);
      console.log(`   📊 Found ${enabledProfiles.length} enabled profile(s)`);

      // Find enabled profiles that should be active right now (within time window)
      const shouldBeActiveProfiles = enabledProfiles.filter(p => this.shouldProfileBeActive(p, now));

      if (shouldBeActiveProfiles.length === 0) {
        // No profiles should be active right now — deactivate any that are currently active
        const currentlyActive = enabledProfiles.find(p => p.isActive);
        if (currentlyActive) {
          console.log(`   ⏹️ Time window ended for: "${currentlyActive.name}" — deactivating`);
          await this.deactivateProfile(currentlyActive, userId);
          return {
            userId,
            action: 'deactivated',
            profile: currentlyActive.name
          };
        }
        return null;
      }

      // Get highest priority profile that should be active
      const targetProfile = shouldBeActiveProfiles[0]; // Already sorted by priority desc

      // Check if this profile is already active
      if (targetProfile.isActive) {
        return null; // Already running, nothing to do
      }

      // Deactivate any other active profiles first
      const otherActive = enabledProfiles.find(p => p.isActive && p._id.toString() !== targetProfile._id.toString());
      if (otherActive) {
        await this.deactivateProfile(otherActive, userId);
      }

      // Activate the target profile (apply status)
      console.log(`   🎯 Time window active for: "${targetProfile.name}" — activating`);
      await this.activateProfile(targetProfile, userId);

      return {
        userId,
        action: 'activated',
        profile: targetProfile.name,
        status: targetProfile.status
      };

    } catch (error) {
      console.error(`❌ [PRIMARY TIME SCHEDULER] Error checking user ${userId}:`, error.message);
      return null;
    }
  }

  /**
   * Activate a Primary Time profile
   */
  async activateProfile(profile, userId) {
    try {
      const now = new Date();

      // Calculate duration until end time using profile's timezone offset
      // Profile stores local times (e.g., "17:00" IST). Server runs in UTC.
      const [endHours, endMinutes] = profile.endTime.split(':').map(Number);
      const offsetMs = (profile.timezoneOffset || 0) * 60 * 1000;
      const localNow = new Date(now.getTime() - offsetMs);
      const localEnd = new Date(localNow);
      localEnd.setHours(endHours, endMinutes, 0, 0);

      // If local end time is before local now, it's tomorrow
      if (localEnd <= localNow) {
        localEnd.setDate(localEnd.getDate() + 1);
      }

      // Convert local end back to UTC for storage
      const endTime = new Date(localEnd.getTime() + offsetMs);
      const durationMinutes = Math.round((endTime.getTime() - now.getTime()) / (1000 * 60));

      console.log(`   ⏰ Duration: ${durationMinutes} minutes (until ${profile.endTime})`);

      // Update profile as active
      profile.isActive = true;
      await profile.save();

      // Update user status
      const user = await User.findById(userId);
      if (!user) {
        console.error(`   ❌ User ${userId} not found`);
        return;
      }

      const oldStatus = user.status;

      // Save previous status for history
      if (user.status && user.status.toLowerCase() !== 'available' && user.status !== '') {
        user.previousStatus = user.customStatus || user.status;
        user.previousStatusEndTime = user.statusUntil || new Date();
      }

      // Update user status with Primary Time (same fields as Quick tab)
      user.status = profile.status;
      user.customStatus = profile.status;
      user.statusUpdatedAt = now;
      user.statusUntil = endTime;
      user.wasAutoApplied = true;
      user.primaryTimeProfileId = profile._id;

      // Set hierarchical fields so DPN page and contacts see full data
      user.mainStatus = profile.status;
      user.mainDuration = durationMinutes;
      user.mainDurationLabel = `${durationMinutes} minutes`;
      user.mainStartTime = now;
      user.mainEndTime = endTime;
      user.subStatus = null;
      user.subDuration = 0;
      user.subDurationLabel = '';
      user.subStartTime = null;
      user.subEndTime = null;

      // Update location if profile has one
      if (profile.location && profile.location.placeName) {
        user.statusLocation = {
          placeName: profile.location.placeName,
          coordinates: profile.location.coordinates || {},
          address: profile.location.address || '',
          shareWithContacts: true,
          timestamp: now,
        };
      }

      await user.save();

      console.log(`   ✅ Status updated: "${oldStatus}" → "${profile.status}"`);

      // Create StatusHistory entry (same as Quick tab)
      try {
        await StatusHistory.create({
          user: user._id,
          userId: user.userId,
          status: profile.status,
          customStatus: profile.status,
          startTime: now,
          endTime: endTime,
          duration: durationMinutes,
        });
      } catch (histErr) {
        console.error(`   ⚠️ StatusHistory error:`, histErr.message);
      }

      // Broadcast via socketManager (same path as Quick tab — contact-filtered)
      try {
        const socketManager = require('../socketManager');
        const statusData = {
          status: user.status,
          customStatus: user.customStatus,
          statusUntil: user.statusUntil,
          statusLocation: user.statusLocation,
          mainStatus: user.mainStatus,
          mainDuration: user.mainDuration,
          mainDurationLabel: user.mainDurationLabel,
          mainStartTime: user.mainStartTime,
          mainEndTime: user.mainEndTime,
          subStatus: user.subStatus,
          subDuration: user.subDuration,
          subDurationLabel: user.subDurationLabel,
          subStartTime: user.subStartTime,
          subEndTime: user.subEndTime,
        };
        socketManager.broadcastStatusUpdate(user, statusData);
      } catch (socketErr) {
        console.error(`   ⚠️ Socket broadcast error:`, socketErr.message);
      }

      // Send notification if enabled
      if (profile.notifications.onStart) {
        await this.sendNotification(userId, {
          title: 'Primary Time Started',
          body: `${profile.status} is now active`,
          channelId: 'primary-time-channel',
          data: {
            type: 'primary_time_start',
            profileId: profile._id.toString(),
            profileName: profile.name,
            status: profile.status
          }
        });
      }

    } catch (error) {
      console.error(`   ❌ Error activating profile:`, error.message);
    }
  }

  /**
   * Deactivate a Primary Time profile
   */
  async deactivateProfile(profile, userId) {
    try {
      const now = new Date();

      // Update profile as inactive
      profile.isActive = false;
      await profile.save();

      // Update user status back to Available
      const user = await User.findById(userId);
      if (!user) {
        console.error(`   ❌ User ${userId} not found`);
        return;
      }

      // Save previous status for history
      if (user.status && user.status.toLowerCase() !== 'available') {
        user.previousStatus = user.customStatus || user.status;
        user.previousStatusEndTime = now;
      }

      user.status = 'Available';
      user.customStatus = '';
      user.statusUpdatedAt = now;
      user.statusUntil = null;
      user.wasAutoApplied = false;
      user.primaryTimeProfileId = null;

      // Clear hierarchical fields
      user.mainStatus = 'Available';
      user.mainDuration = 0;
      user.mainDurationLabel = '';
      user.mainStartTime = null;
      user.mainEndTime = null;
      user.subStatus = null;
      user.subDuration = 0;
      user.subDurationLabel = '';
      user.subStartTime = null;
      user.subEndTime = null;

      // Clear location if it was set by Primary Time
      if (user.statusLocation && profile.location &&
          user.statusLocation.placeName === profile.location.placeName) {
        user.statusLocation = {
          placeName: '',
          coordinates: {},
          address: '',
          shareWithContacts: false,
          timestamp: now,
        };
      }

      await user.save();

      console.log(`   ✅ Status cleared to "Available"`);

      // Broadcast via socketManager (same path as Quick tab)
      try {
        const socketManager = require('../socketManager');
        const statusData = {
          status: 'Available',
          customStatus: '',
          statusUntil: null,
          statusLocation: user.statusLocation,
          mainStatus: 'Available',
          mainDuration: 0,
          mainDurationLabel: '',
          mainStartTime: null,
          mainEndTime: null,
          subStatus: null,
          subDuration: 0,
          subDurationLabel: '',
          subStartTime: null,
          subEndTime: null,
        };
        socketManager.broadcastStatusUpdate(user, statusData);
      } catch (socketErr) {
        console.error(`   ⚠️ Socket broadcast error:`, socketErr.message);
      }

      // Send notification if enabled
      if (profile.notifications.onEnd) {
        await this.sendNotification(userId, {
          title: 'Primary Time Ended',
          body: `${profile.status} has ended`,
          channelId: 'primary-time-channel',
          data: {
            type: 'primary_time_end',
            profileId: profile._id.toString(),
            profileName: profile.name
          }
        });
      }

    } catch (error) {
      console.error(`   ❌ Error deactivating profile:`, error.message);
    }
  }

  // broadcastStatusUpdate is now handled by socketManager.broadcastStatusUpdate
  // which does proper contact-level filtering (same as Quick tab)

  /**
   * Send push notification
   */
  async sendNotification(userId, notification) {
    try {
      const fcmService = require('./fcmNotificationService');
      
      // Check if FCM is enabled
      if (!fcmService.isEnabled()) {
        console.log(`   ⚠️ FCM is disabled - skipping notification`);
        return;
      }
      
      // Send visible notification
      const result = await fcmService.sendVisibleNotification(userId, notification);
      
      if (result.success) {
        console.log(`   🔔 Notification sent successfully (${result.successCount} device(s))`);
      } else {
        console.log(`   ⚠️ Notification failed: ${result.reason || result.error}`);
      }
    } catch (error) {
      console.error(`   ❌ Notification error:`, error.message);
    }
  }

  /**
   * Check all users with Primary Time profiles
   */
  async checkAllUsers() {
    try {
      const startTime = Date.now();
      console.log('\n⏰ [PRIMARY TIME SCHEDULER] ========== CRON JOB STARTED ==========');
      console.log(`🕐 [PRIMARY TIME SCHEDULER] Time: ${new Date().toLocaleString()}`);

      // Get all unique user IDs with ENABLED Primary Time profiles
      const userIds = await PrimaryTimeProfile.find({ isEnabled: true }).distinct('userId');

      console.log(`📊 [PRIMARY TIME SCHEDULER] Found ${userIds.length} users with Primary Time profiles`);

      if (userIds.length === 0) {
        console.log('ℹ️ [PRIMARY TIME SCHEDULER] No users with Primary Time profiles');
        console.log('⏰ [PRIMARY TIME SCHEDULER] ========== CRON JOB COMPLETED ==========\n');
        return [];
      }

      // Check each user
      const results = await Promise.all(
        userIds.map(userId => this.checkAndUpdateUserPrimaryTime(userId))
      );

      const updated = results.filter(r => r !== null);
      const duration = Date.now() - startTime;

      console.log(`\n📈 [PRIMARY TIME SCHEDULER] Summary:`);
      console.log(`   • Total users checked: ${userIds.length}`);
      console.log(`   • Profiles updated: ${updated.length}`);
      console.log(`   • Duration: ${duration}ms`);

      if (updated.length > 0) {
        console.log(`\n✅ [PRIMARY TIME SCHEDULER] Updated profiles:`);
        updated.forEach((u, i) => {
          console.log(`   ${i + 1}. ${u.userId}: ${u.action} "${u.profile}"`);
        });
      }

      console.log('⏰ [PRIMARY TIME SCHEDULER] ========== CRON JOB COMPLETED ==========\n');

      return updated;
    } catch (error) {
      console.error('❌ [PRIMARY TIME SCHEDULER] Error in checkAllUsers:', error);
      return [];
    }
  }

  /**
   * Start cron job (runs every 1 minute)
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ [PRIMARY TIME SCHEDULER] Cron job already running');
      return;
    }

    // Run every 1 minute for responsive activation
    this.cronJob = cron.schedule('* * * * *', async () => {
      await this.checkAllUsers();
    });

    this.isRunning = true;
    console.log('✅ [PRIMARY TIME SCHEDULER] Cron job started (runs every 1 minute)');
    console.log('📅 [PRIMARY TIME SCHEDULER] Schedule: * * * * * (every 1 minute)');

    // Run immediately on startup
    console.log('🚀 [PRIMARY TIME SCHEDULER] Running initial check...');
    this.initialCheckTimeout = setTimeout(() => {
      this.checkAllUsers();
    }, 10000); // Wait 10 seconds after server start
  }

  /**
   * Stop cron job
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    
    // Clear the initial check timeout to prevent memory leak
    if (this.initialCheckTimeout) {
      clearTimeout(this.initialCheckTimeout);
      this.initialCheckTimeout = null;
    }
    
    this.isRunning = false;
    console.log('🛑 [PRIMARY TIME SCHEDULER] Cron job stopped');
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      schedule: '* * * * * (every 1 minute)'
    };
  }

  /**
   * Manually trigger check (for testing)
   */
  async triggerManualCheck() {
    console.log('🔄 [PRIMARY TIME SCHEDULER] Manual check triggered');
    return await this.checkAllUsers();
  }
}

module.exports = new PrimaryTimeSchedulerService();
