const DocSpace = require('../models/DocSpace');
const DocumentRequest = require('../models/DocumentRequest');
const Friend = require('../models/Friend');
const User = require('../models/userModel');
const Blob = require('../models/Blob');
const {
  validateEnvelope,
  isE2eeV2,
  e2eeDocsEnforced,
  MAX_DOC_KEY_ENTRIES,
} = require('../utils/e2eeEnvelope');
const { resolveUploadPath } = require('../utils/safeUploadPath');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;

const BLOB_ID_RE = /^[0-9a-f]{32}$/;
const DOCUMENT_ID_RE = /^[0-9a-f]{32}$/;
const DOC_TYPE_ENUM = new Set([
  'PAN Card', 'Aadhar Card', 'Voter ID Card', 'Passport', 'Driving License',
  'Birth Certificate', '10th Marksheet', '12th Marksheet',
  'Degree Certificate', 'Ration Card', 'Bank Passbook', 'Other',
]);
const DOC_CATEGORY_ENUM = new Set([
  'Identity', 'Financial', 'Medical', 'Education', 'Personal', 'Work', 'Other',
]);
const BLOB_DIR = process.env.BLOB_STORAGE_DIR || path.join(__dirname, '..', 'storage', 'blobs');
const DOC_CTX_MAX_BYTES = 256 * 1024;

/** Users currently holding a key for `document` — owner ∪ general ∪ specific. */
const docAllowedUserIds = (docSpace, documentId) => {
  const set = new Set([docSpace.userId]);
  for (const a of docSpace.generalAccessList) set.add(a.userId);
  for (const a of docSpace.documentSpecificAccess) {
    if (a.documentId === documentId && !a.isRevoked) set.add(a.userId);
  }
  return set;
};

const docCtx = (ownerId, documentId) => `doc:${ownerId}:${documentId}`;

const badDocRequest = (res, code, message, status = 400) =>
  res.status(status).json({ success: false, code, message });

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

    // ── E2EE v2 upload: JSON body { documentId, documentType, category,
    //    e2ee: { v:2, blobId, keyEnvelope } } — no multipart file. ──
    if (isE2eeV2(req.body?.e2ee)) {
      return await uploadE2eeDocument(req, res);
    }

    if (e2eeDocsEnforced()) {
      if (req.file) {
        try { await fs.unlink(req.file.path); } catch {}
      }
      return badDocRequest(
        res, 'E2EE_REQUIRED', 'Encrypted document upload is required', 403);
    }

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

/**
 * E2EE v2 document upload — no file reaches the server; the encrypted blob
 * was already POSTed to /api/blobs by the client.
 * Body: { documentId (32-hex, client-generated), documentType, category?,
 *         e2ee: { v:2, blobId, keyEnvelope, keyVersion? } }
 */
