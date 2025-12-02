const DocSpace = require('../models/DocSpace');
const DocumentRequest = require('../models/DocumentRequest');
const Friend = require('../models/Friend');
const User = require('../models/userModel');
const path = require('path');
const fs = require('fs').promises;

/**
 * Get user's doc space
 * GET /api/doc-space
 */
exports.getDocSpace = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const docSpace = await DocSpace.getOrCreate(userId);
    
    res.json({
      success: true,
      docSpace
    });
  } catch (error) {
    console.error('❌ [DOC SPACE] Error getting doc space:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get doc space',
      error: error.message
    });
  }
};

/**
 * Upload document to doc space
 * POST /api/doc-space/upload
 */
exports.uploadDocument = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { documentType, customName } = req.body;
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }
    
    // Only allow PDF files
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    if (fileExt !== '.pdf') {
      // Delete uploaded file
      await fs.unlink(req.file.path);
      
      return res.status(400).json({
        success: false,
        message: 'Only PDF files are allowed. Please upload a PDF document.'
      });
    }
    
    // Validate MIME type as well
    if (req.file.mimetype !== 'application/pdf') {
      // Delete uploaded file
      await fs.unlink(req.file.path);
      
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Only PDF files are allowed.'
      });
    }
    
    // Get or create doc space
    const docSpace = await DocSpace.getOrCreate(userId);
    
    // Check if max documents reached
    if (docSpace.documents.length >= docSpace.settings.maxDocuments) {
      // Delete uploaded file
      await fs.unlink(req.file.path);
      
      return res.status(400).json({
        success: false,
        message: `Maximum ${docSpace.settings.maxDocuments} documents allowed`
      });
    }
    
    // Create document data
    const documentData = {
      documentType,
      customName: documentType === 'Other' ? customName : '',
      fileUrl: `/uploads/documents/${req.file.filename}`,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      uploadedAt: new Date()
    };
    
    // Add document
    await docSpace.addDocument(documentData);
    
    console.log(`✅ [DOC SPACE] Document uploaded: ${documentType} for user ${userId}`);
    
    res.json({
      success: true,
      message: 'Document uploaded successfully',
      document: documentData,
      docSpace
    });
  } catch (error) {
    console.error('❌ [DOC SPACE] Error uploading document:', error);
    
    // Clean up uploaded file on error
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting file:', unlinkError);
      }
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to upload document',
      error: error.message
    });
  }
};

/**
 * Delete document from doc space
 * DELETE /api/doc-space/document/:documentId
 */
exports.deleteDocument = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { documentId } = req.params;
    
    const docSpace = await DocSpace.findOne({ userId });
    
    if (!docSpace) {
      return res.status(404).json({
        success: false,
        message: 'Doc space not found'
      });
    }
    
    // Find document
    const document = docSpace.documents.find(doc => doc.documentId === documentId);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    // Delete file from filesystem
    try {
      const filePath = path.join(__dirname, '..', document.fileUrl);
      await fs.unlink(filePath);
    } catch (fileError) {
      console.error('Error deleting file:', fileError);
      // Continue even if file deletion fails
    }
    
    // Remove document from doc space
    await docSpace.removeDocument(documentId);
    
    console.log(`✅ [DOC SPACE] Document deleted: ${documentId} for user ${userId}`);
    
    res.json({
      success: true,
      message: 'Document deleted successfully',
      docSpace
    });
  } catch (error) {
    console.error('❌ [DOC SPACE] Error deleting document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete document',
      error: error.message
    });
  }
};

/**
 * Get friends list for access management
 * GET /api/doc-space/friends
 */
exports.getFriendsForAccess = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get all accepted friends
    const friends = await Friend.getFriends(userId, { status: 'accepted' });
    
    // Get current doc space to check who already has access
    const docSpace = await DocSpace.findOne({ userId });
    const currentAccessList = docSpace ? docSpace.generalAccessList.map(a => a.userId) : [];
    
    // Format friends list
    const friendsList = friends.map(friend => ({
      userId: friend.friendUserId,
      name: friend.cachedData.name,
      username: friend.cachedData.username,
      profileImage: friend.cachedData.profileImage,
      hasAccess: currentAccessList.includes(friend.friendUserId)
    }));
    
    res.json({
      success: true,
      friends: friendsList
    });
  } catch (error) {
    console.error('❌ [DOC SPACE] Error getting friends:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get friends list',
      error: error.message
    });
  }
};

/**
 * Grant general access to friends
 * POST /api/doc-space/grant-access
 */
