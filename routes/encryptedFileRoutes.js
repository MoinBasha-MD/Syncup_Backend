const express = require('express');
const router = express.Router();
const path = require('path');
const { serveEncryptedFile } = require('../middleware/fileEncryptionMiddleware');
const { protect } = require('../middleware/authMiddleware');

/**
 * Serve encrypted files
 * All file requests go through this route for decryption
 */

// Profile images
router.get('/uploads/profile-images/:filename', protect, async (req, res) => {
  const filePath = path.join(__dirname, '../uploads/profile-images', req.params.filename);
  await serveEncryptedFile(filePath, res);
});

// Chat images
router.get('/uploads/chat-images/:filename', protect, async (req, res) => {
  const filePath = path.join(__dirname, '../uploads/chat-images', req.params.filename);
  await serveEncryptedFile(filePath, res);
});

// Chat files (voice messages, documents)
router.get('/uploads/chat-files/:filename', protect, async (req, res) => {
  const filePath = path.join(__dirname, '../uploads/chat-files', req.params.filename);
  await serveEncryptedFile(filePath, res);
});

// Story images
router.get('/uploads/story-images/:filename', protect, async (req, res) => {
  const filePath = path.join(__dirname, '../uploads/story-images', req.params.filename);
  await serveEncryptedFile(filePath, res);
});

// Group images
router.get('/uploads/group-images/:filename', protect, async (req, res) => {
  const filePath = path.join(__dirname, '../uploads/group-images', req.params.filename);
  await serveEncryptedFile(filePath, res);
});

// Documents
router.get('/uploads/documents/:filename', protect, async (req, res) => {
  const filePath = path.join(__dirname, '../uploads/documents', req.params.filename);
  await serveEncryptedFile(filePath, res);
});

// Post images
router.get('/uploads/post-images/:filename', protect, async (req, res) => {
  const filePath = path.join(__dirname, '../uploads/post-images', req.params.filename);
  await serveEncryptedFile(filePath, res);
});

// Post videos
router.get('/uploads/post-videos/:filename', protect, async (req, res) => {
  const filePath = path.join(__dirname, '../uploads/post-videos', req.params.filename);
  await serveEncryptedFile(filePath, res);
});

// Post media (photos and videos) - NEW
// ⚠️ PUBLIC ROUTE: No auth required because React Native Image component cannot send headers
router.get('/uploads/post-media/:filename', async (req, res) => {
  const filePath = path.join(__dirname, '../uploads/post-media', req.params.filename);
  await serveEncryptedFile(filePath, res);
});

module.exports = router;
