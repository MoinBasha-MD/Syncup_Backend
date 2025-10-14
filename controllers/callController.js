const asyncHandler = require('express-async-handler');
const Call = require('../models/callModel');
const User = require('../models/userModel');

// @desc    Get call history for current user
// @route   GET /api/calls/history
// @access  Private
const getCallHistory = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const limit = parseInt(req.query.limit) || 50;
  const page = parseInt(req.query.page) || 1;
  const skip = (page - 1) * limit;

  const calls = await Call.find({
    $or: [
      { callerId: userId },
      { receiverId: userId }
    ]
  })
  .sort({ createdAt: -1 })
  .limit(limit)
  .skip(skip);

  const total = await Call.countDocuments({
    $or: [
      { callerId: userId },
      { receiverId: userId }
    ]
  });

  res.json({
    success: true,
    calls,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit
    }
  });
});

// @desc    Get missed calls for current user
// @route   GET /api/calls/missed
// @access  Private
const getMissedCalls = asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  const missedCalls = await Call.find({
    receiverId: userId,
    status: 'missed'
  })
  .sort({ createdAt: -1 });

  const unseenCount = await Call.countDocuments({
    receiverId: userId,
    status: 'missed',
    missedCallSeen: false
  });

  res.json({
    success: true,
    missedCalls,
    unseenCount
  });
});

// @desc    Mark missed calls as seen
// @route   POST /api/calls/missed/mark-seen
// @access  Private
const markMissedCallsAsSeen = asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  const result = await Call.markMissedCallsAsSeen(userId);

  res.json({
    success: true,
    message: 'Missed calls marked as seen',
    modifiedCount: result.modifiedCount
  });
});

// @desc    Mark specific call as seen
// @route   POST /api/calls/:callId/mark-seen
// @access  Private
const markCallAsSeen = asyncHandler(async (req, res) => {
  const { callId } = req.params;
  const userId = req.user.userId;

  const call = await Call.findOne({
    callId,
    receiverId: userId
  });

  if (!call) {
    res.status(404);
    throw new Error('Call not found');
  }

  call.missedCallSeen = true;
  await call.save();

  res.json({
    success: true,
    message: 'Call marked as seen',
    call
  });
});

// @desc    Delete call from history
// @route   DELETE /api/calls/:callId
// @access  Private
const deleteCall = asyncHandler(async (req, res) => {
  const { callId } = req.params;
  const userId = req.user.userId;

  const call = await Call.findOne({
    callId,
    $or: [
      { callerId: userId },
      { receiverId: userId }
    ]
  });

  if (!call) {
    res.status(404);
    throw new Error('Call not found');
  }

  await call.deleteOne();

  res.json({
    success: true,
    message: 'Call deleted from history'
  });
});

// @desc    Get call statistics
// @route   GET /api/calls/stats
// @access  Private
const getCallStats = asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  const totalCalls = await Call.countDocuments({
    $or: [
      { callerId: userId },
      { receiverId: userId }
    ]
  });

  const missedCalls = await Call.countDocuments({
    receiverId: userId,
    status: 'missed'
  });

  const receivedCalls = await Call.countDocuments({
    receiverId: userId,
    status: { $in: ['connected', 'ended'] }
  });

  const madeCalls = await Call.countDocuments({
    callerId: userId,
    status: { $in: ['connected', 'ended'] }
  });

  // Calculate total call duration
  const durationResult = await Call.aggregate([
    {
      $match: {
        $or: [
          { callerId: userId },
          { receiverId: userId }
        ],
        status: 'ended',
        duration: { $gt: 0 }
      }
    },
    {
      $group: {
        _id: null,
        totalDuration: { $sum: '$duration' },
        avgDuration: { $avg: '$duration' }
      }
    }
  ]);

  const stats = {
    totalCalls,
    missedCalls,
    receivedCalls,
    madeCalls,
    totalDuration: durationResult[0]?.totalDuration || 0,
    avgDuration: Math.round(durationResult[0]?.avgDuration || 0),
    totalDurationMinutes: Math.ceil((durationResult[0]?.totalDuration || 0) / 60)
  };

  res.json({
    success: true,
    stats
  });
});

// @desc    Get single call details
// @route   GET /api/calls/:callId
// @access  Private
const getCallDetails = asyncHandler(async (req, res) => {
  const { callId } = req.params;
  const userId = req.user.userId;

  const call = await Call.findOne({
    callId,
    $or: [
      { callerId: userId },
      { receiverId: userId }
    ]
  });

  if (!call) {
    res.status(404);
    throw new Error('Call not found');
  }

  res.json({
    success: true,
    call
  });
});

// @desc    Save call to history
// @route   POST /api/calls/history
// @access  Private
const saveCallToHistory = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const {
    callId,
    contactId,
    callType,
    direction,
    status,
    startTime,
    endTime,
    duration,
    callQuality
  } = req.body;

  // Validate required fields
  if (!callId || !contactId || !callType || !direction || !status) {
    res.status(400);
    throw new Error('Missing required fields');
  }

  // Determine caller and receiver based on direction
  const callerId = direction === 'outgoing' ? userId : contactId;
  const receiverId = direction === 'incoming' ? userId : contactId;

  // Check if call already exists
  const existingCall = await Call.findOne({ callId });
  if (existingCall) {
    // Update existing call
    existingCall.status = status;
    existingCall.endTime = endTime || existingCall.endTime;
    existingCall.duration = duration || existingCall.duration;
    existingCall.callQuality = callQuality || existingCall.callQuality;
    await existingCall.save();

    return res.json({
      success: true,
      message: 'Call history updated',
      call: existingCall
    });
  }

  // Create new call record
  const call = await Call.create({
    callId,
    callerId,
    receiverId,
    callType,
    status,
    startTime: startTime || new Date(),
    endTime: endTime || null,
    duration: duration || 0,
    callQuality: callQuality || 'unknown',
    missedCallSeen: status !== 'missed'
  });

  res.status(201).json({
    success: true,
    message: 'Call saved to history',
    call
  });
});

module.exports = {
  getCallHistory,
  getMissedCalls,
  markMissedCallsAsSeen,
  markCallAsSeen,
  deleteCall,
  getCallStats,
  getCallDetails,
  saveCallToHistory
};
