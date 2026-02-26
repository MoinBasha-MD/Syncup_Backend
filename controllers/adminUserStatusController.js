const User = require('../models/userModel');
const StatusHistory = require('../models/statusHistoryModel');
const { broadcastStatusUpdate } = require('../socketManager');

/**
 * Get all users with their current status
 * @route GET /admin/api/users/all-with-status
 */
const getAllUsersWithStatus = async (req, res) => {
  try {
    console.log('📊 [ADMIN] Fetching all users with status...');
    
    const users = await User.find()
      .select('userId name phoneNumber email status customStatus statusUntil isOnline lastSeen createdAt mainStatus subStatus')
      .sort({ isOnline: -1, lastSeen: -1 })
      .lean();
    
    console.log(`✅ [ADMIN] Found ${users.length} users`);
    
    res.json({
      success: true,
      users: users,
      count: users.length
    });
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching users with status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message
    });
  }
};

/**
 * Update user status (admin override)
 * @route POST /admin/api/users/update-status
 */
const updateUserStatus = async (req, res) => {
  try {
    const { userId, status, customStatus, statusUntil } = req.body;
    
    console.log('🔧 [ADMIN] Updating user status:', {
      userId,
      status,
      customStatus,
      statusUntil
    });
    
    // Validate input
    if (!userId || !status) {
      return res.status(400).json({
        success: false,
        message: 'userId and status are required'
      });
    }
    
    // Find user
    const user = await User.findOne({ userId });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Update user status
    user.status = status;
    user.customStatus = customStatus || '';
    user.statusUntil = statusUntil || null;
    user.mainStatus = status;
    
    await user.save();
    
    console.log(`✅ [ADMIN] Updated status for user ${user.name} (${userId})`);
    
    // Save to status history
    try {
      await StatusHistory.create({
        userId: user._id,
        status: status,
        customStatus: customStatus || '',
        statusUntil: statusUntil || null,
        source: 'admin_panel',
        metadata: {
          adminUpdated: true,
          adminId: req.admin?._id || 'unknown'
        }
      });
    } catch (historyError) {
      console.error('⚠️ [ADMIN] Failed to save status history:', historyError);
    }
    
    // Broadcast status update to all connected clients
    const io = req.app.get('io');
    if (io) {
      console.log('📡 [ADMIN] Broadcasting status update via WebSocket...');
      
      // Broadcast to the user's contacts
      try {
        broadcastStatusUpdate(user, {
          status: status,
          customStatus: customStatus || '',
          statusUntil: statusUntil,
          mainStatus: status
        }, {
          visibility: 'all_contacts'
        });
      } catch (broadcastError) {
        console.error('⚠️ [ADMIN] Failed to broadcast status update:', broadcastError);
      }
      
      // Also emit to admin panel for real-time update
      io.emit('user:status_updated', {
        userId: user.userId,
        name: user.name,
        status: status,
        customStatus: customStatus || '',
        statusUntil: statusUntil,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen
      });
    }
    
    res.json({
      success: true,
      message: 'Status updated successfully',
      user: {
        userId: user.userId,
        name: user.name,
        status: user.status,
        customStatus: user.customStatus,
        statusUntil: user.statusUntil
      }
    });
    
  } catch (error) {
    console.error('❌ [ADMIN] Error updating user status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update status',
      error: error.message
    });
  }
};

/**
 * Get user status history
 * @route GET /admin/api/users/:userId/status-history
 */
const getUserStatusHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50 } = req.query;
    
    console.log(`📜 [ADMIN] Fetching status history for user: ${userId}`);
    
    const user = await User.findOne({ userId });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const history = await StatusHistory.find({ userId: user._id })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .lean();
    
    console.log(`✅ [ADMIN] Found ${history.length} status history entries`);
    
    res.json({
      success: true,
      history: history,
      count: history.length
    });
    
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching status history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch status history',
      error: error.message
    });
  }
};

/**
 * Get real-time status statistics
 * @route GET /admin/api/users/status-stats
 */
