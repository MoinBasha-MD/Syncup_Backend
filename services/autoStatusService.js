const StatusSchedule = require('../models/statusScheduleModel');
const User = require('../models/userModel');
const cron = require('node-cron');

/**
 * Auto Status Service
 * Automatically applies scheduled statuses based on daily schedule
 */
class AutoStatusService {
  constructor() {
    this.cronJob = null;
    this.isRunning = false;
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
      
      // Get current time and day
      const now = new Date();
      const currentDay = now.getDay(); // 0-6 (Sun-Sat)
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      
      console.log(`🔍 [AUTO-STATUS] Checking ${userId}`);
      console.log(`   📅 Current Day: ${currentDay} (0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat)`);
      console.log(`   🕐 Current Time: ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')} (${currentMinutes} minutes)`);
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
        
        // Get schedule time range
        const startDate = new Date(schedule.startTime);
        const endDate = new Date(schedule.endTime);
        
        let startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
        let endMinutes = endDate.getHours() * 60 + endDate.getMinutes();
        
        console.log(`      ⏰ Schedule Time: ${startDate.getHours()}:${startDate.getMinutes().toString().padStart(2, '0')} to ${endDate.getHours()}:${endDate.getMinutes().toString().padStart(2, '0')}`);
        console.log(`      ⏰ Minutes: ${startMinutes} to ${endMinutes}`);
        
        // Handle cross-midnight
        let isInRange = false;
        if (endMinutes < startMinutes) {
          // Cross-midnight case (e.g., 11 PM to 5 AM)
          isInRange = currentMinutes >= startMinutes || currentMinutes < endMinutes;
          console.log(`      🌙 Cross-midnight schedule`);
        } else {
          // Same-day case (e.g., 9 AM to 6 PM)
          isInRange = currentMinutes >= startMinutes && currentMinutes < endMinutes;
          console.log(`      ☀️ Same-day schedule`);
        }
        
        console.log(`      ${isInRange ? '✅' : '❌'} Current time ${isInRange ? 'IS' : 'is NOT'} in range`);
        
        if (isInRange) {
          // Get user
          const user = await User.findOne({ userId });
          if (!user) {
            console.log(`❌ [AUTO-STATUS] User ${userId} not found`);
            return null;
          }
          
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
            const oldSubStatus = user.subStatus;
            console.log(`      🔄 Status needs updating!`);
            
            // ✅ FIX BUG #2: Preserve sub-status during auto-status change
            // Only update main status, keep sub-status intact
            console.log(`      📌 Preserving sub-status: "${oldSubStatus || 'none'}"`);
            
            // Update user status
            user.status = schedule.status;
            user.customStatus = schedule.customStatus || '';
            user.statusUpdatedAt = now;
            user.wasAutoApplied = true;
            // Note: user.subStatus is NOT modified - it's preserved!
            await user.save();
            
            if (oldSubStatus) {
              console.log(`      ✅ Sub-status "${oldSubStatus}" preserved after main status change`);
            }
            
            console.log(`✅ [AUTO-STATUS] Updated ${userId}: "${oldStatus}" → "${schedule.status}"`);
            
            // Broadcast to friends via socket
            try {
              const io = require('../socketManager').getIO();
              if (io) {
                // Broadcast to all connected clients
                io.emit('status_update', {
                  userId: user.userId,
                  status: user.status,
                  customStatus: user.customStatus,
                  subStatus: user.subStatus, // ✅ Include sub-status
                  timestamp: now,
                  wasAutoApplied: true
                });
                
                // Also emit specific event for this user's contacts
                io.emit('contact_status_update', {
                  userId: user.userId,
                  status: user.status,
                  customStatus: user.customStatus,
                  subStatus: user.subStatus, // ✅ Include sub-status
                  timestamp: now,
                  wasAutoApplied: true
                });
                
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
      
      // Check each user
      const results = await Promise.all(
        userIds.map(userId => this.checkAndUpdateUserStatus(userId))
      );
      
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
