const User = require('../models/userModel');

// Test endpoint to verify authentication is working
const testAuth = async (req, res) => {
  try {
    console.log('🧪 Testing authentication...');
    console.log('🔍 req.user:', {
      exists: !!req.user,
      userId: req.user?.userId,
      _id: req.user?._id,
      name: req.user?.name,
      keys: req.user ? Object.keys(req.user) : 'no user object'
    });

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'No user found in request object',
        debug: 'Authentication middleware may not be working'
      });
    }

    if (!req.user.userId) {
      return res.status(401).json({
        success: false,
        message: 'userId not found in user object',
        debug: {
          userKeys: Object.keys(req.user),
          userObject: req.user
        }
      });
    }

    res.status(200).json({
      success: true,
      message: 'Authentication working correctly',
      data: {
        userId: req.user.userId,
        name: req.user.name,
        _id: req.user._id
      }
    });

  } catch (error) {
    console.error('❌ Auth test error:', error);
    res.status(500).json({
      success: false,
      message: 'Auth test failed',
      error: error.message
    });
  }
};

module.exports = {
  testAuth
};
