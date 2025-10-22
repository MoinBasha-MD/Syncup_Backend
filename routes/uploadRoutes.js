const express = require('express');
const router = express.Router();
const { 
  uploadProfileImage, 
  uploadStoryImage, 
  uploadChatImage, 
  uploadChatFile, 
  uploadPostMedia,
  profileUploadMiddleware, 
  storyUploadMiddleware, 
  chatUploadMiddleware, 
  chatFileUploadMiddleware,
  postMediaUploadMiddleware
} = require('../controllers/uploadController');
const { protect } = require('../middleware/authMiddleware');

// Route for uploading profile image
router.post('/profile-image', protect, profileUploadMiddleware, uploadProfileImage);

// Route for uploading story image
router.post('/story-image', protect, storyUploadMiddleware, uploadStoryImage);

// Route for uploading chat image
router.post('/chat-image', protect, chatUploadMiddleware, uploadChatImage);

// Route for uploading chat files (documents, audio, video, etc.)
router.post('/chat-file', protect, chatFileUploadMiddleware, uploadChatFile);

// Route for uploading post media (photos and videos)
router.post('/post-media', protect, postMediaUploadMiddleware, uploadPostMedia);

module.exports = router;
