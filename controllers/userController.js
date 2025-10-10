const User = require('../models/userModel');
const StatusHistory = require('../models/statusHistoryModel');
const { broadcastStatusUpdate } = require('../socketManager');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// @desc    Register a new user
// @route   POST /api/users
// @access  Public
const registerUser = async (req, res) => {
  try {
    const { name, phoneNumber, email, password } = req.body;

    // Check if user already exists with this email or phone
    const userExistsWithEmail = await User.findOne({ email });
    if (userExistsWithEmail) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    const userExistsWithPhone = await User.findOne({ phoneNumber });
    if (userExistsWithPhone) {
      return res.status(400).json({ message: 'User with this phone number already exists' });
    }

    // Create user
    const user = await User.create({
      name,
      phoneNumber,
      email,
      password,
      status: 'available',
      customStatus: '',
      statusUntil: null,
      searchableName: name.toLowerCase() // For search optimization
    });

    if (user) {
      res.status(201).json({
        _id: user._id,
        userId: user.userId,
        name: user.name,
        phoneNumber: user.phoneNumber,
        email: user.email,
        status: user.status,
        customStatus: user.customStatus,
        statusUntil: user.statusUntil,
        token: user.getSignedJwtToken(),
      });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Auth user & get token
// @route   POST /api/users/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;

    // Check for user with phone number
    const user = await User.findOne({ phoneNumber }).select('+password');

    if (!user) {
      return res.status(401).json({ message: 'Invalid phone number or password' });
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid phone number or password' });
    }

    // Check if status timer has expired
    if (user.statusUntil && new Date() > new Date(user.statusUntil)) {
      user.status = 'available';
      user.customStatus = '';
      user.statusUntil = null;
      await user.save();
    }

    res.json({
      _id: user._id,
      userId: user.userId,
      name: user.name,
      phoneNumber: user.phoneNumber,
      email: user.email,
      status: user.status,
      customStatus: user.customStatus,
      statusUntil: user.statusUntil,
      token: user.getSignedJwtToken(),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user) {
      // Check if status timer has expired
      if (user.statusUntil && new Date() > new Date(user.statusUntil)) {
        user.status = 'available';
        user.customStatus = '';
        user.statusUntil = null;
        await user.save();
      }

      res.json({
        _id: user._id,
        userId: user.userId,
        name: user.name,
        phoneNumber: user.phoneNumber,
        email: user.email,
        status: user.status,
        customStatus: user.customStatus,
        statusUntil: user.statusUntil,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender
      });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
// @desc    Update user status
// @route   PUT /api/users/status
// @access  Private
const updateUserStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user) {
      const { status, customStatus, duration } = req.body;
      
      // Validate status
      const validStatuses = [
        // Basic statuses
        'available', 'busy', 'away', 'dnd',
        // Location-based statuses
        'at_work', 'at_home', 'at_school', 'at_college', 'at_hospital', 'at_mosque', 'at_temple', 'at_theatre', 'at_emergency',
        // Activity-based statuses
        'meeting', 'driving', 'commuting', 'working_out', 'eating', 'sleeping', 'studying', 'in_a_meeting',
        // Custom status
        'custom', 'extended', 'pause'
      ];
      
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid status type' });
      }
      
      // Store previous status for history tracking
      const previousStatus = user.status;
      const previousCustomStatus = user.customStatus || '';
      const statusChangeTime = new Date();
      
      // Update status fields
      user.status = status;
      
      // Update custom status if provided and status is custom
      if (status === 'custom' && customStatus) {
        user.customStatus = customStatus;
      } else if (status !== 'custom') {
        user.customStatus = '';
      }
      
      // Set status expiration if duration provided (in minutes)
      let expirationTime = null;
      if (duration && duration > 0) {
        expirationTime = new Date();
        expirationTime.setMinutes(expirationTime.getMinutes() + duration);
        user.statusUntil = expirationTime;
      } else {
        user.statusUntil = null; // No expiration
      }
      
      const updatedUser = await user.save();
      
      // Create status history entry if status has changed
      if (previousStatus !== status || 
          (status === 'custom' && previousCustomStatus !== user.customStatus)) {
        
        // Create a new status history entry
        await StatusHistory.create({
          user: user._id,
          userId: user.userId,
          status: status,
          customStatus: status === 'custom' ? user.customStatus : '',
          startTime: statusChangeTime,
          endTime: expirationTime || null,
          duration: duration || 0,
          isActive: true,
          completed: false,
          endedAt: statusChangeTime.toISOString()
        });
        
        console.log(`Status history entry created for user ${user._id}`);
      }
      
      // Broadcast status update to all relevant users via WebSocket
      broadcastStatusUpdate(updatedUser._id.toString(), {
        status: updatedUser.status,
        customStatus: updatedUser.customStatus,
        statusUntil: updatedUser.statusUntil
      });
      
      console.log(`Status update broadcast for user ${updatedUser._id}`);
      
      res.json({
        _id: updatedUser._id,
        userId: updatedUser.userId,
        name: updatedUser.name,
        phoneNumber: updatedUser.phoneNumber,
        email: updatedUser.email,
        status: updatedUser.status,
        customStatus: updatedUser.customStatus,
        statusUntil: updatedUser.statusUntil
      });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const updateUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user) {
      user.name = req.body.name || user.name;
      user.email = req.body.email || user.email;
      
      // Only update phone number if provided and different
      if (req.body.phoneNumber && req.body.phoneNumber !== user.phoneNumber) {
        // Check if phone number is already in use
        const phoneExists = await User.findOne({ phoneNumber: req.body.phoneNumber });
        if (phoneExists) {
          return res.status(400).json({ message: 'Phone number already in use' });
        }
        user.phoneNumber = req.body.phoneNumber;
      }

      // Update password if provided
      if (req.body.password) {
        user.password = req.body.password;
      }

      // Update dateOfBirth if provided
      if (req.body.dateOfBirth !== undefined) {
        if (req.body.dateOfBirth && !isNaN(Date.parse(req.body.dateOfBirth))) {
          user.dateOfBirth = new Date(req.body.dateOfBirth);
        } else if (req.body.dateOfBirth === null || req.body.dateOfBirth === '') {
          user.dateOfBirth = null;
        }
      }

      // Update gender if provided
      if (req.body.gender !== undefined) {
        if (req.body.gender && ['male', 'female', 'other', 'prefer_not_to_say'].includes(req.body.gender)) {
          user.gender = req.body.gender;
        } else if (req.body.gender === null || req.body.gender === '') {
          user.gender = null;
        }
      }

      const updatedUser = await user.save();

      res.json({
        _id: updatedUser._id,
        userId: updatedUser.userId,
        name: updatedUser.name,
        phoneNumber: updatedUser.phoneNumber,
        email: updatedUser.email,
        status: updatedUser.status,
        customStatus: updatedUser.customStatus,
        statusUntil: updatedUser.statusUntil,
        dateOfBirth: updatedUser.dateOfBirth,
        gender: updatedUser.gender,
        token: updatedUser.getSignedJwtToken(),
      });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get all registered users (minimal data for contact sync)
// @route   GET /api/users/registered
// @access  Public (but can accept userId for filtering)
const getRegisteredUsers = async (req, res) => {
  try {
    const { userId: requestingUserId } = req.query; // Optional userId for filtering
    
    console.log(`🔍 [REGISTERED USERS] Request from userId: ${requestingUserId || 'anonymous'}`);
    
    let excludedUserIds = [];
    
    // If userId is provided, exclude existing contacts and app connections
    if (requestingUserId) {
      const requestingUser = await User.findOne({ userId: requestingUserId }, 'contacts appConnections');
      if (requestingUser) {
        // Get contact userIds
        const contactUsers = await User.find({ 
          _id: { $in: requestingUser.contacts } 
        }, 'userId').lean();
        const contactUserIds = contactUsers.map(user => user.userId);
        
        // Get app connection userIds
        const existingAppConnectionIds = requestingUser.appConnections
          .filter(conn => conn.status === 'accepted')
          .map(conn => conn.userId);
        
        excludedUserIds = [
          requestingUserId, // Exclude self
          ...contactUserIds, // Exclude existing device contacts
          ...existingAppConnectionIds // Exclude existing app connections
        ];
        
        console.log(`🔍 [REGISTERED USERS] Excluding ${excludedUserIds.length} users:`, {
          self: 1,
          contacts: contactUserIds.length,
          appConnections: existingAppConnectionIds.length
        });
      }
    }
    // CRITICAL DEBUG: Check if ANY users have profile images
    const usersWithImages = await User.find({ profileImage: { $exists: true, $ne: '', $ne: null } }).select('name phoneNumber profileImage');
    console.log(`\n🚨 CRITICAL DEBUG: Users with profile images: ${usersWithImages.length}`);
    if (usersWithImages.length > 0) {
      console.log('Users that HAVE profile images:', usersWithImages.map(u => ({
        name: u.name,
        phone: u.phoneNumber,
        profileImage: u.profileImage
      })));
    } else {
      console.log('🚨 NO USERS HAVE PROFILE IMAGES IN DATABASE!');
      
      // Check if there are uploaded files but no database links
      const fs = require('fs');
      const path = require('path');
      const uploadsDir = path.join(__dirname, '../uploads/profile-images');
      
      try {
        if (fs.existsSync(uploadsDir)) {
          const files = fs.readdirSync(uploadsDir);
          console.log(`📁 Found ${files.length} uploaded profile image files:`, files);
          if (files.length > 0) {
            console.log('🚨 ISSUE FOUND: Profile images uploaded but not linked to users in database!');
          }
        }
      } catch (err) {
        console.log('Error checking uploads directory:', err.message);
      }
    }
    
    // Build query to exclude existing connections if userId provided AND only show public users
    const query = {
      isPublic: true, // CRITICAL FIX: Only show public users
      ...(excludedUserIds.length > 0 && { userId: { $nin: excludedUserIds } })
    };
    
    // Get filtered users but include profileImage and isPublic for contact display in HomeTab
    const users = await User.find(query).select('_id userId name phoneNumber profileImage status customStatus statusUntil isPublic username');
    
    console.log(`🔍 [REGISTERED USERS] Query: ${JSON.stringify(query)}`);
    console.log(`🔍 [REGISTERED USERS] Found ${users.length} users after filtering`);
    
    // CRITICAL DEBUG: Check how many users have isPublic: true in database
    const totalPublicUsers = await User.countDocuments({ isPublic: true });
    const totalUsers = await User.countDocuments({});
    console.log(`🔍 [CRITICAL DEBUG] Database stats:`, {
      totalUsers,
      totalPublicUsers,
      publicPercentage: totalUsers > 0 ? ((totalPublicUsers / totalUsers) * 100).toFixed(1) + '%' : '0%'
    });
    
    if (totalPublicUsers === 0) {
      console.log(`🚨 [CRITICAL ISSUE] NO USERS HAVE isPublic: true IN DATABASE!`);
      console.log(`🚨 Users need to update their profile to set isPublic: true to appear in search`);
    }
    
    console.log(`\n=== BACKEND STEP 1: DATABASE QUERY ===`);
    console.log(`Fetching ${users.length} registered users with profile images`);
    console.log(`Raw database users:`, users.map(u => ({
      name: u.name,
      phone: u.phoneNumber,
      profileImage: u.profileImage,
      profileImageType: typeof u.profileImage,
      profileImageLength: u.profileImage ? u.profileImage.length : 0
    })));
    
    // Format the response to match what the frontend expects
    const formattedUsers = users.map(user => {
      // Check if status timer has expired
      let currentStatus = user.status;
      let currentCustomStatus = user.customStatus;
      if (user.statusUntil && new Date() > new Date(user.statusUntil)) {
        currentStatus = 'available';
        currentCustomStatus = '';
      }
      
      // Debug: Log profile image data for each user
      console.log(`\n=== BACKEND STEP 2: FORMATTING USER ${user.name} ===`);
      console.log(`🔍 User: ${user.name} (${user.phoneNumber})`);
      console.log(`🖼️ Profile Image RAW: ${JSON.stringify(user.profileImage)}`);
      console.log(`📊 Profile Image Type: ${typeof user.profileImage}`);
      console.log(`📏 Profile Image Length: ${user.profileImage ? user.profileImage.length : 0}`);
      console.log(`📝 Profile Image Empty Check: ${!user.profileImage ? 'EMPTY/NULL' : 'HAS_VALUE'}`);
      console.log('---');
      
      return {
        id: user._id,
        userId: user.userId,
        name: user.name, // Use 'name' instead of 'fullName' for consistency
        fullName: user.name,
        phoneNumber: user.phoneNumber,
        profileImage: user.profileImage,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
        status: currentStatus,
        customStatus: currentCustomStatus,
        statusUntil: user.statusUntil,
        isPublic: user.isPublic, // CRITICAL: Include isPublic field for global search filtering
        username: user.username
      };
    });
    
    console.log(`\n=== BACKEND STEP 3: FINAL API RESPONSE ===`);
    console.log(`Returning ${formattedUsers.length} users with profile image data`);
    console.log(`Final API Response:`, JSON.stringify({
      users: formattedUsers.map(u => ({
        name: u.fullName,
        phone: u.phoneNumber,
        profileImage: u.profileImage,
        profileImageExists: !!u.profileImage
      }))
    }, null, 2));
    
    // Add debug info to response if userId was provided
    const responseData = { users: formattedUsers };
    if (requestingUserId) {
      responseData.debug = {
        requestingUserId,
        totalUsersBeforeFiltering: await User.countDocuments({}),
        totalUsersAfterFiltering: formattedUsers.length,
        excludedUsersCount: excludedUserIds.length,
        filteringApplied: true
      };
    }
    
    res.json(responseData);
  } catch (error) {
    console.error('Error fetching registered users:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get user by userId (UUID)
// @route   GET /api/users?userid=:userId
// @access  Private
const getUserByUserId = async (req, res) => {
  try {
    const { userid } = req.query;

    if (!userid) {
      return res.status(400).json({ 
        success: false,
        message: 'User ID is required' 
      });
    }

    console.log(`Getting user data for userId: ${userid}`);

    // Find user by UUID (userId field)
    const user = await User.findOne({ userId: userid });

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // Return user data without sensitive information
    res.json({
      success: true,
      data: {
        _id: user._id,
        userId: user.userId,
        name: user.name,
        phoneNumber: user.phoneNumber,
        email: user.email,
        status: user.status,
        customStatus: user.customStatus,
        statusUntil: user.statusUntil,
        profileImage: user.profileImage,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
        // Global discovery fields
        isPublic: user.isPublic,
        username: user.username
      }
    });
  } catch (error) {
    console.error('Error getting user by userId:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
};

// @desc    Get all contacts for the authenticated user
// @route   GET /api/users/contacts
// @access  Private
const getUserContacts = async (req, res) => {
  try {
    // Get the authenticated user
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    console.log(`Getting contacts for user ${user._id}, contacts count: ${user.contacts.length}`);
    
    // If user has no contacts, return empty array
    if (!user.contacts || user.contacts.length === 0) {
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    // Get contacts with their status information
    const contacts = await User.find(
      { _id: { $in: user.contacts } },
      '_id userId name phoneNumber email profileImage status customStatus statusUntil'
    );

    console.log(`Found ${contacts.length} contacts`);
    
    res.status(200).json({
      success: true,
      data: contacts
    });
  } catch (error) {
    console.error('Error getting user contacts:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
};

// @desc    Get user by phone number
// @route   GET /api/users/phone/:phoneNumber
// @access  Private
const getUserByPhone = async (req, res) => {
  try {
    const { phoneNumber } = req.params;

    if (!phoneNumber) {
      return res.status(400).json({ 
        success: false,
        message: 'Phone number is required' 
      });
    }

    console.log(`Getting user data for phone: ${phoneNumber}`);

    // Find user by phone number
    const user = await User.findOne({ phoneNumber: phoneNumber });

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // Check if status timer has expired
    if (user.statusUntil && new Date() > new Date(user.statusUntil)) {
      user.status = 'available';
      user.customStatus = '';
      user.statusUntil = null;
      await user.save();
    }

    // Return user data without sensitive information
    res.json({
      success: true,
      data: {
        _id: user._id,
        userId: user.userId,
        name: user.name,
        phoneNumber: user.phoneNumber,
        email: user.email,
        status: user.status,
        customStatus: user.customStatus,
        statusUntil: user.statusUntil,
        profileImage: user.profileImage,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender
      }
    });
  } catch (error) {
    console.error('Error getting user by phone number:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
};

// @desc    Update user profile with username and public settings
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfileWithDiscovery = async (req, res) => {
  try {
    const { name, username, isPublic, dateOfBirth, gender } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // Update basic fields
    if (name) {
      user.name = name;
      user.searchableName = name.toLowerCase(); // Update searchable name
    }
    if (typeof isPublic === 'boolean') user.isPublic = isPublic;
    if (dateOfBirth) user.dateOfBirth = dateOfBirth;
    if (gender) user.gender = gender;

    // Handle username update with validation
    if (username !== undefined) {
      if (username === '') {
        // Allow clearing username
        user.username = undefined;
      } else {
        // Validate username format
        if (username.length < 3 || username.length > 20) {
          return res.status(400).json({
            success: false,
            message: 'Username must be 3-20 characters long'
          });
        }

        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
          return res.status(400).json({
            success: false,
            message: 'Username can only contain letters, numbers, and underscores'
          });
        }

        // Check if username is already taken (excluding current user)
        const existingUser = await User.findOne({
          username: username,
          _id: { $ne: user._id }
        });

        if (existingUser) {
          return res.status(400).json({
            success: false,
            message: 'Username is already taken'
          });
        }

        user.username = username;
      }
    }

    await user.save();

    console.log(`✅ User profile updated: ${user.userId} - Username: ${user.username}, Public: ${user.isPublic}`);

    res.json({
      success: true,
      data: {
        _id: user._id,
        userId: user.userId,
        name: user.name,
        phoneNumber: user.phoneNumber,
        email: user.email,
        profileImage: user.profileImage,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
        username: user.username,
        isPublic: user.isPublic
      },
      message: 'Profile updated successfully'
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
};

// @desc    Reset password (Admin only - no current password required)
// @route   POST /api/users/admin/reset-password
// @access  Admin
const adminResetPassword = async (req, res) => {
  try {
    console.log('Admin reset password request received:', req.body);
    
    const { identifier, newPassword } = req.body;

    if (!identifier || !newPassword) {
      console.log('Missing required fields:', { identifier: !!identifier, newPassword: !!newPassword });
      return res.status(400).json({
        success: false,
        message: 'User identifier and new password are required'
      });
    }

    if (newPassword.length < 6) {
      console.log('Password too short:', newPassword.length);
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Find user by email, phone, or userId
    let user;
    console.log('Searching for user with identifier:', identifier);
    
    if (identifier.includes('@')) {
      user = await User.findOne({ email: identifier }).select('+password');
      console.log('Searched by email, found:', !!user);
    } else if (/^\d+$/.test(identifier)) {
      user = await User.findOne({ phoneNumber: identifier }).select('+password');
      console.log('Searched by phone, found:', !!user);
    } else {
      user = await User.findOne({ userId: identifier }).select('+password');
      console.log('Searched by userId, found:', !!user);
    }

    if (!user) {
      console.log('User not found for identifier:', identifier);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('Found user:', { name: user.name, email: user.email, phone: user.phoneNumber });

    // Update password directly
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    
    await user.save();
    console.log('Password updated successfully for user:', user.name);

    res.json({
      success: true,
      message: `Password reset successfully for ${user.name} (${user.phoneNumber})`,
      data: {
        userId: user.userId,
        name: user.name,
        phoneNumber: user.phoneNumber,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Admin password reset error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get all users for admin panel
// @route   GET /api/users/admin/all
// @access  Admin
const getAllUsersForAdmin = async (req, res) => {
  try {
    console.log('Admin get all users request received');
    const { page = 1, limit = 20, search = '' } = req.query;
    
    let query = {};
    if (search) {
      query = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phoneNumber: { $regex: search, $options: 'i' } },
          { userId: { $regex: search, $options: 'i' } }
        ]
      };
    }

    const users = await User.find(query)
      .select('userId name phoneNumber email status createdAt')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    console.log(`Found ${users.length} users for admin panel`);

    res.json({
      success: true,
      data: {
        users,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        total
      }
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Test endpoint to set user as public (for debugging)
// @route   POST /api/users/set-public
// @access  Private
const setUserPublic = async (req, res) => {
  try {
    const { isPublic = true } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    user.isPublic = isPublic;
    await user.save();

    console.log(`🔄 User ${user.name} (${user.userId}) set isPublic to: ${isPublic}`);

    res.status(200).json({
      success: true,
      message: `Profile visibility set to ${isPublic ? 'public' : 'private'}`,
      data: {
        userId: user.userId,
        name: user.name,
        isPublic: user.isPublic
      }
    });
  } catch (error) {
    console.error('Error setting user public status:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error while updating profile visibility' 
    });
  }
};

// @desc    Set up chat encryption PIN
// @route   POST /api/user/encryption-pin
// @access  Private
const setupEncryptionPin = async (req, res) => {
  try {
    const { pinHash, encryptionKey } = req.body;
    
    if (!pinHash || !encryptionKey) {
      return res.status(400).json({ message: 'PIN hash and encryption key are required' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update encryption settings
    user.encryptionSettings = {
      isEnabled: true,
      pinHash: pinHash,
      encryptionKey: encryptionKey,
      updatedAt: new Date()
    };

    await user.save();

    console.log(`🔐 [BACKEND] Encryption PIN set up for user: ${user.name}`);
    
    res.status(200).json({
      message: 'Encryption PIN set up successfully',
      encryptionEnabled: true
    });
  } catch (error) {
    console.error('❌ [BACKEND] Error setting up encryption PIN:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Verify chat encryption PIN
// @route   POST /api/user/encryption-verify
// @access  Private
const verifyEncryptionPin = async (req, res) => {
  try {
    const { pinHash } = req.body;
    
    if (!pinHash) {
      return res.status(400).json({ message: 'PIN hash is required' });
    }

    const user = await User.findById(req.user.id).select('+encryptionSettings.pinHash +encryptionSettings.encryptionKey');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.encryptionSettings || !user.encryptionSettings.pinHash) {
      return res.status(400).json({ message: 'No encryption PIN set up' });
    }

    // Verify PIN hash
    const isValidPin = user.encryptionSettings.pinHash === pinHash;
    
    if (isValidPin) {
      console.log(`✅ [BACKEND] Encryption PIN verified for user: ${user.name}`);
      res.status(200).json({
        message: 'PIN verified successfully',
        encryptionKey: user.encryptionSettings.encryptionKey,
        isEnabled: user.encryptionSettings.isEnabled
      });
    } else {
      console.log(`❌ [BACKEND] Invalid encryption PIN for user: ${user.name}`);
      res.status(401).json({ message: 'Invalid PIN' });
    }
  } catch (error) {
    console.error('❌ [BACKEND] Error verifying encryption PIN:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update chat encryption settings
// @route   POST /api/user/encryption-settings
// @access  Private
const updateEncryptionSettings = async (req, res) => {
  try {
    const { encryptionEnabled } = req.body;
    
    if (typeof encryptionEnabled !== 'boolean') {
      return res.status(400).json({ message: 'encryptionEnabled must be a boolean' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update encryption enabled status
    if (!user.encryptionSettings) {
      user.encryptionSettings = {};
    }
    
    user.encryptionSettings.isEnabled = encryptionEnabled;
    user.encryptionSettings.updatedAt = new Date();

    await user.save();

    console.log(`🔐 [BACKEND] Encryption ${encryptionEnabled ? 'enabled' : 'disabled'} for user: ${user.name}`);
    
    res.status(200).json({
      message: `Encryption ${encryptionEnabled ? 'enabled' : 'disabled'} successfully`,
      encryptionEnabled: encryptionEnabled
    });
  } catch (error) {
    console.error('❌ [BACKEND] Error updating encryption settings:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get chat encryption settings
// @route   GET /api/user/encryption-settings
// @access  Private
const getEncryptionSettings = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const settings = {
      encryptionEnabled: user.encryptionSettings?.isEnabled || false,
      hasPinSetup: !!(user.encryptionSettings?.pinHash),
      updatedAt: user.encryptionSettings?.updatedAt || null
    };

    res.status(200).json(settings);
  } catch (error) {
    console.error('❌ [BACKEND] Error getting encryption settings:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Verify user password for PIN reset
// @route   POST /api/users/verify-password
// @access  Private
const verifyUserPassword = async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ message: 'Password is required' });
    }

    const user = await User.findById(req.user.id).select('+password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify password
    const isValidPassword = await user.matchPassword(password);
    
    if (isValidPassword) {
      console.log(`✅ [BACKEND] Password verified for PIN reset: ${user.name}`);
      res.status(200).json({
        message: 'Password verified successfully',
        verified: true
      });
    } else {
      console.log(`❌ [BACKEND] Invalid password for PIN reset: ${user.name}`);
      res.status(401).json({ message: 'Invalid password' });
    }
  } catch (error) {
    console.error('❌ [BACKEND] Error verifying password:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getUserProfile,
  updateUserProfile,
  updateUserStatus,
  getRegisteredUsers,
  getUserByUserId,
  getUserContacts,
  getUserByPhone,
  updateUserProfileWithDiscovery,
  adminResetPassword,
  getAllUsersForAdmin,
  setUserPublic,
  setupEncryptionPin,
  verifyEncryptionPin,
  updateEncryptionSettings,
  getEncryptionSettings,
  verifyUserPassword
};
