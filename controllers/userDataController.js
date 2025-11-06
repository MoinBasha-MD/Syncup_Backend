const User = require('../models/userModel');
const StatusHistory = require('../models/statusHistoryModel');
const StatusTemplate = require('../models/statusTemplateModel');
const StatusSchedule = require('../models/statusScheduleModel');

/**
 * @desc    Get all user data including profile, history, templates, and schedules
 * @route   GET /api/users/:userId/data
 * @access  Private
 */
const getUserData = async (req, res) => {
  try {
    const { userId } = req.params;

    // Verify the user exists
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if the requesting user is authorized to view this data
    // Only allow users to view their own data or administrators
    if (req.user.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to view this user data' });
    }

    // Get user profile data (excluding sensitive information)
    const userData = {
      userId: user.userId,
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber,
      username: user.username,
      profileImage: user.profileImage,
      dateOfBirth: user.dateOfBirth,
      gender: user.gender,
      bio: user.bio,
      isPublic: user.isPublic,
      status: user.status,
      customStatus: user.customStatus,
      statusUntil: user.statusUntil,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    // Return the user data
    res.json({
      success: true,
      data: userData
    });
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * @desc    Get user status history
 * @route   GET /api/users/:userId/history
 * @access  Private
 */
const getUserHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10, startDate, endDate } = req.query;

    // Verify the user exists
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if the requesting user is authorized to view this data
    if (req.user.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to view this user history' });
    }

    // Build query
    const query = { userId };
    
    // Add date range filter if provided
    if (startDate && endDate) {
      query.startTime = { 
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else if (startDate) {
      query.startTime = { $gte: new Date(startDate) };
    } else if (endDate) {
      query.startTime = { $lte: new Date(endDate) };
    }

    // Get status history with pagination
    const history = await StatusHistory.find(query)
      .sort({ startTime: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));
    
    const total = await StatusHistory.countDocuments(query);

    res.json({
      success: true,
      data: history,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching user history:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * @desc    Get user status templates
 * @route   GET /api/users/:userId/templates
 * @access  Private
 */
const getUserTemplates = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    // Verify the user exists
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if the requesting user is authorized to view this data
    if (req.user.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to view this user templates' });
    }

    // Get status templates with pagination
    const templates = await StatusTemplate.find({ userId })
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));
    
    const total = await StatusTemplate.countDocuments({ userId });

    res.json({
      success: true,
      data: templates,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching user templates:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * @desc    Get user status schedules
 * @route   GET /api/users/:userId/schedules
 * @access  Private
 */
const getUserSchedules = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10, active = true, startDate, endDate } = req.query;

    // Verify the user exists
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if the requesting user is authorized to view this data
    if (req.user.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to view this user schedules' });
    }

    // Build query
    const query = { 
      userId
    };
    
    // Only filter by active status if explicitly provided
    if (active !== undefined && active !== 'undefined') {
      query.active = active === 'true' || active === true;
    }

    // Add date range filter if provided
    if (startDate && endDate) {
      // Find schedules that overlap with the requested date range
      // Schedule overlaps if: schedule.startTime < endDate AND schedule.endTime > startDate
      query.$and = [
        { startTime: { $lt: new Date(endDate) } },
        { endTime: { $gt: new Date(startDate) } }
      ];
      console.log(`📅 Filtering schedules for date range: ${startDate} to ${endDate}`);
    } else if (startDate) {
      // For upcoming schedules: get schedules that start after the given date OR end after the given date
      query.startTime = { $gte: new Date(startDate) };
      console.log(`📅 Filtering upcoming schedules from: ${startDate}`);
    } else if (endDate) {
      query.startTime = { $lt: new Date(endDate) };
      console.log(`📅 Filtering schedules before: ${endDate}`);
    }

    console.log('📋 Schedule query:', JSON.stringify(query, null, 2));

    // Get status schedules with pagination
    const schedules = await StatusSchedule.find(query)
      .sort({ startTime: 1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));
    
    const total = await StatusSchedule.countDocuments(query);

    console.log(`✅ Found ${schedules.length} schedules for user ${userId}`);
    if (schedules.length > 0) {
      console.log('📋 Schedule details:');
      schedules.forEach((schedule, index) => {
        console.log(`  ${index + 1}. ${schedule.status} - ${schedule.startTime} to ${schedule.endTime} (Active: ${schedule.active})`);
      });
    }

    // Return schedules with success/data structure to match frontend expectations
    res.json({
      success: true,
      data: schedules,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching user schedules:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * @desc    Get contact status schedules (for registered contacts only)
 * @route   GET /api/users/:userId/contact-schedules
 * @access  Private
 */
const getContactSchedules = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10, active = true, date, phoneNumber } = req.query;

    // Verify the requesting user is logged in
    if (!req.user) {
      return res.status(401).json({ message: 'Not authorized' });
    }
    
    let targetUser;
    
    // If phoneNumber is provided, look up user by phone number
    if (phoneNumber) {
      console.log(`Looking up user by phone number: ${phoneNumber}`);
      targetUser = await User.findOne({ phoneNumber });
      if (!targetUser) {
        return res.status(404).json({ message: 'User not found with the provided phone number' });
      }
      console.log(`Found user by phone number: ${targetUser.userId}`);
    } else {
      // Otherwise, look up by userId
      console.log(`Looking up user by userId: ${userId}`);
      targetUser = await User.findOne({ userId });
      if (!targetUser) {
        return res.status(404).json({ message: 'User not found' });
      }
    }

    // Build query using the target user's ID
    const query = { 
      userId: targetUser.userId, // Use the found user's ID
      active: active === 'true' || active === true
    };
    
    console.log(`Querying schedules for user ID: ${targetUser.userId}`);

    // If a specific date is provided, filter by that date
    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      
      query.startTime = { $gte: startDate, $lte: endDate };
      console.log(`Filtering by date: ${date}, start: ${startDate}, end: ${endDate}`);
    }

    // Get status schedules with pagination
    const schedules = await StatusSchedule.find(query)
      .sort({ startTime: 1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));
    
    console.log(`Found ${schedules.length} schedules for user ${targetUser.userId}`);
    
    const total = await StatusSchedule.countDocuments(query);

    // Only return non-sensitive schedule information
    const sanitizedSchedules = schedules.map(schedule => ({
      _id: schedule._id,
      status: schedule.status,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      active: schedule.active,
      repeat: schedule.repeat,
      notes: schedule.notes // Include notes for better user experience
    }));

    res.json({
      success: true,
      data: sanitizedSchedules,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching contact schedules:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * @desc    Get user data analytics
 * @route   GET /api/users/:userId/analytics
 * @access  Private
 */
const getUserAnalytics = async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = req.query;

    // Verify the user exists
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if the requesting user is authorized to view this data
    if (req.user.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to view this user analytics' });
    }

    // Build query
    const query = { userId };
    
    // Add date range filter if provided
    if (startDate && endDate) {
      query.startTime = { 
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    } else if (startDate) {
      query.startTime = { $gte: new Date(startDate) };
    } else if (endDate) {
      query.startTime = { $lte: new Date(endDate) };
    }
    
    // Get all status history entries for the user within the date range
    const statusHistory = await StatusHistory.find(query);
    
    // Calculate total time spent in each status
    const statusDurations = {};
    let totalDuration = 0;
    
    statusHistory.forEach(entry => {
      if (!statusDurations[entry.status]) {
        statusDurations[entry.status] = 0;
      }
      statusDurations[entry.status] += entry.duration;
      totalDuration += entry.duration;
    });
    
    // Calculate percentage for each status
    const statusPercentages = {};
    Object.keys(statusDurations).forEach(status => {
      statusPercentages[status] = totalDuration > 0 
        ? Math.round((statusDurations[status] / totalDuration) * 100) 
        : 0;
    });
    
    // Get most frequent status
    let mostFrequentStatus = null;
    let maxDuration = 0;
    Object.keys(statusDurations).forEach(status => {
      if (statusDurations[status] > maxDuration) {
        maxDuration = statusDurations[status];
        mostFrequentStatus = status;
      }
    });
    
    // Get status pattern suggestions based on time of day
    const morningStatuses = {};
    const afternoonStatuses = {};
    const eveningStatuses = {};
    
    statusHistory.forEach(entry => {
      const hour = new Date(entry.startTime).getHours();
      
      if (hour >= 5 && hour < 12) {
        // Morning (5 AM - 12 PM)
        if (!morningStatuses[entry.status]) {
          morningStatuses[entry.status] = 0;
        }
        morningStatuses[entry.status]++;
      } else if (hour >= 12 && hour < 18) {
        // Afternoon (12 PM - 6 PM)
        if (!afternoonStatuses[entry.status]) {
          afternoonStatuses[entry.status] = 0;
        }
        afternoonStatuses[entry.status]++;
      } else {
        // Evening/Night (6 PM - 5 AM)
        if (!eveningStatuses[entry.status]) {
          eveningStatuses[entry.status] = 0;
        }
        eveningStatuses[entry.status]++;
      }
    });
    
    // Find most common status for each time period
    const getMostCommonStatus = (statusCounts) => {
      let mostCommon = null;
      let maxCount = 0;
      Object.keys(statusCounts).forEach(status => {
        if (statusCounts[status] > maxCount) {
          maxCount = statusCounts[status];
          mostCommon = status;
        }
      });
      return mostCommon;
    };
    
    const suggestions = {
      morning: getMostCommonStatus(morningStatuses),
      afternoon: getMostCommonStatus(afternoonStatuses),
      evening: getMostCommonStatus(eveningStatuses)
    };

    res.json({
      success: true,
      data: {
        totalEntries: statusHistory.length,
        totalDuration,
        statusDurations,
        statusPercentages,
        mostFrequentStatus,
        suggestions
      }
    });
  } catch (error) {
    console.error('Error fetching user analytics:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * @desc    Get comprehensive user profile with all related data
 * @route   GET /api/users/:userId/profile
 * @access  Private
 */
const getUserProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    // Verify the user exists
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if the requesting user is authorized to view this data
    if (req.user.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to view this user profile' });
    }

    // Get user profile data (excluding sensitive information)
    const userData = {
      userId: user.userId,
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber,
      status: user.status,
      customStatus: user.customStatus,
      statusUntil: user.statusUntil,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    // Get recent status history (last 5 entries)
    const recentHistory = await StatusHistory.find({ userId })
      .sort({ startTime: -1 })
      .limit(5);

    // Get active status schedules
    const activeSchedules = await StatusSchedule.find({ 
      userId,
      active: true,
      startTime: { $gte: new Date() }
    })
      .sort({ startTime: 1 })
      .limit(5);

    // Get status templates
    const templates = await StatusTemplate.find({ userId })
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      success: true,
      data: {
        profile: userData,
        recentHistory,
        activeSchedules,
        templates
      }
    });
  } catch (error) {
    console.error('Error fetching comprehensive user profile:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * @desc    Create user status schedule
 * @route   POST /api/users/:userId/schedules
 * @access  Private
 */
const createUserSchedule = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, customStatus, startTime, endTime, repeat, active, notes, duration } = req.body;

    // Verify the user exists
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if the requesting user is authorized to create data for this user
    if (req.user.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to create schedules for this user' });
    }

    // Validate required fields
    if (!status || !startTime) {
      return res.status(400).json({ message: 'Please provide status and startTime' });
    }

    // Calculate endTime if duration is provided instead
    let finalEndTime = endTime;
    if (!endTime && duration) {
      const start = new Date(startTime);
      finalEndTime = new Date(start.getTime() + duration * 60000); // Convert minutes to milliseconds
    } else if (!endTime) {
      return res.status(400).json({ message: 'Please provide either endTime or duration' });
    }

    // Create the status schedule
    const statusSchedule = await StatusSchedule.create({
      user: user._id, // Set the MongoDB ObjectId
      userId, // Set the UUID
      status,
      customStatus,
      startTime,
      endTime: finalEndTime,
      repeat: repeat || 'none',
      active: active !== undefined ? active : true,
      notes
    });

    if (statusSchedule) {
      res.status(201).json({
        success: true,
        data: statusSchedule
      });
    } else {
      res.status(400).json({ message: 'Invalid schedule data' });
    }
  } catch (error) {
    console.error('Error creating user schedule:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * @desc    Update user status schedule
 * @route   PUT /api/users/:userId/schedules/:id
 * @access  Private
 */
const updateUserSchedule = async (req, res) => {
  try {
    const { userId, id } = req.params;
    const { status, customStatus, startTime, endTime, repeat, active, notes, duration } = req.body;

    // Verify the user exists
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if the requesting user is authorized to update data for this user
    if (req.user.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to update schedules for this user' });
    }

    // Find the schedule
    const statusSchedule = await StatusSchedule.findById(id);
    if (!statusSchedule) {
      return res.status(404).json({ message: 'Status schedule not found' });
    }

    // Verify the schedule belongs to the specified user
    if (statusSchedule.userId !== userId) {
      return res.status(403).json({ message: 'Schedule does not belong to this user' });
    }

    // Calculate endTime if duration is provided instead
    let finalEndTime = endTime;
    if (!endTime && duration && startTime) {
      const start = new Date(startTime);
      finalEndTime = new Date(start.getTime() + duration * 60000); // Convert minutes to milliseconds
    } else if (endTime) {
      finalEndTime = endTime;
    }

    // Update the schedule
    statusSchedule.status = status || statusSchedule.status;
    statusSchedule.customStatus = customStatus !== undefined ? customStatus : statusSchedule.customStatus;
    statusSchedule.startTime = startTime || statusSchedule.startTime;
    statusSchedule.endTime = finalEndTime || statusSchedule.endTime;
    statusSchedule.repeat = repeat || statusSchedule.repeat;
    statusSchedule.notes = notes !== undefined ? notes : statusSchedule.notes;
    
    // Only update active status if explicitly provided
    if (active !== undefined) {
      statusSchedule.active = active;
    }

    const updatedSchedule = await statusSchedule.save();
    res.json({
      success: true,
      data: updatedSchedule
    });
  } catch (error) {
    console.error('Error updating user schedule:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * @desc    Delete user status schedule
 * @route   DELETE /api/users/:userId/schedules/:id
 * @access  Private
 */
const deleteUserSchedule = async (req, res) => {
  try {
    const { userId, id } = req.params;

    // Verify the user exists
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if the requesting user is authorized to delete data for this user
    if (req.user.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to delete schedules for this user' });
    }

    // Find the schedule
    const statusSchedule = await StatusSchedule.findById(id);
    if (!statusSchedule) {
      return res.status(404).json({ message: 'Status schedule not found' });
    }

    // Verify the schedule belongs to the specified user
    if (statusSchedule.userId !== userId) {
      return res.status(403).json({ message: 'Schedule does not belong to this user' });
    }

    // Use deleteOne instead of the deprecated remove() method
    await StatusSchedule.deleteOne({ _id: id });
    res.json({ 
      success: true,
      message: 'Status schedule removed' 
    });
  } catch (error) {
    console.error('Error deleting user schedule:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  getUserData,
  getUserHistory,
  getUserTemplates,
  getUserSchedules,
  getContactSchedules,
  getUserAnalytics,
  getUserProfile,
  createUserSchedule,
  updateUserSchedule,
  deleteUserSchedule
};
