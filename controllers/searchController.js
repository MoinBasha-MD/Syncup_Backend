const User = require('../models/userModel');
const Message = require('../models/Message');
const Post = require('../models/postModel');
const GroupModel = require('../models/groupModel');

/**
 * Global search across all resources
 */
const globalSearch = async (req, res) => {
  try {
    const query = req.query.q || '';
    const type = req.query.type || 'all';
    
    if (!query) {
      return res.json({ success: true, results: {} });
    }
    
    const results = {};
    
    // Search users
    if (type === 'all' || type === 'users') {
      results.users = await User.find({
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { email: { $regex: query, $options: 'i' } },
          { phoneNumber: { $regex: query, $options: 'i' } }
        ]
      })
      .select('name email phoneNumber isActive')
      .limit(10)
      .lean();
    }
    
    // Search groups
    if (type === 'all' || type === 'groups') {
      results.groups = await GroupModel.find({
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { description: { $regex: query, $options: 'i' } }
        ]
      })
      .select('name description membersCount')
      .limit(10)
      .lean();
    }
    
    // Search posts
    if (type === 'all' || type === 'posts') {
      results.posts = await Post.find({
        content: { $regex: query, $options: 'i' }
      })
      .select('content userId createdAt')
      .limit(10)
      .lean();
    }
    
    // Search messages
    if (type === 'all' || type === 'messages') {
      results.messages = await Message.find({
        message: { $regex: query, $options: 'i' }
      })
      .select('message senderId receiverId createdAt')
      .limit(10)
      .lean();
    }
    
    res.json({ success: true, results });
  } catch (error) {
    console.error('Global search error:', error);
    res.status(500).json({ success: false, message: 'Search error' });
  }
};

/**
 * Show search page
 */
const showSearchPage = (req, res) => {
  try {
    res.render('admin/search/index', {
      title: 'Advanced Search',
      layout: 'admin/layouts/main',
      query: req.query.q || ''
    });
  } catch (error) {
    console.error('Search page error:', error);
    res.status(500).send('Error loading search page');
  }
};

module.exports = {
  globalSearch,
  showSearchPage
};
