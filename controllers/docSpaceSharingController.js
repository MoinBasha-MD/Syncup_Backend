const DocSpace = require('../models/DocSpace');
const User = require('../models/userModel');
const { sendNotification } = require('../services/enhancedNotificationService');

/**
 * DocSpace Sharing Controller
 * Handles document sharing with people-centric view
 */

/**
 * Get list of people who shared documents with me
 * Groups by person and shows count of shared documents
 */
exports.getPeopleWhoSharedWithMe = async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log('📊 [DOC SHARE] ========================================');
    console.log('📊 [DOC SHARE] Getting people who shared with user:', userId);
    console.log('📊 [DOC SHARE] User type:', typeof userId);

    // First, let's see ALL DocSpaces with documentSpecificAccess
    const allDocSpaces = await DocSpace.find({
      'documentSpecificAccess.0': { $exists: true }
    }).select('userId documentSpecificAccess');
    
    console.log(`📊 [DOC SHARE] Total DocSpaces with ANY documentSpecificAccess: ${allDocSpaces.length}`);
    
    allDocSpaces.forEach((ds, index) => {
      console.log(`📊 [DOC SHARE] DocSpace ${index + 1}:`, {
        owner: ds.userId,
        accessCount: ds.documentSpecificAccess.length,
        accessEntries: ds.documentSpecificAccess.map(a => ({
          userId: a.userId,
          userIdType: typeof a.userId,
          documentId: a.documentId,
          isRevoked: a.isRevoked,
          userName: a.userName
        }))
      });
    });

    // Find all DocSpaces where user has documentSpecificAccess
    const sharedDocSpaces = await DocSpace.find({
      'documentSpecificAccess.userId': userId,
      'documentSpecificAccess.isRevoked': false,
    }).populate('userId', 'name username profileImage');

    console.log(`📊 [DOC SHARE] Found ${sharedDocSpaces.length} DocSpaces with access for user ${userId}`);

    // Group by person
    const peopleMap = new Map();

    sharedDocSpaces.forEach(docSpace => {
      const ownerId = docSpace.userId._id.toString();
      
      console.log(`📄 [DOC SHARE] Processing DocSpace for owner: ${docSpace.userId.name} (${docSpace.userId._id})`);
      console.log(`📄 [DOC SHARE] Total documentSpecificAccess entries: ${docSpace.documentSpecificAccess.length}`);
      
      // Count documents shared with this user from documentSpecificAccess
      const sharedAccess = docSpace.documentSpecificAccess.filter(access => {
        const userIdMatch = access.userId === userId;
        const notRevoked = !access.isRevoked;
        const notExpired = !access.expiryDate || new Date() <= new Date(access.expiryDate);
        
        console.log(`📄 [DOC SHARE] Checking access:`, {
          accessUserId: access.userId,
          accessUserIdType: typeof access.userId,
          targetUserId: userId,
          targetUserIdType: typeof userId,
          userIdMatch,
          notRevoked,
          notExpired,
          willInclude: userIdMatch && notRevoked && notExpired
        });
        
        return userIdMatch && notRevoked && notExpired;
      });

      console.log(`📄 [DOC SHARE] Owner ${docSpace.userId.name}: ${sharedAccess.length} documents shared`);

      if (sharedAccess.length > 0) {
        if (!peopleMap.has(ownerId)) {
          peopleMap.set(ownerId, {
            userId: docSpace.userId._id,
            name: docSpace.userId.name,
            username: docSpace.userId.username || docSpace.userId.name,
            profileImage: docSpace.userId.profileImage,
            documentCount: 0,
            lastSharedAt: null,
          });
        }

        const person = peopleMap.get(ownerId);
        person.documentCount += sharedAccess.length;

        // Get most recent share date
        sharedAccess.forEach(access => {
          if (access.grantedAt) {
            if (!person.lastSharedAt || new Date(access.grantedAt) > new Date(person.lastSharedAt)) {
              person.lastSharedAt = access.grantedAt;
            }
          }
        });
      }
    });

    const people = Array.from(peopleMap.values())
      .sort((a, b) => new Date(b.lastSharedAt) - new Date(a.lastSharedAt));

    console.log(`✅ [DOC SHARE] Found ${people.length} people who shared documents`);

    res.json({
      success: true,
      people,
      totalCount: people.length,
    });
  } catch (error) {
    console.error('❌ [DOC SHARE] Error getting people who shared:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get shared documents',
      error: error.message,
    });
  }
};