const uploadE2eeDocument = async (req, res) => {
  const userId = req.user.userId;
  const { documentId, documentType, category, e2ee } = req.body;

  if (!DOCUMENT_ID_RE.test(documentId || '')) {
    return badDocRequest(res, 'INVALID_DOCUMENT_ID', 'documentId must be 32 lowercase hex chars');
  }
  if (!DOC_TYPE_ENUM.has(documentType)) {
    return badDocRequest(res, 'INVALID_DOCUMENT_TYPE', 'Unknown document type');
  }
  if (category !== undefined && !DOC_CATEGORY_ENUM.has(category)) {
    return badDocRequest(res, 'INVALID_CATEGORY', 'Unknown category');
  }
  if (!BLOB_ID_RE.test(e2ee?.blobId || '')) {
    return badDocRequest(res, 'INVALID_BLOB', 'blobId must be 32 lowercase hex chars');
  }

  // The blob must exist and belong to the uploader — nobody may attach
  // another user's ciphertext to their doc space.
  const blob = await Blob.findOne({ blobId: e2ee.blobId, ownerUserId: userId });
  if (!blob) {
    return badDocRequest(res, 'BLOB_NOT_FOUND', 'Blob not found', 404);
  }

  const docSpace = await DocSpace.getOrCreate(userId);
  if (docSpace.documents.some(d => d.documentId === documentId)) {
    return badDocRequest(res, 'DUPLICATE_DOCUMENT', 'documentId already exists', 409);
  }
  if (docSpace.documents.length >= docSpace.settings.maxDocuments) {
    return badDocRequest(res, 'MAX_DOCUMENTS',
      `Maximum ${docSpace.settings.maxDocuments} documents allowed`);
  }

  // Envelope may only wrap keys for users who currently have access
  // (general access already covers a brand-new doc — specific access can't
  // exist yet).
  const err = validateEnvelope(
    { v: 2, envelope: e2ee.keyEnvelope },
    {
      senderId: userId,
      expectedCtx: docCtx(userId, documentId),
      allowedUserIds: docAllowedUserIds(docSpace, documentId),
      maxKeys: MAX_DOC_KEY_ENTRIES,
      maxBytes: DOC_CTX_MAX_BYTES,
    },
  );
  if (err) {
    return badDocRequest(res, err, `keyEnvelope rejected: ${err}`);
  }

  const documentData = {
    documentId,
    documentType,
    customName: '', // sealed inside the envelope payload
    category: category || 'Other',
    fileUrl: null,
    fileType: '',
    fileSize: 0,
    uploadedAt: new Date(),
    e2ee: {
      v: 2,
      blobId: e2ee.blobId,
      keyEnvelope: e2ee.keyEnvelope,
      keyVersion: Number.isInteger(e2ee.keyVersion) && e2ee.keyVersion > 0 ? e2ee.keyVersion : 1,
    },
  };

  await docSpace.addDocument(documentData);
  console.log(`✅ [DOC SPACE] E2EE document uploaded: ${documentType} for user ${userId}`);

  res.json({
    success: true,
    message: 'Document uploaded successfully',
    document: documentData,
    docSpace,
  });
};

/**
 * PUT /document/:documentId/key — owner re-seals a doc's payload key to the
 * current recipient set (grant/approve) or rotates it (revoke).
 * Body: { keyEnvelope, keyVersion, blobId? }
 *  - keyVersion === current  → same key, more recipients (no blobId)
 *  - keyVersion === current+1 → key rotation; blobId REQUIRED and must be a
 *    blob owned by the caller (the server swaps blobId atomically).
 */
exports.updateDocumentKey = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { documentId } = req.params;
    const { keyEnvelope, keyVersion, blobId } = req.body;

    const docSpace = await DocSpace.findOne({ userId });
    if (!docSpace) return badDocRequest(res, 'NOT_FOUND', 'Doc space not found', 404);

    const document = docSpace.documents.find(d => d.documentId === documentId);
    if (!document || !document.e2ee?.v) {
      return badDocRequest(res, 'NOT_FOUND', 'Encrypted document not found', 404);
    }

    const current = document.e2ee.keyVersion || 1;
    const next = Number(keyVersion);
    if (!Number.isInteger(next) || (next !== current && next !== current + 1)) {
      return badDocRequest(res, 'INVALID_KEY_VERSION',
        `keyVersion must be ${current} (re-seal) or ${current + 1} (rotation)`);
    }

    if (next === current + 1) {
      // Rotation: a new blob is mandatory and must be the caller's own.
      if (!BLOB_ID_RE.test(blobId || '')) {
        return badDocRequest(res, 'INVALID_BLOB', 'rotation requires a new blobId');
      }
      const blob = await Blob.findOne({ blobId, ownerUserId: userId });
      if (!blob) return badDocRequest(res, 'BLOB_NOT_FOUND', 'Blob not found', 404);
    } else if (blobId !== undefined) {
      return badDocRequest(res, 'UNEXPECTED_BLOB', 'blobId only allowed on rotation');
    }

    const err = validateEnvelope(
      { v: 2, envelope: keyEnvelope },
      {
        senderId: userId,
        expectedCtx: docCtx(userId, documentId),
        allowedUserIds: docAllowedUserIds(docSpace, documentId),
        maxKeys: MAX_DOC_KEY_ENTRIES,
        maxBytes: DOC_CTX_MAX_BYTES,
      },
    );
    if (err) return badDocRequest(res, err, `keyEnvelope rejected: ${err}`);

    document.e2ee.keyEnvelope = keyEnvelope;
    document.e2ee.keyVersion = next;
    if (next === current + 1) document.e2ee.blobId = blobId;
    document.markModified?.('e2ee');
    await docSpace.save();

    res.json({ success: true, keyVersion: next, blobId: document.e2ee.blobId });
  } catch (error) {
    console.error('❌ [DOC SPACE] Error updating document key:', error);
    res.status(500).json({ success: false, message: 'Failed to update document key', error: error.message });
  }
};

