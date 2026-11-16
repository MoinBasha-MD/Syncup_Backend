const StatusSchedule = require('../models/statusScheduleModel');
const PrimaryTimeProfile = require('../models/PrimaryTimeProfile');
const User = require('../models/userModel');
const cron = require('node-cron');
const { activeScheduleWindow, minutesOfDayInTimezone } = require('../utils/scheduleWindow');
const { localDate } = require('../utils/primaryTimeClock');
const saveStatusIfUnchanged = require('./statusCompareAndSet');

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/**
 * Resolve the timezone a user's schedule windows should be evaluated in:
 * their most recent Primary Time profile's timezone, else a timezone field on
 * the user doc when present, else the app's default.
 */
const resolveUserTimezone = async (user) => {
  try {
    const profile = await PrimaryTimeProfile.findOne({ userId: user._id })
      .sort({ updatedAt: -1 })
      .select('timezone')
      .lean();
    if (profile?.timezone) return profile.timezone;
  } catch (error) {
    console.error('⚠️ [AUTO-STATUS] Timezone lookup failed, using default:', error.message);
  }
  return user.timezone || DEFAULT_TIMEZONE;
};

/**
 * Auto Status Service
 * Automatically applies scheduled statuses based on daily schedule
 */
class AutoStatusService {
  constructor() {
    this.cronJob = null;
    this.isRunning = false;
    this.isProcessing = false;
  }

