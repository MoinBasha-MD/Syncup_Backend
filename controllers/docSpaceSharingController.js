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

    // Find all DocSpaces where user has documentSpecificAccess OR generalAccessList
    const sharedDocSpaces = await DocSpace.find({
      $or: [
        { 'documentSpecificAccess.userId': userId, 'documentSpecificAccess.isRevoked': false },
        { 'generalAccessList.userId': userId }
      ]
    });

    console.log(`📊 [DOC SHARE] Found ${sharedDocSpaces.length} DocSpaces with access for user ${userId}`);
    
    // Get unique owner userIds
    const ownerUserIds = [...new Set(sharedDocSpaces.map(ds => ds.userId))];
    console.log(`📊 [DOC SHARE] Fetching owner data for ${ownerUserIds.length} users:`, ownerUserIds);
    
    // Fetch owner user data (User model already imported at top)
    const owners = await User.find({ userId: { $in: ownerUserIds } })
      .select('userId name username profileImage');
    
    // Create a map for quick lookup
    const ownerMap = new Map();
    owners.forEach(owner => {
      ownerMap.set(owner.userId, owner);
    });
    
    console.log(`📊 [DOC SHARE] Loaded ${owners.length} owner profiles`);

    // Group by person
    const peopleMap = new Map();

    sharedDocSpaces.forEach(docSpace => {
      const ownerUserId = docSpace.userId; // This is the UUID string
      const owner = ownerMap.get(ownerUserId);
      
      if (!owner) {
        console.log(`⚠️ [DOC SHARE] Owner not found for userId: ${ownerUserId}`);
        return;
      }
      
      console.log(`📄 [DOC SHARE] Processing DocSpace for owner: ${owner.name} (${ownerUserId})`);
      console.log(`📄 [DOC SHARE] Total documentSpecificAccess entries: ${docSpace.documentSpecificAccess.length}`);
      console.log(`📄 [DOC SHARE] Total generalAccessList entries: ${docSpace.generalAccessList.length}`);
      
      // Check if user has general access (access to ALL documents)
      const hasGeneralAccess = docSpace.generalAccessList.some(access => access.userId === userId);
      console.log(`📄 [DOC SHARE] User has general access: ${hasGeneralAccess}`);
      
      let documentCount = 0;
      let lastSharedDate = null;
      
      if (hasGeneralAccess) {
        // User has access to ALL documents
        documentCount = docSpace.documents.length;
        const generalAccessEntry = docSpace.generalAccessList.find(access => access.userId === userId);
        lastSharedDate = generalAccessEntry.grantedAt;
        console.log(`📄 [DOC SHARE] General access: ${documentCount} documents, granted at ${lastSharedDate}`);
      } else {
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
        
        documentCount = sharedAccess.length;
        
        // Get most recent share date
        sharedAccess.forEach(access => {
          if (access.grantedAt) {
            if (!lastSharedDate || new Date(access.grantedAt) > new Date(lastSharedDate)) {
              lastSharedDate = access.grantedAt;
            }
          }
        });
      }

      console.log(`📄 [DOC SHARE] Owner ${owner.name}: ${documentCount} documents shared`);

      if (documentCount > 0) {
        if (!peopleMap.has(ownerUserId)) {
          peopleMap.set(ownerUserId, {
            userId: owner.userId,
            name: owner.name,
            username: owner.username || owner.name,
            profileImage: owner.profileImage,
            documentCount: 0,
            lastSharedAt: null,
          });
        }

        const person = peopleMap.get(ownerUserId);
        person.documentCount += documentCount;

        // Update last shared date
        if (lastSharedDate) {
          if (!person.lastSharedAt || new Date(lastSharedDate) > new Date(person.lastSharedAt)) {
            person.lastSharedAt = lastSharedDate;
          }
        }
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
    const docSpace = await DocSpace.findOne({ userId: personId });

    if (!docSpace) {
      return res.status(404).json({
        success: false,
        message: 'Person not found or has no documents',
      });
    }
    
    // Fetch owner user data
    const owner = await User.findOne({ userId: personId })
      .select('userId name username profileImage');
    
    if (!owner) {
      return res.status(404).json({
        success: false,
        message: 'Person not found',
      });
    }

    // Check if user has general access (access to ALL documents)
    const hasGeneralAccess = docSpace.generalAccessList.some(access => access.userId === userId);
    console.log(`📊 [DOC SHARE] User has general access: ${hasGeneralAccess}`);

    let sharedDocuments = [];

    if (hasGeneralAccess) {
      // User has access to ALL documents
      const generalAccessEntry = docSpace.generalAccessList.find(access => access.userId === userId);
      
      sharedDocuments = docSpace.documents.map(doc => ({
        documentId: doc.documentId,
        documentType: doc.documentType,
        customName: doc.customName,
        fileUrl: doc.fileUrl,
        fileSize: doc.fileSize,
        uploadedAt: doc.uploadedAt,
        sharedAt: generalAccessEntry.grantedAt,
        expiresAt: null,
        accessCount: 0,
        lastAccessedAt: null,
        permissionType: 'download',
        accessType: 'permanent',
      })).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      
      console.log(`✅ [DOC SHARE] General access: ${sharedDocuments.length} documents from ${owner.name}`);
    } else {
      // Get document IDs shared with this user from documentSpecificAccess
      const sharedAccess = docSpace.documentSpecificAccess.filter(access => 
        access.userId === userId && 
        !access.isRevoked &&
        (!access.expiryDate || new Date() <= new Date(access.expiryDate))
      );

      console.log(`📊 [DOC SHARE] Found ${sharedAccess.length} specific access entries for user`);

      // Map access to actual documents
      sharedDocuments = sharedAccess
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

      console.log(`✅ [DOC SHARE] Found ${sharedDocuments.length} documents from ${owner.name}`);
    }

    res.json({
      success: true,
      owner: {
        userId: owner.userId,
        name: owner.name,
        username: owner.username || owner.name,
        profileImage: owner.profileImage,
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

    // ⚡ FIX: Check view limit before allowing access
    if (accessEntry.viewLimit && accessEntry.viewCount >= accessEntry.viewLimit) {
      return res.status(403).json({
        success: false,
        message: `View limit reached (${accessEntry.viewLimit} views)`,
      });
    }

    // Update access tracking
    accessEntry.viewCount = (accessEntry.viewCount || 0) + 1;
    accessEntry.usedAt = new Date();
    accessEntry.lastAccessedAt = new Date();
    
    console.log(`📊 [VIEW TRACKING] View count updated: ${accessEntry.viewCount}/${accessEntry.viewLimit || 'unlimited'}`);

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
      recipientUserId
    } = req.body;

    console.log('📤 [SHARE] Simplified sharing request:', {
      ownerId,
      documentId,
      recipientUserId
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

    // Simplified: Check if already has access
    const existingAccess = docSpace.documentSpecificAccess.find(
      access => access.documentId === documentId && access.userId === recipientUserId
    );

    if (existingAccess) {
      console.log('ℹ️ [SHARE] User already has access');
    } else {
      console.log('📝 [SHARE] Granting access (view + download)');
      const newAccess = {
        documentId,
        userId: recipientUserId,
        userName: recipient.name,
        grantedAt: new Date()
      };
      docSpace.documentSpecificAccess.push(newAccess);
    }

    await docSpace.save();

    console.log('✅ [SHARE] Document shared successfully');
    console.log('📊 [SHARE] Total access entries:', docSpace.documentSpecificAccess.length);

    // Send notification to recipient
    await sendNotification({
      recipientId: recipientUserId,
      type: 'document_shared',
      title: 'Document Shared',
      message: `${req.user.name} shared a document with you`,
      data: { documentId, ownerId }
    });

    res.json({
      success: true,
      message: 'Document shared successfully (view + download permissions)',
      access: { documentId, recipientUserId, permissions: ['view', 'download'] }
    });
  } catch (error) {
    console.error('❌ [DOC SHARE ENHANCED] Error:', error);
    res.status(500).json({ success: false, message: 'Failed to share document', error: error.message });
  }
};

