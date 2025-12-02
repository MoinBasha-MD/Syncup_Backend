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
    const userId = req.user._id;
    console.log('📊 [DOC SHARE] Getting people who shared with user:', userId);

    // Find all DocSpaces where user has shared access
    const sharedDocSpaces = await DocSpace.find({
      'documents.sharedWith.userId': userId,
      'documents.sharedWith.hasAccess': true,
    }).populate('userId', 'name profileImage');

    // Group by person
    const peopleMap = new Map();

    sharedDocSpaces.forEach(docSpace => {
      const ownerId = docSpace.userId._id.toString();
      
      // Count documents shared with this user
      const sharedDocs = docSpace.documents.filter(doc => 
        doc.sharedWith.some(share => 
          share.userId.toString() === userId.toString() && share.hasAccess
        )
      );

      if (sharedDocs.length > 0) {
        if (!peopleMap.has(ownerId)) {
          peopleMap.set(ownerId, {
            userId: docSpace.userId._id,
            name: docSpace.userId.name,
            username: docSpace.userId.name,
            profileImage: docSpace.userId.profileImage,
            documentCount: 0,
            lastSharedAt: null,
          });
        }

        const person = peopleMap.get(ownerId);
        person.documentCount += sharedDocs.length;

        // Get most recent share date
        sharedDocs.forEach(doc => {
          const userShare = doc.sharedWith.find(s => 
            s.userId.toString() === userId.toString()
          );
          if (userShare && userShare.sharedAt) {
            if (!person.lastSharedAt || new Date(userShare.sharedAt) > new Date(person.lastSharedAt)) {
              person.lastSharedAt = userShare.sharedAt;
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
    const userId = req.user._id;
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

    // Filter documents shared with this user
    const sharedDocuments = docSpace.documents
      .filter(doc => 
        doc.sharedWith.some(share => 
          share.userId.toString() === userId.toString() && share.hasAccess
        )
      )
      .map(doc => {
        const userShare = doc.sharedWith.find(s => 
          s.userId.toString() === userId.toString()
        );
        
        return {
          documentId: doc._id,
          documentType: doc.documentType,
          customName: doc.customName,
          fileUrl: doc.fileUrl,
          fileSize: doc.fileSize,
          uploadedAt: doc.uploadedAt,
          sharedAt: userShare.sharedAt,
          expiresAt: userShare.expiresAt,
          accessCount: userShare.accessCount || 0,
          lastAccessedAt: userShare.lastAccessedAt,
        };
      })
      .sort((a, b) => new Date(b.sharedAt) - new Date(a.sharedAt));

    console.log(`✅ [DOC SHARE] Found ${sharedDocuments.length} documents from ${docSpace.userId.name}`);

    res.json({
      success: true,
      owner: {
        userId: docSpace.userId._id,
        name: docSpace.userId.name,
        username: docSpace.userId.name,
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
    const userId = req.user._id;
    console.log('📤 [DOC SHARE] Getting people user shared with:', userId);

    // Find user's DocSpace
    const docSpace = await DocSpace.findOne({ userId });

    if (!docSpace || docSpace.documents.length === 0) {
      return res.json({
        success: true,
        people: [],
        totalCount: 0,
      });
    }

    // Collect all unique people user has shared with
    const peopleMap = new Map();

    for (const doc of docSpace.documents) {
      for (const share of doc.sharedWith) {
        if (share.hasAccess) {
          const sharedUserId = share.userId.toString();
          
          if (!peopleMap.has(sharedUserId)) {
            peopleMap.set(sharedUserId, {
              userId: share.userId,
              documentCount: 0,
              lastSharedAt: null,
            });
          }

          const person = peopleMap.get(sharedUserId);
          person.documentCount += 1;

          if (!person.lastSharedAt || new Date(share.sharedAt) > new Date(person.lastSharedAt)) {
            person.lastSharedAt = share.sharedAt;
          }
        }
      }
    }

    // Populate user details
    const userIds = Array.from(peopleMap.keys());
    const users = await User.find({ _id: { $in: userIds } })
      .select('name profileImage');

    const people = users.map(user => {
      const personData = peopleMap.get(user._id.toString());
      return {
        userId: user._id,
        name: user.name,
        username: user.name,
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
    const userId = req.user._id;
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
    const person = await User.findById(personId)
      .select('name profileImage');

    if (!person) {
      return res.status(404).json({
        success: false,
        message: 'Person not found',
      });
    }

    // Filter documents shared with this person
    const sharedDocuments = docSpace.documents
      .filter(doc => 
        doc.sharedWith.some(share => 
          share.userId.toString() === personId && share.hasAccess
        )
      )
      .map(doc => {
        const personShare = doc.sharedWith.find(s => 
          s.userId.toString() === personId
        );
        
        return {
          documentId: doc._id,
          documentType: doc.documentType,
          customName: doc.customName,
          fileUrl: doc.fileUrl,
          fileSize: doc.fileSize,
          uploadedAt: doc.uploadedAt,
          sharedAt: personShare.sharedAt,
          expiresAt: personShare.expiresAt,
          accessCount: personShare.accessCount || 0,
          lastAccessedAt: personShare.lastAccessedAt,
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
    const userId = req.user._id;
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
    const document = docSpace.documents.id(documentId);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    // Find and revoke access
    const shareIndex = document.sharedWith.findIndex(s => 
      s.userId.toString() === personId
    );

    if (shareIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Access not found',
      });
    }

    document.sharedWith[shareIndex].hasAccess = false;
    document.sharedWith[shareIndex].revokedAt = new Date();

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
    const userId = req.user._id;
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
    const document = docSpace.documents.id(documentId);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    // Find user's share entry
    const shareEntry = document.sharedWith.find(s => 
      s.userId.toString() === userId.toString()
    );

    if (!shareEntry || !shareEntry.hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    // Update access tracking
    shareEntry.accessCount = (shareEntry.accessCount || 0) + 1;
    shareEntry.lastAccessedAt = new Date();

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

