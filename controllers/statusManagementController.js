const StatusHistory = require('../models/statusHistoryModel');
const StatusSchedule = require('../models/statusScheduleModel');
const User = require('../models/userModel');

/**
 * Show status management page
 */
const showStatusManagement = async (req, res) => {
  try {
    const [totalStatuses, activeStatuses, scheduledStatuses, recentStatuses] = await Promise.all([
      StatusHistory.countDocuments(),
      StatusHistory.countDocuments({ endTime: null }),
      StatusSchedule.countDocuments({ isActive: true }),
      StatusHistory.find()
        .populate('user', 'name phoneNumber')
        .sort({ startTime: -1 })
        .limit(50)
        .lean()
    ]);
    
    const schedules = await StatusSchedule.find()
      .populate('user', 'name phoneNumber')
      .sort({ scheduledTime: -1 })
      .limit(20)
      .lean();
    
    res.render('admin/status/index', {
      title: 'Status Management',
      layout: 'admin/layouts/main',
      totalStatuses,
      activeStatuses,
      scheduledStatuses,
      recentStatuses,
      schedules
    });
  } catch (error) {
    console.error('Status management error:', error);
    res.status(500).send('Error loading status management');
  }
};

/**
 * Delete status history
 */
const deleteStatusHistory = async (req, res) => {
  try {
    await StatusHistory.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Status history deleted' });
  } catch (error) {
    console.error('Delete status error:', error);
    res.status(500).json({ success: false, message: 'Error deleting status' });
  }
};

/**
 * Delete scheduled status
 */
const deleteScheduledStatus = async (req, res) => {
  try {
    await StatusSchedule.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Scheduled status deleted' });
  } catch (error) {
    console.error('Delete scheduled status error:', error);
    res.status(500).json({ success: false, message: 'Error deleting scheduled status' });
  }
};

/**
 * Clear old status history
 */
const clearOldStatuses = async (req, res) => {
  try {
    const daysAgo = parseInt(req.body.days) || 30;
    const cutoffDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    
    const result = await StatusHistory.deleteMany({ startTime: { $lt: cutoffDate } });
    
    res.json({ 
      success: true, 
      message: `Deleted ${result.deletedCount} old status records`,
      count: result.deletedCount
    });
  } catch (error) {
    console.error('Clear old statuses error:', error);
    res.status(500).json({ success: false, message: 'Error clearing old statuses' });
  }
};

module.exports = {
  showStatusManagement,
  deleteStatusHistory,
  deleteScheduledStatus,
  clearOldStatuses
};