/**
 * Shared access check for the e2ee read paths — owner or a user with
 * general/document-specific access. Returns { docSpace, document } or
 * writes the error response and returns null.
 */
const authorizeDocAccess = async (req, res, documentIdRequired = true) => {
  const { ownerId, documentId } = req.params;
  const requesterId = req.user.userId;

  const docSpace = await DocSpace.findOne({ userId: ownerId });
  if (!docSpace) {
    badDocRequest(res, 'NOT_FOUND', 'Document not found', 404);
    return null;
  }
  const document = docSpace.documents.find(d => d.documentId === documentId);
  if (!document) {
    badDocRequest(res, 'NOT_FOUND', 'Document not found', 404);
    return null;
  }
  const isOwner = docSpace.userId === requesterId;
  if (!isOwner) {
    // NOTE: DocSpace.hasAccess ignores isRevoked/expiry, so the check is
    // done here directly — revoked or expired grantees get 403 even before
    // the owner client finishes key rotation.
    const hasGeneral = docSpace.generalAccessList.some(a => a.userId === requesterId);
    const specific = docSpace.documentSpecificAccess.find(
      a => a.documentId === document.documentId && a.userId === requesterId);
    const hasSpecific = !!specific &&
      !specific.isRevoked &&
      (!specific.expiryDate || new Date() <= new Date(specific.expiryDate));
    if (!hasGeneral && !hasSpecific) {
      badDocRequest(res, 'ACCESS_DENIED', 'Access denied', 403);
      return null;
    }
  }
  return { docSpace, document, isOwner };
};

/**
 * GET /document/:ownerId/:documentId/e2ee — the sealed record a grantee (or
 * the owner's other device) downloads to decrypt locally.
 */
exports.getDocumentE2ee = async (req, res) => {
  try {
    const found = await authorizeDocAccess(req, res);
    if (!found) return;
    const { docSpace, document } = found;

    if (!document.e2ee?.v) {
      return badDocRequest(res, 'NOT_ENCRYPTED', 'Document is not encrypted', 404);
    }

    await docSpace.logAccess(document.documentId, req.user.userId, req.user.name || 'Unknown', 'view');

    res.json({
      success: true,
      data: {
        documentId: document.documentId,
        documentType: document.documentType,
        category: document.category,
        blobId: document.e2ee.blobId,
        keyEnvelope: document.e2ee.keyEnvelope,
        keyVersion: document.e2ee.keyVersion,
      },
    });
  } catch (error) {
    console.error('❌ [DOC SPACE] Error getting e2ee document:', error);
    res.status(500).json({ success: false, message: 'Failed to get document', error: error.message });
  }
};

/**
 * GET /document/:ownerId/:documentId/blob — stream the encrypted blob to an
 * authorized reader. Grantees can't hit /api/blobs directly (owner-only), so
 * the ciphertext rides this access-checked route.
 */
exports.streamDocumentBlob = async (req, res) => {
  try {
    const found = await authorizeDocAccess(req, res);
    if (!found) return;
    const { document } = found;

    const blobId = document.e2ee?.blobId;
    if (!document.e2ee?.v || !BLOB_ID_RE.test(blobId || '')) {
      return badDocRequest(res, 'NOT_FOUND', 'Document blob not found', 404);
    }

    res.sendFile(blobId, { root: BLOB_DIR, dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ success: false, message: 'Blob not found' });
      }
    });
  } catch (error) {
    console.error('❌ [DOC SPACE] Error streaming document blob:', error);
    res.status(500).json({ success: false, message: 'Failed to stream blob', error: error.message });
  }
};

