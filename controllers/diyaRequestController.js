const User = require('../models/userModel');
const DiyaRequest = require('../models/diyaRequestModel');
const { broadcastToUser } = require('../socketManager');

// Create a new cross-user availability request
const createAvailabilityRequest = async (req, res) => {
  try {
    const { targetUserId, requestMessage, requestType = 'availability' } = req.body;
    const requesterId = req.user.userId;

    console.log('🔄 Creating availability request:', {
      requesterId,
      targetUserId,
      requestType,
      requestMessage
    });

    // Validate requester and target users exist
    const [requester, targetUser] = await Promise.all([
      User.findOne({ userId: requesterId }).select('userId name profileImage'),
      User.findOne({ userId: targetUserId }).select('userId name profileImage')
    ]);

    if (!requester) {
      return res.status(404).json({
        success: false,
        message: 'Requester not found'
      });
    }

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'Target user not found'
      });
    }

    // Create the request
    const diyaRequest = new DiyaRequest({
      requesterId: requesterId,
      targetUserId: targetUserId,
      requestType: requestType,
      requestMessage: requestMessage || `${requester.name} wants to know your availability`,
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now
    });

    await diyaRequest.save();

    console.log('✅ Diya request created:', diyaRequest._id);

    // Broadcast to target user's Diya
    const notificationData = {
      type: 'diya_request',
      requestId: diyaRequest._id,
      requesterName: requester.name,
      requesterUserId: requesterId,
      requestMessage: diyaRequest.requestMessage,
      requestType: requestType,
      timestamp: new Date().toISOString()
    };

    // Find target user's MongoDB _id for socket broadcasting
    const targetUserObjectId = targetUser._id.toString();
    broadcastToUser(targetUserObjectId, 'diya:request', notificationData);

    console.log('📡 Broadcasted request to target user:', targetUserId);

    res.status(201).json({
      success: true,
      data: {
        requestId: diyaRequest._id,
        message: 'Availability request sent successfully',
        expiresAt: diyaRequest.expiresAt
      }
    });

  } catch (error) {
    console.error('❌ Error creating availability request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create availability request',
      error: error.message
    });
  }
};

// Respond to a cross-user availability request
const respondToRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { response, responseMessage } = req.body;
    const responderId = req.user.userId;

    console.log('📝 Responding to request:', {
      requestId,
      responderId,
      response,
      responseMessage
    });

    // Find the request
    const diyaRequest = await DiyaRequest.findById(requestId);
    
    if (!diyaRequest) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    // Verify the responder is the target user
    if (diyaRequest.targetUserId !== responderId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to respond to this request'
      });
    }

    // Check if request is still pending and not expired
    if (diyaRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Request has already been responded to'
      });
    }

    if (new Date() > diyaRequest.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Request has expired'
      });
    }

    // Update the request with response
    diyaRequest.status = response === 'share' ? 'responded' : 'declined';
    diyaRequest.response = response;
    diyaRequest.responseMessage = responseMessage || (response === 'share' ? 'No free time' : 'Declined to share');
    diyaRequest.respondedAt = new Date();

    await diyaRequest.save();

    console.log('✅ Request response saved:', diyaRequest._id);

    // Get responder details
    const responder = await User.findOne({ userId: responderId }).select('userId name');

    // Broadcast response back to requester's Diya
    const responseData = {
      type: 'diya_response',
      requestId: diyaRequest._id,
      responderName: responder.name,
      responderUserId: responderId,
      response: response,
      responseMessage: diyaRequest.responseMessage,
      timestamp: new Date().toISOString()
    };

    // Find requester's MongoDB _id for socket broadcasting
    const requester = await User.findOne({ userId: diyaRequest.requesterId }).select('_id userId');
    const requesterObjectId = requester._id.toString();
    broadcastToUser(requesterObjectId, 'diya:response', responseData);

    console.log('📡 Broadcasted response to requester:', diyaRequest.requesterId);

    res.status(200).json({
      success: true,
      data: {
        message: 'Response sent successfully',
        response: response,
        responseMessage: diyaRequest.responseMessage
      }
    });

  } catch (error) {
    console.error('❌ Error responding to request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to respond to request',
      error: error.message
    });
  }
};