exports.grantGeneralAccess = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { friendUserIds } = req.body; // Array of friend user IDs
    
    if (!Array.isArray(friendUserIds) || friendUserIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Friend user IDs array is required'
      });
    }
    
    const docSpace = await DocSpace.getOrCreate(userId);
    const currentUser = await User.findOne({ userId });
    
    // Get friend details
    const friends = await Friend.find({
      userId,
      friendUserId: { $in: friendUserIds },
      status: 'accepted'
    });
    
    // Grant access to each friend
    for (const friend of friends) {
      await docSpace.grantGeneralAccess(
        friend.friendUserId,
        friend.cachedData.name,
        userId
      );
    }
    
    console.log(`✅ [DOC SPACE] General access granted to ${friends.length} friends by user ${userId}`);
    
    res.json({
      success: true,
      message: `Access granted to ${friends.length} friends`,
      docSpace
    });
  } catch (error) {
    console.error('❌ [DOC SPACE] Error granting access:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to grant access',
      error: error.message
    });
  }
};

/**
 * Revoke general access from a friend
 * DELETE /api/doc-space/revoke-access/:friendUserId
 */
exports.revokeGeneralAccess = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { friendUserId } = req.params;
    
    const docSpace = await DocSpace.findOne({ userId });
    
    if (!docSpace) {
      return res.status(404).json({
        success: false,
        message: 'Doc space not found'
      });
    }
    
    await docSpace.revokeGeneralAccess(friendUserId);
    
    console.log(`✅ [DOC SPACE] Access revoked for user ${friendUserId} by ${userId}`);
    
    res.json({
      success: true,
      message: 'Access revoked successfully',
      docSpace
    });
  } catch (error) {
    console.error('❌ [DOC SPACE] Error revoking access:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to revoke access',
      error: error.message
    });
  }
};

/**
 * Get access list for doc space
 * GET /api/doc-space/access-list
 */
exports.getAccessList = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const docSpace = await DocSpace.findOne({ userId });
    
    if (!docSpace) {
      return res.json({
        success: true,
        generalAccessList: [],
        documentSpecificAccess: []
      });
    }
    
    res.json({
      success: true,
      generalAccessList: docSpace.generalAccessList,
      documentSpecificAccess: docSpace.documentSpecificAccess
    });
  } catch (error) {
    console.error('❌ [DOC SPACE] Error getting access list:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get access list',
      error: error.message
    });
  }
};

/**
 * Request document from another user (via Maya AI)
 * POST /api/doc-space/request-document
 */
exports.requestDocument = async (req, res) => {
  try {
    const requesterId = req.user.userId;
    const { targetUserId, documentType, requestMessage } = req.body;
    
    if (!targetUserId || !documentType) {
      return res.status(400).json({
        success: false,
        message: 'Target user ID and document type are required'
      });
    }
    
    // Check if they are friends
    const areFriends = await Friend.areFriends(requesterId, targetUserId);
    
    if (!areFriends) {
      return res.status(403).json({
        success: false,
        message: 'You can only request documents from friends'
      });
    }
    
    // Get user details
    const requester = await User.findOne({ userId: requesterId });
    const targetUser = await User.findOne({ userId: targetUserId });
    
    if (!requester || !targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Check if target user has doc space and the requested document
    const targetDocSpace = await DocSpace.findOne({ userId: targetUserId });
    
    if (!targetDocSpace || !targetDocSpace.settings.allowRequests) {
      return res.status(403).json({
        success: false,
        message: 'User does not allow document requests'
      });
    }
    
    const requestedDocument = targetDocSpace.getDocumentByType(documentType);
    
    if (!requestedDocument) {
      return res.status(404).json({
        success: false,
        message: `User does not have a ${documentType} in their doc space`
      });
    }
    
    // Check if requester already has access
    const accessCheck = await DocSpace.hasAccess(targetUserId, requesterId, requestedDocument.documentId);
    
    if (accessCheck.hasAccess) {
      // User already has access, return document directly
      await targetDocSpace.logAccess(
        requestedDocument.documentId,
        requesterId,
        requester.name,
        'view'
      );
      
      return res.json({
        success: true,
        hasAccess: true,
        message: 'Access already granted',
        document: requestedDocument
      });
    }
    
    // Create document request
    const documentRequest = await DocumentRequest.createRequest({
      requesterId,
      requesterName: requester.name,
      requesterProfileImage: requester.profileImage || '',
      targetUserId,
      targetUserName: targetUser.name,
      documentType,
      documentId: requestedDocument.documentId,
      requestMessage: requestMessage || '',
      requestedVia: 'maya_ai'
    });
    
    // TODO: Send push notification to target user
    console.log(`📨 [DOC SPACE] Document request created: ${documentRequest.requestId}`);
    console.log(`   Requester: ${requester.name} (${requesterId})`);
    console.log(`   Target: ${targetUser.name} (${targetUserId})`);
    console.log(`   Document: ${documentType}`);
    
    res.json({
      success: true,
      hasAccess: false,
      message: 'Document request sent. Waiting for approval.',
      request: documentRequest
    });
  } catch (error) {
    console.error('❌ [DOC SPACE] Error requesting document:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to request document'
    });
  }
};