  /**
   * Check and update status for a single user
   */
  async checkAndUpdateUserStatus(userId) {
    try {
      // Get user's daily schedule
      const schedules = await StatusSchedule.find({
        userId,
        tags: 'daily_schedule',
        active: true
      }).sort({ priority: 1 });
      
      if (schedules.length === 0) {
        return null;
      }

      // Fetch the user up front — we need their timezone to evaluate windows.
      const user = await User.findOne({ userId });
      if (!user) {
        console.log(`❌ [AUTO-STATUS] User ${userId} not found`);
        return null;
      }
      const timezone = await resolveUserTimezone(user);

      // Get current time and day IN THE USER'S TIMEZONE (not server-local)
      const now = new Date();
      const localNow = localDate({ timezone }, now);
      const currentDay = localNow.getUTCDay(); // 0-6 (Sun-Sat)
      const currentMinutes = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();

      console.log(`🔍 [AUTO-STATUS] Checking ${userId}`);
      console.log(`   🌍 Timezone: ${timezone}`);
      console.log(`   📅 Current Day: ${currentDay} (0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat)`);
      console.log(`   🕐 Current Time: ${localNow.getUTCHours()}:${localNow.getUTCMinutes().toString().padStart(2, '0')} (${currentMinutes} minutes)`);
      console.log(`   📊 Found ${schedules.length} schedule(s)`);
      
      // Find matching schedule
      for (const schedule of schedules) {
        const daysOfWeek = schedule.recurrenceConfig?.daysOfWeek || [];
        
        console.log(`   🔍 Checking schedule: "${schedule.status}"`);
        console.log(`      Days: ${daysOfWeek.join(', ')}`);
        
        // ✅ FIX BUG #7: Check if schedule is paused
        if (schedule.pausedUntil && new Date(schedule.pausedUntil) > now) {
          const pausedUntilDate = new Date(schedule.pausedUntil);
          const hoursRemaining = Math.round((pausedUntilDate.getTime() - now.getTime()) / (1000 * 60 * 60));
          console.log(`      ⏸️ Schedule paused until ${pausedUntilDate.toLocaleString()}`);
          console.log(`      ⏰ Resumes in ${hoursRemaining} hours`);
          console.log(`      📝 Reason: ${schedule.pauseReason || 'manual'}`);
          continue;
        }
        
        // Check if schedule has "start from tomorrow" flag
        if (schedule.metadata?.startFromTomorrow) {
          const createdDate = new Date(schedule.createdAt);
          const createdDay = createdDate.toDateString();
          const todayDay = now.toDateString();
          
          if (createdDay === todayDay) {
            console.log(`      ⏸️ Schedule set to start from tomorrow - skipping today`);
            continue;
          }
        }
        
        // Check if today is in the schedule
        if (!daysOfWeek.includes(currentDay)) {
          console.log(`      ❌ Today (${currentDay}) not in schedule days`);
          continue;
        }
        
        console.log(`      ✅ Today IS in schedule days`);

        // Evaluate the window in the user's timezone — returns the window's
        // end instant when `now` is inside it, else null.
        const startMinutes = minutesOfDayInTimezone(schedule.startTime, timezone);
        const endMinutes = minutesOfDayInTimezone(schedule.endTime, timezone);
        const window = activeScheduleWindow(schedule, timezone, now);

        console.log(`      ⏰ Schedule Time: ${Math.floor(startMinutes / 60)}:${String(startMinutes % 60).padStart(2, '0')} to ${Math.floor(endMinutes / 60)}:${String(endMinutes % 60).padStart(2, '0')} (${timezone})`);
        if (endMinutes < startMinutes) {
          console.log(`      🌙 Cross-midnight schedule`);
        } else {
          console.log(`      ☀️ Same-day schedule`);
        }

        console.log(`      ${window ? '✅' : '❌'} Current time ${window ? 'IS' : 'is NOT'} in range`);

        if (window) {
          // Check if status needs updating
          console.log(`      👤 Current user status: "${user.status}"`);
          console.log(`      🎯 Target status: "${schedule.status}"`);
          
          // ✅ FIX BUG #1: Check if user has active manual status
          const hasActiveManualStatus = user.statusUntil && 
            new Date(user.statusUntil) > now && 
            user.wasAutoApplied === false;
          
          if (hasActiveManualStatus) {
            const manualStatusExpiry = new Date(user.statusUntil);
            console.log(`⏸️ [AUTO-STATUS] User has active manual status until ${manualStatusExpiry.toLocaleString()}, skipping auto-apply`);
            console.log(`      Manual status: "${user.status}" (set by user)`);
            console.log(`      Would apply: "${schedule.status}" (from daily schedule)`);
            console.log(`      ⏰ Manual status expires in ${Math.round((manualStatusExpiry.getTime() - now.getTime()) / 60000)} minutes`);
            return null;
          }
          
          if (user.status !== schedule.status) {
            const oldStatus = user.status;
            console.log(`      🔄 Status needs updating!`);

            // Write the hierarchical status fields too (same shape the
            // primary-time scheduler writes) and clear any sub-status —
            // the schedule defines the user's whole status for the window.
            user.status = schedule.status;
            user.customStatus = schedule.customStatus || '';
            user.statusUpdatedAt = now;
            user.wasAutoApplied = true;
            user.mainStatus = schedule.status;
            user.mainStartTime = now;
            user.mainEndTime = window.endAt;
            user.statusUntil = window.endAt;
            user.subStatus = null;
            user.subDuration = 0;
            user.subDurationLabel = '';
            user.subStartTime = null;
            user.subEndTime = null;

            // Compare-and-set save so a concurrent manual write wins.
            const saved = await saveStatusIfUnchanged(user, {}, now);
            if (!saved) {
              console.log(`⏸️ [AUTO-STATUS] ${userId} changed concurrently — skipping auto-apply`);
              return null;
            }

            console.log(`✅ [AUTO-STATUS] Updated ${userId}: "${oldStatus}" → "${schedule.status}" (until ${window.endAt.toISOString()})`);

            // Broadcast to friends via socket
            try {
              const io = require('../socketManager').getIO();
              if (io) {
                const payload = {
                  userId: user.userId,
                  status: user.status,
                  customStatus: user.customStatus,
                  mainStatus: user.mainStatus,
                  mainStartTime: user.mainStartTime,
                  mainEndTime: user.mainEndTime,
                  statusUntil: user.statusUntil,
                  subStatus: null,
                  timestamp: now,
                  wasAutoApplied: true
                };
                // Broadcast to all connected clients
                io.emit('status_update', payload);

                // Also emit specific event for this user's contacts
                io.emit('contact_status_update', payload);

                console.log(`📡 [AUTO-STATUS] Broadcasted status update for ${userId}`);
              }
            } catch (socketError) {
              console.error(`❌ [AUTO-STATUS] Socket broadcast error:`, socketError.message);
            }

            return {
              userId,
              oldStatus,
              newStatus: schedule.status,
              activity: schedule.status,
              time: now
            };
          } else {
            console.log(`ℹ️ [AUTO-STATUS] ${userId} already has status "${schedule.status}"`);
          }
          
          // Found matching schedule, no need to check others
          return null;
        }
      }
      
      console.log(`ℹ️ [AUTO-STATUS] No matching schedule for ${userId} at current time`);
      return null;
    } catch (error) {
      console.error(`❌ [AUTO-STATUS] Error checking ${userId}:`, error.message);
      return null;
    }
  }
  
