const User = require('../models/userModel');
const Message = require('../models/Message');
const Post = require('../models/postModel');
const Story = require('../models/storyModel');
const StatusHistory = require('../models/statusHistoryModel');

/**
 * Enhanced Analytics Dashboard
 */
const showAnalytics = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    // User growth data
    const userGrowth = await User.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Message volume data
    const messageVolume = await Message.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Active users timeline
    const activeUsers = await StatusHistory.aggregate([
      { $match: { startTime: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$startTime' } },
          uniqueUsers: { $addToSet: '$user' }
        }
      },
      {
        $project: {
          _id: 1,
          count: { $size: '$uniqueUsers' }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Status distribution
    const statusDistribution = await User.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Top active users
    const topUsers = await Message.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: '$senderId',
          messageCount: { $sum: 1 }
        }
      },
      { $sort: { messageCount: -1 } },
      { $limit: 10 }
    ]);
    
    // Get user details for top users
    const userIds = topUsers.map(u => u._id);
    const users = await User.find({ userId: { $in: userIds } })
      .select('userId name phoneNumber')
      .lean();
    
    const userMap = {};
    users.forEach(u => { userMap[u.userId] = u; });
    
    const topUsersWithDetails = topUsers.map(u => ({
      ...u,
      user: userMap[u._id]
    }));
    
    // Summary stats
    const [totalUsers, totalMessages, totalPosts, totalStories] = await Promise.all([
      User.countDocuments(),
      Message.countDocuments(),
      Post.countDocuments(),
      Story.countDocuments()
    ]);
    
    res.render('admin/analytics/index', {
      title: 'Analytics & Reports',
      layout: 'admin/layouts/main',
      userGrowth,
      messageVolume,
      activeUsers,
      statusDistribution,
      topUsers: topUsersWithDetails,
      totalUsers,
      totalMessages,
      totalPosts,
      totalStories,
      days
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).send('Error loading analytics');
  }
};

/**
 * Export analytics data
 */
const exportAnalytics = async (req, res) => {
  try {
    const format = req.query.format || 'json';
    const days = parseInt(req.query.days) || 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const data = {
      totalUsers: await User.countDocuments(),
      totalMessages: await Message.countDocuments(),
      newUsers: await User.countDocuments({ createdAt: { $gte: startDate } }),
      newMessages: await Message.countDocuments({ createdAt: { $gte: startDate } })
    };
    
    if (format === 'json') {
      res.json({ success: true, data });
    } else {
      // CSV format
      const csv = `Metric,Value\nTotal Users,${data.totalUsers}\nTotal Messages,${data.totalMessages}\nNew Users (${days}d),${data.newUsers}\nNew Messages (${days}d),${data.newMessages}`;
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=analytics.csv');
      res.send(csv);
    }
  } catch (error) {
    console.error('Export analytics error:', error);
    res.status(500).json({ success: false, message: 'Error exporting data' });
  }
};

module.exports = {
  showAnalytics,
  exportAnalytics
};