/**
 * POST /document/:documentId/migrate — owner promotes a legacy plaintext doc
 * to v2. The server verifies blob ownership + envelope + the client's
 * plaintext hash BEFORE deleting the plaintext file.
 * Body: { blobId, keyEnvelope, plaintextSha256 }
 */
exports.migrateDocument = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { documentId } = req.params;
    const { blobId, keyEnvelope, plaintextSha256 } = req.body;

    const docSpace = await DocSpace.findOne({ userId });
    if (!docSpace) return badDocRequest(res, 'NOT_FOUND', 'Doc space not found', 404);

    const document = docSpace.documents.find(d => d.documentId === documentId);
    if (!document) return badDocRequest(res, 'NOT_FOUND', 'Document not found', 404);
    if (document.e2ee?.v) {
      return badDocRequest(res, 'ALREADY_MIGRATED', 'Document is already encrypted', 409);
    }

    if (!BLOB_ID_RE.test(blobId || '')) {
      return badDocRequest(res, 'INVALID_BLOB', 'blobId must be 32 lowercase hex chars');
    }
    const blob = await Blob.findOne({ blobId, ownerUserId: userId });
    if (!blob) return badDocRequest(res, 'BLOB_NOT_FOUND', 'Blob not found', 404);

    const err = validateEnvelope(
      { v: 2, envelope: keyEnvelope },
      {
        senderId: userId,
        expectedCtx: docCtx(userId, documentId),
        allowedUserIds: docAllowedUserIds(docSpace, documentId),
        maxKeys: MAX_DOC_KEY_ENTRIES,
        maxBytes: DOC_CTX_MAX_BYTES,
      },
    );
    if (err) return badDocRequest(res, err, `keyEnvelope rejected: ${err}`);

    // The plaintext file's hash must match what the client says it encrypted —
    // a mismatch means the blob belongs to different content; do NOT migrate
    // or delete.
    if (!/^[0-9a-f]{64}$/i.test(plaintextSha256 || '')) {
      return badDocRequest(res, 'INVALID_HASH', 'plaintextSha256 must be a sha256 hex digest');
    }
    const filename = path.basename(document.fileUrl || '');
    const filePath = filename ? resolveUploadPath('documents', filename) : null;
    if (filePath) {
      try {
        const diskBytes = await fs.readFile(filePath);
        const diskSha = crypto.createHash('sha256').update(diskBytes).digest('hex');
        if (diskSha !== plaintextSha256.toLowerCase()) {
          return badDocRequest(res, 'HASH_MISMATCH', 'plaintext hash mismatch', 409);
        }
      } catch (readErr) {
        if (readErr?.code !== 'ENOENT') throw readErr;
        // File already gone — nothing left to verify; still record the
        // migration so the doc becomes encrypted.
        console.warn('⚠️ [DOC SPACE] migrate: plaintext file already missing:', filename);
      }
    }

    document.e2ee = {
      v: 2,
      blobId,
      keyEnvelope,
      keyVersion: 1,
    };
    document.fileUrl = null;
    document.customName = '';
    document.fileType = '';
    document.fileSize = 0;
    document.markModified?.('e2ee');
    await docSpace.save();

    // Plaintext deletion only AFTER the encrypted record is committed.
    if (filePath) {
      try {
        await fs.unlink(filePath);
      } catch (unlinkErr) {
        if (unlinkErr?.code !== 'ENOENT') {
          console.error('⚠️ [DOC SPACE] migrate: failed to delete plaintext:', unlinkErr.message);
        }
      }
    }

    console.log(`✅ [DOC SPACE] Document migrated to E2EE: ${documentId} for user ${userId}`);
    res.json({ success: true, message: 'Document migrated to end-to-end encryption', docSpace });
  } catch (error) {
    console.error('❌ [DOC SPACE] Error migrating document:', error);
    res.status(500).json({ success: false, message: 'Failed to migrate document', error: error.message });
  }
};

module.exports = exports;
