const Message = require('../models/Message');
const AIInstance = require('../models/aiInstanceModel');
const GroupModel = require('../models/groupModel');
const User = require('../models/userModel');

// Messages Page
exports.showMessagesPage = async (req, res) => {
  try {
    const totalMessages = await Message.countDocuments();
    const recentMessages = await Message.find()
      .populate('sender', 'name')
      .populate('receiver', 'name')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    
    res.render('admin/messages', {
      title: 'Messages',
      layout: 'admin/layouts/main',
      totalMessages,
      recentMessages
    });
  } catch (error) {
    res.status(500).send('Error loading messages');
  }
};

// AI System Page
exports.showAIPage = async (req, res) => {
  try {
    const [totalAI, activeAI] = await Promise.all([
      AIInstance.countDocuments(),
      AIInstance.countDocuments({ isActive: true })
    ]);
    
    const aiInstances = await AIInstance.find()
      .populate('user', 'name phoneNumber')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    
    res.render('admin/ai', {
      title: 'AI System',
      layout: 'admin/layouts/main',
      totalAI,
      activeAI,
      aiInstances
    });
  } catch (error) {
    res.status(500).send('Error loading AI system');
  }
};

// Groups Page
exports.showGroupsPage = async (req, res) => {
  try {
    const totalGroups = await GroupModel.countDocuments();
    const groups = await GroupModel.find()
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    
    res.render('admin/groups', {
      title: 'Groups',
      layout: 'admin/layouts/main',
      totalGroups,
      groups
    });
  } catch (error) {
    res.status(500).send('Error loading groups');
  }
};

// Analytics Page
exports.showAnalyticsPage = async (req, res) => {
  try {
    const [totalUsers, totalMessages, totalPosts, totalAI] = await Promise.all([
      User.countDocuments(),
      Message.countDocuments(),
      require('../models/postModel').countDocuments(),
      AIInstance.countDocuments()
    ]);
    
    res.render('admin/analytics', {
      title: 'Analytics',
      layout: 'admin/layouts/main',
      totalUsers,
      totalMessages,
      totalPosts,
      totalAI
    });
  } catch (error) {
    res.status(500).send('Error loading analytics');
  }
};

// Settings Page
exports.showSettingsPage = (req, res) => {
  res.render('admin/settings', {
    title: 'Settings',
    layout: 'admin/layouts/main'
  });
};
