const Admin = require('../models/adminModel');
const User = require('../models/userModel');

/**
 * Show security dashboard
 */
const showSecurityDashboard = async (req, res) => {
  try {
    // Get recent admin logins
    const recentLogins = await Admin.find()
      .select('username email lastLogin loginAttempts')
      .sort({ lastLogin: -1 })
      .limit(20)
      .lean();
    
    // Get locked accounts
    const lockedAccounts = await Admin.find({ lockUntil: { $gt: Date.now() } })
      .select('username email lockUntil loginAttempts')
      .lean();
    
    // Get inactive admins
    const inactiveAdmins = await Admin.find({ isActive: false })
      .select('username email')
      .lean();
    
    // Security stats
    const totalAdmins = await Admin.countDocuments();
    const activeAdmins = await Admin.countDocuments({ isActive: true });
    
    res.render('admin/security/index', {
      title: 'Security & Logs',
      layout: 'admin/layouts/main',
      recentLogins,
      lockedAccounts,
      inactiveAdmins,
      totalAdmins,
      activeAdmins
    });
  } catch (error) {
    console.error('Security dashboard error:', error);
    res.status(500).send('Error loading security dashboard');
  }
};

/**
 * Get activity logs
 */
const getActivityLogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const skip = (page - 1) * limit;
    
    // This would require a separate ActivityLog model
    // For now, return admin login history
    const logs = await Admin.find()
      .select('username email lastLogin')
      .sort({ lastLogin: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    res.json({ success: true, logs });
  } catch (error) {
    console.error('Activity logs error:', error);
    res.status(500).json({ success: false, message: 'Error loading logs' });
  }
};

/**
 * Unlock admin account
 */
const unlockAccount = async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id);
    
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }
    
    admin.loginAttempts = 0;
    admin.lockUntil = undefined;
    await admin.save();
    
    res.json({ success: true, message: 'Account unlocked successfully' });
  } catch (error) {
    console.error('Unlock account error:', error);
    res.status(500).json({ success: false, message: 'Error unlocking account' });
  }
};

/**
 * Reset login attempts
 */
const resetLoginAttempts = async (req, res) => {
  try {
    await Admin.updateMany({}, { $set: { loginAttempts: 0, lockUntil: undefined } });
    
    res.json({ success: true, message: 'All login attempts reset' });
  } catch (error) {
    console.error('Reset login attempts error:', error);
    res.status(500).json({ success: false, message: 'Error resetting attempts' });
  }
};

module.exports = {
  showSecurityDashboard,
  getActivityLogs,
  unlockAccount,
  resetLoginAttempts
};
