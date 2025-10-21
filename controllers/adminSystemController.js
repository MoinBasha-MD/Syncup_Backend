const User = require('../models/userModel');
const Message = require('../models/Message');
const StatusHistory = require('../models/statusHistoryModel');
const StatusSchedule = require('../models/statusScheduleModel');
const AIInstance = require('../models/aiInstanceModel');
const os = require('os');

/**
 * System Monitoring Dashboard
 */
const showSystemMonitoring = async (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Server Status
    const uptime = process.uptime();
    const uptimeDays = Math.floor(uptime / 86400);
    const uptimeHours = Math.floor((uptime % 86400) / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    
    // Memory Usage
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsagePercent = ((usedMemory / totalMemory) * 100).toFixed(2);
    
    // CPU Info
    const cpus = os.cpus();
    const cpuModel = cpus[0].model;
    const cpuCores = cpus.length;
    
    // Status Broadcasting Stats
    const [
      totalStatusChanges,
      statusChangesToday,
      activeStatuses,
      scheduledStatuses,
      totalUsers,
      activeUsers,
      connectedUsers,
      totalMessages,
      messagesToday,
      totalAI,
      activeAI
    ] = await Promise.all([
      StatusHistory.countDocuments(),
      StatusHistory.countDocuments({ startTime: { $gte: today } }),
      StatusHistory.countDocuments({ endTime: null }),
      StatusSchedule.countDocuments({ isActive: true }),
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ 
        lastSeen: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Last 5 minutes
      }),
      Message.countDocuments(),
      Message.countDocuments({ createdAt: { $gte: today } }),
      AIInstance.countDocuments(),
      AIInstance.countDocuments({ isActive: true })
    ]);
    
    // Recent Status Changes
    const recentStatusChanges = await StatusHistory.find()
      .populate('user', 'name phoneNumber')
      .sort({ startTime: -1 })
      .limit(10)
      .lean();
    
    // System Health
    const systemHealth = {
      database: 'Connected',
      memory: memoryUsagePercent < 80 ? 'Healthy' : 'Warning',
      uptime: 'Running',
      status: 'Operational'
    };
    
    res.render('admin/system-monitoring', {
      title: 'System Monitoring',
      layout: 'admin/layouts/main',
      server: {
        uptime: { days: uptimeDays, hours: uptimeHours, minutes: uptimeMinutes },
        memory: {
          total: (totalMemory / 1024 / 1024 / 1024).toFixed(2),
          used: (usedMemory / 1024 / 1024 / 1024).toFixed(2),
          free: (freeMemory / 1024 / 1024 / 1024).toFixed(2),
          usagePercent: memoryUsagePercent
        },
        cpu: { model: cpuModel, cores: cpuCores },
        nodeVersion: process.version,
        platform: os.platform(),
        arch: os.arch()
      },
      stats: {
        totalStatusChanges,
        statusChangesToday,
        activeStatuses,
        scheduledStatuses,
        totalUsers,
        activeUsers,
        connectedUsers,
        totalMessages,
        messagesToday,
        totalAI,
        activeAI
      },
      recentStatusChanges,
      systemHealth
    });
    
  } catch (error) {
    console.error('System monitoring error:', error);
    res.status(500).send('Error loading system monitoring');
  }
};

module.exports = {
  showSystemMonitoring
};
