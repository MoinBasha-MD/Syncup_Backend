/**
 * DocSpace Access Request Controller
 * Handles requests for more access when limits are reached
 */

const DocSpace = require('../models/DocSpace');
const User = require('../models/userModel');
const { broadcastToUser } = require('../socketManager');

/**
 * Send access request to document owner
 * POST /api/doc-space-access-requests/request
 */
exports.requestMoreAccess = async (req, res) => {
  try {
    const requesterId = req.user.userId;
    const { documentId, message } = req.body;

    console.log('📨 [ACCESS REQUEST] User requesting more access:', {
      requesterId,
      documentId,
      message
    });

    // Find the document and its owner
    const docSpace = await DocSpace.findOne({
      'documents.documentId': documentId
    });

    if (!docSpace) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    const document = docSpace.documents.find(d => d.documentId === documentId);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    const ownerId = docSpace.userId;

    // Get requester details
    const requester = await User.findOne({ userId: requesterId }).select('name profileImage');
    if (!requester) {
      return res.status(404).json({
        success: false,
        message: 'Requester not found'
      });
    }

    // Create access request entry
    if (!docSpace.accessRequests) {
      docSpace.accessRequests = [];
    }

    // Check if there's already a pending request
    const existingRequest = docSpace.accessRequests.find(
      r => r.documentId === documentId && 
           r.requesterId === requesterId && 
           r.status === 'pending'
    );

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending request for this document'
      });
    }

    // Add new request
    docSpace.accessRequests.push({
      documentId,
      requesterId,
      requesterName: requester.name,
      requesterProfileImage: requester.profileImage,
      message: message || 'Requesting more access to this document',
      status: 'pending',
      requestedAt: new Date()
    });

    await docSpace.save();

    // ⚡ Send push notification to document owner (using existing notification pattern)
    try {
      const notificationData = {
        type: 'doc_access_request',
        title: '📄 Access Request',
        body: `${requester.name} is requesting more access to ${document.documentType}`,
        data: {
          type: 'doc_access_request',
          documentId,
          documentType: document.documentType,
          customName: document.customName,
          requesterId,
          requesterName: requester.name,
          requesterProfileImage: requester.profileImage,
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      };

      // Send WebSocket notification
      const socketSuccess = broadcastToUser(ownerId, 'notification:new', notificationData);
      
      if (socketSuccess) {
        console.log('✅ [ACCESS REQUEST] Notification sent to owner via WebSocket');
      } else {
        console.log('⚠️ [ACCESS REQUEST] Owner not connected, notification queued');
      }
    } catch (notifError) {
      console.error('❌ [ACCESS REQUEST] Failed to send notification:', notifError);
      // Don't fail the request if notification fails
    }

    console.log('✅ [ACCESS REQUEST] Request created successfully');

    res.json({
      success: true,
      message: 'Access request sent successfully'
    });

  } catch (error) {
    console.error('❌ [ACCESS REQUEST] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send access request',
      error: error.message
    });
  }
};

/**
 * Get pending access requests for document owner
 * GET /api/doc-space-access-requests/pending
 */
exports.getPendingRequests = async (req, res) => {
  try {
    const ownerId = req.user.userId;

    console.log('📋 [ACCESS REQUESTS] Getting pending requests for owner:', ownerId);

    const docSpace = await DocSpace.findOne({ userId: ownerId });

    if (!docSpace || !docSpace.accessRequests) {
      return res.json({
        success: true,
        requests: []
      });
    }

    // Filter pending requests
    const pendingRequests = docSpace.accessRequests.filter(r => r.status === 'pending');

    console.log(`✅ [ACCESS REQUESTS] Found ${pendingRequests.length} pending requests`);

    res.json({
      success: true,
      requests: pendingRequests
    });

  } catch (error) {
    console.error('❌ [ACCESS REQUESTS] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get pending requests',
      error: error.message
    });
  }
};

/**
 * Approve access request
 * POST /api/doc-space-access-requests/approve
 */
exports.approveRequest = async (req, res) => {
  try {
    const ownerId = req.user.userId;
    const { requestId, additionalViews, additionalDownloads, additionalDays } = req.body;

    console.log('✅ [ACCESS REQUEST] Approving request:', requestId);

    const docSpace = await DocSpace.findOne({ userId: ownerId });

    if (!docSpace) {
      return res.status(404).json({
        success: false,
        message: 'DocSpace not found'
      });
    }

    // Find the request
    const request = docSpace.accessRequests.find(r => r._id.toString() === requestId);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    // Update request status
    request.status = 'approved';
    request.approvedAt = new Date();

    // Find and update the access entry
    const accessEntry = docSpace.documentSpecificAccess.find(
      a => a.documentId === request.documentId && a.userId === request.requesterId
    );

    if (accessEntry) {
      // Add more views/downloads
      if (additionalViews) {
        accessEntry.viewLimit = (accessEntry.viewLimit || 0) + additionalViews;
      }
      if (additionalDownloads) {
        accessEntry.downloadLimit = (accessEntry.downloadLimit || 0) + additionalDownloads;
      }
      if (additionalDays && accessEntry.expiryDate) {
        const newExpiry = new Date(accessEntry.expiryDate);
        newExpiry.setDate(newExpiry.getDate() + additionalDays);
        accessEntry.expiryDate = newExpiry;
      }
    }

    await docSpace.save();

    // Send notification to requester
    try {
      const notificationData = {
        type: 'doc_access_approved',
        title: '✅ Access Approved',
        body: `Your request for more access has been approved`,
        data: {
          type: 'doc_access_approved',
          documentId: request.documentId,
          timestamp: new Date().toISOString()
        }
      };

      broadcastToUser(request.requesterId, 'notification:new', notificationData);
    } catch (notifError) {
      console.error('❌ Failed to send approval notification:', notifError);
    }

    res.json({
      success: true,
      message: 'Request approved successfully'
    });

  } catch (error) {
    console.error('❌ [ACCESS REQUEST] Error approving:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve request',
      error: error.message
    });
  }
};

/**
 * Deny access request
 * POST /api/doc-space-access-requests/deny
 */
exports.denyRequest = async (req, res) => {
  try {
    const ownerId = req.user.userId;
    const { requestId } = req.body;

    console.log('❌ [ACCESS REQUEST] Denying request:', requestId);

    const docSpace = await DocSpace.findOne({ userId: ownerId });

    if (!docSpace) {
      return res.status(404).json({
        success: false,
        message: 'DocSpace not found'
      });
    }

    const request = docSpace.accessRequests.find(r => r._id.toString() === requestId);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    request.status = 'denied';
    request.deniedAt = new Date();

    await docSpace.save();

    // Send notification to requester
    try {
      const notificationData = {
        type: 'doc_access_denied',
        title: '❌ Access Denied',
        body: `Your request for more access was denied`,
        data: {
          type: 'doc_access_denied',
          documentId: request.documentId,
          timestamp: new Date().toISOString()
        }
      };

      broadcastToUser(request.requesterId, 'notification:new', notificationData);
    } catch (notifError) {
      console.error('❌ Failed to send denial notification:', notifError);
    }

    res.json({
      success: true,
      message: 'Request denied'
    });

  } catch (error) {
    console.error('❌ [ACCESS REQUEST] Error denying:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to deny request',
      error: error.message
    });
  }
};

module.exports = exports;
