const Admin = require('../models/adminModel');
const User = require('../models/userModel');
const Message = require('../models/Message');
const Story = require('../models/storyModel');
const Post = require('../models/postModel');
const AIInstance = require('../models/aiInstanceModel');
const ConnectionRequest = require('../models/connectionRequestModel');
const Call = require('../models/callModel');
const GroupModel = require('../models/groupModel');
const StatusHistory = require('../models/statusHistoryModel');

/**
 * Show login page
 */
const showLoginPage = (req, res) => {
  res.render('admin/login', {
    title: 'Admin Login',
    layout: 'admin/layouts/auth',
    error: req.query.error || null
  });
};

/**
 * Handle login
 */
const handleLogin = async (req, res) => {
  try {
    console.log('=== LOGIN REQUEST RECEIVED ===');
    console.log('Request body:', req.body);
    console.log('Request headers:', req.headers);
    
    const { email, password } = req.body;
    
    console.log('Login attempt:', { email, hasPassword: !!password });
    
    // Validate input
    if (!email || !password) {
      console.log('Missing credentials');
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Find admin
    const admin = await Admin.findOne({ email }).select('+password');
    
    console.log('Admin found:', admin ? 'Yes' : 'No');
    
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    // Check if account is locked
    if (admin.isLocked()) {
      return res.status(423).json({
        success: false,
        message: 'Account is locked due to too many failed login attempts. Please try again later.'
      });
    }
    
    // Check if account is active
    if (!admin.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact administrator.'
      });
    }
    
    // Verify password
    const isMatch = await admin.comparePassword(password);
    
    console.log('Password match:', isMatch);
    
    if (!isMatch) {
      // Increment login attempts
      await admin.incLoginAttempts();
      
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    console.log('Login successful, creating session...');
    
    // Reset login attempts
    await admin.resetLoginAttempts();
    
    // Update last login
    admin.lastLogin = new Date();
    await admin.save();
    
    // Regenerate session to prevent fixation attacks and ensure clean session
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regenerate error:', err);
        return res.status(500).json({
          success: false,
          message: 'Error creating session'
        });
      }
      
      // Create session data
      req.session.adminUser = {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions
      };
      
      // Save session before responding
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.status(500).json({
            success: false,
            message: 'Error saving session'
          });
        }
        
        console.log('Session saved successfully:', req.session.adminUser);
        console.log('Session ID:', req.sessionID);
        
        res.json({
          success: true,
          message: 'Login successful',
          redirect: '/admin/dashboard'
        });
      });
    });
    
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during login'
    });
  }
};

/**
 * Handle logout
 */
const handleLogout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/admin/login');
  });
};

/**
 * Show dashboard
 */
const showDashboard = async (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Get statistics
    const [
      totalUsers,
      activeUsers,
      newUsersToday,
      totalMessages,
      messagesToday,
      totalStories,
      activeStories,
      totalPosts,
      postsToday,
      totalAIInstances,
      activeAIInstances,
      totalConnections,
      pendingConnections,
      totalCalls,
      callsToday,
      totalGroups
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ createdAt: { $gte: today } }),
      Message.countDocuments(),
      Message.countDocuments({ createdAt: { $gte: today } }),
      Story.countDocuments(),
      Story.countDocuments({ expiresAt: { $gt: now } }),
      Post.countDocuments(),
      Post.countDocuments({ createdAt: { $gte: today } }),
      AIInstance.countDocuments(),
      AIInstance.countDocuments({ isActive: true }),
      ConnectionRequest.countDocuments({ status: 'accepted' }),
      ConnectionRequest.countDocuments({ status: 'pending' }),
      Call.countDocuments(),
      Call.countDocuments({ startTime: { $gte: today } }),
      GroupModel.countDocuments()
    ]);
    
    // Get recent users
    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('name email phoneNumber createdAt isActive')
      .lean();
    
    // Get status distribution
    const statusDistribution = await User.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    
    res.render('admin/dashboard', {
      title: 'Dashboard',
      layout: 'admin/layouts/main',
      stats: {
        totalUsers,
        activeUsers,
        newUsersToday,
        totalMessages,
        messagesToday,
        totalStories,
        activeStories,
        totalPosts,
        postsToday,
        totalAIInstances,
        activeAIInstances,
        totalConnections,
        pendingConnections,
        totalCalls,
        callsToday,
        totalGroups
      },
      recentUsers,
      statusDistribution
    });
    
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).render('admin/error', {
      title: 'Error',
      layout: 'admin/layouts/main',
      message: 'Error loading dashboard'
    });
  }
};

/**
 * Handle traditional form login (no JavaScript)
 */
const handleFormLogin = async (req, res) => {
  try {
    console.log('=== FORM LOGIN REQUEST ===');
    console.log('Body:', req.body);
    
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.redirect('/admin/login?error=' + encodeURIComponent('Email and password are required'));
    }
    
    const Admin = require('../models/adminModel');
    const admin = await Admin.findOne({ email }).select('+password');
    
    if (!admin) {
      return res.redirect('/admin/login?error=' + encodeURIComponent('Invalid email or password'));
    }
    
    if (!admin.isActive) {
      return res.redirect('/admin/login?error=' + encodeURIComponent('Account is deactivated'));
    }
    
    const isMatch = await admin.comparePassword(password);
    
    if (!isMatch) {
      return res.redirect('/admin/login?error=' + encodeURIComponent('Invalid email or password'));
    }
    
    // Create session
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regenerate error:', err);
        return res.redirect('/admin/login?error=' + encodeURIComponent('Session error'));
      }
      
      req.session.adminUser = {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions
      };
      
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.redirect('/admin/login?error=' + encodeURIComponent('Session save error'));
        }
        
        console.log('✅ Login successful! Redirecting to dashboard...');
        res.redirect('/admin/dashboard');
      });
    });
    
  } catch (error) {
    console.error('Form login error:', error);
    res.redirect('/admin/login?error=' + encodeURIComponent('An error occurred'));
  }
};

module.exports = {
  showLoginPage,
  handleLogin,
  handleFormLogin,
  handleLogout,
  showDashboard
};