/**
 * Get documents shared with me by a specific person
 */
exports.getDocumentsSharedByPerson = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { personId } = req.params;
    console.log(`📄 [DOC SHARE] Getting documents from ${personId} shared with ${userId}`);

    // Find the person's DocSpace
    const docSpace = await DocSpace.findOne({ userId: personId })
      .populate('userId', 'name username profileImage');

    if (!docSpace) {
      return res.status(404).json({
        success: false,
        message: 'Person not found or has no documents',
      });
    }

    // Get document IDs shared with this user from documentSpecificAccess
    const sharedAccess = docSpace.documentSpecificAccess.filter(access => 
      access.userId === userId && 
      !access.isRevoked &&
      (!access.expiryDate || new Date() <= new Date(access.expiryDate))
    );

    console.log(`📊 [DOC SHARE] Found ${sharedAccess.length} access entries for user`);

    // Map access to actual documents
    const sharedDocuments = sharedAccess
      .map(access => {
        const doc = docSpace.documents.find(d => d.documentId === access.documentId);
        if (!doc) {
          console.warn(`⚠️ [DOC SHARE] Document ${access.documentId} not found in docSpace`);
          return null;
        }
        
        return {
          documentId: doc.documentId,
          documentType: doc.documentType,
          customName: doc.customName,
          fileUrl: doc.fileUrl,
          fileSize: doc.fileSize,
          uploadedAt: doc.uploadedAt,
          sharedAt: access.grantedAt,
          expiresAt: access.expiryDate,
          accessCount: access.viewCount || 0,
          lastAccessedAt: access.lastAccessedAt || access.usedAt,
          permissionType: access.permissionType,
          accessType: access.accessType,
        };
      })
      .filter(doc => doc !== null)
      .sort((a, b) => new Date(b.sharedAt) - new Date(a.sharedAt));

    console.log(`✅ [DOC SHARE] Found ${sharedDocuments.length} documents from ${docSpace.userId.name}`);

    res.json({
      success: true,
      owner: {
        userId: docSpace.userId._id,
        name: docSpace.userId.name,
        username: docSpace.userId.username || docSpace.userId.name,
        profileImage: docSpace.userId.profileImage,
      },
      documents: sharedDocuments,
      totalCount: sharedDocuments.length,
    });
  } catch (error) {
    console.error('❌ [DOC SHARE] Error getting documents from person:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get documents',
      error: error.message,
    });
  }
};

/**
 * Get list of people I shared documents with
 */
