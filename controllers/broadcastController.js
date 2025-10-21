const User = require('../models/userModel');
const Message = require('../models/Message');

/**
 * Show broadcast form
 */
const showBroadcastForm = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ isActive: true });
    
    res.render('admin/broadcast/index', {
      title: 'Broadcast System',
      layout: 'admin/layouts/main',
      totalUsers
    });
  } catch (error) {
    console.error('Broadcast form error:', error);
    res.status(500).send('Error loading broadcast form');
  }
};

/**
 * Send broadcast message
 */
const sendBroadcast = async (req, res) => {
  try {
    const { message, messageType, targetType } = req.body;
    
    if (!message) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }
    
    // Get target users
    let users;
    if (targetType === 'all') {
      users = await User.find({ isActive: true }).select('userId').lean();
    } else if (targetType === 'active') {
      users = await User.find({ 
        isActive: true,
        lastSeen: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
      }).select('userId').lean();
    }
    
    // Create broadcast messages
    const broadcastMessages = users.map(user => ({
      senderId: 'SYSTEM',
      receiverId: user.userId,
      message: message,
      messageType: messageType || 'text',
      status: 'sent',
      createdAt: new Date()
    }));
    
    // Insert all messages
    await Message.insertMany(broadcastMessages);
    
    res.json({ 
      success: true, 
      message: `Broadcast sent to ${users.length} users`,
      count: users.length
    });
  } catch (error) {
    console.error('Send broadcast error:', error);
    res.status(500).json({ success: false, message: 'Error sending broadcast' });
  }
};

/**
 * Get broadcast history
 */
const getBroadcastHistory = async (req, res) => {
  try {
    const broadcasts = await Message.aggregate([
      { $match: { senderId: 'SYSTEM' } },
      { 
        $group: {
          _id: { message: '$message', date: { $dateToString: { format: '%Y-%m-%d %H:%M', date: '$createdAt' } } },
          count: { $sum: 1 },
          createdAt: { $first: '$createdAt' }
        }
      },
      { $sort: { createdAt: -1 } },
      { $limit: 20 }
    ]);
    
    res.json({ success: true, broadcasts });
  } catch (error) {
    console.error('Broadcast history error:', error);
    res.status(500).json({ success: false, message: 'Error loading history' });
  }
};

module.exports = {
  showBroadcastForm,
  sendBroadcast,
  getBroadcastHistory
};
