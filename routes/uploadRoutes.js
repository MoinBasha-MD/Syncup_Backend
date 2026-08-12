const express = require('express');
const router = express.Router();
const { 
  uploadProfileImage, 
  uploadStoryImage, 
  uploadChatImage, 
  uploadChatFile, 
  uploadPostMedia,
  uploadPageProfileImage,
  uploadPageCoverImage,
  profileUploadMiddleware, 
  storyUploadMiddleware, 
  chatUploadMiddleware, 
  chatFileUploadMiddleware,
  postMediaUploadMiddleware,
  pageProfileUploadMiddleware,
  pageCoverUploadMiddleware
} = require('../controllers/uploadController');
const { protect } = require('../middleware/authMiddleware');
const { uploadLimiter } = require('../middleware/securityMiddleware');

// Apply authentication and per-user upload rate limiting to all upload routes
router.use(protect, uploadLimiter);

// Route for uploading profile image
router.post('/profile-image', profileUploadMiddleware, uploadProfileImage);

// Route for uploading story image
router.post('/story-image', storyUploadMiddleware, uploadStoryImage);

// Route for uploading chat image
router.post('/chat-image', chatUploadMiddleware, uploadChatImage);

// Route for uploading chat files (documents, audio, video, etc.)
router.post('/chat-file', chatFileUploadMiddleware, uploadChatFile);

// Route for uploading post media (photos and videos)
router.post('/post-media', postMediaUploadMiddleware, uploadPostMedia);

// ✅ Route for uploading page profile image
router.post('/page-profile-image', pageProfileUploadMiddleware, uploadPageProfileImage);

// ✅ Route for uploading page cover image
router.post('/page-cover-image', pageCoverUploadMiddleware, uploadPageCoverImage);

module.exports = router;
