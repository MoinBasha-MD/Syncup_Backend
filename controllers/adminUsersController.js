const User = require('../models/userModel');
const AIInstance = require('../models/aiInstanceModel');
const Message = require('../models/Message');
const Post = require('../models/postModel');

/**
 * Show users list page
 */
const showUsersPage = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const status = req.query.status || '';
    
    // Build query
    let query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } }
      ];
    }
    if (status) {
      if (status === 'active') {
        query.isActive = true;
      } else if (status === 'inactive') {
        query.isActive = false;
      }
    }
    
    // Get users
    const [users, totalUsers] = await Promise.all([
      User.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query)
    ]);
    
    const totalPages = Math.ceil(totalUsers / limit);
    
    res.render('admin/users/list', {
      title: 'Users',
      layout: 'admin/layouts/main',
      users,
      currentPage: page,
      totalPages,
      totalUsers,
      search,
      status
    });
    
  } catch (error) {
    console.error('Users page error:', error);
    res.status(500).send('Error loading users');
  }
};

/**
 * Show single user details
 */
const showUserDetails = async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Get user
    const user = await User.findById(userId).lean();
    
    if (!user) {
      return res.status(404).send('User not found');
    }
    
    // Get all related data
    // Note: Messages use userId (UUID string), not MongoDB _id
    const StatusHistory = require('../models/statusHistoryModel');
    const StatusSchedule = require('../models/statusScheduleModel');
    
    const [aiInstances, messageCount, postCount, storyCount, connectionCount, statusHistory, scheduledStatuses] = await Promise.all([
      AIInstance.find({ user: userId }).lean(),
      Message.countDocuments({ $or: [{ senderId: user.userId }, { receiverId: user.userId }] }),
      Post.countDocuments({ user: userId }),
      require('../models/storyModel').countDocuments({ user: userId }),
      require('../models/connectionRequestModel').countDocuments({ 
        $or: [{ sender: userId }, { receiver: userId }],
        status: 'accepted'
      }),
      StatusHistory.find({ user: userId }).sort({ startTime: -1 }).limit(20).lean(),
      StatusSchedule.find({ user: userId }).sort({ createdAt: -1 }).lean()
    ]);
    
    res.render('admin/users/details', {
      title: 'User Details',
      layout: 'admin/layouts/main',
      user,
      aiInstances,
      messageCount,
      postCount,
      storyCount,
      connectionCount,
      statusHistory,
      scheduledStatuses
    });
    
  } catch (error) {
    console.error('User details error:', error);
    res.status(500).send('Error loading user details');
  }
};

/**
 * Show edit user page
 */
const showEditUserPage = async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findById(userId).lean();
    
    if (!user) {
      return res.status(404).send('User not found');
    }
    
    res.render('admin/users/edit', {
      title: 'Edit User',
      layout: 'admin/layouts/main',
      user
    });
    
  } catch (error) {
    console.error('Edit user page error:', error);
    res.status(500).send('Error loading edit page');
  }
};

/**
 * Update user
 */
const updateUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const { name, email, phoneNumber, status, customStatus, isActive } = req.body;
    
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Update fields
    if (name) user.name = name;
    if (email) user.email = email;
    if (phoneNumber) user.phoneNumber = phoneNumber;
    if (status) user.status = status;
    if (customStatus !== undefined) user.customStatus = customStatus;
    if (isActive !== undefined) user.isActive = isActive;
    
    await user.save();
    
    res.json({ success: true, message: 'User updated successfully' });
    
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, message: 'Error updating user' });
  }
};

/**
 * Delete user
 */
const deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Check permission
    if (req.session.adminUser.role !== 'super-admin') {
      return res.status(403).json({ success: false, message: 'Only super-admin can delete users' });
    }
    
    await User.findByIdAndDelete(userId);
    
    res.json({ success: true, message: 'User deleted successfully' });
    
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ success: false, message: 'Error deleting user' });
  }
};

/**
 * Show create user page
 */
const showCreateUserPage = (req, res) => {
  res.render('admin/users/create', {
    title: 'Create User',
    layout: 'admin/layouts/main'
  });
};

/**
 * Create new user with complete profile
 */
