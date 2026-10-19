const express = require('express');
const router = express.Router();
const User = require('../models/userModel');
const Post = require('../models/FeedPost');
const Message = require('../models/Message');
const Broadcast = require('../models/Broadcast');
const { setAccountState } = require('../services/userSessionControl');
const { recordAdminAction } = require('../services/adminAudit');
const broadcasts = require('../controllers/adminV2/broadcastsController').legacy;

const audit = (req, action, extra = {}) => {
  recordAdminAction({
    adminId: req.admin?._id,
    adminUsername: req.admin?.username,
    adminRole: req.admin?.role,
    ip: req.ip,
    action,
    result: 'success',
    ...extra
  }).catch(error => console.error(`❌ [AUDIT] Failed to record ${action}:`, error.message));
};

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
        .select('userId name email phoneNumber profileImage isOnline lastSeen createdAt accountStatus')
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

// Fields an admin is allowed to edit on a user — anything else is dropped
const USER_EDITABLE_FIELDS = ['name', 'bio', 'email', 'phoneNumber', 'profileImage'];

// Update user
router.put('/users/:id', async (req, res) => {
  try {
    console.log(`✏️ [ADMIN] Updating user: ${req.params.id}`);

    const updateData = {};
    for (const field of USER_EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    }

    const before = await User.findById(req.params.id).select(USER_EDITABLE_FIELDS.join(' ')).lean();
    if (!before) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).lean();

    console.log(`✅ [ADMIN] User updated: ${user.name}`);

    audit(req, 'user.update', {
      targetType: 'user',
      targetId: user.userId,
      before,
      after: updateData
    });

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

    const target = await User.findById(req.params.id).select('userId name').lean();
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = await setAccountState(target.userId, {
      state: 'banned',
      reason,
      by: String(req.admin?._id || 'admin')
    });

    console.log(`✅ [ADMIN] User banned: ${target.name}`);

    audit(req, 'user.ban', {
      targetType: 'user',
      targetId: target.userId,
      reason
    });

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

    const target = await User.findById(req.params.id).select('userId name').lean();
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = await setAccountState(target.userId, {
      state: 'active',
      by: String(req.admin?._id || 'admin')
    });

    console.log(`✅ [ADMIN] User unbanned: ${target.name}`);

    audit(req, 'user.unban', {
      targetType: 'user',
      targetId: target.userId
    });

    res.json({ success: true, user });
  } catch (error) {
    console.error('❌ [ADMIN] Error unbanning user:', error);
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

// Delete user (soft delete — preserves the account and its data)
router.delete('/users/:id', async (req, res) => {
  try {
    console.log(`🗑️ [ADMIN] Deleting user: ${req.params.id}`);

    const target = await User.findById(req.params.id).select('userId name').lean();

    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    await setAccountState(target.userId, {
      state: 'deleted',
      reason: req.body?.reason,
      by: String(req.admin?._id || 'admin')
    });

    console.log(`✅ [ADMIN] User soft-deleted: ${target.name}`);

    audit(req, 'user.delete', {
      targetType: 'user',
      targetId: target.userId,
      reason: req.body?.reason
    });

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
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Post.countDocuments()
    ]);

    // Manually fetch user data for each post since userId is String, not ObjectId
    const postsWithUsers = await Promise.all(
      posts.map(async (post) => {
        const user = await User.findOne({ userId: post.userId })
          .select('name profileImage userId')
          .lean();
        
        return {
          ...post,
          userId: user ? {
            name: user.name,
            profileImage: user.profileImage,
            userId: user.userId
          } : {
            name: 'Unknown User',
            profileImage: null,
            userId: post.userId
          }
        };
      })
    );

    console.log(`✅ [ADMIN] Found ${posts.length} posts (${total} total)`);

    res.json({
      posts: postsWithUsers,
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

// Get user statistics
router.get('/users/:id/stats', async (req, res) => {
  try {
    console.log(`📊 [ADMIN] Fetching stats for user: ${req.params.id}`);
    
    const user = await User.findById(req.params.id).lean();
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [messagesSent, postsCreated, friendsCount] = await Promise.all([
      Message.countDocuments({ senderId: user.userId }),
      Post.countDocuments({ userId: user.userId }),
      require('../models/Friend').countDocuments({ 
        userId: user.userId, 
        status: 'accepted',
        isDeleted: false 
      })
    ]);

    console.log(`✅ [ADMIN] User stats: messages=${messagesSent}, posts=${postsCreated}, friends=${friendsCount}`);

    res.json({
      messagesSent,
      postsCreated,
      friendsCount
    });
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching user stats:', error);
    res.status(500).json({ error: 'Failed to fetch user stats' });
  }
});

// Get all active statuses
router.get('/statuses', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    console.log(`📊 [ADMIN] Fetching active statuses - page: ${page}, limit: ${limit}`);

    // Find users with active statuses
    const users = await User.find({
      $or: [
        { mainStatus: { $exists: true, $ne: 'Available' } },
        { subStatus: { $exists: true, $ne: null } },
        { customStatus: { $exists: true, $ne: '' } }
      ]
    })
    .select('userId name profileImage mainStatus subStatus customStatus mainEndTime subEndTime statusUntil isOnline')
    .sort({ mainStartTime: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

    const total = await User.countDocuments({
      $or: [
        { mainStatus: { $exists: true, $ne: 'Available' } },
        { subStatus: { $exists: true, $ne: null } },
        { customStatus: { $exists: true, $ne: '' } }
      ]
    });

    // Format statuses
    const statuses = users.map(user => ({
      _id: user._id,
      userId: user.userId,
      userName: user.name,
      profileImage: user.profileImage,
      mainStatus: user.mainStatus,
      subStatus: user.subStatus,
      customStatus: user.customStatus,
      expiresAt: user.mainEndTime || user.subEndTime || user.statusUntil,
      isOnline: user.isOnline,
      isActive: true
    }));

    console.log(`✅ [ADMIN] Found ${statuses.length} active statuses (${total} total)`);

    res.json({
      statuses,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching statuses:', error);
    res.status(500).json({ error: 'Failed to fetch statuses' });
  }
});

// Get status statistics
router.get('/statuses/stats', async (req, res) => {
  try {
    console.log(`📊 [ADMIN] Fetching status statistics`);

    const [
      totalOnline,
      available,
      busy,
      inMeeting,
      doNotDisturb,
      away,
      broadcasting,
      withCustomStatus
    ] = await Promise.all([
      User.countDocuments({ isOnline: true }),
      User.countDocuments({ mainStatus: 'Available', isOnline: true }),
      User.countDocuments({ mainStatus: 'Busy' }),
      User.countDocuments({ mainStatus: 'In a meeting' }),
      User.countDocuments({ mainStatus: 'Do not disturb' }),
      User.countDocuments({ mainStatus: 'Away' }),
      User.countDocuments({ subStatus: { $exists: true, $ne: null } }),
      User.countDocuments({ customStatus: { $exists: true, $ne: '' } })
    ]);

    const stats = {
      totalOnline,
      available,
      busy,
      inMeeting,
      doNotDisturb,
      away,
      broadcasting,
      withCustomStatus
    };

    console.log(`✅ [ADMIN] Status stats:`, stats);

    res.json(stats);
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching status stats:', error);
    res.status(500).json({ error: 'Failed to fetch status stats' });
  }
});

// Delete user status
router.delete('/statuses/:userId', async (req, res) => {
  try {
    console.log(`🗑️ [ADMIN] Clearing status for user: ${req.params.userId}`);

    const user = await User.findOne({ userId: req.params.userId });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Clear all status fields
    user.mainStatus = 'Available';
    user.subStatus = null;
    user.customStatus = '';
    user.mainEndTime = null;
    user.subEndTime = null;
    user.statusUntil = null;
    
    await user.save();

    console.log(`✅ [ADMIN] Status cleared for user: ${req.params.userId}`);

    res.json({ message: 'Status cleared successfully' });
  } catch (error) {
    console.error('❌ [ADMIN] Error clearing status:', error);
    res.status(500).json({ error: 'Failed to clear status' });
  }
});

// ==================== BROADCAST MESSAGING ====================

// Broadcast handlers live in controllers/adminV2/broadcastsController.js and
// are shared with /api/admin/v2 — legacy response shapes are unchanged.
router.get('/broadcasts', broadcasts.list);
router.post('/broadcasts', broadcasts.create);
router.get('/broadcasts/stats', broadcasts.stats);
router.get('/broadcasts/templates', broadcasts.templates);
router.get('/broadcasts/scheduled', broadcasts.scheduled);
router.patch('/broadcasts/:id/cancel', broadcasts.cancel);
router.get('/broadcasts/:id/analytics', broadcasts.analytics);
router.patch('/broadcasts/:id', broadcasts.update);
router.delete('/broadcasts/:id', broadcasts.delete);

// ==================== HASHTAG MANAGEMENT ====================

// Get trending hashtags
router.get('/hashtags/trending', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const days = parseInt(req.query.days) || 7;

    console.log(`#️⃣ [ADMIN] Fetching trending hashtags (last ${days} days)`);

    const dateFilter = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const trending = await Post.aggregate([
      {
        $match: {
          createdAt: { $gte: dateFilter },
          hashtags: { $exists: true, $ne: [] }
        }
      },
      { $unwind: '$hashtags' },
      {
        $group: {
          _id: '$hashtags',
          count: { $sum: 1 },
          totalLikes: { $sum: '$likesCount' },
          totalComments: { $sum: '$commentsCount' },
          totalShares: { $sum: '$sharesCount' },
          recentPosts: { $push: { postId: '$_id', createdAt: '$createdAt' } }
        }
      },
      {
        $project: {
          hashtag: '$_id',
          count: 1,
          totalLikes: 1,
          totalComments: 1,
          totalShares: 1,
          engagement: { $add: ['$totalLikes', '$totalComments', { $multiply: ['$totalShares', 2] }] },
          recentPosts: { $slice: ['$recentPosts', 5] }
        }
      },
      { $sort: { engagement: -1, count: -1 } },
      { $limit: limit }
    ]);

    console.log(`✅ [ADMIN] Found ${trending.length} trending hashtags`);

    res.json({
      hashtags: trending,
      total: trending.length,
      period: `${days} days`
    });
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching trending hashtags:', error);
    res.status(500).json({ error: 'Failed to fetch trending hashtags' });
  }
});

// Get hashtag details
router.get('/hashtags/:hashtag', async (req, res) => {
  try {
    const hashtag = req.params.hashtag.replace('#', '');
    const days = parseInt(req.query.days) || 30;

    console.log(`#️⃣ [ADMIN] Fetching details for hashtag: ${hashtag}`);

    const dateFilter = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [posts, stats] = await Promise.all([
      Post.find({
        hashtags: hashtag,
        createdAt: { $gte: dateFilter }
      })
        .select('userId userName userProfileImage caption media likesCount commentsCount sharesCount createdAt')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      Post.aggregate([
        {
          $match: {
            hashtags: hashtag,
            createdAt: { $gte: dateFilter }
          }
        },
        {
          $group: {
            _id: null,
            totalPosts: { $sum: 1 },
            totalLikes: { $sum: '$likesCount' },
            totalComments: { $sum: '$commentsCount' },
            totalShares: { $sum: '$sharesCount' },
            uniqueUsers: { $addToSet: '$userId' }
          }
        },
        {
          $project: {
            totalPosts: 1,
            totalLikes: 1,
            totalComments: 1,
            totalShares: 1,
            uniqueUsers: { $size: '$uniqueUsers' }
          }
        }
      ])
    ]);

    console.log(`✅ [ADMIN] Found ${posts.length} posts for #${hashtag}`);

    res.json({
      hashtag,
      stats: stats[0] || { totalPosts: 0, totalLikes: 0, totalComments: 0, totalShares: 0, uniqueUsers: 0 },
      posts
    });
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching hashtag details:', error);
    res.status(500).json({ error: 'Failed to fetch hashtag details' });
  }
});

// Get hashtag statistics
router.get('/hashtags/stats', async (req, res) => {
  try {
    console.log(`📊 [ADMIN] Fetching hashtag statistics`);

    const [totalHashtags, postsWithHashtags, avgHashtagsPerPost] = await Promise.all([
      Post.aggregate([
        { $match: { hashtags: { $exists: true, $ne: [] } } },
        { $unwind: '$hashtags' },
        { $group: { _id: '$hashtags' } },
        { $count: 'total' }
      ]),
      Post.countDocuments({ hashtags: { $exists: true, $ne: [] } }),
      Post.aggregate([
        { $match: { hashtags: { $exists: true, $ne: [] } } },
        { $project: { hashtagCount: { $size: '$hashtags' } } },
        { $group: { _id: null, avgCount: { $avg: '$hashtagCount' } } }
      ])
    ]);

    const stats = {
      totalHashtags: totalHashtags[0]?.total || 0,
      postsWithHashtags,
      avgHashtagsPerPost: Math.round((avgHashtagsPerPost[0]?.avgCount || 0) * 10) / 10
    };

    console.log(`✅ [ADMIN] Hashtag stats:`, stats);

    res.json(stats);
  } catch (error) {
    console.error('❌ [ADMIN] Error fetching hashtag stats:', error);
    res.status(500).json({ error: 'Failed to fetch hashtag stats' });
  }
});

module.exports = router;