  /**
   * Check all users with daily schedules
   */
  async checkAllUsers() {
    // cron fires every minute regardless; overlapping sweeps stack heap until OOM
    if (this.isProcessing) {
      console.log('⚠️ [AUTO-STATUS] Previous run still active, skipping this tick');
      return [];
    }
    this.isProcessing = true;
    try {
      const startTime = Date.now();
      console.log('\n⏰ [AUTO-STATUS] ========== CRON JOB STARTED ==========');
      console.log(`🕐 [AUTO-STATUS] Time: ${new Date().toLocaleString()}`);
      
      // Get all unique user IDs with daily schedules
      const userIds = await StatusSchedule.find({
        tags: 'daily_schedule',
        active: true
      }).distinct('userId');
      
      console.log(`📊 [AUTO-STATUS] Found ${userIds.length} users with daily schedules`);
      
      if (userIds.length === 0) {
        console.log('ℹ️ [AUTO-STATUS] No users with daily schedules');
        console.log('⏰ [AUTO-STATUS] ========== CRON JOB COMPLETED ==========\n');
        return [];
      }
      
      // Check each user in batches: one Promise.all over every user (3 queries
      // each) spikes the heap on large accounts
      const results = [];
      for (let i = 0; i < userIds.length; i += 20) {
        results.push(...await Promise.all(
          userIds.slice(i, i + 20).map(userId => this.checkAndUpdateUserStatus(userId))
        ));
      }
      
      const updated = results.filter(r => r !== null);
      const duration = Date.now() - startTime;
      
      console.log(`\n📈 [AUTO-STATUS] Summary:`);
      console.log(`   • Total users checked: ${userIds.length}`);
      console.log(`   • Statuses updated: ${updated.length}`);
      console.log(`   • Duration: ${duration}ms`);
      
      if (updated.length > 0) {
        console.log(`\n✅ [AUTO-STATUS] Updated statuses:`);
        updated.forEach((u, i) => {
          console.log(`   ${i + 1}. ${u.userId}: "${u.oldStatus}" → "${u.newStatus}"`);
        });
      }
      
      console.log('⏰ [AUTO-STATUS] ========== CRON JOB COMPLETED ==========\n');
      
      return updated;
    } catch (error) {
      console.error('❌ [AUTO-STATUS] Error in checkAllUsers:', error);
      return [];
    } finally {
      this.isProcessing = false;
    }
  }
  
  /**
   * Start cron job (runs every 5 minutes)
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ [AUTO-STATUS] Cron job already running');
      return;
    }
    
    // ✅ FIX BUG #4: Run every 1 minute for faster response
    // Changed from */5 (every 5 minutes) to * (every 1 minute)
    this.cronJob = cron.schedule('* * * * *', async () => {
      await this.checkAllUsers();
    });
    
    this.isRunning = true;
    console.log('✅ [AUTO-STATUS] Cron job started (runs every 1 minute)');
    console.log('📅 [AUTO-STATUS] Schedule: * * * * * (every 1 minute)');
    
    // Run immediately on startup
    console.log('🚀 [AUTO-STATUS] Running initial check...');
    setTimeout(() => {
      this.checkAllUsers();
    }, 5000); // Wait 5 seconds after server start
  }
  
  /**
   * Stop cron job
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.isRunning = false;
      console.log('🛑 [AUTO-STATUS] Cron job stopped');
    }
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
}

module.exports = new AutoStatusService();