/**
 * Get pending document requests (received)
 * GET /api/doc-space/requests/received
 */
exports.getReceivedRequests = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const requests = await DocumentRequest.getPendingRequests(userId, 'received');
    
    res.json({
      success: true,
      requests
    });
  } catch (error) {
    console.error('❌ [DOC SPACE] Error getting requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get requests',
      error: error.message
    });
  }
};

/**
 * Get pending document requests (sent)
 * GET /api/doc-space/requests/sent
 */
exports.getSentRequests = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const requests = await DocumentRequest.getPendingRequests(userId, 'sent');
    
    res.json({
      success: true,
      requests
    });
  } catch (error) {
    console.error('❌ [DOC SPACE] Error getting requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get requests',
      error: error.message
    });
  }
};

/**
 * Respond to document request
 * POST /api/doc-space/requests/:requestId/respond
 */
exports.respondToRequest = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { requestId } = req.params;
    const { action, approvalType, accessType, responseMessage } = req.body;
    // action: 'approve' or 'deny'
    // approvalType: 'document-specific' or 'full-access'
    // accessType: 'one-time' or 'permanent'
    
    const request = await DocumentRequest.findOne({ requestId });
    
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }
    
    // Verify user is the target
    if (request.targetUserId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }
    
    // Check if request is still pending
    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Request is already ${request.status}`
      });
    }
    
    const docSpace = await DocSpace.findOne({ userId });
    
    if (!docSpace) {
      return res.status(404).json({
        success: false,
        message: 'Doc space not found'
      });
    }
    
    if (action === 'approve') {
      // Approve request
      await request.approve(approvalType, accessType || 'permanent', userId, responseMessage);
      
      // Grant access based on approval type
      if (approvalType === 'full-access') {
        // Grant general access to all documents
        await docSpace.grantGeneralAccess(
          request.requesterId,
          request.requesterName,
          userId
        );
      } else if (approvalType === 'document-specific') {
        // Grant access to specific document
        await docSpace.grantDocumentAccess(
          request.documentId,
          request.requesterId,
          request.requesterName,
          accessType || 'permanent'
        );
      }
      
      console.log(`✅ [DOC SPACE] Request approved: ${requestId}`);
      console.log(`   Approval type: ${approvalType}`);
      console.log(`   Access type: ${accessType}`);
      
      // TODO: Send push notification to requester
      
      res.json({
        success: true,
        message: 'Request approved',
        request
      });
    } else if (action === 'deny') {
      // Deny request
      await request.deny(userId, responseMessage);
      
      console.log(`❌ [DOC SPACE] Request denied: ${requestId}`);
      
      // TODO: Send push notification to requester
      
      res.json({
        success: true,
        message: 'Request denied',
        request
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Use "approve" or "deny"'
      });
    }
  } catch (error) {
    console.error('❌ [DOC SPACE] Error responding to request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to respond to request',
      error: error.message
    });
  }
};

/**
 * Get document (if user has access)
 * GET /api/doc-space/document/:ownerId/:documentType
 */
exports.getDocument = async (req, res) => {
  try {
    const requesterId = req.user.userId;
    const { ownerId, documentType } = req.params;
    
    // Check access
    const docSpace = await DocSpace.findOne({ userId: ownerId });
    
    if (!docSpace) {
      return res.status(404).json({
        success: false,
        message: 'Doc space not found'
      });
    }
    
    const document = docSpace.getDocumentByType(documentType);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    const accessCheck = await DocSpace.hasAccess(ownerId, requesterId, document.documentId);
    
    if (!accessCheck.hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    // Log access
    const requester = await User.findOne({ userId: requesterId });
    await docSpace.logAccess(
      document.documentId,
      requesterId,
      requester.name,
      'view'
    );
    
    // TODO: Send notification to owner
    
    res.json({
      success: true,
      document
    });
  } catch (error) {
    console.error('❌ [DOC SPACE] Error getting document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get document',
      error: error.message
    });
  }
};

/**
 * Get document access log
 * GET /api/doc-space/document/:documentId/access-log
 */
exports.getAccessLog = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { documentId } = req.params;
    
    const docSpace = await DocSpace.findOne({ userId });
    
    if (!docSpace) {
      return res.status(404).json({
        success: false,
        message: 'Doc space not found'
      });
    }
    
    const document = docSpace.documents.find(doc => doc.documentId === documentId);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    res.json({
      success: true,
      accessLog: document.accessLog
    });
  } catch (error) {
    console.error('❌ [DOC SPACE] Error getting access log:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get access log',
      error: error.message
    });
  }
};

module.exports = exports;
