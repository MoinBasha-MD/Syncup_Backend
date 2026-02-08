const PrimaryTimeProfile = require('../models/PrimaryTimeProfile');
const User = require('../models/userModel');
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
    const currentDay = now.getDay(); // 0-6 (Sun-Sat)
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Check if today is in the days array
    if (!profile.days.includes(currentDay)) {
      return false;
    }

    // Check date range if applicable
    if (profile.recurrence.type === 'date_range') {
      if (profile.recurrence.startDate && now < new Date(profile.recurrence.startDate)) {
        return false;
      }
      if (profile.recurrence.endDate && now > new Date(profile.recurrence.endDate)) {
        return false;
      }
    }

    // Check time range
    return currentTime >= profile.startTime && currentTime < profile.endTime;
  }

  /**
   * Check and update Primary Time status for a single user
   */
  async checkAndUpdateUserPrimaryTime(userId) {
    try {
      const now = new Date();

      // Get all user's Primary Time profiles
      const profiles = await PrimaryTimeProfile.find({ userId }).sort({ priority: -1 });

      if (profiles.length === 0) {
        return null;
      }

      console.log(`🔍 [PRIMARY TIME SCHEDULER] Checking user ${userId}`);
      console.log(`   📊 Found ${profiles.length} profile(s)`);

      // Find profiles that should be active right now
      const activeProfiles = profiles.filter(p => this.shouldProfileBeActive(p, now));

      if (activeProfiles.length === 0) {
        // No profiles should be active - deactivate any active ones
        const currentlyActive = profiles.find(p => p.isActive);
        if (currentlyActive) {
          console.log(`   ⏹️ Deactivating profile: "${currentlyActive.name}"`);
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
      const targetProfile = activeProfiles[0]; // Already sorted by priority desc

      // Check if this profile is already active
      if (targetProfile.isActive) {
        console.log(`   ℹ️ Profile "${targetProfile.name}" already active`);
        return null;
      }

      // Deactivate any other active profiles
      const otherActive = profiles.find(p => p.isActive && p.id !== targetProfile.id);
      if (otherActive) {
        await this.deactivateProfile(otherActive, userId);
      }

      // Activate the target profile
      console.log(`   🎯 Activating profile: "${targetProfile.name}"`);
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

      // Calculate duration until end time
      const [endHours, endMinutes] = profile.endTime.split(':').map(Number);
      const endTime = new Date(now);
      endTime.setHours(endHours, endMinutes, 0, 0);

      // If end time is before current time, it's tomorrow
      if (endTime <= now) {
        endTime.setDate(endTime.getDate() + 1);
      }

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

      // Update user status with Primary Time
      user.status = profile.status;
      user.customStatus = profile.status;
      user.statusUpdatedAt = now;
      user.statusUntil = endTime;
      user.wasAutoApplied = true;
      user.primaryTimeProfileId = profile._id; // Track which profile is active

      // Update location if profile has one
      if (profile.location && profile.location.placeName) {
        user.currentLocation = {
          placeName: profile.location.placeName,
          coordinates: profile.location.coordinates,
          address: profile.location.address,
          timestamp: now
        };
      }

      await user.save();

      console.log(`   ✅ Status updated: "${oldStatus}" → "${profile.status}"`);

      // Broadcast via WebSocket
      await this.broadcastStatusUpdate(user, profile);

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

      user.status = 'Available';
      user.customStatus = '';
      user.statusUpdatedAt = now;
      user.statusUntil = null;
      user.wasAutoApplied = false;
      user.primaryTimeProfileId = null;

      // Clear location if it was set by Primary Time
      if (user.currentLocation && profile.location && 
          user.currentLocation.placeName === profile.location.placeName) {
        user.currentLocation = null;
      }

      await user.save();

      console.log(`   ✅ Status cleared to "Available"`);

      // Broadcast via WebSocket
      await this.broadcastStatusUpdate(user, null);

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

  /**
   * Broadcast status update via WebSocket
   */
  async broadcastStatusUpdate(user, profile) {
    try {
      const io = require('../socketManager').getIO();
      if (!io) {
        console.log(`   ⚠️ Socket.IO not available`);
        return;
      }

      const statusData = {
        userId: user.userId,
        status: user.status,
        customStatus: user.customStatus,
        subStatus: user.subStatus,
        statusUntil: user.statusUntil,
        location: user.currentLocation,
        timestamp: new Date(),
        wasAutoApplied: user.wasAutoApplied,
        primaryTime: profile ? {
          profileId: profile._id.toString(),
          profileName: profile.name,
          isActive: true
        } : null
      };

      // Broadcast to all connected clients
      io.emit('status:update', statusData);
      io.emit('status_update', statusData); // Legacy event
      io.emit('contact_status_update', statusData); // For HomeTab

      console.log(`   📡 Broadcasted status update via WebSocket`);

    } catch (error) {
      console.error(`   ❌ Socket broadcast error:`, error.message);
    }
  }

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

      // Get all unique user IDs with Primary Time profiles
      const userIds = await PrimaryTimeProfile.find().distinct('userId');

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
