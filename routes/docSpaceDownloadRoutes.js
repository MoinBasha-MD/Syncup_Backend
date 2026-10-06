const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { protect } = require('../middleware/authMiddleware');
const { resolveUploadPath } = require('../utils/safeUploadPath');
const DocSpace = require('../models/DocSpace');

/**
 * Locate the DocSpace document a filename belongs to and authorize access.
 * Only the owner or a user with current (non-revoked, non-expired) general
 * or document-specific access may read. Returns { document } or null —
 * callers respond 404 for everything unauthorized so existence isn't leaked.
 */
const findAuthorizedLegacyDoc = async (filename, userId) => {
  const docSpace = await DocSpace.findOne({
    'documents.fileUrl': { $regex: filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$' }
  });
  if (!docSpace) return null;

  const document = docSpace.documents.find(
    d => (d.fileUrl || '').endsWith(`/${filename}`) || d.fileUrl === filename
  );
  if (!document || document.e2ee?.v) return null;
  if (docSpace.userId === userId) return { document };

  const hasGeneral = docSpace.generalAccessList.some(a => a.userId === userId);
  const specific = docSpace.documentSpecificAccess.find(
    a => a.documentId === document.documentId && a.userId === userId);
  const hasSpecific = !!specific &&
    !specific.isRevoked &&
    (!specific.expiryDate || new Date() <= new Date(specific.expiryDate));

  return (hasGeneral || hasSpecific) ? { document, docSpace } : null;
};

/**
 * View document (inline) with proper headers
 * GET /api/doc-space-download/view/:filename
 * IMPORTANT: This must come BEFORE /:filename route
 */
router.get('/view/:filename', protect, async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = resolveUploadPath('documents', filename);

    console.log('👁️ [VIEW] Request for file:', filename);

    if (!filePath) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error('❌ [VIEW] File not found:', filePath);
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Authorize before streaming: owner or current grantee only; anything
    // else (stranger, revoked, expired, unknown file, e2ee doc) → 404.
    const authorized = await findAuthorizedLegacyDoc(filename, req.user.userId);
    if (!authorized) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Get file stats
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;

    // Only allow PDF files
    const ext = path.extname(filename).toLowerCase();
    if (ext !== '.pdf') {
      console.error('❌ [VIEW] Only PDF files are supported:', ext);
      return res.status(400).json({
        success: false,
        message: 'Only PDF files can be viewed'
      });
    }

    // Set headers for inline viewing
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    
    fileStream.on('error', (error) => {
      console.error('❌ [VIEW] Stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error streaming file'
        });
      }
    });

    fileStream.pipe(res);

    fileStream.on('end', () => {
      console.log('✅ [VIEW] PDF sent successfully');
    });

  } catch (error) {
    console.error('❌ [VIEW] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to view file',
      error: error.message
    });
  }
});

/**
 * Download document with proper headers
 * GET /api/doc-space-download/:filename
 */
router.get('/:filename', protect, async (req, res) => {
  try {
    const { filename } = req.params;
    const userId = req.user.userId;
    const filePath = resolveUploadPath('documents', filename);

    console.log('📥 [DOWNLOAD] Request for file:', filename);

    if (!filePath) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error('❌ [DOWNLOAD] File not found:', filePath);
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Authorize before streaming: owner or current (non-revoked,
    // non-expired) grantee only; everything else → 404 (existence stays
    // opaque — same for unknown files and e2ee docs).
    const authorized = await findAuthorizedLegacyDoc(filename, userId);
    if (!authorized) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    const { document, docSpace } = authorized;
    const isOwner = docSpace ? docSpace.userId === userId : true;
    if (!isOwner && docSpace) {
      await docSpace.logAccess(document.documentId, userId, req.user.name || 'Unknown User', 'download');
      console.log('✅ [DOWNLOAD] Access granted to authorized grantee');
    } else {
      console.log('✅ [DOWNLOAD] Owner downloading their own document');
    }

    // Get file stats
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;

    // Only allow PDF files
    const ext = path.extname(filename).toLowerCase();
    if (ext !== '.pdf') {
      console.error('❌ [DOWNLOAD] Only PDF files are supported:', ext);
      return res.status(400).json({
        success: false,
        message: 'Only PDF files can be downloaded'
      });
    }

    console.log('📥 [DOWNLOAD] File size:', fileSize);

    // Set headers for download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    
    fileStream.on('error', (error) => {
      console.error('❌ [DOWNLOAD] Stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error streaming file'
        });
      }
    });

    fileStream.pipe(res);

    fileStream.on('end', () => {
      console.log('✅ [DOWNLOAD] File sent successfully');
    });

  } catch (error) {
    console.error('❌ [DOWNLOAD] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download file',
      error: error.message
    });
  }
});

module.exports = router;
