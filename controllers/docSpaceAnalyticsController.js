const DocSpace = require('../models/DocSpace');
const AccessAnalytics = require('../models/AccessAnalytics');
const User = require('../models/userModel');

/**
 * Get analytics for a specific document
 * GET /api/doc-space/analytics/:documentId
 */
exports.getDocumentAnalytics = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { documentId } = req.params;
    
    // Verify ownership
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
    
    // Get analytics
    const analytics = await AccessAnalytics.getDocumentAnalytics(userId, documentId);
    
    res.json({
      success: true,
      analytics: {
        document: {
          id: document.documentId,
          type: document.documentType,
          customName: document.customName,
          uploadedAt: document.uploadedAt
        },
        ...analytics
      }
    });
  } catch (error) {
    console.error('❌ [ANALYTICS] Error getting document analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get analytics',
      error: error.message
    });
  }
};

/**
 * Get access timeline for user
 * GET /api/doc-space/analytics/timeline
 */
exports.getAccessTimeline = async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit) || 50;
    
    const timeline = await AccessAnalytics.getUserTimeline(userId, limit);
    
    res.json({
      success: true,
      timeline
    });
  } catch (error) {
    console.error('❌ [ANALYTICS] Error getting timeline:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get timeline',
      error: error.message
    });
  }
};

/**
 * Get overall stats for user's doc space
 * GET /api/doc-space/analytics/stats
 */
exports.getOverallStats = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const stats = await AccessAnalytics.getOwnerStats(userId);
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('❌ [ANALYTICS] Error getting stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get stats',
      error: error.message
    });
  }
};

/**
 * Track document access (view/download)
 * POST /api/doc-space/track-access
 */
exports.trackAccess = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { ownerId, documentId, action } = req.body;
    
    // Get owner's doc space
    const docSpace = await DocSpace.findOne({ userId: ownerId });
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
    
    // Check access control
    if (document.accessControl.enabled) {
      // Check expiry
      if (document.accessControl.expiryDate && new Date() > document.accessControl.expiryDate) {
        return res.status(403).json({
          success: false,
          message: 'Access expired'
        });
      }
      
      // Check view limit
      if (action === 'view' && document.accessControl.viewLimit) {
        if (document.accessControl.viewCount >= document.accessControl.viewLimit) {
          return res.status(403).json({
            success: false,
            message: 'View limit reached'
          });
        }
      }
      
      // Check download limit
      if (action === 'download' && document.accessControl.downloadLimit) {
        if (document.accessControl.downloadCount >= document.accessControl.downloadLimit) {
          return res.status(403).json({
            success: false,
            message: 'Download limit reached'
          });
        }
      }
    }
    
    // Get user info
    const user = await User.findOne({ userId });
    
    // Create analytics entry
    await AccessAnalytics.create({
      ownerId,
      documentId,
      documentType: document.documentType,
      accessorId: userId,
      accessorName: user.name,
      accessorUsername: user.username,
      accessorProfileImage: user.profileImage,
      action,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });
    
    // Update access log in document
    document.accessLog.push({
      userId,
      userName: user.name,
      accessType: action,
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent']
    });
    
    // Update access control counts
    if (document.accessControl.enabled) {
      if (action === 'view') {
        document.accessControl.viewCount++;
      } else if (action === 'download') {
        document.accessControl.downloadCount++;
      }
      
      // Auto-revoke if limits reached
      if (document.accessControl.autoRevoke) {
        const viewLimitReached = document.accessControl.viewLimit && 
          document.accessControl.viewCount >= document.accessControl.viewLimit;
        const downloadLimitReached = document.accessControl.downloadLimit && 
          document.accessControl.downloadCount >= document.accessControl.downloadLimit;
        
        if (viewLimitReached || downloadLimitReached) {
          // Revoke access for this user
          const accessIndex = docSpace.documentSpecificAccess.findIndex(
            access => access.documentId === documentId && access.userId === userId
          );
          if (accessIndex !== -1) {
            docSpace.documentSpecificAccess[accessIndex].isRevoked = true;
            docSpace.documentSpecificAccess[accessIndex].revokedAt = new Date();
          }
        }
      }
    }
    
    // Update stats
    docSpace.stats.totalAccesses++;
    docSpace.stats.lastAccessedAt = new Date();
    
    await docSpace.save();
    
    res.json({
      success: true,
      message: 'Access tracked successfully'
    });
  } catch (error) {
    console.error('❌ [ANALYTICS] Error tracking access:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track access',
      error: error.message
    });
  }
};

/**
 * Update document access control settings
 * PUT /api/doc-space/documents/:documentId/access-control
 */
exports.updateAccessControl = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { documentId } = req.params;
    const { enabled, expiryDate, viewLimit, downloadLimit, autoRevoke } = req.body;
    
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
    
    // Update access control
    document.accessControl.enabled = enabled !== undefined ? enabled : document.accessControl.enabled;
    document.accessControl.expiryDate = expiryDate !== undefined ? expiryDate : document.accessControl.expiryDate;
    document.accessControl.viewLimit = viewLimit !== undefined ? viewLimit : document.accessControl.viewLimit;
    document.accessControl.downloadLimit = downloadLimit !== undefined ? downloadLimit : document.accessControl.downloadLimit;
    document.accessControl.autoRevoke = autoRevoke !== undefined ? autoRevoke : document.accessControl.autoRevoke;
    
    await docSpace.save();
    
    res.json({
      success: true,
      message: 'Access control updated',
      accessControl: document.accessControl
    });
  } catch (error) {
    console.error('❌ [ACCESS CONTROL] Error updating:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update access control',
      error: error.message
    });
  }
};

/**
 * Update document category and tags
 * PUT /api/doc-space/documents/:documentId/organize
 */
exports.organizeDocument = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { documentId } = req.params;
    const { category, tags, isFavorite } = req.body;
    
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
    
    // Update organization
    if (category !== undefined) document.category = category;
    if (tags !== undefined) document.tags = tags;
    if (isFavorite !== undefined) document.isFavorite = isFavorite;
    
    await docSpace.save();
    
    res.json({
      success: true,
      message: 'Document organized',
      document: {
        documentId: document.documentId,
        category: document.category,
        tags: document.tags,
        isFavorite: document.isFavorite
      }
    });
  } catch (error) {
    console.error('❌ [ORGANIZE] Error organizing document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to organize document',
      error: error.message
    });
  }
};

module.exports = exports;
