const express = require('express');
const router = express.Router();
const User = require('../models/userModel');
const Message = require('../models/Message');
const Post = require('../models/postModel');

// Get dashboard stats
router.get('/dashboard/stats', async (req, res) => {
  try {
    console.log('📊 [ADMIN] Fetching dashboard stats...');
    
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
    
    const [
      totalUsers,
      onlineUsers,
      totalMessages,
      totalPosts,
      todayUsers,
      todayMessages,
      todayPosts
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isOnline: true }),
      Message.countDocuments(),
      Post.countDocuments(),
      User.countDocuments({ createdAt: { $gte: startOfToday } }),
      Message.countDocuments({ timestamp: { $gte: startOfToday } }),
      Post.countDocuments({ createdAt: { $gte: startOfToday } })
    ]);

    // Calculate storage (example - adjust based on your storage tracking)
    const storageUsed = '0 GB'; // TODO: Implement storage calculation

    const stats = {
      totalUsers,
      activeUsers: onlineUsers,
      onlineUsers,
      totalMessages,
      totalPosts,
      totalUploads: 0, // TODO: Implement upload tracking
      storageUsed,
      todayRegistrations: todayUsers,
      todayMessages,
      todayPosts
    };

    console.log('✅ [ADMIN] Dashboard stats:', stats);
    res.json(stats);
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// Get online users
router.get('/analytics/online-users', async (req, res) => {
  try {
    console.log('👥 [ADMIN] Fetching online users...');
    
    const onlineUsers = await User.find({ isOnline: true })
      .select('userId name profileImage lastSeen')
      .limit(100)
      .lean();
    
    console.log(`✅ [ADMIN] Found ${onlineUsers.length} online users`);
    res.json({ users: onlineUsers, count: onlineUsers.length });
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching online users:', error);
    res.status(500).json({ error: 'Failed to fetch online users' });
  }
});

// Get upload stats
router.get('/analytics/upload-stats', async (req, res) => {
  try {
    console.log('📁 [ADMIN] Fetching upload stats...');
    
    // TODO: Implement based on your file upload tracking
    const stats = {
      totalUploads: 0,
      todayUploads: 0,
      storageUsed: '0 GB',
      uploadsByType: {
        images: 0,
        videos: 0,
        documents: 0,
        audio: 0
      }
    };
    
    res.json(stats);
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching upload stats:', error);
    res.status(500).json({ error: 'Failed to fetch upload stats' });
  }
});

// Get users list with pagination and search
router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    console.log(`👥 [ADMIN] Fetching users - page: ${page}, limit: ${limit}, search: "${search}"`);

    let filter = {};
    if (search) {
      filter = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phoneNumber: { $regex: search, $options: 'i' } },
          { userId: { $regex: search, $options: 'i' } }
        ]
      };
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('userId name email phoneNumber profileImage isOnline lastSeen createdAt isBanned')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ]);

    console.log(`✅ [ADMIN] Found ${users.length} users (${total} total)`);

    res.json({
      users,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get single user details
router.get('/users/:id', async (req, res) => {
  try {
    console.log(`👤 [ADMIN] Fetching user details: ${req.params.id}`);
    
    const user = await User.findById(req.params.id).lean();
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`✅ [ADMIN] User found: ${user.name}`);
    res.json(user);
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Update user
router.put('/users/:id', async (req, res) => {
  try {
    console.log(`✏️ [ADMIN] Updating user: ${req.params.id}`);
    
    const { _id, ...updateData } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`✅ [ADMIN] User updated: ${user.name}`);
    res.json(user);
  } catch (error) {
    console.error('❌ [ADMIN] Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Ban user
router.post('/users/:id/ban', async (req, res) => {
  try {
    const { reason } = req.body;
    console.log(`🚫 [ADMIN] Banning user: ${req.params.id}, reason: ${reason}`);
    
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { 
        isBanned: true,
        banReason: reason,
        bannedAt: new Date(),
        bannedBy: req.admin?.userId || 'admin'
      },
      { new: true }
    ).lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`✅ [ADMIN] User banned: ${user.name}`);
    res.json({ success: true, user });
  } catch (error) {
    console.error('❌ [ADMIN] Error banning user:', error);
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

// Unban user
router.post('/users/:id/unban', async (req, res) => {
  try {
    console.log(`✅ [ADMIN] Unbanning user: ${req.params.id}`);
    
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { 
        isBanned: false,
        banReason: null,
        bannedAt: null,
        bannedBy: null
      },
      { new: true }
    ).lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`✅ [ADMIN] User unbanned: ${user.name}`);
    res.json({ success: true, user });
  } catch (error) {
    console.error('❌ [ADMIN] Error unbanning user:', error);
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

// Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    console.log(`🗑️ [ADMIN] Deleting user: ${req.params.id}`);
    
    const user = await User.findByIdAndDelete(req.params.id).lean();
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`✅ [ADMIN] User deleted: ${user.name}`);
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('❌ [ADMIN] Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Get posts list
router.get('/posts', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    console.log(`📝 [ADMIN] Fetching posts - page: ${page}, limit: ${limit}`);

    const [posts, total] = await Promise.all([
      Post.find()
        .populate('userId', 'name profileImage')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Post.countDocuments()
    ]);

    console.log(`✅ [ADMIN] Found ${posts.length} posts (${total} total)`);

    res.json({
      posts,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching posts:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// Delete post
router.delete('/posts/:id', async (req, res) => {
  try {
    console.log(`🗑️ [ADMIN] Deleting post: ${req.params.id}`);
    
    const post = await Post.findByIdAndDelete(req.params.id).lean();
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    console.log(`✅ [ADMIN] Post deleted`);
    res.json({ success: true, message: 'Post deleted successfully' });
  } catch (error) {
    console.error('❌ [ADMIN] Error deleting post:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// Get messages list
router.get('/messages', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    console.log(`💬 [ADMIN] Fetching messages - page: ${page}, limit: ${limit}`);

    const [messages, total] = await Promise.all([
      Message.find()
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Message.countDocuments()
    ]);

    console.log(`✅ [ADMIN] Found ${messages.length} messages (${total} total)`);

    res.json({
      messages,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// User growth analytics
router.get('/analytics/user-growth', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    console.log(`📈 [ADMIN] Fetching user growth for ${days} days`);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const users = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    console.log(`✅ [ADMIN] User growth data points: ${users.length}`);
    res.json(users);
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching user growth:', error);
    res.status(500).json({ error: 'Failed to fetch user growth' });
  }
});

// Message stats
router.get('/analytics/message-stats', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    console.log(`📊 [ADMIN] Fetching message stats for ${days} days`);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const messages = await Message.aggregate([
      {
        $match: {
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$timestamp' }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    console.log(`✅ [ADMIN] Message stats data points: ${messages.length}`);
    res.json(messages);
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching message stats:', error);
    res.status(500).json({ error: 'Failed to fetch message stats' });
  }
});

module.exports = router;
