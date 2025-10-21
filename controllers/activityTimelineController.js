const User = require('../models/userModel');
const Post = require('../models/postModel');
const Message = require('../models/Message');
const GroupModel = require('../models/groupModel');

/**
 * Show activity timeline
 */
const showActivityTimeline = async (req, res) => {
  try {
    const limit = 50;
    
    // Get recent activities from different sources
    const [recentUsers, recentPosts, recentGroups] = await Promise.all([
      User.find()
        .sort({ createdAt: -1 })
        .limit(20)
        .select('name phoneNumber createdAt')
        .lean(),
      
      Post.find()
        .sort({ createdAt: -1 })
        .limit(20)
        .populate('userId', 'name')
        .select('content userId createdAt')
        .lean(),
      
      GroupModel.find()
        .sort({ createdAt: -1 })
        .limit(20)
        .populate('createdBy', 'name')
        .select('name createdBy createdAt')
        .lean()
    ]);
    
    // Combine and format activities
    const activities = [];
    
    // Add user registrations
    recentUsers.forEach(user => {
      activities.push({
        type: 'user_registered',
        icon: 'fa-user-plus',
        color: '#4F46E5',
        title: 'New User Registered',
        description: `${user.name} joined the platform`,
        user: user.name,
        time: user.createdAt
      });
    });
    
    // Add posts
    recentPosts.forEach(post => {
      activities.push({
        type: 'post_created',
        icon: 'fa-file-alt',
        color: '#EC4899',
        title: 'New Post Created',
        description: post.content ? post.content.substring(0, 100) + '...' : 'No content',
        user: post.userId ? post.userId.name : 'Unknown',
        time: post.createdAt
      });
    });
    
    // Add groups
    recentGroups.forEach(group => {
      activities.push({
        type: 'group_created',
        icon: 'fa-layer-group',
        color: '#14B8A6',
        title: 'New Group Created',
        description: `Group "${group.name}" was created`,
        user: group.createdBy ? group.createdBy.name : 'Unknown',
        time: group.createdAt
      });
    });
    
    // Sort by time (most recent first)
    activities.sort((a, b) => new Date(b.time) - new Date(a.time));
    
    // Limit to 50 activities
    const timeline = activities.slice(0, limit);
    
    res.render('admin/activity/index', {
      title: 'Activity Timeline',
      layout: 'admin/layouts/main',
      activities: timeline
    });
  } catch (error) {
    console.error('Activity timeline error:', error);
    res.status(500).send('Error loading activity timeline');
  }
};

/**
 * Get activity feed (API endpoint for real-time updates)
 */
const getActivityFeed = async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 60000); // Last 1 minute
    
    const [newUsers, newPosts] = await Promise.all([
      User.countDocuments({ createdAt: { $gte: since } }),
      Post.countDocuments({ createdAt: { $gte: since } })
    ]);
    
    res.json({
      success: true,
      activities: {
        newUsers,
        newPosts,
        total: newUsers + newPosts
      }
    });
  } catch (error) {
    console.error('Activity feed error:', error);
    res.status(500).json({ success: false, message: 'Error loading feed' });
  }
};

module.exports = {
  showActivityTimeline,
  getActivityFeed
};