const getStatusStatistics = async (req, res) => {
  try {
    console.log('📊 [ADMIN] Fetching status statistics...');
    
    const [
      totalUsers,
      onlineUsers,
      availableUsers,
      busyUsers,
      awayUsers,
      offlineUsers
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isOnline: true }),
      User.countDocuments({ status: { $regex: /available/i } }),
      User.countDocuments({ status: { $regex: /busy/i } }),
      User.countDocuments({ status: { $regex: /away/i } }),
      User.countDocuments({ isOnline: false })
    ]);
    
    const stats = {
      totalUsers,
      onlineUsers,
      availableUsers,
      busyUsers,
      awayUsers,
      offlineUsers,
      timestamp: new Date()
    };
    
    console.log('✅ [ADMIN] Status statistics:', stats);
    
    res.json({
      success: true,
      stats: stats
    });
    
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching status statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: error.message
    });
  }
};

/**
 * Bulk update user statuses
 * @route POST /admin/api/users/bulk-update-status
 */
const bulkUpdateUserStatus = async (req, res) => {
  try {
    const { userIds, status, customStatus, statusUntil } = req.body;
    
    console.log('🔧 [ADMIN] Bulk updating user statuses:', {
      userCount: userIds?.length,
      status,
      customStatus
    });
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'userIds array is required'
      });
    }
    
    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'status is required'
      });
    }
    
    // Update all users
    const result = await User.updateMany(
      { userId: { $in: userIds } },
      {
        $set: {
          status: status,
          customStatus: customStatus || '',
          statusUntil: statusUntil || null,
          mainStatus: status
        }
      }
    );
    
    console.log(`✅ [ADMIN] Bulk updated ${result.modifiedCount} users`);
    
    // Broadcast updates
    const io = req.app.get('io');
    if (io) {
      const users = await User.find({ userId: { $in: userIds } });
      
      users.forEach(user => {
        try {
          broadcastStatusUpdate(user, {
            status: status,
            customStatus: customStatus || '',
            statusUntil: statusUntil,
            mainStatus: status
          }, {
            visibility: 'all_contacts'
          });
        } catch (error) {
          console.error('⚠️ [ADMIN] Failed to broadcast for user:', user.userId);
        }
        
        io.emit('user:status_updated', {
          userId: user.userId,
          name: user.name,
          status: status,
          customStatus: customStatus || '',
          statusUntil: statusUntil,
          isOnline: user.isOnline,
          lastSeen: user.lastSeen
        });
      });
    }
    
    res.json({
      success: true,
      message: `Successfully updated ${result.modifiedCount} users`,
      modifiedCount: result.modifiedCount
    });
    
  } catch (error) {
    console.error('❌ [ADMIN] Error bulk updating user statuses:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk update statuses',
      error: error.message
    });
  }
};

/**
 * Search users by status
 * @route GET /admin/api/users/search-by-status
 */
const searchUsersByStatus = async (req, res) => {
  try {
    const { status, isOnline, search } = req.query;
    
    console.log('🔍 [ADMIN] Searching users by status:', { status, isOnline, search });
    
    let query = {};
    
    if (status) {
      query.status = { $regex: status, $options: 'i' };
    }
    
    if (isOnline !== undefined) {
      query.isOnline = isOnline === 'true';
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { userId: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } }
      ];
    }
    
    const users = await User.find(query)
      .select('userId name phoneNumber status customStatus statusUntil isOnline lastSeen')
      .sort({ isOnline: -1, lastSeen: -1 })
      .limit(100)
      .lean();
    
    console.log(`✅ [ADMIN] Found ${users.length} users matching criteria`);
    
    res.json({
      success: true,
      users: users,
      count: users.length
    });
    
  } catch (error) {
    console.error('❌ [ADMIN] Error searching users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search users',
      error: error.message
    });
  }
};

module.exports = {
  getAllUsersWithStatus,
  updateUserStatus,
  getUserStatusHistory,
  getStatusStatistics,
  bulkUpdateUserStatus,
  searchUsersByStatus
};
