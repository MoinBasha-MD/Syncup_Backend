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
      
      // Get current time and day in IST (UTC+5:30)
      const now = new Date();
      // Convert to IST
      const istOffset = 5.5 * 60; // IST is UTC+5:30
      const istTime = new Date(now.getTime() + istOffset * 60 * 1000);
      const currentDay = istTime.getUTCDay(); // 0-6 (Sun-Sat)
      const currentMinutes = istTime.getUTCHours() * 60 + istTime.getUTCMinutes();
      
      console.log(`🔍 [AUTO-STATUS] Checking ${userId}`);
      console.log(`   📅 Current Day: ${currentDay} (0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat)`);
      console.log(`   🕐 Current Time IST: ${istTime.getUTCHours()}:${istTime.getUTCMinutes().toString().padStart(2, '0')} (${currentMinutes} minutes)`);
      console.log(`   🕐 Current Time UTC: ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`);
      console.log(`   📊 Found ${schedules.length} schedule(s)`);
      
      // Find matching schedule
      for (const schedule of schedules) {
        const daysOfWeek = schedule.recurrenceConfig?.daysOfWeek || [];
        
        console.log(`   🔍 Checking schedule: "${schedule.status}"`);
        console.log(`      Days: ${daysOfWeek.join(', ')}`);
        
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
        // IMPORTANT: Extract hours/minutes in LOCAL time (where user is)
        // The stored Date objects are in UTC, but we only care about the time portion
        const startDate = new Date(schedule.startTime);
        const endDate = new Date(schedule.endTime);
        
        // Use getUTCHours to get the actual stored hour value
        // This gives us the time as it was entered by the user
        let startMinutes = startDate.getUTCHours() * 60 + startDate.getUTCMinutes();
        let endMinutes = endDate.getUTCHours() * 60 + endDate.getUTCMinutes();
        
        console.log(`      ⏰ Schedule Time (stored): ${startDate.getUTCHours()}:${startDate.getUTCMinutes().toString().padStart(2, '0')} to ${endDate.getUTCHours()}:${endDate.getUTCMinutes().toString().padStart(2, '0')}`);
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
          
          if (user.status !== schedule.status) {
            const oldStatus = user.status;
            console.log(`      🔄 Status needs updating!`);
            
            // Update user status
            user.status = schedule.status;
            user.customStatus = schedule.customStatus || '';
            user.statusUpdatedAt = now;
            user.wasAutoApplied = true;
            await user.save();
            
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
                  timestamp: now,
                  wasAutoApplied: true
                });
                
                // Also emit specific event for this user's contacts
                io.emit('contact_status_update', {
                  userId: user.userId,
                  status: user.status,
                  customStatus: user.customStatus,
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
      
      // No schedule matches - check if user has an auto-applied status that needs to be cleared
      const user = await User.findOne({ userId });
      
      // Check if user has a status that looks like it's from a schedule
      const scheduleStatuses = schedules.map(s => s.status);
      const hasScheduleStatus = scheduleStatuses.includes(user?.status);
      
      console.log(`      📊 User status: "${user?.status}", wasAutoApplied: ${user?.wasAutoApplied}, isScheduleStatus: ${hasScheduleStatus}`);
      
      // Clear if: (1) wasAutoApplied is true, OR (2) status matches a schedule status
      if (user && user.status !== 'Available' && (user.wasAutoApplied || hasScheduleStatus)) {
        const oldStatus = user.status;
        console.log(`      🔄 Clearing expired auto-status: "${oldStatus}" → "Available"`);
        
        user.status = 'Available';
        user.customStatus = '';
        user.statusUpdatedAt = now;
        user.wasAutoApplied = false;
        await user.save();
        
        // Broadcast status change
        try {
          const io = require('../socketManager').getIO();
          if (io) {
            io.emit('status_update', {
              userId: user.userId,
              status: 'Available',
              customStatus: '',
              timestamp: now,
              wasAutoApplied: false
            });
            
            io.emit('contact_status_update', {
              userId: user.userId,
              status: 'Available',
              customStatus: '',
              timestamp: now,
              wasAutoApplied: false
            });
            
            console.log(`📡 [AUTO-STATUS] Broadcasted status cleared for ${userId}`);
          }
        } catch (socketError) {
          console.error(`❌ [AUTO-STATUS] Socket broadcast error:`, socketError.message);
        }
        
        return {
          userId,
          oldStatus,
          newStatus: 'Available',
          activity: 'Available',
          time: now
        };
      }
      
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
    
    // Run every 5 minutes: */5 * * * *
    // For testing, use every minute: * * * * *
    this.cronJob = cron.schedule('*/5 * * * *', async () => {
      await this.checkAllUsers();
    });
    
    this.isRunning = true;
    console.log('✅ [AUTO-STATUS] Cron job started (runs every 5 minutes)');
    console.log('📅 [AUTO-STATUS] Schedule: */5 * * * * (every 5 minutes)');
    
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
      schedule: '*/5 * * * * (every 5 minutes)'
    };
  }
}

module.exports = new AutoStatusService();
