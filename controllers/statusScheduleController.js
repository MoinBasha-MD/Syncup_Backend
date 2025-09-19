const asyncHandler = require('express-async-handler');
const StatusSchedule = require('../models/statusScheduleModel');

// @desc    Get user status schedules
// @route   GET /api/status/schedules
// @access  Private
const getStatusSchedules = asyncHandler(async (req, res) => {
  const statusSchedules = await StatusSchedule.find({ 
    user: req.user._id,
    active: true
  }).sort({ startTime: 1 });
  
  res.json(statusSchedules);
});

// @desc    Create new status schedule
// @route   POST /api/status/schedules
// @access  Private
const createStatusSchedule = asyncHandler(async (req, res) => {
  const { status, customStatus, startTime, endTime, repeat } = req.body;

  if (!status || !startTime || !endTime) {
    res.status(400);
    throw new Error('Please provide all required fields');
  }

  const statusSchedule = await StatusSchedule.create({
    user: req.user._id,
    status,
    customStatus,
    startTime,
    endTime,
    repeat: repeat || 'none',
    active: true,
  });

  if (statusSchedule) {
    res.status(201).json(statusSchedule);
  } else {
    res.status(400);
    throw new Error('Invalid status schedule data');
  }
});

// @desc    Update status schedule
// @route   PUT /api/status/schedules/:id
// @access  Private
const updateStatusSchedule = asyncHandler(async (req, res) => {
  const { status, customStatus, startTime, endTime, repeat, active } = req.body;
  
  const statusSchedule = await StatusSchedule.findById(req.params.id);

  if (!statusSchedule) {
    res.status(404);
    throw new Error('Status schedule not found');
  }

  // Check if the status schedule belongs to the logged-in user
  if (statusSchedule.user.toString() !== req.user._id.toString()) {
    res.status(401);
    throw new Error('Not authorized to update this status schedule');
  }

  statusSchedule.status = status || statusSchedule.status;
  statusSchedule.customStatus = customStatus || statusSchedule.customStatus;
  statusSchedule.startTime = startTime || statusSchedule.startTime;
  statusSchedule.endTime = endTime || statusSchedule.endTime;
  statusSchedule.repeat = repeat || statusSchedule.repeat;
  
  // Only update active status if explicitly provided
  if (active !== undefined) {
    statusSchedule.active = active;
  }

  const updatedStatusSchedule = await statusSchedule.save();
  res.json(updatedStatusSchedule);
});

// @desc    Delete status schedule
// @route   DELETE /api/status/schedules/:id
// @access  Private
const deleteStatusSchedule = asyncHandler(async (req, res) => {
  const statusSchedule = await StatusSchedule.findById(req.params.id);

  if (!statusSchedule) {
    res.status(404);
    throw new Error('Status schedule not found');
  }

  // Check if the status schedule belongs to the logged-in user
  if (statusSchedule.user.toString() !== req.user._id.toString()) {
    res.status(401);
    throw new Error('Not authorized to delete this status schedule');
  }

  await statusSchedule.remove();
  res.json({ message: 'Status schedule removed' });
});

// @desc    Get upcoming status schedules
// @route   GET /api/status/schedules/upcoming
// @access  Private
const getUpcomingStatusSchedules = asyncHandler(async (req, res) => {
  const now = new Date();
  
  // Get all active schedules that start in the future or are recurring
  const statusSchedules = await StatusSchedule.find({
    user: req.user._id,
    active: true,
    $or: [
      { startTime: { $gte: now } },
      { repeat: { $ne: 'none' } }
    ]
  }).sort({ startTime: 1 }).limit(5);
  
  res.json(statusSchedules);
});

module.exports = {
  getStatusSchedules,
  createStatusSchedule,
  updateStatusSchedule,
  deleteStatusSchedule,
  getUpcomingStatusSchedules,
};
