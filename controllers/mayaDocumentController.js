const DocSpace = require('../models/DocSpace');
const User = require('../models/userModel');
const Friend = require('../models/Friend');
const { broadcastToUser } = require('../socketManager');
const enhancedNotificationService = require('../services/enhancedNotificationService');

/**
 * Maya Document Request - Handle document requests between users
 * POST /api/maya/request-document
 */
exports.requestDocument = async (req, res) => {
  try {
    const { documentType, targetUsername, requesterId, requesterName } = req.body;
    
    console.log(`📄 [MAYA DOC REQUEST] ${requesterName} requesting ${documentType} from @${targetUsername}`);
    
    // Find target user by username
    const targetUser = await User.findOne({ username: targetUsername });
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: `User @${targetUsername} not found`
      });
    }
    
    // Check if they are friends
    const friendship = await Friend.findOne({
      $or: [
        { userId: requesterId, friendUserId: targetUser.userId },
        { userId: targetUser.userId, friendUserId: requesterId }
      ],
      status: 'accepted'
    });
    
    if (!friendship) {
      return res.status(403).json({
        success: false,
        message: `You need to be friends with @${targetUsername} to request documents`
      });
    }
    
    // Get target user's doc space
    const targetDocSpace = await DocSpace.findOne({ userId: targetUser.userId });
    if (!targetDocSpace) {
      return res.status(404).json({
        success: false,
        message: `@${targetUsername} doesn't have a Doc Space yet`,
        documentFound: false
      });
    }
    
    // Find the requested document
    const document = targetDocSpace.documents.find(
      doc => doc.documentType === documentType
    );
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: `@${targetUsername} doesn't have ${documentType} uploaded`,
        documentFound: false
      });
    }
    
    // Check permissions
    // 1. Check general access (can view all documents)
    const hasGeneralAccess = targetDocSpace.generalAccess.some(
      access => access.userId === requesterId && access.canView
    );
    
    // 2. Check document-specific access
    const hasDocumentAccess = document.sharedWith.some(
      share => share.userId === requesterId
    );
    
    if (hasGeneralAccess || hasDocumentAccess) {
      // ✅ Access granted - Auto-send document
      console.log(`✅ [MAYA DOC REQUEST] Access granted - sending ${documentType} to ${requesterName}`);
      
      // Log the access
      document.accessLog.push({
        userId: requesterId,
        userName: requesterName,
        accessedAt: new Date(),
        accessType: 'maya_request'
      });
      
      // Update stats
      targetDocSpace.stats.totalAccesses += 1;
      await targetDocSpace.save();
      
      // Send document URL
      const documentUrl = `${process.env.API_BASE_URL || 'http://localhost:5000'}${document.filePath}`;
      
      // Notify target user about the access
      await enhancedNotificationService.sendDocumentAccessNotification(
        targetUser.userId,
        requesterId,
        requesterName,
        documentType
      );
      
      // Send WebSocket notification to requester
      broadcastToUser(requesterId, 'maya:document:received', {
        documentType,
        documentUrl,
        fromUser: targetUsername,
        message: `${targetUsername} has shared their ${documentType} with you via Maya`
      });
      
      return res.json({
        success: true,
        message: `Document sent successfully`,
        documentUrl,
        accessGranted: true,
        documentFound: true
      });
      
    } else {
      // ❌ No access - Send request notification
      console.log(`🔒 [MAYA DOC REQUEST] No access - notifying ${targetUsername}`);
      
      // Notify target user about the request
      await enhancedNotificationService.sendDocumentRequestNotification(
        targetUser.userId,
        requesterId,
        requesterName,
        documentType
      );
      
      // Send WebSocket notification to target user
      broadcastToUser(targetUser.userId, 'maya:document:request', {
        documentType,
        fromUserId: requesterId,
        fromUserName: requesterName,
        message: `${requesterName} is requesting your ${documentType} via Maya`
      });
      
      return res.status(403).json({
        success: false,
        message: `Request sent to @${targetUsername}. They'll be notified.`,
        accessGranted: false,
        documentFound: true
      });
    }
    
  } catch (error) {
    console.error('❌ [MAYA DOC REQUEST] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process document request',
      error: error.message
    });
  }
};

