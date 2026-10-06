const express = require('express');
const router = express.Router();
const { serveEncryptedFile } = require('../middleware/fileEncryptionMiddleware');
const { protect } = require('../middleware/authMiddleware');
const { resolveUploadPath } = require('../utils/safeUploadPath');

/**
 * Serve encrypted files
 * All file requests go through this route for decryption
 */

const serveUpload = (subdir) => async (req, res) => {
  const filePath = resolveUploadPath(subdir, req.params.filename);
  if (!filePath) {
    return res.status(404).json({ success: false, message: 'File not found' });
  }
  await serveEncryptedFile(filePath, res);
};

// Profile images - PUBLIC ROUTE (encryption disabled, React Native Image cannot send auth headers)
router.get('/uploads/profile-images/:filename', serveUpload('profile-images'));

// Chat images
router.get('/uploads/chat-images/:filename', protect, serveUpload('chat-images'));

// Chat files (voice messages, documents)
router.get('/uploads/chat-files/:filename', protect, serveUpload('chat-files'));

// Story images - PUBLIC ROUTE (encryption disabled, React Native Image cannot send auth headers)
router.get('/uploads/story-images/:filename', serveUpload('story-images'));

// Group images
router.get('/uploads/group-images/:filename', protect, serveUpload('group-images'));

// Documents
router.get('/uploads/documents/:filename', protect, serveUpload('documents'));

// Post images
router.get('/uploads/post-images/:filename', protect, serveUpload('post-images'));

// Post videos
router.get('/uploads/post-videos/:filename', protect, serveUpload('post-videos'));

// Post media (photos and videos) - NEW
// ⚠️ PUBLIC ROUTE: No auth required because React Native Image component cannot send headers
router.get('/uploads/post-media/:filename', serveUpload('post-media'));

module.exports = router;