exports.getPeopleISharedWith = async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log('📤 [DOC SHARE] Getting people user shared with:', userId);

    // Find user's DocSpace
    const docSpace = await DocSpace.findOne({ userId });

    if (!docSpace) {
      console.log('❌ [DOC SHARE] No doc space found for user:', userId);
      return res.json({
        success: true,
        people: [],
        totalCount: 0,
      });
    }

    console.log('📊 [DOC SHARE] DocSpace found');
    console.log('📊 [DOC SHARE] Total documentSpecificAccess entries:', docSpace.documentSpecificAccess?.length || 0);

    if (!docSpace.documentSpecificAccess || docSpace.documentSpecificAccess.length === 0) {
      console.log('⚠️ [DOC SHARE] No documentSpecificAccess entries found');
      return res.json({
        success: true,
        people: [],
        totalCount: 0,
      });
    }

    // Collect all unique people user has shared with from documentSpecificAccess
    const peopleMap = new Map();

    console.log('🔄 [DOC SHARE] Processing documentSpecificAccess entries...');
    
    for (const access of docSpace.documentSpecificAccess) {
      console.log('📄 [DOC SHARE] Access entry:', {
        userId: access.userId,
        userName: access.userName,
        documentId: access.documentId,
        isRevoked: access.isRevoked,
        expiryDate: access.expiryDate
      });
      
      // Skip revoked access
      if (access.isRevoked) {
        console.log('⏭️ [DOC SHARE] Skipping revoked access');
        continue;
      }
      
      // Skip expired access
      if (access.expiryDate && new Date() > new Date(access.expiryDate)) {
        console.log('⏭️ [DOC SHARE] Skipping expired access');
        continue;
      }
      
      const sharedUserId = access.userId;
      
      if (!peopleMap.has(sharedUserId)) {
        peopleMap.set(sharedUserId, {
          userId: access.userId,
          userName: access.userName,
          documentCount: 0,
          lastSharedAt: null,
        });
      }

      const person = peopleMap.get(sharedUserId);
      person.documentCount += 1;

      if (!person.lastSharedAt || new Date(access.grantedAt) > new Date(person.lastSharedAt)) {
        person.lastSharedAt = access.grantedAt;
      }
    }

    // Populate user details
    const userIds = Array.from(peopleMap.keys());
    const users = await User.find({ userId: { $in: userIds } })
      .select('userId name username profileImage');

    const people = users.map(user => {
      const personData = peopleMap.get(user.userId);
      return {
        userId: user.userId,
        name: user.name,
        username: user.username || user.name,
        profileImage: user.profileImage,
        documentCount: personData.documentCount,
        lastSharedAt: personData.lastSharedAt,
      };
    }).sort((a, b) => new Date(b.lastSharedAt) - new Date(a.lastSharedAt));

    console.log(`✅ [DOC SHARE] Found ${people.length} people user shared with`);

    res.json({
      success: true,
      people,
      totalCount: people.length,
    });
  } catch (error) {
    console.error('❌ [DOC SHARE] Error getting people shared with:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get shared recipients',
      error: error.message,
    });
  }
};

/**
 * Get documents I shared with a specific person
 */
exports.getDocumentsSharedWithPerson = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { personId } = req.params;
    console.log(`📤 [DOC SHARE] Getting documents shared with ${personId}`);

    // Find user's DocSpace
    const docSpace = await DocSpace.findOne({ userId })
      .populate('userId', 'name username profileImage');

    if (!docSpace) {
      return res.status(404).json({
        success: false,
        message: 'No documents found',
      });
    }

    // Get person details
    const person = await User.findOne({ userId: personId })
      .select('userId name username profileImage');

    if (!person) {
      console.error('❌ [DOC SHARE] Person not found:', personId);
      return res.status(404).json({
        success: false,
        message: 'Person not found',
      });
    }

    console.log('✅ [DOC SHARE] Found person:', person.name);

    // Get document IDs shared with this person from documentSpecificAccess
    console.log('📊 [DOC SHARE] Total documentSpecificAccess entries:', docSpace.documentSpecificAccess?.length || 0);
    console.log('📊 [DOC SHARE] Looking for personId:', personId);
    
    const sharedDocumentIds = docSpace.documentSpecificAccess
      .filter(access => {
        console.log('🔍 [DOC SHARE] Checking access:', {
          accessUserId: access.userId,
          personId: personId,
          match: access.userId === personId,
          isRevoked: access.isRevoked,
          documentId: access.documentId
        });
        return access.userId === personId && 
          !access.isRevoked &&
          (!access.expiryDate || new Date() <= new Date(access.expiryDate));
      })
      .map(access => access.documentId);

    console.log('📄 [DOC SHARE] Shared document IDs:', sharedDocumentIds);
    console.log('📄 [DOC SHARE] Total documents in docSpace:', docSpace.documents.length);

    // Filter documents shared with this person
    const sharedDocuments = docSpace.documents
      .filter(doc => {
        const included = sharedDocumentIds.includes(doc.documentId);
        console.log(`📄 [DOC SHARE] Document ${doc.documentId} (${doc.documentType}): ${included ? 'INCLUDED' : 'EXCLUDED'}`);
        return included;
      })
      .map(doc => {
        const access = docSpace.documentSpecificAccess.find(a => 
          a.documentId === doc.documentId && a.userId === personId
        );
        
        return {
          documentId: doc.documentId,
          documentType: doc.documentType,
          customName: doc.customName,
          fileUrl: doc.fileUrl,
          fileSize: doc.fileSize,
          uploadedAt: doc.uploadedAt,
          sharedAt: access.grantedAt,
          expiresAt: access.expiryDate,
          accessCount: access.viewCount || 0,
          lastAccessedAt: access.lastAccessedAt,
          permissionType: access.permissionType,
          accessType: access.accessType,
        };
      })
      .sort((a, b) => new Date(b.sharedAt) - new Date(a.sharedAt));

    console.log(`✅ [DOC SHARE] Found ${sharedDocuments.length} documents shared with ${person.name}`);

    res.json({
      success: true,
      recipient: {
        userId: person._id,
        name: person.name,
        username: person.name,
        profileImage: person.profileImage,
      },
      documents: sharedDocuments,
      totalCount: sharedDocuments.length,
    });
  } catch (error) {
    console.error('❌ [DOC SHARE] Error getting documents shared with person:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get documents',
      error: error.message,
    });
  }
};

