const asyncHandler = require('express-async-handler');
const StatusHistory = require('../models/statusHistoryModel');

// @desc    Get user status history
// @route   GET /api/status/history
// @access  Private
const getStatusHistory = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  let query = { user: req.user._id };

  // Add date range filter if provided
  if (startDate && endDate) {
    query.startTime = { 
      $gte: new Date(startDate), 
      $lte: new Date(endDate) 
    };
  }

  const statusHistory = await StatusHistory.find(query).sort({ startTime: -1 });
  res.json(statusHistory);
});

// @desc    Create new status history entry
// @route   POST /api/status/history
// @access  Private
const createStatusHistory = asyncHandler(async (req, res) => {
  const { status, customStatus, startTime, endTime, duration } = req.body;

  if (!status || !startTime || !endTime || !duration) {
    res.status(400);
    throw new Error('Please provide all required fields');
  }

  const statusHistory = await StatusHistory.create({
    user: req.user._id,
    userId: req.user.userId, // Add userId from the user object
    status,
    customStatus,
    startTime,
    endTime,
    duration,
  });

  if (statusHistory) {
    res.status(201).json(statusHistory);
  } else {
    res.status(400);
    throw new Error('Invalid status history data');
  }
});

// @desc    Delete status history entry
// @route   DELETE /api/status/history/:id
// @access  Private
const deleteStatusHistory = asyncHandler(async (req, res) => {
  const statusHistory = await StatusHistory.findById(req.params.id);

  if (!statusHistory) {
    res.status(404);
    throw new Error('Status history not found');
  }

  // Check if the status history belongs to the logged-in user
  if (statusHistory.user.toString() !== req.user._id.toString()) {
    res.status(401);
    throw new Error('Not authorized to delete this status history');
  }

  // Using findByIdAndDelete instead of the deprecated remove() method
  await StatusHistory.findByIdAndDelete(req.params.id);
  res.json({ message: 'Status history removed' });
});

// @desc    Get status analytics
// @route   GET /api/status/history/analytics
// @access  Private
const getStatusAnalytics = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  let query = { user: req.user._id };

  // Add date range filter if provided
  if (startDate && endDate) {
    query.startTime = { 
      $gte: new Date(startDate), 
      $lte: new Date(endDate) 
    };
  }

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
  
  // Find most used status
  let mostUsedStatus = null;
  let maxDuration = 0;
  
  Object.keys(statusDurations).forEach(status => {
    if (statusDurations[status] > maxDuration) {
      maxDuration = statusDurations[status];
      mostUsedStatus = status;
    }
  });
  
  res.json({
    totalEntries: statusHistory.length,
    totalDuration,
    statusDurations,
    mostUsedStatus,
  });
});

module.exports = {
  getStatusHistory,
  createStatusHistory,
  deleteStatusHistory,
  getStatusAnalytics,
};