const createUser = async (req, res) => {
  try {
    const { 
      name, email, phoneNumber, password, 
      username, profileImage, dateOfBirth, gender,
      status, customStatus, statusUntil, statusLocation,
      isPublic
    } = req.body;
    
    // Check if user exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { phoneNumber }] 
    });
    
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'User with this email or phone already exists' 
      });
    }
    
    // Check username uniqueness if provided
    if (username) {
      const existingUsername = await User.findOne({ username });
      if (existingUsername) {
        return res.status(400).json({ 
          success: false, 
          message: 'Username already taken' 
        });
      }
    }
    
    // Create user with all fields
    const userData = {
      name,
      email,
      phoneNumber,
      password, // Will be hashed in model pre-save hook
      status: status || 'available',
      isActive: true
    };
    
    // Add optional fields if provided
    if (username) userData.username = username;
    if (profileImage) userData.profileImage = profileImage;
    if (dateOfBirth) userData.dateOfBirth = new Date(dateOfBirth);
    if (gender) userData.gender = gender;
    if (customStatus) userData.customStatus = customStatus;
    if (statusUntil) userData.statusUntil = new Date(statusUntil);
    if (isPublic !== undefined) userData.isPublic = isPublic;
    if (name) userData.searchableName = name.toLowerCase();
    
    // Handle location data
    if (statusLocation) {
      userData.statusLocation = {
        placeName: statusLocation.placeName || '',
        address: statusLocation.address || '',
        shareWithContacts: statusLocation.shareWithContacts || false,
        timestamp: new Date()
      };
      
      if (statusLocation.coordinates && statusLocation.coordinates.latitude && statusLocation.coordinates.longitude) {
        userData.statusLocation.coordinates = {
          latitude: parseFloat(statusLocation.coordinates.latitude),
          longitude: parseFloat(statusLocation.coordinates.longitude)
        };
      }
    }
    
    const user = new User(userData);
    await user.save();
    
    res.json({ 
      success: true, 
      message: 'User created successfully with complete profile',
      userId: user._id
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Error creating user' 
    });
  }
};

/**
 * Toggle user status (active/inactive)
 */
const toggleUserStatus = async (req, res) => {
  try {
    console.log('Toggle status endpoint hit:', {
      userId: req.params.id,
      method: req.method,
      url: req.url,
      headers: req.headers
    });
    
    const { id } = req.params;
    
    if (!id) {
      console.error('No user ID provided in params');
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }
    
    console.log('Looking for user with ID:', id);
    const user = await User.findById(id);
    
    // Check if user exists
    if (!user) {
      console.error('User not found with ID:', id);
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    console.log('User found:', { name: user.name, currentStatus: user.isActive });
    
    // Toggle status
    const oldStatus = user.isActive;
    user.isActive = !user.isActive;
    await user.save();
    
    console.log('User status toggled:', { 
      from: oldStatus, 
      to: user.isActive,
      userName: user.name 
    });
    
    // Return response
    const response = { 
      success: true, 
      message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      isActive: user.isActive
    };
    
    console.log('Sending response:', response);
    res.json(response);
    
  } catch (error) {
    console.error('Toggle status error details:', {
      message: error.message,
      stack: error.stack,
      userId: req.params.id
    });
    res.status(500).json({ success: false, message: 'Error toggling status: ' + error.message });
  }
};

/**
 * Set user custom status
 */
const setUserStatus = async (req, res) => {
  try {
    console.log('Set status endpoint hit:', {
      userId: req.params.id,
      body: req.body,
      method: req.method,
      url: req.url
    });
    
    const { id } = req.params;
    const { status, customStatus } = req.body;
    
    if (!id) {
      console.error('No user ID provided in params');
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }
    
    console.log('Looking for user with ID:', id);
    const user = await User.findById(id);
    
    // Check if user exists
    if (!user) {
      console.error('User not found with ID:', id);
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    console.log('User found:', { 
      name: user.name, 
      currentStatus: user.status, 
      currentCustomStatus: user.customStatus 
    });
    
    // Update status
    const oldStatus = user.status;
    const oldCustomStatus = user.customStatus;
    
    if (status) user.status = status;
    if (customStatus !== undefined) user.customStatus = customStatus;
    
    // Save changes
    await user.save();
    
    console.log('User status updated:', {
      statusChanged: oldStatus !== user.status,
      customStatusChanged: oldCustomStatus !== user.customStatus,
      newStatus: user.status,
      newCustomStatus: user.customStatus
    });
    
    // Return response
    const response = { 
      success: true, 
      message: 'User status updated successfully' 
    };
    
    console.log('Sending response:', response);
    res.json(response);
    
  } catch (error) {
    console.error('Set status error details:', {
      message: error.message,
      stack: error.stack,
      userId: req.params.id,
      body: req.body
    });
    res.status(500).json({ success: false, message: 'Error setting status: ' + error.message });
  }
};

/**
 * Send push notification to user
 */
const sendPushNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, message, type } = req.body;
    // Get user
    const user = await User.findById(id);
    // Check if user exists
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    // TODO: Implement actual push notification via Firebase/OneSignal
    // For now, we'll just log it
    console.log(`Push notification to ${user.name}:`, { title, message, type });
    // You can integrate with Socket.IO for real-time notification
    // io.to(user.socketId).emit('notification', { title, message, type });
    // Return response
    res.json({ 
      success: true, 
      message: 'Notification sent successfully' 
    });
  } catch (error) {
    console.error('Send notification error:', error);
    res.status(500).json({ success: false, message: 'Error sending notification' });
  }
};

module.exports = {
  showUsersPage,
  showUserDetails,
  showEditUserPage,
  updateUser,
  deleteUser,
  showCreateUserPage,
  createUser,
  toggleUserStatus,
  setUserStatus,
  sendPushNotification
};