/**
 * Revoke document access from a person
 */
exports.revokeDocumentAccess = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { personId, documentId } = req.params;
    console.log(`🚫 [DOC SHARE] Revoking access: doc ${documentId} from person ${personId}`);

    // Find user's DocSpace
    const docSpace = await DocSpace.findOne({ userId });

    if (!docSpace) {
      return res.status(404).json({
        success: false,
        message: 'DocSpace not found',
      });
    }

    // Find the document
    const document = docSpace.documents.find(d => d.documentId === documentId);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    // Find and revoke access in documentSpecificAccess
    const accessEntry = docSpace.documentSpecificAccess.find(access => 
      access.documentId === documentId && access.userId === personId
    );

    if (!accessEntry) {
      return res.status(404).json({
        success: false,
        message: 'Access not found',
      });
    }

    accessEntry.isRevoked = true;
    accessEntry.revokedAt = new Date();

    await docSpace.save();

    // Send notification
    await sendNotification(personId, {
      type: 'document_access_revoked',
      title: '🚫 Document Access Revoked',
      message: `Access to ${document.documentType} has been revoked`,
      data: {
        documentType: document.documentType,
        ownerId: userId,
      },
    });

    console.log(`✅ [DOC SHARE] Access revoked successfully`);

    res.json({
      success: true,
      message: 'Access revoked successfully',
    });
  } catch (error) {
    console.error('❌ [DOC SHARE] Error revoking access:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to revoke access',
      error: error.message,
    });
  }
};

/**
 * Track document access (when someone views/downloads)
 */
exports.trackDocumentAccess = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { ownerId, documentId } = req.params;
    console.log(`👁️ [DOC SHARE] Tracking access: user ${userId} accessing doc ${documentId} from ${ownerId}`);

    // Find owner's DocSpace
    const docSpace = await DocSpace.findOne({ userId: ownerId });

    if (!docSpace) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    // Find the document
    const document = docSpace.documents.find(d => d.documentId === documentId);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    // Find user's access entry in documentSpecificAccess
    const accessEntry = docSpace.documentSpecificAccess.find(access => 
      access.documentId === documentId && access.userId === userId
    );

    if (!accessEntry || accessEntry.isRevoked) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Check if access has expired
    if (accessEntry.expiryDate && new Date() > new Date(accessEntry.expiryDate)) {
      return res.status(403).json({
        success: false,
        message: 'Access expired',
      });
    }

    // Update access tracking
    accessEntry.viewCount = (accessEntry.viewCount || 0) + 1;
    accessEntry.usedAt = new Date();
    accessEntry.lastAccessedAt = new Date();

    // Add to document access log
    document.accessLog.push({
      userId: userId,
      userName: req.user.name || 'Unknown User',
      accessedAt: new Date(),
      accessType: 'view',
    });

    await docSpace.save();

    // Send notification to owner
    await sendNotification(ownerId, {
      type: 'document_accessed',
      title: '👁️ Document Accessed',
      message: `Someone viewed your ${document.documentType}`,
      data: {
        documentType: document.documentType,
        accessorId: userId,
      },
    });

    console.log(`✅ [DOC SHARE] Access tracked successfully`);

    res.json({
      success: true,
      message: 'Access tracked',
      fileUrl: document.fileUrl,
    });
  } catch (error) {
    console.error('❌ [DOC SHARE] Error tracking access:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track access',
      error: error.message,
    });
  }
};