/**
 * Maya Document Share - Share own document with another user
 * POST /api/maya/share-document
 */
exports.shareDocument = async (req, res) => {
  try {
    const { documentId, targetUsername, senderId, senderName } = req.body;
    
    console.log(`📤 [MAYA DOC SHARE] ${senderName} sharing document with @${targetUsername}`);
    
    // Find target user
    const targetUser = await User.findOne({ username: targetUsername });
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: `User @${targetUsername} not found`
      });
    }
    
    // Check friendship
    const friendship = await Friend.findOne({
      $or: [
        { userId: senderId, friendUserId: targetUser.userId },
        { userId: targetUser.userId, friendUserId: senderId }
      ],
      status: 'accepted'
    });
    
    if (!friendship) {
      return res.status(403).json({
        success: false,
        message: `You need to be friends with @${targetUsername} to share documents`
      });
    }
    
    // Get sender's doc space
    const senderDocSpace = await DocSpace.findOne({ userId: senderId });
    if (!senderDocSpace) {
      return res.status(404).json({
        success: false,
        message: 'You don\'t have any documents to share'
      });
    }
    
    // Find the document
    const document = senderDocSpace.documents.id(documentId);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    // Grant access to target user (if not already granted)
    const alreadyShared = document.sharedWith.some(
      share => share.userId === targetUser.userId
    );
    
    if (!alreadyShared) {
      document.sharedWith.push({
        userId: targetUser.userId,
        userName: targetUser.name,
        sharedAt: new Date()
      });
      await senderDocSpace.save();
    }
    
    // Send document URL
    const documentUrl = `${process.env.API_BASE_URL || 'http://localhost:5000'}${document.filePath}`;
    
    // Notify target user
    await enhancedNotificationService.sendDocumentSharedNotification(
      targetUser.userId,
      senderId,
      senderName,
      document.documentType
    );
    
    // Send WebSocket notification
    broadcastToUser(targetUser.userId, 'maya:document:shared', {
      documentType: document.documentType,
      documentUrl,
      fromUser: senderName,
      message: `${senderName} has shared their ${document.documentType} with you via Maya`
    });
    
    return res.json({
      success: true,
      message: `Document shared with @${targetUsername} successfully`
    });
    
  } catch (error) {
    console.error('❌ [MAYA DOC SHARE] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to share document',
      error: error.message
    });
  }
};

/**
 * Get shared documents for a user (for Doc Space UI)
 * GET /api/maya/shared-documents
 */
exports.getSharedDocuments = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get all doc spaces where user has access
    const docSpaces = await DocSpace.find({
      $or: [
        { 'generalAccess.userId': userId },
        { 'documents.sharedWith.userId': userId }
      ]
    }).populate('userId', 'name username profileImage');
    
    // Format response
    const sharedDocuments = [];
    
    for (const docSpace of docSpaces) {
      const owner = await User.findOne({ userId: docSpace.userId });
      if (!owner) continue;
      
      // Get documents shared with this user
      const accessibleDocs = docSpace.documents.filter(doc => {
        const hasGeneralAccess = docSpace.generalAccess.some(
          access => access.userId === userId && access.canView
        );
        const hasDocAccess = doc.sharedWith.some(
          share => share.userId === userId
        );
        return hasGeneralAccess || hasDocAccess;
      });
      
      if (accessibleDocs.length > 0) {
        sharedDocuments.push({
          ownerId: docSpace.userId,
          ownerName: owner.name,
          ownerUsername: owner.username,
          ownerProfileImage: owner.profileImage,
          documents: accessibleDocs.map(doc => ({
            id: doc._id,
            documentType: doc.documentType,
            customName: doc.customName,
            uploadedAt: doc.uploadedAt,
            filePath: doc.filePath
          }))
        });
      }
    }
    
    res.json({
      success: true,
      sharedDocuments
    });
    
  } catch (error) {
    console.error('❌ [MAYA SHARED DOCS] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get shared documents',
      error: error.message
    });
  }
};

module.exports = exports;