// Get pending requests for a user
const getPendingRequests = async (req, res) => {
  try {
    // Enhanced debugging for authentication issues
    console.log('🔍 Auth Debug - req.user:', {
      exists: !!req.user,
      userId: req.user?.userId,
      _id: req.user?._id,
      keys: req.user ? Object.keys(req.user) : 'no user object'
    });

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required - no user found in request'
      });
    }

    if (!req.user.userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required - userId not found in user object'
      });
    }

    const userId = req.user.userId;

    console.log('📋 Getting pending requests for user:', userId);

    const pendingRequests = await DiyaRequest.find({
      targetUserId: userId,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    }).sort({ createdAt: -1 });

    // Get requester details for each request
    const requestsWithDetails = await Promise.all(
      pendingRequests.map(async (request) => {
        const requester = await User.findOne({ userId: request.requesterId }).select('userId name profileImage');
        return {
          requestId: request._id,
          requesterName: requester?.name || 'Unknown User',
          requesterUserId: request.requesterId,
          requestMessage: request.requestMessage,
          requestType: request.requestType,
          createdAt: request.createdAt,
          expiresAt: request.expiresAt
        };
      })
    );

    console.log('✅ Found pending requests:', requestsWithDetails.length);

    res.status(200).json({
      success: true,
      data: requestsWithDetails
    });

  } catch (error) {
    console.error('❌ Error getting pending requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get pending requests',
      error: error.message
    });
  }
};

// Get request history for a user
const getRequestHistory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;

    console.log('📚 Getting request history for user:', userId);

    const requests = await DiyaRequest.find({
      $or: [
        { requesterId: userId },
        { targetUserId: userId }
      ]
    })
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

    // Get user details for each request
    const requestsWithDetails = await Promise.all(
      requests.map(async (request) => {
        const [requester, target] = await Promise.all([
          User.findOne({ userId: request.requesterId }).select('userId name'),
          User.findOne({ userId: request.targetUserId }).select('userId name')
        ]);

        return {
          requestId: request._id,
          requesterName: requester?.name || 'Unknown User',
          targetName: target?.name || 'Unknown User',
          requestMessage: request.requestMessage,
          responseMessage: request.responseMessage,
          status: request.status,
          createdAt: request.createdAt,
          respondedAt: request.respondedAt,
          isRequester: request.requesterId === userId
        };
      })
    );

    console.log('✅ Found request history:', requestsWithDetails.length);

    res.status(200).json({
      success: true,
      data: requestsWithDetails,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: requests.length
      }
    });

  } catch (error) {
    console.error('❌ Error getting request history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get request history',
      error: error.message
    });
  }
};

// Clean up expired requests (can be called by a cron job)
const cleanupExpiredRequests = async (req, res) => {
  try {
    console.log('🧹 Cleaning up expired requests...');

    const result = await DiyaRequest.updateMany(
      {
        status: 'pending',
        expiresAt: { $lt: new Date() }
      },
      {
        $set: {
          status: 'expired',
          respondedAt: new Date()
        }
      }
    );

    console.log('✅ Expired requests cleaned up:', result.modifiedCount);

    res.status(200).json({
      success: true,
      data: {
        expiredCount: result.modifiedCount,
        message: 'Expired requests cleaned up successfully'
      }
    });

  } catch (error) {
    console.error('❌ Error cleaning up expired requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup expired requests',
      error: error.message
    });
  }
};

module.exports = {
  createAvailabilityRequest,
  respondToRequest,
  getPendingRequests,
  getRequestHistory,
  cleanupExpiredRequests
};