/**
 * Share document with enhanced access control
 * POST /api/doc-space-sharing/share-enhanced
 */
exports.shareDocumentEnhanced = async (req, res) => {
  try {
    const ownerId = req.user.userId;
    const {
      documentId,
      recipientUserId,
      permissionType = 'download',
      accessType = 'permanent',
      expiryDate = null,
      viewLimit = null,
      downloadLimit = null
    } = req.body;

    console.log('📤 [SHARE ENHANCED] Request:', {
      ownerId,
      documentId,
      recipientUserId,
      permissionType,
      accessType
    });

    const docSpace = await DocSpace.findOne({ userId: ownerId });
    if (!docSpace) {
      console.error('❌ [SHARE ENHANCED] Doc space not found for owner:', ownerId);
      return res.status(404).json({ success: false, message: 'Doc space not found' });
    }

    const document = docSpace.documents.find(doc => doc.documentId === documentId);
    if (!document) {
      console.error('❌ [SHARE ENHANCED] Document not found:', documentId);
      console.log('Available documents:', docSpace.documents.map(d => d.documentId));
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const recipient = await User.findOne({ userId: recipientUserId });
    if (!recipient) {
      console.error('❌ [SHARE ENHANCED] Recipient not found:', recipientUserId);
      return res.status(404).json({ success: false, message: 'Recipient not found' });
    }

    console.log('✅ [SHARE ENHANCED] Found recipient:', recipient.name);
    console.log('📊 [SHARE ENHANCED] Recipient userId:', recipientUserId, 'Type:', typeof recipientUserId);

    const existingAccess = docSpace.documentSpecificAccess.find(
      access => access.documentId === documentId && access.userId === recipientUserId
    );

    if (existingAccess) {
      console.log('📝 [SHARE ENHANCED] Updating existing access');
      existingAccess.permissionType = permissionType;
      existingAccess.accessType = accessType;
      existingAccess.expiryDate = expiryDate;
      existingAccess.viewLimit = viewLimit;
      existingAccess.viewCount = 0;
      existingAccess.downloadLimit = downloadLimit;
      existingAccess.downloadCount = 0;
      existingAccess.isRevoked = false;
    } else {
      console.log('📝 [SHARE ENHANCED] Creating new access entry');
      const newAccess = {
        documentId,
        userId: recipientUserId,
        userName: recipient.name,
        permissionType,
        accessType,
        expiryDate,
        viewLimit,
        viewCount: 0,
        downloadLimit,
        downloadCount: 0,
        grantedAt: new Date()
      };
      console.log('📝 [SHARE ENHANCED] New access object:', newAccess);
      docSpace.documentSpecificAccess.push(newAccess);
    }

    await docSpace.save();

    console.log('✅ [SHARE ENHANCED] Document shared successfully');
    console.log('📊 [SHARE ENHANCED] Total documentSpecificAccess entries:', docSpace.documentSpecificAccess.length);
    console.log('📊 [SHARE ENHANCED] All access entries:', docSpace.documentSpecificAccess.map(a => ({
      documentId: a.documentId,
      userId: a.userId,
      userIdType: typeof a.userId,
      userName: a.userName,
      isRevoked: a.isRevoked
    })));

    res.json({
      success: true,
      message: 'Document shared successfully',
      access: { documentId, recipientUserId, permissionType, accessType, expiryDate, viewLimit }
    });
  } catch (error) {
    console.error('❌ [DOC SHARE ENHANCED] Error:', error);
    res.status(500).json({ success: false, message: 'Failed to share document', error: error.message });
  }
};

