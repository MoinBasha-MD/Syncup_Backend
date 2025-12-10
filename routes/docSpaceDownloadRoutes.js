const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { protect } = require('../middleware/authMiddleware');
const DocSpace = require('../models/DocSpace');

/**
 * View document (inline) with proper headers
 * GET /api/doc-space-download/view/:filename
 * IMPORTANT: This must come BEFORE /:filename route
 */
router.get('/view/:filename', protect, async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, '../uploads/documents', filename);

    console.log('👁️ [VIEW] Request for file:', filename);
    console.log('👁️ [VIEW] File path:', filePath);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error('❌ [VIEW] File not found:', filePath);
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
    const filePath = path.join(__dirname, '../uploads/documents', filename);

    console.log('📥 [DOWNLOAD] Request for file:', filename);
    console.log('📥 [DOWNLOAD] User:', userId);
    console.log('📥 [DOWNLOAD] File path:', filePath);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error('❌ [DOWNLOAD] File not found:', filePath);
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // ⚡ FIX: Check download permissions
    // Find the document and check if user has download permission
    const docSpace = await DocSpace.findOne({
      'documents.fileUrl': { $regex: filename }
    });

    if (!docSpace) {
      console.error('❌ [DOWNLOAD] Document not found in DocSpace');
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    const document = docSpace.documents.find(d => d.fileUrl.includes(filename));
    if (!document) {
      console.error('❌ [DOWNLOAD] Document not found');
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }

    // Check if user is the owner
    const isOwner = docSpace.userId === userId;

    if (!isOwner) {
      // Check if user has download permission
      const accessEntry = docSpace.documentSpecificAccess.find(access => 
        access.documentId === document.documentId && 
        access.userId === userId &&
        !access.isRevoked
      );

      if (!accessEntry) {
        console.error('❌ [DOWNLOAD] No access permission');
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to download this document'
        });
      }

      // Check if access has expired
      if (accessEntry.expiryDate && new Date() > new Date(accessEntry.expiryDate)) {
        console.error('❌ [DOWNLOAD] Access expired');
        return res.status(403).json({
          success: false,
          message: 'Access expired'
        });
      }

      // Check if user has download permission
      if (accessEntry.permissionType === 'view') {
        console.error('❌ [DOWNLOAD] View-only permission');
        return res.status(403).json({
          success: false,
          message: 'You only have view permission. Download not allowed.'
        });
      }

      // ⚡ FIX: Check download limit
      if (accessEntry.downloadLimit && accessEntry.downloadCount >= accessEntry.downloadLimit) {
        console.error('❌ [DOWNLOAD] Download limit reached');
        return res.status(403).json({
          success: false,
          message: `Download limit reached (${accessEntry.downloadLimit} downloads)`
        });
      }

      // ⚡ FIX: Track download
      accessEntry.downloadCount = (accessEntry.downloadCount || 0) + 1;
      accessEntry.lastAccessedAt = new Date();
      
      // Add to access log
      document.accessLog.push({
        userId: userId,
        userName: req.user.name || 'Unknown User',
        accessedAt: new Date(),
        accessType: 'download',
      });

      await docSpace.save();
      
      console.log(`📊 [DOWNLOAD TRACKING] Download count updated: ${accessEntry.downloadCount}/${accessEntry.downloadLimit || 'unlimited'}`);
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
